# ADR 0016: Check-in Responses, Submission, Review and Comparison v1

Status: accepted, 2026-08-25

## Context

Phase 6A-1 built the authoring half of check-ins: a form lineage, draft versions, published
immutable versions, and assignments that name one published version. A client could read what they
were asked and nothing more. This decides how they answer it, how an answer becomes a record, and
how two records are read together.

The hard part is not storing answers. It is making sure that a submitted check-in still means, a
year later, exactly what it meant when it was submitted — including the wording of the question it
answers — and that nothing in the schema invites a future chunk to score, rate, or interpret it.

## Decision

**Typed answers, never a JSON blob.** One `CheckInAnswer` row per answered question with `TextValue`
and `NumericValue` columns, plus `CheckInAnswerChoice` rows for selections. A blob would have made
every invariant below a matter of application code remembering to check.

**The answer chain is enforced by referential integrity, not by code paths.** Each foreign key
deliberately carries its parent's discriminating columns as well as the ones needed to find a row:

```text
CheckInAnswers (TenantId, ResponseId, FormVersionId)
  -> CheckInResponses (TenantId, Id, FormVersionId)          -- answer's version == response's version
CheckInAnswers (TenantId, FormVersionId, QuestionId, QuestionType)
  -> CheckInQuestions (TenantId, FormVersionId, Id, QuestionType)  -- question is of that version, type matches
CheckInAnswerChoices (TenantId, AnswerId, QuestionId)
  -> CheckInAnswers (TenantId, Id, QuestionId)               -- choice's question == answer's question
CheckInAnswerChoices (TenantId, QuestionId, QuestionOptionId)
  -> CheckInQuestionOptions (TenantId, QuestionId, Id)       -- option is one of that question's options
```

Every version owns its own question and option rows, so "an option from another version" is an
option of another question and the last key refuses it. Answering a question belonging to a
different version of the same lineage is refused by the second. Neither refusal depends on a code
path someone could forget, and a check constraint ties `QuestionType` to the column that may be
populated. This required three additive unique constraints on 6A-1 tables; no 6A-1 behaviour
changed.

**Snapshotting is by immutability, not by copying.** A submission renders its original wording by
reading the published version's own frozen rows. Question and option text is never denormalised into
an answer, because two copies of the same sentence eventually disagree and the copy is the one that
gets shown. Publishing a later version therefore cannot touch an existing submission, and the test
that proves it publishes v2 and re-reads the v1 submission.

**One `CheckInResponse` per assignment, `Draft` -> `Submitted` -> `Reviewed`, one way.** A trigger
permits only those transitions, refuses deletes, freezes identity, and refuses any change to a
reviewed row or to the moment a submission happened. Answer and choice rows are frozen by their own
triggers as soon as the response leaves `Draft` — on `INSERT` as well as `UPDATE` and `DELETE`,
because adding a late answer to a submitted check-in would rewrite the record just as much as
editing one. This mirrors ADR 0015 rather than inventing a second lifecycle shape.

**Drafts are lenient, submission is strict.** A draft may be partial, may hold a number outside the
question's range, and may be saved repeatedly, because a client filling a form in over several
sittings should never lose what they typed. Structure is still enforced in a draft — an answer must
belong to a question of the assigned version, a selection to that question — since those are not
opinions a later submission could repair. Submission validates the whole response in one pass and
returns **every** failure together: required answers, numeric range, numeric step, choice
membership, and single-choice arity. Reporting the first failure only would make a ten-question form
a ten-round conversation.

**A draft is private to the client who is writing it.** Submission is what makes an answer a record
addressed to the coach; before it, what has been typed is working material and half a sentence read
out of context is worse than no sentence. The coach's read of an unsubmitted response therefore
returns the response with its status, its identity and its dates, and **no answers at all**, with
`AnswersWithheld` set so an empty list is never mistaken for a client who started and wrote nothing.
The client's own read is unchanged and complete: this is privacy from the coach, not from everyone.

The redaction is in the mapping the API contract is built from — `CheckInResponseApplicationService`
decides the audience once, in `ToDetail` — rather than in the screen that renders it. Angular hiding
a field is presentation; a coach reading the JSON directly is what the rule has to hold against. The
coach's assignment list is built from `CheckInAssignmentResponseSummary`, which carries status and
dates and has no field an answer could travel in.

**Concurrent first saves are settled by the unique index, not by the pre-check.** Two saves that
both find no response both try to start one; the unique index on `(TenantId, AssignmentId)` admits
exactly one and the loser receives a stable `409` with code `CheckInResponseAlreadyStarted`. Only
that violation is caught — an unrelated `DbUpdateException` stays a failure rather than being
reported as a conflict that did not happen. This is the same shape the concurrent submit and review
already used; the first save was the one path that had no equivalent and produced a `500`.

**The assignment list carries response status, and is paged.** A coach's screen needs to know which
check-ins are outstanding, submitted and reviewed. It used to work that out by listing the
assignments and then fetching every response in full — one request per assignment, growing without
limit with the relationship, and reading draft content on the way. The status now travels with the
list, and reading one response's content is a separate, separately authorized request for one
assignment. The list is paged (default 50, maximum 200) with the total reported, because an
assignment list grows for the life of the coaching relationship.

**Review is a state change plus an append-only event, and never touches an answer.** Re-reviewing is
refused. A unique index on `(ResponseId, EventType)` is what actually settles a concurrent submit or
review: both racers pass the in-memory check and exactly one commits.

**Comparison is a read-side projection.** No tables, no copied data. Both responses must be
`Submitted` or `Reviewed` and in the same lineage, otherwise it refuses with a stable code. Rows
align by `QuestionKey`, and each side carries its own version's wording so a re-worded question shows
both wordings rather than one standing in for both. A question present in only one version is
reported as one-sided; it is never dropped and never rendered as an empty answer on a side that was
never asked it, because "not asked" and "asked and left blank" are different facts.

**Entitlement is a property of the client's enrollment, not of who is asking.** Every response route
resolves `CoachingFeature.CheckIns` through `ICoachingFeatureAccessService` before it reads or writes
anything, and coach routes inherit relationship blocking from the same decision. When a client's
entitlement lapses, check-ins close **for that client entirely** — for the client and for the coach's
view of that client — which is the rule 6A-1 already applies to assignments. Nothing is deleted: the
submission and its answers stay on disk, so restoring the enrollment restores the view rather than
recovering lost data. Applying a softer rule to responses than to the assignments they answer would
have let a client read their answers while the questions were unreachable, which is not a readable
record.

**Lateness is a fact, not a judgement.** The workspace-local `SubmittedDate` is stored, because the
workspace time zone can change later and that would silently re-date a submission that already
happened. `IsLate` is derived from it against the due date and is never persisted. There is no
compliance rating, streak, adherence percentage or score anywhere in this chunk, and no schema
affordance for one.

## Consequences and deferred work

Nothing is weakened: tenant isolation, the write-scope guard, relationship blocking, entitlement
evaluation, published-version immutability, optimistic concurrency, append-only audit and
same-user-multiple-workspace separation are all unchanged.

The shared client-access decision moved into `CheckInAccessResolver`, used by both the authoring and
response services. It replaced a private copy in the authoring service rather than adding a second
implementation of an authorization rule, which is the kind of duplication that drifts into a hole.

Rolling this migration back deletes every recorded answer, submission and review; that is stated in
the `Down` method rather than left to fail at runtime.

Deferred: recurring scheduling, tasks and habits, notifications and reminders, comments and chat on
a check-in, SignalR, signatures, file uploads, conditional branching, AI interpretation, exports,
and any coach-facing list of outstanding check-ins across clients. Comparison is limited to two
responses of one lineage; comparing more than two, or charting one question over time, is Phase 6B
work and would need a decision about what a series of recorded values may and may not imply.

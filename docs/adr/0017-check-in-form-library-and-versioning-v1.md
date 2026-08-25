# ADR 0017: Check-in Form Library and Versioning v1

Status: accepted, 2026-08-25

Recorded after ADR 0016 although it describes the earlier chunk (Phase 6A-1). 6A-1 shipped without
its ADR; this fills that gap rather than renumbering an ADR that other documents already cite.

## Context

Coaches need to ask clients the same set of questions repeatedly, to change those questions over
time, and to still be able to read an answer given a year ago and know exactly what was asked. Those
three requirements pull against each other: a form that can be edited freely cannot also be a
reliable record of what someone was asked.

This is also the first production consumer of `CoachingFeature.CheckIns`, which existed in
`FeatureAccess.cs` since Phase 2 with nothing using it.

## Decision

**A form is a lineage; a version is the unit of truth.** `CheckInForm` owns identity, title and
status. Each `CheckInFormVersion` owns an ordered question set. Editing published content derives a
new draft version rather than mutating the one clients were already asked. At most one open draft
exists per lineage, enforced by a partial unique index on an `IsDraft` predicate column with a check
constraint tying it to `Status` — the same shape the bodyweight active-observation index uses, so
the two cannot drift.

**Publishing freezes a version permanently, at the database.** `TR_CheckInFormVersions_Protect`
refuses any update to a published row and refuses deletes outright; sibling triggers do the same for
its question and option rows. The application refuses these too, but a migration, a repair script or
a future background job would not pass through the domain. Publishing is one-way: a second publish
is refused rather than silently ignored.

**Every question carries a stable `QuestionKey`.** It is a 32-character hex identity generated once
on first authoring, regex-constrained at the database, frozen against change by trigger, and copied
forward unchanged into every later version of the lineage. The row id does not survive — each
version owns its own rows — so the key is what lets a re-worded question stay the same question for
anything that later compares versions. A caller may not invent one: a supplied key must already
belong to the lineage, otherwise the alignment that comparison depends on could be silently broken.

**Ordering contiguity and per-version key uniqueness are deferred constraint triggers, not unique
indexes.** Editing a draft replaces its whole question set, and a plain unique index would reject the
intermediate state of that one transaction even though the committed state is correct. Deferring
moves the check to commit, where the answer is the one that matters.

**An assignment targets a specific published version, never the lineage.** `CheckInAssignment` pins
one published version, one tenant-local client and one workspace-local due date, and
`TR_CheckInAssignments_Protect` refuses both deletion and any repointing of `FormVersionId`.
Assigning an unpublished version is refused because its wording can still change; a due date already
past in the workspace time zone is refused because it asks for something that can no longer be
delivered on time. Today is accepted, so the boundary is the workspace's own date rather than
"strictly future".

**Question types in v1** are short text, long text, single choice, multiple choice and numeric scale.
A numeric scale validates that `min < max` and that the step divides the range exactly, in both the
domain and a check constraint — PostgreSQL numeric modulo is exact, so the database performs the same
arithmetic rather than an approximation of it. A scale whose step cannot land on its maximum is
rejected outright rather than silently truncated, because the client would otherwise be shown
positions the coach never chose.

**Authorization: `/api/checkins/forms/*` deliberately does not evaluate `CoachingFeature.CheckIns`.**
This is a decision, not an oversight, and it is the one place Phase 6A departs from the instruction
that check-in APIs evaluate the shared access port.

*Rationale.* `ICoachingFeatureAccessService.EvaluateAsync` takes a `clientProfileId` and answers a
question about one named client: is *this* person's enrollment active, paid, unblocked and in date
for *this* feature. An authoring route has no client subject, so there is no argument to give it.
Making authoring "evaluate" would mean inventing a subject — a synthetic client, an any-client
disjunction, or a new workspace-scoped entitlement — and each of those is a new concept in the
commercial model rather than a use of the existing one.

*Why an unentitled workspace is not a concept here.* Entitlement in this system is dated and
per-client: `CoachingProduct` -> immutable `ProductOffer` -> `ClientEnrollment` for one client over
one date range. Nothing entitles a *workspace*. A workspace with no enrolled clients is not an
unentitled workspace; it is a new one, and its coach must be able to author before a first client
exists or the product could never be started. Conversely a workspace whose every enrollment has
lapsed still owns its form library — the forms are the coach's own work, not the clients'.

*Boundary.* Authoring is gated on the coach role (`AuthorizationPolicies.TenantCoach`) plus tenant
isolation: the global query filter, the write-scope guard and tenant-aware constraints, with
antiforgery on every state change and rate limiting on the expensive writes. That boundary admits
exactly one thing — a coach of this workspace reading and writing this workspace's own form
lineages. It reaches no client, no answer, and no other tenant. The moment a route names a client —
assignment, the coach's read of a submission, review, comparison, and the client's own read and
write — `CoachingFeature.CheckIns` is resolved through `ICoachingFeatureAccessService`, which is
where membership, platform block, workspace-local relationship block, entitlement and payment state
are decided together. No bespoke check was added anywhere.

*Cost of being wrong.* A coach whose clients are all unentitled can still author and publish forms
they cannot assign. That is a wasted-effort outcome, not an access leak: no client row, no
assignment and no answer is reachable from any authoring route, and assignment itself is refused.
If workspace-level entitlement ever becomes real — a plan that sells the check-in *builder* rather
than a client's coverage — this is the decision to revisit, and it needs a commercial concept
first, not an extra call here.

**The client surface in this chunk is read-only.** A client lists their assignments and reads the
assigned version's questions and options. Answering is 6A-2 (ADR 0016).

## Consequences and deferred work

Nothing is weakened: tenant isolation, the write-scope guard, relationship blocking, entitlement
evaluation, optimistic concurrency, append-only audit and same-user-multiple-workspace separation are
all unchanged.

The cost of immutability is row growth: every version duplicates its whole question and option set
rather than sharing rows. That is deliberate — sharing rows across versions is what would make a
later edit reach backwards into an existing assignment.

Archiving is a separate reversible flag rather than a third status value, so restoring a form never
has to guess which of Draft or Published it was.

Rolling this migration back discards every authored form, published version and assignment in the
workspace; there is nowhere else that content lives. That is stated in the `Down` method rather than
left to fail at runtime.

Deferred: responses and everything downstream of them (delivered in 6A-2), recurring scheduling,
tasks and habits, notifications, comments, signatures, file uploads, conditional branching and AI
interpretation. No question or answer is interpreted: nothing derives a score, rating, flag or
conclusion from check-in content, and the schema leaves no affordance for one.

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

**Authorization.** Authoring is workspace content: it names no client, so it is gated on the coach
role and tenant isolation alone and evaluates no entitlement. Every route that names a client —
assignment, and the client's own read — resolves `CoachingFeature.CheckIns` through
`ICoachingFeatureAccessService`, which is where membership, platform block, workspace-local
relationship block, entitlement and payment state are decided together. No bespoke check was added.

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

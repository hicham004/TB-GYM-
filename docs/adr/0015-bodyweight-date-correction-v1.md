# ADR 0015: Bodyweight Date Correction v1

Status: accepted, 2026-08-24

## Context

A weight logged against the wrong day was uncorrectable. `BodyweightCorrection` fixes a wrong
*value* by superseding it in place, but the measurement date is the observation's identity: the
unique index is keyed on it, and `TR_BodyweightObservations_ProtectIdentity` refuses to let an
`UPDATE` change it. The only remedies available to a user were to leave a false fact in the record
or to have someone delete the row, and deleting is refused too. Meanwhile the date the entry
actually belonged to might already be occupied, or might need to stay usable afterwards.

## Decision

**Correcting a date is void-and-replace, never an in-place date change.** The mis-dated observation
is withdrawn and a replacement is recorded on the date the weight was actually taken. The date stays
immutable in the domain and at the database, so there is exactly one way to move an entry and it
leaves a trail. The value is carried across untouched: a wrong number is the existing value
correction, and conflating the two would let one request rewrite both what was measured and when.

**Voiding is modelled exactly like progress-photo removal**: a `Status` of `Active` or `Voided` on
the observation plus an append-only `BodyweightObservationVoid` carrying the actor, the reason, the
moment, and the replacement it was superseded by. The reason is required. The original row is
retained with its recorded facts intact, because a correction has to be visible to be auditable —
erasing the mistake would erase the evidence that it was corrected.

**One-way, and enforced by the database, not only by the application.** The trigger permits a status
transition only from `Active` to `Voided`, refuses a value change smuggled into the same statement,
and freezes a voided row against any further update. Identity, date and creation audit remain
immutable as before. `MarkTombstoned`-style application checks would be the only guard otherwise,
and a background job or a future migration would bypass them.

**The unique index becomes partial on the active predicate.** A total index would have let a voided
row hold its date forever, so a date corrected away from could never be logged again — the same
shape as the nutrition plan overlap reservation, and fixed the same way: a redundant `IsActive`
column with `CK_BodyweightObservations_IsActive` tying it to the status so the two cannot drift.
One weight per client per local date still holds for current truth; a voided row keeps its date
without reserving it.

**Void and replacement commit together or not at all.** Both happen in one `SaveChanges`, therefore
one transaction. The target date is checked first so an occupied date gets a precise message, but
the partial unique index is what actually guarantees it under a concurrent write: a collision rolls
the whole operation back and the original stays `Active`, never partially voided. Optimistic
concurrency on the original is unchanged, and authorization is unchanged — the client over their own
data, a coach only while the relationship is not blocked.

**Every current-truth read excludes voided rows**, and there are eight of them: the duplicate-date
check when recording, the load before a value correction, the day/week/trend projection, the
dashboard bodyweight section, the onboarding earliest-observation lookup, the target-date check and
the load in the new operation itself. The onboarding one matters most: it picks the earliest
observation as the authoritative first weigh-in, so a voided entry would otherwise become a client's
onboarding weight. The audit read is the deliberate exception — it still resolves a voided
observation, now with its void record attached.

A voided entry can no longer be value-corrected or re-voided. That is reported as a conflict rather
than a not-found, because the entry does exist; it simply is not current truth any more.

## Consequences and deferred work

Nothing is weakened: date immutability, deletion refusal, one-entry-per-day for active observations,
optimistic concurrency, append-only correction history, tenant isolation and coach blocking are all
unchanged, and the value-correction path is untouched.

Rolling this migration back deletes voided observations, because reinstating a total unique index
would make a voided row collide with its replacement. That is stated in the `Down` method rather
than left to fail at runtime.

Deferred: voiding an observation outright without a replacement (the schema already allows a null
replacement, but no endpoint offers it), bulk re-dating of several entries, the same date correction
for body measurements and progress photos, and any automatic detection of entries that look
mis-dated.

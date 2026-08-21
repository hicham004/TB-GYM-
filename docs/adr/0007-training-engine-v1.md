# ADR 0007: Training Engine v1

Status: accepted, 2026-08-20

## Context

TB Gym needs strength programming that is fast for a coach without making templates,
client prescriptions, and completed performance the same mutable object. Product research
confirmed that established coaching systems emphasize reusable programming plus fast copy
operations, while client assignment behavior varies: Everfit and TrainHeroic expose week or
session copy operations, Trainerize distinguishes master and client programs, and TrueCoach
makes prior exercise performance available during programming. Those workflows informed
the interaction design; their data models were not copied.

Resistance-training RPE/RIR and estimated 1RM are useful estimates, not physiological truth.
The implementation therefore needs named, versioned calculations and durable inputs rather
than one ambiguous `1RM` field or opaque generated loads.

## Decision

The Exercise Library, Training, Strength, and Media modules remain separate bounded modules.
Infrastructure coordinates their public contracts in one local transaction where required;
the modules do not reference each other directly.

Training uses the following distinct lifecycles:

1. `ProgramTemplate` is reusable identity with optimistic concurrency.
2. `ProgramTemplateVersion` is an immutable week/session/prescription/set tree. Publication
   is a one-way state change. Editing creates a new version.
3. `SavedSessionTemplate` points to an immutable source session; reusing it copies content.
4. `TrainingMesocycle` is a deep client-specific assignment snapshot with source provenance,
   enrollment, start date, workspace time-zone snapshot, rounding policy, and working maxes.
5. `WorkoutExecution` takes another snapshot when the client starts. Prescribed values and
   actual performance are separate children. Later future-program changes cannot rewrite it.

One enrollment may authorize zero, one, or multiple sequential mesocycles. Enrollment is
not a mesocycle. Assignment, rescheduling, and progression apply use one Training-owned
coverage policy; the complete resulting period must fit inside one training entitlement.
Phase 3 permits primary mesocycles only and rejects intersecting primary periods for the same
tenant/client in both the domain service and a PostgreSQL GiST exclusion constraint.
Supplemental vocabulary is reserved but not enabled.

Planned and Active are date-derived in the snapshotted workspace time zone. Completed and
Cancelled are explicit terminal states. Cancellation is audited, retains the assigned tree
and completed history, and releases the primary-overlap block. Completion requires every
programmed session to be complete. Terminal mesocycles cannot be edited.

Week 1 begins on the explicit mesocycle start date. Each later week begins seven days later;
session day offsets are 0 through 6. The workspace IANA time zone is snapshotted. A published
week is client-visible when its local unlock date has arrived, unless the coach enables
`RevealAllWeeks`. Rescheduling changes only sessions that have not started; completed dates
remain historical facts.

Each prescription has `Locked` or `CoachApprovedSwap`. Marking a prescription as a main lift
forces `Locked`. A client substitution must be one of the alternatives captured in that
prescription and creates actual-performance state; it never edits the prescription.
Completed workouts remain in the client's dated read model for their scheduled local day,
even when that completion also makes the mesocycle terminal. Actual load entry requires a
unit; an unweighted prescription does not create an implicit kg/lb choice.

Strength max observations are append-only and distinguish tested 1RM, estimated 1RM, and
coach working max, with date, unit, source, method key/version, and evidence reference. Every
calculated lift receives a mesocycle working-max snapshot. Phase 3 deliberately performs no
implicit kg/lb conversion. A later global max does not rebase a mesocycle automatically.

Canonical exertion is RPE. Accepted RPE is 5 through 10 and accepted RIR is 0 through 5,
both in 0.5 steps; RIR maps to `10 - RPE`. This is a coaching convention and subjective
estimate. Epley v1 supports 1-12 repetitions, Brzycki v1 supports 1-10, and both retain their
method/version. `WorkingMaxLoad` v2 supports direct load, percentage of captured working max,
and an inverse-Epley-shaped RPE recommendation based on prescribed repetitions plus RIR. It
does not estimate or imply a true 1RM. Effective repetitions cannot exceed 12. The strategy
retains unrounded and practical rounded load plus an explanation. Rounding uses the mesocycle
unit, configurable positive increment, and nearest, down, or up mode. A positive target that
would silently round to zero is rejected; an explicit coach override always wins.

Progression v1 is `Duplicate -> Transform -> Preview -> Apply`. It generates new weeks from
selected source weeks and changes eligible RPE targets by a 0.5-step increment. Preview is
not persistence. Apply recomputes the result and requires the SHA-256 preview hash and
current mesocycle concurrency token to match; the application record is append-only.
Preview reports entitlement overflow, and apply independently recomputes and rejects it.

Uploaded exercise media uses generated tenant-scoped object keys, streaming size limits,
file-signature validation, SHA-256 checksums, a scanner port, private authorization, and
short-lived user/tenant/asset-bound access tokens. Production denies publication when no
scanner is configured. The authorized metadata endpoint issues an HTTP-only, path-scoped,
short-lived grant cookie so native `<img>` and `<video>` requests do not depend on
`X-Tenant-Id`; the content endpoint restores the cryptographically bound tenant and
reauthorizes the authenticated user and current entitlement. Range responses are enabled.
The grant's absolute expiry travels inside its protected payload and is enforced against
`IClock`, so expiry is deterministic under test rather than tied to a provider wall clock.
`Media:AccessLifetimeSeconds` accepts 60 seconds to 4 hours and defaults to 1800, sized for a
viewing session that includes pausing and seeking; because every content request reauthorizes,
a shorter lifetime would break playback without improving revocation.
External media is restricted to validated YouTube or Vimeo IDs and privacy-oriented embed
URLs. Uploads are streamed, rate/concurrency limited, and subject to a configurable workspace
quota. Referenced deletion becomes a tombstone; physical purge remains a later retention job.
Docker's local object store and data-protection keys use named volumes; production must use
managed object storage, shared key protection, scanning, and a CDN/private delivery strategy.

## Database protections

- Tenant-composite foreign keys protect tenant ownership throughout each aggregate graph.
- Template content, append-only max records/snapshots/notes/progression applications, and
  completed workout history are protected by PostgreSQL triggers.
- Started/completed session prescriptions and workout snapshots cannot be rewritten.
- Primary mesocycle overlap is protected against concurrent races by an exclusion constraint.
- Trigram indexes support tenant-scoped exercise and tag search.
- `xmin` protects mutable roots; generated progression also carries a content hash.

## Consequences

- Coaches can evolve templates and future client work without mutating historical truth.
- A client sees a focused dated workout while the coach retains precise prescribed-versus-
  performed history, including immediately after completion.
- Formula output is reproducible and explainable but must never be marketed as exact.
- Supplemental programs, explicit working-max rebasing, completion corrections, arbitrary
  assigned-tree surgery, additional progression transforms, analytics/PR dashboards, and
  production media providers require later approved work.
- Phase 4 is nutrition and meal planning. It must not reuse training entities or start
  without approval and the BMR/TDEE decisions in `DOMAIN-RULES.md`.

# ADR 0014: Media Purge and Storage Quotas v1

Status: accepted, 2026-08-23

## Context

Phase 3 built the scheduling seam — `MarkTombstoned` already set `PurgeAfterUtc` — but nothing ever
acted on it, so deleted bytes stayed on disk indefinitely. Removing a progress photo did not even
schedule them: it flipped `ProgressPhoto.Status` and left the `MediaAsset` untouched, so those bytes
were never eligible in the first place. The workspace allowance summed `MediaAsset.Length` only,
which excluded thumbnails and never released deleted bytes, so it was wrong in both directions.

## Decision

**Removal schedules deletion.** Removing a progress photo now tombstones its asset through the
existing `MarkTombstoned`, with the existing 30-day retention shared by every tombstoning path via
`MediaRetentionPolicy`. Progress photos are never referenced by a program snapshot, so
`isHistoricallyReferenced` is false for them. The owning client keeps reading the photo for the
whole retention window, because `CreateAccessAsync` already permits `Tombstoned` — a mistaken
removal stays recoverable until the bytes actually go.

**Purge is a state progression on existing rows**, not a parallel lifecycle and not a job record:
Active → Tombstoned (with `PurgeAfterUtc`) → Purged, or left visibly tombstoned with an attempt
count and the last failure code. `Purged` is terminal: re-purging, re-tombstoning, or re-scanning a
purged asset all throw, so nothing can reschedule or resurrect bytes that are gone.

**The worker is one in-process `BackgroundService`**, the first in this repository, and is
deliberately the smallest thing that works: a timer, a scope, one call. It is not a job platform and
must not become one — no queue, no schedule table, no retry-policy engine, no generic dispatch.
**It is explicitly not a foundation for Phase 6 notification-outbox dispatch**, which needs durable
delivery semantics, ordering, and provider acknowledgement that this loop does not have; reusing it
there would be a mistake.

Its safety with several API replicas comes entirely from the database. Each sweep claims rows inside
a transaction with `FOR UPDATE SKIP LOCKED`, so every replica may run the loop and no two ever claim
the same asset: a second sweep steps over locked rows instead of blocking or double-deleting. The
sweep works one workspace at a time, each in its own scope, because the tenant write-scope guard
refuses to let one scope write rows from two workspaces — and a background sweep that bypassed that
guard would be exactly the hole the guard exists to close.

Order per asset is derivatives first, then the original, then completion. Deleting an object that is
already gone counts as success, so a partial purge can be replayed. Any storage failure records the
reason on the row and leaves it tombstoned, due, and retryable; nothing is swallowed and an asset is
never marked complete on a failure. Eligibility is expressed both in the claim SQL and in
`MediaAsset.IsPurgeDue`: an asset that is not tombstoned, one whose `PurgeAfterUtc` is null because
history references it, and one whose retention has not elapsed are all ineligible.

**After a purge the rows remain as history** with their storage keys cleared, and every access path
fails closed: grant creation returns not-found rather than "not ready", and both content routes
return not-found rather than reaching storage with a null key. A 500 there would be a defect, not a
denial, so it is asserted for the client and the coach on both variants.

**Quota accounting, exactly.** The allowance counts the original *and* every derivative, because
both are real objects. It counts tombstoned-but-not-yet-purged bytes, because those are still
physically stored and pretending otherwise would let a workspace overshoot by everything awaiting
deletion — the unsafe direction to be wrong in. It excludes purged bytes, which is what finally
releases the space. External embeds occupy nothing and are not counted.

A per-client progress-photo allowance is added alongside the workspace one, default 500 MB, validated
between one maximum-size image and the workspace allowance. Both are enforced: an upload must fit
inside the workspace limit *and* the client limit.

**Concurrency.** A read-then-write check cannot hold, because two uploads can observe the same free
space and both commit. The measurement, the decision, and the insert therefore happen inside one
transaction holding a transaction-scoped PostgreSQL advisory lock keyed on the workspace. Locking the
workspace also serialises its clients, so one lock covers both allowances and no lock ordering can
deadlock, and the lock is released by commit or rollback so a crash cannot leak it. It is taken after
the bytes are stored, so it is held for the decision rather than for the whole ingest; an upload that
loses the race has its objects deleted and its row never committed.

Rejection is a `409` carrying a stable `code` — `MediaWorkspaceStorageExceeded` or
`ClientProgressPhotoStorageExceeded` — rather than a validation problem that reads as though the file
were malformed. When the remaining allowance rather than the format limit cuts the ingest stream
short, that is reported as a full allowance too, so a full workspace is never blamed on the upload.

## Consequences and deferred work

Nothing is weakened: signature validation, scanning against the bytes actually stored, byte limits,
streamed ingest, tenant isolation, coach blocking, thumbnail-inherits-parent authorization, and
exercise-media behaviour are all unchanged.

The sweep holds row locks across its storage calls. Against local files that is microseconds; against
a remote object store a slow call would hold one workspace's claimed rows for the duration, which is
what `Media:PurgeBatchSize` bounds. If storage latency ever makes that uncomfortable, the fix is to
claim and finalise in separate transactions, not to widen the batch.

Deferred: a coach-facing view of storage usage and what is pending deletion, alerting on assets stuck
pending after repeated failures, an administrative force-purge, restoring a tombstoned asset before
its retention elapses, counting bytes toward an allowance at reservation rather than at commit, and
purging orphaned objects that have no row at all.

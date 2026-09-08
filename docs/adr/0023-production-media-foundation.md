# ADR 0023: Production Media Foundation

Status: accepted, 2026-09-07

Supersedes in part: ADR 0014's row-lock-across-storage purge execution. Its tombstone,
retention, quota and history decisions remain in force.

## Context

The Phase 3 and 5B media pipeline had a local object-store implementation, generated keys,
checksum/signature validation, protected media access, durable ingest reservations and quota-aware
purge. Those facts were insufficient as a production foundation: storage identity was only a key,
the current adapter could be mistaken for the adapter that owns historical bytes, a media read had no
owned range contract, and an unavailable non-development adapter was not an explicit composition
state. A scanner result described the call but was not durable evidence tied to the exact bytes.

ADR 0014 deliberately documented a minimal worker that held its database row locks while deleting
local files. That was acceptable historical local behavior, but it is unsafe as a provider-neutral
foundation: remote storage latency must not hold a database transaction open, and a process that dies
between deletion and finalization needs a truthful recoverable state.

## Decision

### Storage composition fails closed outside Development

`LocalObjectStorage` is composed automatically only in Development. In every other environment,
absence of a configured adapter composes `UnavailableObjectStorage`, reports a **degraded**
media-storage readiness state and refuses an upload before a reservation, generated key or upload byte
is accepted. This is an explicit unavailable deployment, not a local-files fallback. No production
object-store provider is selected by this ADR.

Degraded rather than unhealthy, for the same reason the scanner check already chose it: everything
except media works normally, so failing readiness outright would pull a functioning API out of its
load balancer over one unconfigured adapter. Degraded keeps the deployment serving and still names
the closed state on `/health/ready`, which is what an operator needs before a coach reports it as a
bug. Uploads are refused either way — visibility is what this check adds, not enforcement.

### Stored objects retain provider-neutral identity

The durable identity of an object is `(location, key)`, not a key interpreted by today's write
adapter. Assets, derivatives and ingest reservations persist that locator. Existing local rows are
backfilled truthfully as `local-v1`; no provider or storage move is claimed. The Media module owns
the locator and full/bounded range read contracts, while provider-specific behavior remains behind
`IObjectStorage` in Infrastructure.

A key is a canonical relative name, not a path: the row's own tenant as a 32-hex first segment, then
one or more segments of letters, digits, dot, underscore and hyphen, with no segment that is nothing
but dots. `StorageObjectLocator` and a matching PostgreSQL check on all three media tables enforce
exactly that. The tenant prefix alone was not tenant binding — `<tenantA>/../<tenantB>/object`
satisfies a prefix or `LIKE` test and still resolves inside tenant B under any adapter that treats a
key as a path, so the constraint asserted ownership the key did not carry. The grammar closes both
separator forms and every rooted, empty, control-character and dot-segment shape, on Windows and
Unix; `LocalObjectStorage` keeps its own path-containment check underneath as defense in depth.
Every key the application and its migrations have ever written is inside the grammar already.

Media authorization completes before `IObjectStorage.ReadAsync` opens an original or rendition.
The persisted locator is used for reads and purge, so changing the configured write location cannot
redirect historical content.

### Scan evidence identifies the exact stored bytes

An allowed original or derivative records the storage location, key, SHA-256, scanner key, scanner
version, scan instant and outcome that apply to the exact bytes published. Publication requires that
evidence to cover the stored locator and checksum. Historical rows that predate this evidence are
marked `LegacyUnavailable`; evidence is not invented, and database guards reject newly written legacy
states.

A scanner that answers with unusable metadata — no key, no version, an over-long failure code, a
non-UTC instant — has not refused the file; it has failed to produce a verdict that can be bound to
anything. That is an operational scanner failure and reports `503`, with every stored object deleted
or left in durable cleanup state and no provider detail in the response or the log. `400` stays
reserved for an actual refusal and for genuine caller file validation.

Refused bytes are still stored bytes, so a refused original travels `Rejected -> Tombstoned ->
Purged` like any other object, keeping its Complete/Refused evidence the whole way. `Tombstoned` is a
readable state for ordinary media, so the access and content paths decide on the scan outcome rather
than the status alone: refused content is never readable on the way to being reclaimed.

### Purge uses durable leases and separates I/O from transactions

A purge sweep first commits a short claim transaction that records a random token and short lease on
one due asset or ingest object. It then deletes derivatives before the original outside a database
transaction. A separate short finalization transaction accepts completion or a failure only when the
presented token still owns the claim. An expired claim is due again and can be reclaimed; a stale
claimant cannot finalize or fail a newer claim. Missing storage objects remain idempotent deletion
successes. Bytes stay quota-counted until storage confirms deletion and the owner is durably purged.

One item is claimed at a time, immediately before its own deletion, from a clock read taken at that
moment. `Media:PurgeBatchSize` and the per-workspace share still bound how much one sweep does; what
they no longer do is decide when a lease starts. Leasing a whole workspace batch in one transaction
dated every item's expiry from the first item's claim, so a batch slower than the lease — exactly the
remote-storage latency this decision exists to accommodate — handed its later items an expiry already
in the past, and another replica could reclaim them before their work had begun. A failed item is
released and due again for the next sweep, but is not re-offered inside the sweep that failed it:
one stuck object must not spend the whole budget.

This supersedes ADR 0014's row-lock-across-storage execution choice. It does not change the existing
tombstone lifecycle, retention policy, generated-key ownership, quota-accounting rule or tenant scope.

## Consequences

Every persisted object is addressable by the adapter/location that created it, exact scan claims are
auditable, and slow or failed storage cannot retain an open purge transaction. Recovery is at-least-once
for deletion: a crash after a successful deletion and before finalization may replay a missing-object
delete, which is the safe trade for no lost quota or orphaned durable owner.

S3/R2, production ClamAV, provider inventory reconciliation, CDN/presigned URLs and production
retention/operations controls remain deferred. This ADR makes none of those provider, hosting,
privacy, legal or retention-duration decisions.

## References

- ADR 0014: Media Purge and Storage Quotas v1 (historical execution decision superseded here)
- `20260907122803_Phase6B4AProductionMediaFoundation`
- `DOMAIN-RULES.md` MED-004, MED-006, MED-008 and MED-010

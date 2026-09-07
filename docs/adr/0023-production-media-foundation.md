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
absence of a configured adapter composes `UnavailableObjectStorage`, reports an unhealthy
media-storage readiness state and refuses an upload before a reservation, generated key or upload byte
is accepted. This is an explicit unavailable deployment, not a local-files fallback. No production
object-store provider is selected by this ADR.

### Stored objects retain provider-neutral identity

The durable identity of an object is `(location, key)`, not a key interpreted by today's write
adapter. Assets, derivatives and ingest reservations persist that locator. Existing local rows are
backfilled truthfully as `local-v1`; no provider or storage move is claimed. The Media module owns
the locator and full/bounded range read contracts, while provider-specific behavior remains behind
`IObjectStorage` in Infrastructure.

Media authorization completes before `IObjectStorage.ReadAsync` opens an original or rendition.
The persisted locator is used for reads and purge, so changing the configured write location cannot
redirect historical content.

### Scan evidence identifies the exact stored bytes

An allowed original or derivative records the storage location, key, SHA-256, scanner key, scanner
version, scan instant and outcome that apply to the exact bytes published. Publication requires that
evidence to cover the stored locator and checksum. Historical rows that predate this evidence are
marked `LegacyUnavailable`; evidence is not invented, and database guards reject newly written legacy
states.

### Purge uses durable leases and separates I/O from transactions

A purge sweep first commits a short claim transaction that records a random token and short lease on
one due asset or ingest object. It then deletes derivatives before the original outside a database
transaction. A separate short finalization transaction accepts completion or a failure only when the
presented token still owns the claim. An expired claim is due again and can be reclaimed; a stale
claimant cannot finalize or fail a newer claim. Missing storage objects remain idempotent deletion
successes. Bytes stay quota-counted until storage confirms deletion and the owner is durably purged.

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

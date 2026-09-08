# ADR 0025: Media Inventory Reconciliation and Retention Operations

Status: accepted, 2026-09-08

Builds on: ADR 0014, ADR 0023 and ADR 0024. Every decision in those remains in force and unchanged.
This ADR adds a read-only observer beside them and takes nothing away.

## Context

ADR 0024 gave media a durable home and a real verdict, and said plainly what it had not done: nothing
reconciles the bucket's actual inventory against the database, sets a retention or lifecycle policy on
it, or gives an operator a surface for either. ADR 0014 deferred the same things in smaller words —
alerting on assets stuck pending after repeated failures, and provider-level inventory reconciliation
for objects created outside the generated-key contract.

The gap is not theoretical. Three tables can own a stored object, an object can outlive every row that
ever named it, and a row can name an object the store no longer has. Today nothing would notice
either. A coach would find out at read time, as a photograph that will not load; the deployment would
find out on an invoice, as bytes nobody can account for.

What makes this awkward is that the obvious response is the dangerous one. Everything discoverable
here looks like something that could be tidied up, and every tidy-up is a deletion of somebody's data
or a rewrite of somebody's history on the strength of one provider response.

## Decision

### Reconciliation reads. It has no repair authority at all

One pass compares the objects at the reconciled location with the rows that own them, records what it
found, and stops. It deletes no object, clears no locator, marks nothing purged, releases no
allowance, touches no lifecycle configuration and repairs no finding. Every action that would change
media state is deliberately absent rather than disabled, and adding one is a decision for a later ADR.

The guarantee is structural. `MediaInventoryReconciliationService` is composed with `IObjectInventory`
— which lists and stats — and never with `IObjectStorage`, which writes and deletes. There is no
object in its constructor with a delete on it. An architecture test asserts that parameter list,
because a reviewer can miss a call and a signature cannot hide one, and because the way a read-only
sweep stops being one is a later constructor parameter that nobody thought about twice.

### The database stays the source of truth, and a provider answer is never promoted to one

A missing object does not tombstone a row, clear a key or release quota: absence for one moment is not
grounds to schedule history, and the safe direction to be wrong in is to keep charging a workspace for
bytes that may be gone. A present object does not resurrect anything. And a store that did not answer
has reported nothing at all — a failed stat is a page failure, never an absence — because that
distinction is the whole difference between "this workspace has lost a photograph" and "the network
was busy".

### Only app-owned canonical locators, at one location

The reconciled location comes from the composed adapter, never from a constant in the Media module,
which has still never heard of a bucket. Every enumerated key is re-validated through
`StorageObjectLocator` and attributed to the workspace its own first segment names before it is
treated as ours. A key outside that grammar, or one naming no workspace, is counted on the run and
nothing more: a finding is a tenant-owned row, and an object with no tenant has none to own it. Rows
at another location — `local-v1`, or anything a later phase introduces — are never probed against this
bucket and are counted as unreconciled, so a completed run cannot be read as having verified them.

### Existing authorities are not duplicated

Where the leased purge sweep or the fifteen-minute ingest reservation lease already owns a row, this
pass observes it and stays out of the way. Two authorities over one row is how a lease invariant gets
broken, and a tombstoned row whose object is already gone is not a disagreement — it is the outcome
the pending deletion wanted. Those rows are counted rather than reported, and suppression is a
decision here rather than an omission.

The one thing this adds to that territory is visibility: a cleanup that has failed at least five times
over at least a day becomes a durable finding. It changes no retry schedule. That is the alerting
ADR 0014 deferred, delivered as a queryable row instead of a log line nobody is watching.

### A finding is a durable observation with a lifecycle of its own

`media.InventoryFindings` is tenant-owned, so it inherits the query filter, the write-scope guard and
the cross-tenant tests every other tenant row has. It is the only place an object key is recorded,
because a key identifies one workspace's private content and therefore belongs in a scoped row and
never in a log line.

Findings are opened, re-observed and resolved, never duplicated and never deleted. A partial unique
index over unresolved findings — `(TenantId, Kind, StorageLocation, StorageKey)` — is the idempotency
guarantee: a resumed pass, a re-run and a second replica all converge on one row. `ConsecutiveObservations`
separates a standing condition from an object deleted a moment after its page was read, and nothing is
described as actionable on a single observation. Resolution is one-way; a condition that returns is a
new finding, so what was once wrong here is never rewritten.

Seven kinds, and what each means is fixed in `MediaInventoryPolicy` rather than configurable, because
a deployment that could retune a threshold could turn a real leak into silence without changing a line
of code:

- `ObjectMissingForLiveOwner` — a row that should be readable names an object the store says is not there.
- `UnownedObject` — a stored object older than 24 hours that no row owns, live or purged.
- `PurgedObjectStillPresent` — the database says these bytes were deleted and the store disagrees.
- `ObjectLengthMismatch` — the only integrity check a listing affords for free.
- `DuplicateKeyOwnership` — one key claimed by two live rows, so purging either deletes what the other serves.
- `DerivativePurgeStateMismatch` — a derivative and its parent disagree about whether they were purged.
- `CleanupStuck` — a cleanup that has been failing long enough to be worth a person's attention.

`PurgedObjectStillPresent` is distinguishable from `UnownedObject` only because scan evidence survives
a purge: the row's live key is cleared but `ScanStorageKey` still names the exact object it covered. No
new column was added for it, and none was added to ingest rows either — an ingest object purged before
any scan surfaces as `UnownedObject` instead, which is a less precise report of a condition that is
never acted on automatically anyway.

Findings and runs are kept indefinitely for v1. They hold no personal data and they are the history of
what was once wrong; a retention for them belongs with the deferred decision for provider-event
history and dead letters, not invented here.

### A partial run is never a clean bill of health

`media.InventoryRuns` is not tenant-owned: a run describes a store, and a store belongs to the
deployment. It carries the lease, both resume cursors, the counters and the failure count.

`Completed` is reachable only when both passes finished with no page failure, enforced in the domain
and again by a check constraint. A pass that spends its budget hands the run back — lease released,
cursors intact — and stays `Running` so the next tick resumes it; a run whose failure budget runs out
is `Failed` and retained; one older than a day is `Abandoned` rather than resumed, because its cursor
describes an enumeration the store may no longer be able to continue. This matters more than it looks:
"it found nothing" from a pass that could not read everything is a different statement from the same
words after a complete one, and only the run row can tell them apart. A failed page deliberately leaves
its cursor where it was, so the page is re-read rather than stepped over and its objects called
verified.

One unfinished run per location, by partial unique index plus a lease token. Two replicas ticking
together both try to start one, exactly one succeeds, and losing that race is an ordinary outcome
rather than an error.

### Bucket lifecycle is an operator prerequisite, not code

The adapter aborts its own interrupted uploads. What it cannot abort is an upload whose process was
killed between the last part and the abort, and only the bucket can reclaim those parts. R2's lifecycle
rules include exactly that, so **one rule is configured by hand: abort incomplete multipart uploads
after 1 day.** Cloudflare's own example is a week; this application's uploads finish in minutes and its
largest accepted body is 500 MiB, so a day is generous by two orders of magnitude and still outside any
legitimate in-flight upload. It needs no prefix: an abort rule touches incomplete uploads and never an
object.

Writing lifecycle configuration requires an Admin Read & Write credential. The runtime credential stays
bucket-scoped Object Read and Write — which already permits the listing this phase needs — and the
application never writes lifecycle configuration and is never given a credential that could. This phase
also does not enumerate incomplete multipart uploads: the manual rule is sufficient, and observing them
is not worth widening a runtime permission for.

**No object-expiration rule and no storage-class transition rule may ever be enabled on this bucket
without a future ADR and explicit approval.** An expiration rule deletes an object with no row change,
no quota release, no tombstone, no attempt count and no audit trail; the application would discover it
at read time, as a 404 for a photograph a client still owns. Every deletion in this system belongs to
the tombstone lifecycle, driven by a claim, a lease and a confirmed provider response. This is
operational discipline the code cannot enforce, and it sits beside the `r2-eu-v1` rule from ADR 0024
for the same reason.

The 30-day tombstone retention stays a fixed application constant. Making it configurable would invite
a deployment to set it to zero and quietly defeat the reason it exists — that a mistaken removal stays
reversible by a human — and a per-deployment retention duration is a product and legal decision rather
than an engineering knob.

### Where it runs

A second `BackgroundService` beside the purge worker in the API process, daily by default, bounded by
`Media:Reconciliation:ObjectsPerRun` and `OwnerProbesPerRun`. Deliberately not the same loop: deleting
due bytes must finish in seconds and run every few minutes, while auditing a whole location walks
everything and may take several passes, and sharing a loop would make an inventory walk the reason a
deletion was late. Like the purge worker it is a timer, a scope and one call, and it must not grow into
a job platform. It does nothing at all when the composed deployment has no enumerable store, so
Development and any unconfigured deployment need no separate switch.

No storage call happens inside a database transaction, for the reason the purge sweep was rebuilt: list
or stat, then classify with untracked reads, then write findings in one short per-tenant scope. An
integration test holds that by failing if the store is called while a transaction is open.

## Consequences

A deployment can now answer "does the bucket match the database" and, just as importantly, "was that
question actually answered in full". Objects nobody owns, rows whose bytes are gone, keys two rows
claim, and cleanups that have been failing for a day are all discoverable without anyone opening a
bucket browser.

Nothing is repaired, so every finding is work for a person, and a deployment that never reads them gets
nothing from this beyond a row count. That is the deliberate trade: the alternative was to give a
background loop the authority to delete a workspace's data on the strength of one listing.

The cost is two tables, one more background loop, and a daily enumeration — a Class A operation per
thousand keys, against a Class B stat per probed row. Both are bounded by configuration rather than by
data volume.

One thing worth stating because it is easy to misread: pointing the configuration at a different bucket
while keeping the `r2-eu-v1` name will now make the very next run report every object as unowned and
every row as missing. That is a symptom, not a detector, and it must not be described as one — but it
is louder than the silence ADR 0024 had to accept.

## Prerequisites

Before a deployment relies on this:

- A bucket lifecycle rule aborting incomplete multipart uploads after **1 day**, applied once through
  the Cloudflare dashboard or Wrangler with an **Admin Read & Write** credential that the application
  never holds. Nothing in the application creates or verifies it.
- A written agreement, beside the `r2-eu-v1` one, that **no object-expiration and no storage-class
  transition rule** is enabled on this bucket without a new ADR.
- The existing runtime credential, unchanged: bucket-scoped Object Read and Write, which already
  permits listing objects. It is never widened.
- Someone who reads `media.InventoryFindings`. There is no operator surface, no alert and no
  notification in this phase; a completed run with zero page failures is what makes an empty finding
  set meaningful.

## References

- ADR 0014 (tombstone, retention, quota and the deferred alerting), ADR 0023 (locator, evidence,
  leased purge), ADR 0024 (the bucket and the scanner)
- `20260908190256_Phase6B4CMediaInventoryReconciliation`
- `docs/ARCHITECTURE.md` section 9, `DOMAIN-RULES.md` MED-012
- Cloudflare R2: [S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/),
  [object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/),
  [consistency](https://developers.cloudflare.com/r2/reference/consistency/),
  [API tokens](https://developers.cloudflare.com/r2/api/tokens/)

# ADR 0034: One active price option per duration and currency

Status: accepted, 2026-10-05

## Decision

A coaching product has at most one active `ProductOffer` for each exact duration count,
duration unit and currency, regardless of price or included features. Separate products
represent different prices sold concurrently for the same duration and currency. The domain
checks addition and restoration; a tenant-scoped PostgreSQL partial unique index protects races.

Change price accepts a new exact amount, the source offer's concurrency version and an
idempotency key. It copies the source's duration, currency, label and features into a new
immutable offer and retires the source in one transaction. An append-only `OfferPriceChange`
binds the tenant's key to the source, its version and normalized amount. Identical retries
reuse that replacement; a changed payload conflicts. Existing enrollments and payments retain
their original snapshots and amounts (ADR 0005).

Enrollment and primary-program overlap rules remain unchanged. Their refusals name the
existing plan or program and its dates using only the already-authorized client's workspace.

## Migration and recovery

`ActiveOfferPriceOptions` adds the index and command history. It refuses to migrate when
existing active options share a slot; it does not choose a winner or retire any option. Before
retrying, the owner reviews each duplicate group and retires unwanted options through the
existing availability operation. Enrollments remain attached to their original offers.

The migration rolls back the new index and table only. A production rollback after price
changes have been recorded requires preserving or exporting that append-only command history;
prefer a forward fix so retry identities and the newly created offers stay auditable.

## Amended in the audit's batch A7 (2026-10-20)

A replacement counted only its own clients, so after 130 became 150 the option on sale read "No clients
yet" while the plan's clients stayed on 130 (COACH-2). The catalog now counts, for an option on sale, the
clients of every option it replaced through Change price, read from `OfferPriceChange`; a retired option
counts its own and names the option that replaced it (`ReplacedByOfferId`). Renew starts on that
replacement when the plan's own price is no longer sold (COACH-3). A new price with a part of a cent is
refused, never rounded (BILL-1).

## Amended in the audit's batch A16b (2026-10-22)

New plan and Add price option sell a length in days as well as in weeks (INV-7). A slot is still the
exact count and unit: 28 days and 4 weeks cover the same dates and are two options, while a second 30
days in the same currency is refused. Plans covering one feature side by side (`AllowsConcurrentCoverage`)
stay off screen; the owner declined them.

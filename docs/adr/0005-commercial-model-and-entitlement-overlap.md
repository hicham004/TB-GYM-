# ADR 0005: Commercial Model and Entitlement Overlap

Status: accepted, 2026-08-20

## Context

TB Gym needs manual-first commercial operations for Lebanon before training and nutrition
assignments are built. A single mutable subscription record would mix catalog data, price,
payment, access, dates, and future program assignments. It would also make legitimate
concurrent services, such as training plus a nutrition add-on, difficult to represent.

Current coaching products support the same useful separation seen in established platforms:
sellable products/packages are distinct from client purchases, and primary services can be
combined with add-ons. This decision is informed by the public product documentation for
[Everfit packages](https://help.everfit.io/en/articles/5718929-what-can-you-sell-with-packages),
[Everfit subscriptions](https://help.everfit.io/en/articles/6597428-manage-client-subscriptions),
and [Trainerize main products and add-ons](https://help.trainerize.com/hc/en-us/articles/360035361591-Main-Products-vs-Add-ons).
Their behavior is product research, not an architecture to copy.

## Decision

The `Subscriptions` module owns these separate concepts:

1. `CoachingProduct`: editable catalog identity and description.
2. `ProductOffer`: immutable fixed-duration, price, currency, and billing-model snapshot.
3. `OfferEntitlement`: the coaching features included by an offer.
4. `ClientEnrollment`: one client's dated purchase/assignment of an offer, with copied
   commercial terms and an explicit lifecycle.
5. `EnrollmentEntitlement`: one coverage row per feature and enrollment.
6. `PaymentRecord`: append-only money operation with its own currency and actor.
7. `ClientRelationshipEvent`: append-only workspace-local block/unblock history, owned by
   the Clients module.

Phase 2 creates fixed-duration offers only. `OfferBillingModel.Recurring` reserves contract
vocabulary, but recurring charging, invoices, retries, and dunning are not represented as
finished behavior.

Enrollment periods are half-open `[startDate, endDateExclusive)`. Renewal creates a new
enrollment with `RenewedFromEnrollmentId`; it never extends or reprices the original row.
Catalog changes never mutate enrollment snapshots.

An enrollment begins `PendingPayment`, or `Active` immediately when its price is zero. A
manual payment is appended to the ledger. Access activates only when same-currency receipts
equal the immutable price. Partial receipts are preserved but do not grant proportional
weeks. Overpayment and cross-currency settlement are rejected until credit and FX policies
exist. Pause, resume, cancellation, and expiration use domain transitions. The service date
is authoritative for effective expiration even if a background projection has not yet
persisted `Expired`.

There is no global no-overlap rule. PostgreSQL excludes intersecting coverage only for the
same tenant, client, and `CoachingFeature`. Coverage rows marked by an explicit offer rule as
concurrent are excluded from that protection. Cancellation releases future overlap locking;
paid and historical records remain.

The exclusion is enforced with `btree_gist` and `daterange(StartDate, EndDateExclusive,
'[)')`, so concurrent requests cannot both pass. Domain validation produces a friendly
conflict before the database when possible.

## Consequences

- Training and nutrition assignments can later reference an enrollment without becoming
  commercial entities themselves.
- A client may own simultaneous non-conflicting services.
- A new price or duration requires a new offer. This creates honest price history.
- Corrections, refunds, and reversals require new payment operations; Phase 2 only exposes
  receipt recording.
- Recurring billing needs a later ADR covering invoice schedules, provider callbacks,
  retries, grace periods, and cancellation semantics.

## Amended in the audit's batch A7 (2026-10-20)

- Coverage rows (`EnrollmentEntitlement`) were the one part of the enrollment snapshot without a database
  guard (SEC-5). A trigger now refuses deleting them and every change but the one cancellation makes,
  `BlocksOverlap` true to false; the GiST constraint keeps protecting the dates they hold.
- Money is kept to the cent: a price or a receipt with a smaller part is refused, never rounded (BILL-1).
- A receipt is entered as the workspace day the money arrived and the server stamps its instant in the
  workspace's time zone, so every reader sees one day (WEA-6).
- Only a paid enrollment covers days on Coach Today: a renewal waiting for payment never quiets Ending
  soon (BEB-7, the owner's decision of 2026-10-19).
- No two plans for sale in a workspace share a name; plans that did before keep it until renamed (BILL-7).

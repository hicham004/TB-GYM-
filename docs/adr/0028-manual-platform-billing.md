# ADR 0028: Manual platform billing

Status: accepted, 2026-09-24

## Context

Commercial Step 2. TB Gym earns from coaches and gyms, not from their clients, and nothing billed a
workspace yet. Payment is by Whish transfer, recorded by hand, until Whish automation (Step 5).
This is separate from coach-to-client money (ADR 0005), which keeps its own names and tables.

## Decision

Business rules, decided by the product owner on 2026-09-24:

- **Each workspace is billed monthly in the price plan's currency (USD)**, for the previous UTC month
  `[first day, first day of next month)`. Only the owner sees billing.
- **Seats** = the owner plus every coach active at any moment of the month. **Billable clients** =
  clients with coverage for any coaching feature at any moment of the month, including zero-price
  plans. No proration: whoever touched the month counts once.
- **A client whose plan was paused for the whole month is not billable** (decided 2026-09-25); paused
  for part of the month still counts, since they had access. Only unpaused coverage counts, so a
  client with another plan they could use that month still counts.
- **Price** = seats × seat price + extra clients × extra-client price + a gym fee from a minimum seat
  count, where extra clients = billable clients − seats × clients included per seat (pooled, never
  below zero). A founding-coach discount (percentage, start and end date) comes off the total. Since
  notes plan N11a the included clients also count a founding seat's extra and the admin's grants
  (`platform-invoice-v2`, PBL-011); the discount still comes off the whole subtotal.
- **Every number is a placeholder in a versioned, immutable price plan** (seat price, included
  clients, extra-client price, gym fee and its seat threshold, trial days, payment days, grace days).
  The platform admin publishes a new version; new invoices use the latest one (since N8, a founding space
  whose price is held keeps its founding day's version, below). An invoice snapshots its plan and
  quantities, so a new version never changes it.
- **New workspaces get a free trial** (30 days in the seeded plan). Issued invoices are immutable; a
  correction voids and reissues, keeping both. Due after the plan's payment days (7). Emails go to the
  owner through the notice queue: invoice issued, due soon (2 days before), overdue.
- **The admin records one exact payment** (Whish or transfer reference, note). Append-only; no partial
  payments, refunds or credit.
- **Unpaid for the plan's grace days after the due date (7), the workspace is read-only** for the owner
  and coaches: they can read everything but not change anything. Clients keep full use. Paying lifts
  it at once. Nothing is deleted.
- **Platform admin is a global role**, never self-registered, granted only by a CLI command.

Chosen by the implementer, to confirm:

- The trial runs from workspace creation for the trial length of the plan current then. A month fully
  inside the trial is not invoiced; in the month the trial ends, only usage after it counts.
- A reissue keeps the voided invoice's plan version and recounts usage and discount now (since N11a,
  the founding seat and the grants too: the seat takes the highest number its status had while it ran,
  up to now, PBL-011).
- Discounts for one workspace may not overlap. A discount applies to every month it touches; if two
  touch a month, the larger applies. A total of zero issues an invoice with nothing to pay.
- A client who leaves and returns within a month counts once.
- A paid invoice cannot be voided, and a voided one cannot be paid.
- Emails carry fixed wording without amounts; the Billing page shows the amount, the Whish number
  (configuration) and the invoice's reference code.

## Mechanism

- A new module, `TB.Gym.Modules.PlatformBilling` (schema `billing`), owns price plans, invoices, voids,
  payments and discounts, plus the named calculation `platform-invoice-v1`. Invoices, voids, payments
  and discounts are tenant-owned; plans are global.
- Tenancy gains an append-only `MembershipStatusChanges` history, written by a database trigger on
  every membership insert and status change, because a membership row keeps only its current status.
  Coverage is read from enrollment dates, activation and cancellation, in the workspace time zone.
- Subscriptions gains an append-only `EnrollmentStatusChanges` history, written the same way, because
  an enrollment forgets a pause once resumed. A pause runs from entering Paused to the next status.
  Pauses that ended before the history existed are unknown and still count.
- Database guards: plans, invoices, voids and payments reject update and delete; one original invoice
  per workspace and month; one reissue per void, pointing at a void; one payment per invoice, equal
  to its total, never on a voided invoice; non-overlapping discounts by a GiST exclusion constraint.
- The Worker issues invoices on the 1st and queues reminders. Both are idempotent under unique indexes.
- Read-only is enforced in one place, the tenant authorization handler: an owner's or coach's
  state-changing request answers 403 `workspace_read_only`, except a short list of reads sent as POST
  and personal settings (notification read state and preferences, message read cursors, media access
  grants, progression preview, the 1RM calculator) and resigning.
- Admin endpoints use a policy that re-reads the role from the database on every request, never a
  workspace header.

## Consequences

- A new state-changing endpoint for staff is blocked on an unpaid workspace unless it is added to the
  allow-list on purpose.
- Prices can change without a deploy; trial, due and grace periods apply per plan version.
- Whish automation (Step 5) records payments through the same append-only payment row.
- The platform admin's screen (R5.2b, 2026-10-10) orders coaching spaces by how soon each needs the admin
  (read-only, overdue, owing, a trial ending within 7 days, paid up, other trials), shows a payment's amount
  as fixed because partial payments stay unsupported, and dates each payment with the day the money arrived
  (PBL-007, decided by Claude for the owner after Chargebee's Record payment, whose date may be in the past).
  A void offers a corrected invoice by default and says it recounts usage today, is due after the plan's
  payment days and is emailed to the owner. Dates there are UTC days, like every invoice date.
- The owner's Billing page (R5.2a, 2026-10-09) shows each invoice's reference, lines, total and payment and
  copies the reference for the transfer note. There is no printable or PDF invoice until TB Gym's legal name,
  address and tax number are decided: a formal invoice carries them, and TB Gym does not invent that wording.
- Amended 2026-10-20 (audit A7): a plan gives at least one grace day, as the rule always applied (BILL-4;
  the check is `NOT VALID` so a version published with 0 stays as it was). The owner's Billing page names
  the read-only day while an invoice is merely open and says its days are UTC (BILL-3, BILL-6).
- Amended 2026-11-06 (notes plan N3a, decision 15): the module also owns founding status (PBL-009). A
  tenant-owned `billing."FoundingStatuses"` row per mark (one open per workspace by a partial unique index;
  a trigger refuses deleting it, changing its mark or a recorded badge, and touching it once ended) and
  global, immutable `billing."FoundingTerms"` versions (version 1, 10 clients and 2 months, seeded by the
  migration). Founding status is separate from the founding-coach discount above: earning or hiding the
  badge changes no invoice, and revoking a discount leaves the badge (since N11a an open status gives its
  owner's seat the founding terms' clients, below). The Worker's sweep also runs the
  badge check after the invoices and reminders, in its own try. The owner's switch that hides the badge
  from their clients (`SetFoundingBadgeVisibility`) is a personal display setting on the owner's own
  status, so it is on the read-only allow-list and uses `RoutineWrite`.
- Amended 2026-11-07 (notes plan N4b, ADR 0039): a coach's switch that shows one of their own certificate
  lines to their clients or hides it (`SetOwnCoachCertificateLineShown`) is a personal setting about
  themselves, a consent that can always be withdrawn, so it joins the read-only allow-list with `RoutineWrite`.
- Amended 2026-11-10 (notes plan N7, decisions 11 to 14): the owner's read (`GET /api/billing`) also carries the
  unrevoked discounts running or still to come on the server's UTC day, oldest first, each with its name (the
  admin's note, which the grant sheet now says the owner sees), rate, first and last day, the day after its last,
  and whether it starts later; never who granted or revoked it. The Billing page states them in one sentence per
  run of discounts that follow on, "free until …, then 40% off until …, then the normal price.". Ended and revoked
  ones are not sent; nothing billed changes and each invoice keeps its own discount line. Since the largest
  discount touching a month applies, a month in which a run changes rate takes off the larger, never less.
- Amended 2026-11-10 (notes plan N11a, decisions 11 and 17, PBL-011): included clients come from three sources
  under `platform-invoice-v2`, invoices issued before keeping `platform-invoice-v1`: the plan's per-seat number for
  every seat; for the owner's seat alone, what the founding terms' new `FoundingSeatIncludedClients` adds over it
  while a founding status touches the month (the highest number the status had; none is seeded); and the clients
  of every unrevoked grant in the new tenant-owned `billing."IncludedClientGrants"` touching the month. Grants are
  whole UTC calendar months, only for a space with an open founding status, never overlap-checked (they add up),
  one per identical request (a partial unique index behind a lock on the open status), and revoked once:
  `billing.protect_included_client_grant()` and the context's guard refuse an edit or a delete. An invoice records
  the founding number, its terms version, the founding status (a composite key in its space) and the grants' ids (a
  `uuid[]` frozen with the row); `CK_Invoices_Quantities` checks the v2 sum, and a v1 invoice holds neither. The
  columns came with constant defaults, so no issued invoice was rewritten. The admin grants and revokes under the
  platform-admin policy with `SensitiveWrite`; the read-only allow-list is unchanged.
- Amended 2026-11-12 (notes plan N8, decision 16, PBL-012): a founding space keeps the price plan version in
  force on its founding day (read at the end of that UTC day, or at the mark when that comes first, so it never
  moves afterwards) until its price guarantee ends, under the named rule `founding-price-v1`. The founding
  terms gain `PriceGuaranteeMonths` (nullable, 0 to 120, checked; none is seeded, so nothing is held until the admin
  publishes it, and its key is required on a publish like the founding seat's). The guarantee's last day is the
  later of the founding day and the last unrevoked discount's last day plus those months; the month it falls
  inside is held whole, and an ended status holds the month it ended in and no later one. The monthly run and the
  estimate ask the rule for the version, work the month out at the held version and at the latest, and bill the
  lower total, equal totals keeping the held one; the invoice records the version billed as before, with no new
  column, and a reissue still keeps its voided invoice's version. `GET /api/billing` carries the guarantee's last
  day while it has not passed and the admin's space detail the held version too. No route was added, so the
  read-only allow-list and the rate-limit table are unchanged. The migration refuses to revert once months are
  published.

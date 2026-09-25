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
  below zero). A founding-coach discount (percentage, start and end date) comes off the total.
- **Every number is a placeholder in a versioned, immutable price plan** (seat price, included
  clients, extra-client price, gym fee and its seat threshold, trial days, payment days, grace days).
  The platform admin publishes a new version; new invoices use the latest one. An invoice snapshots its
  plan and quantities, so a new version never changes it.
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
- A reissue keeps the voided invoice's plan version and recounts usage and discount now.
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

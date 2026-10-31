# ADR 0038: Session packs

Status: accepted by the owner in the critique's row B10b (2026-10-27 and 2026-10-29). Built 2026-10-30. Amended
2026-10-31: who held a session (critique B12, the partner's answer, the owner's word).

## Context

A gym coach sells in-person 1-on-1 sessions in packs and singles (Toufic's T4, T5). The commercial model had no
count of anything: a plan is a dated enrollment, and `ProductOffer` refuses an offer with no feature. Access, the
client list, ask-to-renew and the platform bill all read coaching features, so a pack outside them would have needed
each reader amended.

## Decision

**Sessions are a sixth coaching feature.** A plan (`CoachingProduct.Kind`) is a coaching plan or a session pack, and
never changes kind. A pack's price option carries a session count, 1 to 100, and keeps its length as the pack's
validity: every pack ends. Each of its options includes `CoachingFeature.Sessions` with `AllowsConcurrentCoverage`, so
packs overlap freely, while any other feature ticked on one keeps its own overlap rule (SUB-004). A coaching plan's
option never includes Sessions. ADR 0034's slot gains the count: one active option per count, length and currency,
held by the same unique index with `NULLS NOT DISTINCT`, so a coaching plan's options, which have no count, still
clash. The enrollment snapshots the count (`SessionCountSnapshot`), immutable like its price.

**Selling is an enrollment.** Dated, waiting for payment until the exact price is received, active at once when free.
Nothing else about selling, renewing, pausing or cancelling changed, and a pack-only client is billable as any covered
client (PBL-002 as it stands).

**An append-only ledger per pack** (`SessionLedgerEntries`, the shape of `PaymentRecords`): Issued, once, when the pack
becomes active; Held (the workspace day, the coach, a note the team reads); Charged (a no-show or late cancel, with a
reason the client reads); Voided (a correction pointing at the row it undoes, one per row). Balance = issued − held −
charged + voided. A session counts when it happens, never at booking, and goes on the pack ending first among those
paid, covering that day and with a session left.

**Lapsed is the calendar's answer, not a row.** The day a pack ends or is cancelled, what is left has lapsed, on every
read. SUB-006 makes the calendar authoritative over any stored state; a row written later would be a copy, wrong the
moment an Undo after the end moved the balance, and no Worker has to run for a pack to end. A lapsed pack is never
extended: a free one-session pack is the goodwill tool. A pause stops access, not the pack's dates.

**The database holds it past the service.** Triggers refuse update and delete. `guard_session_entry` locks the pack on
every insert and refuses a session past the balance, outside the dates or on an unpaid pack, an Issued of another
count, and a correction of anything but a session on the same pack. Check constraints hold each kind's shape; partial
unique indexes hold one Issued per pack and one correction per row. The command also locks the client's packs, so a
refusal is in words and the guard never fires in normal use.

**Access and scope.** Recording asks `ICoachingFeatureAccessService`, whose decision for Sessions closes the command for
a blocked, platform-blocked or departed client. It does not ask for Granted: a session on the pack's last day may be
recorded the next morning, when the feature already reads Expired, because the day is what counts. The route names the
client, so the tenant handler answers another coach's client with 404 and a released one with 409 (ADR 0026, 0027).

**A pack never stands for the client's plan beside a coaching plan.** Sessions run alongside, often ending later, so
the Clients row, Ending soon and the plan in front of Service & access read the coaching plan while one runs or is to
come. With none, the pack is the plan, as any plan is. Readers that key on features are otherwise unchanged, so a pack
running keeps a client Running and keeps Ask to renew away (SUB-014: partly running).

**Who held it (critique B12).** A gym owner often records what a coach held, so a Held row keeps two people:
`CoachUserId`, who held it and who it counts for, and `RecordedByUserId`, who recorded it. The owner names who held it,
active staff of the workspace; a coach logs only their own, and the server refuses another name. A charge is no session
held, so it keeps who recorded it in both. A row from before B12 names only who recorded it, in `CoachUserId`, and
counts as held by them: the ledger is append-only, so nothing is backfilled, and every reader of a session's person
stays as it was. The guard refuses a new session that does not keep who recorded it or names anyone but active staff,
and the command takes that membership's lock as an assignment does (ADR 0026), so a coach removed in that moment either
has the session or is refused. A client reads neither person (SES-007).

## Consequences

- A receipt can be taken in the same command as a session, when a pack waits for payment on that day. It must pay the
  pack in full, as a part payment opens nothing (SUB-008), and session and receipt commit together under one key.
- Single sessions are packs of one. Service & access lists packs in 1-on-1 sessions alone, not under Other plans, with
  those that are over folded, so a coach selling many reads each once.
- Not in v1: booking, a calendar, self-booking, reminders, automatic no-show charging, several kinds of session, pay
  rates, packs with no end date. B10c adds what clients read (SES-007), what coaches read (SES-008) and a pack's own
  notices (SES-009), B10d the month's numbers.

## Migration and recovery

`SessionPacks` adds the columns, the ledger and its triggers, and rebuilds the slot index; every existing plan becomes a
coaching plan and every existing option has no count. Rolling back drops the ledger, so after real sessions are
recorded prefer a forward fix: the ledger is a money-adjacent history that must not be lost.

`SessionHeldAndRecordedBy` (critique B12) adds the nullable column, its foreign key and check, and the guard's two
refusals. Rolling it back drops who recorded each session; prefer a forward fix here too.

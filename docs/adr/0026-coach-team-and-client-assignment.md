# ADR 0026: Coach team and client assignment

Status: accepted, 2026-09-23; amended 2026-09-24 (a coach can resign, and their clients are told);
amended 2026-10-20 (the owner's old thread closes too, audit COACH-13); amended 2026-10-29 (money received on
Today, critique B4b, for the owner to confirm); amended 2026-10-31 (the This month page, critique B10d, for the
owner to confirm); amended 2026-11-14 (the owner privacy split, C8 decided 2026-10-14, notes plan N9d1a); amended
2026-11-14 (a client may wait for a coach, C8, notes plan N9d1b)

## Context

A workspace could hold Owner, Coach and Client memberships, but an owner could not add a coach, and
clients belonged to nobody in particular, so every coach in a workspace saw every client. Gyms need
several coaches with their own clients before the per-seat billing that follows (roadmap commercial
Step 2).

## Decision

Business rules, decided by the product owner on 2026-09-23:

- **The owner invites a coach by email.** Coach invitations reuse the client invitation aggregate,
  token lifecycle and action-mail pipeline, told apart by `InvitationKind`. Accepting creates an
  active `Coach` membership (or reactivates a removed coach's). Only the owner lists, resends and
  revokes coach invitations and removes coaches. One active owner per workspace (partial unique
  index).
- **Every client has exactly one coach**: `ClientProfile.AssignedCoachUserId`, always an active
  Owner or Coach of the same workspace. A client lands with whoever sent their invitation; if that
  coach has left by the time they accept, with the owner. Existing clients were migrated to the
  owner. *Amended 2026-11-14 (C8, N9d1b):* **at most one coach**. A client whose coach left, or who
  accepted an invitation after its coach left, or a house trainee while the house has no Coach, waits
  for a coach (an empty `AssignedCoachUserId`); the owner never gets them automatically and gives them
  a coach, themselves included, through the reassignment. Nobody opens a waiting client's private side;
  their plans keep running and they can still log.
- **A Coach sees and acts only on their own clients; the Owner sees all.** A solo owner notices no
  change. *Amended 2026-11-14 (C8, N9d1a):* the Owner manages every client and coaches only their own.
  The business side (name, contact, coach, plan and payment status, enrollments, payments, sessions,
  renewals, the relationship and its coach history, activity counts) is the Owner's for every client;
  the private side (training and food logs, programs, maxes, nutrition targets, check-in answers,
  weigh-ins, measurements, progress photos, intake answers, the health fields, the coach's notes) opens
  only to the client's own coach, the Owner included. An owner who coaches is simply the coach of their
  own clients, and one who takes a client by reassigning it to themselves opens its private side. A
  former client's private side opens only to an Owner who coached them when they left (a release or a
  leave makes the Owner the keeper, not the coach, and the coach left loses the record), so releasing a
  coach's client opens nothing. Still to come: the front desk (C8's slice 2).
- **Every member of staff reads who is on the team** (critique B3a, 2026-10-28): each active owner
  and coach's name, role and joining day (`GET /api/team/roster`), which a coach opens from Settings.
  Emails, invitations, client counts and every change to the team stay the owner's.
- **The owner reassigns** a client (optional note, optimistic concurrency on the client version).
  *Amended 2026-11-14 (C8, N9d1b):* every reassignment that changes the coach, an owner taking a
  client or a waiting client given one included, tells the client in-app that they have a new coach,
  naming nobody (`CoachAssigned`); a self-directed trainee, who trains as their own coach, is told in words of
  their own that someone else on the team can now see their training (`TraineeStaffChanged`).
- **Removing a coach moves all their clients, and their pending client invitations, to the owner**
  in one transaction. Nothing about a client is deleted. *Amended 2026-11-14 (C8, N9d1b):* they wait
  for a coach instead, each client with a waiting entry naming nobody and each invitation naming no
  coach; clients the owner already held from an earlier departure stay the owner's. The owner's
  resignation notice says the clients wait. **A coach can also resign themselves**, with
  the same effect, recorded as `CoachResigned` rather than `CoachRemoved` (2026-09-24). The owner
  cannot resign. When a coach resigns, the owner is told in-app.
- **When a coach resigns or is removed, each of their clients with access is told** in-app and by
  one email through the workspace notice queue (ADR 0027): their coach is no longer with this
  workspace and the workspace will assign a new coach. The wording names no coach or workspace.
  Releasing a client, a client leaving, and coming back are in ADR 0027; following a coach to a new
  workspace is a normal invitation from that workspace.
- **Chats stay private.** The owner cannot read another coach's chats. After a reassignment the old
  coach loses the thread, the client keeps it read-only, and the new coach starts a fresh one.
  Reassigning back reopens it, because nothing was deleted. The owner is no exception (2026-10-20,
  audit COACH-13): a thread is live only with the client's assigned coach, so the owner's thread with
  a client they hand to a coach closes the same way, and the owner starts a chat only with their own
  clients. On a team member's client the owner's screens say who messages them instead of offering
  one; to message the client themselves the owner reassigns them first. The rule is
  `CoachClientScope.IsAssignedCoachAsync`, asked by every messaging read, write, badge and live
  delivery.
- No other permission changed: coaches still create products, record payments and edit the shared
  libraries.
- **Money received on Today** (critique B4b, 2026-10-29, for the owner to confirm): a coach sees this
  month's money received that counts for them by each client's coach history (SUB-016), as totals per
  currency with no client named; the owner sees the workspace's totals and every member of staff's
  client counts, which no coach receives (CLI-020).
- **The This month page** (critique B10d, 2026-10-31, for the owner to confirm): a coach sees their own money
  received, sessions held, plans and packs sold, and clients started and ended, this month and last. The owner
  sees the workspace's and each coach's, anyone who left the team with a number included, so the rows add up to
  the totals; no coach receives another's, and no client is named (SUB-018). *Amended 2026-11-14 (C8, N9d1b):*
  what happened while a client waited for a coach counts for nobody, on the owner's No coach line, so the rows
  and that line add up to the totals (SUB-018 v3). A session counts for who held it, which
  only the owner can make someone else (critique B12, SES-003).

Mechanism:

- Assignment history is the append-only `clients.ClientCoachAssignments`, numbered per client, each
  entry naming the coach it replaced, the reason (`Invitation`, `Reassigned`, `CoachRemoved`,
  `Migration`), an optional note and the actor. Since N9d1b an entry may name nobody: a departure
  (`CoachRemoved`, `CoachResigned`) always does, an `Invitation` or `SignUp` entry does when nobody
  could take the client, and the entry that ends a wait names nobody before it.
- Enforcement is server-side in one place, `CoachClientScope`. The tenant authorization handler
  checks every route parameter named `clientProfileId` or `clientId`; routes that reach a client
  through another row (mesocycle, enrollment, workout note, conversation, progress photo) ask the
  scope after loading it. Another coach's client answers **404**, exactly like a missing one. An
  integration test fails if a route parameter whose name contains "client" uses any other name.
  Since N9d1a the scope answers may manage and may coach, every client route carries SharedKernel's
  `ClientSide` (`Business` or `Private`, none counting as private, the business list pinned by a
  test), and the Owner on another coach's client's private side answers 404 the same way.
- Database guards: a composite FK from client to membership; deferred constraint triggers refusing
  a coach who is not active staff or a coach change, an empty one included, without a matching newest
  history entry; a chain check and trigger that read a wait as an entry naming nobody and refuse a
  new departure that names anybody; a check that a released record keeps its keeper; a
  trigger refusing a staff member leaving while clients are still assigned; append-only and chain
  triggers on the history; invitation kind immutability.
- Races between removing a coach and assigning to them (acceptance, reassignment) are serialized by
  row locks on the coach's membership: assignment takes `FOR SHARE`, removal `FOR UPDATE`.

## Consequences

- New client-facing coach routes must name the client `clientProfileId`/`clientId`, or check
  `CoachClientScope` themselves.
- Seat counting for billing can read active Coach/Owner memberships and assigned clients directly.
- `ClientInvitation` now also carries coach invitations; the name predates that.

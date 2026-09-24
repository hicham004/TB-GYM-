# ADR 0026: Coach team and client assignment

Status: accepted, 2026-09-23; amended 2026-09-24 (a coach can resign, and their clients are told)

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
  owner.
- **A Coach sees and acts only on their own clients; the Owner sees all.** A solo owner notices no
  change.
- **The owner reassigns** a client (optional note, optimistic concurrency on the client version).
- **Removing a coach moves all their clients, and their pending client invitations, to the owner**
  in one transaction. Nothing about a client is deleted. **A coach can also resign themselves**, with
  the same effect, recorded as `CoachResigned` rather than `CoachRemoved` (2026-09-24). The owner
  cannot resign. When a coach resigns, the owner is told in-app.
- **When a coach resigns or is removed, each of their clients with access is told** in-app and by
  one email through the workspace notice queue (ADR 0027): their coach is no longer with this
  workspace and the workspace will assign a new coach. The wording names no coach or workspace.
  Releasing a client, a client leaving, and coming back are in ADR 0027; following a coach to a new
  workspace is a normal invitation from that workspace.
- **Chats stay private.** The owner cannot read another coach's chats. After a reassignment the old
  coach loses the thread, the client keeps it read-only, and the new coach starts a fresh one.
  Reassigning back reopens it, because nothing was deleted.
- No other permission changed: coaches still create products, record payments and edit the shared
  libraries.

Mechanism:

- Assignment history is the append-only `clients.ClientCoachAssignments`, numbered per client, each
  entry naming the coach it replaced, the reason (`Invitation`, `Reassigned`, `CoachRemoved`,
  `Migration`), an optional note and the actor.
- Enforcement is server-side in one place, `CoachClientScope`. The tenant authorization handler
  checks every route parameter named `clientProfileId` or `clientId`; routes that reach a client
  through another row (mesocycle, enrollment, workout note, conversation, progress photo) ask the
  scope after loading it. Another coach's client answers **404**, exactly like a missing one. An
  integration test fails if a route parameter whose name contains "client" uses any other name.
- Database guards: a composite FK from client to membership; deferred constraint triggers refusing
  a coach who is not active staff or a coach change without a matching newest history entry; a
  trigger refusing a staff member leaving while clients are still assigned; append-only and chain
  triggers on the history; invitation kind immutability.
- Races between removing a coach and assigning to them (acceptance, reassignment) are serialized by
  row locks on the coach's membership: assignment takes `FOR SHARE`, removal `FOR UPDATE`.

## Consequences

- New client-facing coach routes must name the client `clientProfileId`/`clientId`, or check
  `CoachClientScope` themselves.
- Seat counting for billing can read active Coach/Owner memberships and assigned clients directly.
- `ClientInvitation` now also carries coach invitations; the name predates that.

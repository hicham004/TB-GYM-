# ADR 0027: Release client, client departure and return

Status: accepted, 2026-09-23; amended 2026-09-24 (a client can leave, and a former client can be
invited back)

## Context

ADR 0026 gave each client one coach but no way to end a client's relationship with a workspace — for
example when a client follows a departing coach or quits the gym. Platform billing (commercial
Step 2) will count active clients, so a departed client must stop counting without losing history.

## Decision

Business rules, decided by the product owner on 2026-09-23 and 2026-09-24:

- **The owner releases a client**, with a reason, against the client version they saw.
- **A client can leave on their own**, with an optional reason. It has the same effect as a release
  and is recorded as "left by client" instead of "released by owner". The owner and the client's
  coach are told in-app; the client, who did it, is not emailed.
- **Access ends immediately.** The client's membership becomes `Removed`; their account keeps
  working for any other workspace. They can no longer see anything in this one, including their own
  history.
- **Open work closes; nothing is deleted.** Running and future plans (enrollments), programs
  (mesocycles) and meal plans are cancelled through their own audited transitions, with a reason
  saying whether the client was released or left. Payments stay; there is no refund. A program with
  a workout in progress is left as it is, because the training rules refuse to cancel one mid-workout.
- **The owner keeps a read-only record** under "Former clients". The client moves to the owner (a
  `Released` or `ClientLeft` entry in the coach history), so no coach keeps them. Chats keep the ADR
  0026 privacy rule, and an ended profile's features all answer `MembershipInactive`.
- **No undo, but a former client can be invited back** as a new relationship: a new client profile
  with a fresh start, while the old record stays read-only and untouched. They cannot be invited as a
  coach.
- **Former clients are not active clients** for team counts or future billing.
- **A released client is emailed once**, in fixed wording that names no workspace, coach or reason.
- **Following a coach to a new workspace** is a normal invitation from that workspace. Moving history
  between workspaces is out of scope.

Mechanism:

- `ClientProfile.ReleasedAtUtc` marks the end of a relationship; a `Released` or `Left`
  `ClientRelationshipEvent` records who ended it and why. One transaction does all of the above.
- Read-only is enforced server-side: the tenant authorization handler refuses every
  state-changing request that names an ended profile in its route, and writes that reach one through
  another row (enrollment, mesocycle, workout note) call `CoachClientScope.EnsureNotReleasedAsync`.
  Both answer **409 `client_released`**. The domain also refuses changes to an ended profile.
- A person keeps one membership row per workspace. Coming back reactivates it with a new profile, so
  "current profile" is the profile linked to the person and not ended: unique indexes on client email
  and user cover current profiles only, and every self-service lookup uses `CurrentFor(userId)`.
- Database guards: an ended profile row cannot be updated or deleted; at commit an ended profile has
  no active membership, and a client membership that becomes active again has a current profile.
- The email uses a third tenant-owned action-mail queue, `tenancy."NoticeMailRequests"`, with the
  invitation queue's claim, attempt, retry and dead-letter lifecycle but no token or link. Its
  recipient is a membership row (never deleted), one notice per workspace, kind and subject, and the
  dispatcher re-checks that the notice still holds before sending.
- The in-app notices (`ClientLeft` here, `CoachDeparted` in ADR 0026) are in-app-only intents on the
  existing notification outbox, re-checked by the dispatcher like any other.

## Consequences

- A new write path that reaches a client without a `clientProfileId`/`clientId` route parameter
  must call `EnsureNotReleasedAsync` after loading its row.
- A new client self-service path must resolve the client with `CurrentFor(userId)`.
- The owner's former-client page shows the ending, the intake and notes read-only, the progress
  dashboard, and the plan and payment history. Training, nutrition and detailed progress history
  are kept but not shown there yet.
- How Step 2 billing counts active clients is decided there.
- Moving a client and their history to another workspace remains a later, separate feature.

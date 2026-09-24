# ADR 0027: Release client

Status: accepted, 2026-09-23

## Context

ADR 0026 gave each client one coach but no way to end a client's relationship with a workspace — for
example when a client follows a departing coach or quits the gym. Platform billing (commercial
Step 2) will count active clients, so a departed client must stop counting without losing history.

## Decision

Business rules, decided by the product owner on 2026-09-23:

- **Only the owner releases a client**, with a reason, against the client version they saw.
- **Access ends immediately.** The client's membership becomes `Removed`; their account keeps
  working for any other workspace. They can no longer see anything in this one, including their own
  history.
- **Open work closes; nothing is deleted.** Running and future plans (enrollments), programmes
  (mesocycles) and meal plans are cancelled through their own audited transitions with the reason
  "Closed because the client was released from the workspace." Payments stay; there is no refund.
  A programme with a workout in progress is left as it is, because the training rules refuse to
  cancel one mid-workout.
- **The owner keeps a read-only record** under "Former clients". The client moves to the owner (a
  `Released` entry in the coach history), so no coach keeps them. Chats keep the ADR 0026 privacy
  rule, and a former client's features all answer `MembershipInactive`.
- **No undo, no re-invite.** A released client cannot rejoin or be invited again to that workspace.
- **Released clients are not active clients** for team counts or future billing.
- **The client is emailed once**, in fixed wording that names no workspace, coach or reason.

Mechanism:

- `ClientProfile.ReleasedAtUtc` marks the release; the reason is a `Released`
  `ClientRelationshipEvent`. One transaction does all of the above.
- Read-only is enforced server-side: the tenant authorization handler refuses every
  state-changing request that names a released client in its route, and writes that reach one
  through another row (enrollment, mesocycle, workout note) call
  `CoachClientScope.EnsureNotReleasedAsync`. Both answer **409 `client_released`**. The domain
  also refuses changes to a released profile.
- Database guards: a released profile row cannot be updated or deleted; a released client's
  membership can never become active again; and at commit a released profile has no active
  membership. A client membership ended some other way (support, tests) is not a release and is not
  refused.
- The email uses a third tenant-owned action-mail queue, `tenancy."NoticeMailRequests"`, with the
  invitation queue's claim, attempt, retry and dead-letter lifecycle but no token or link. Its
  recipient is a membership row (never deleted), one notice per workspace, kind and subject, and the
  dispatcher re-checks that the release still holds before sending.

## Consequences

- A new write path that reaches a client without a `clientProfileId`/`clientId` route parameter
  must call `EnsureNotReleasedAsync` after loading its row.
- The owner's former-client page shows the release, the intake and notes read-only, the progress
  dashboard, and the plan and payment history. Training, nutrition and detailed progress history
  are kept but not shown there yet.
- Step 2 billing can count active clients as active `Client` memberships.
- Moving a client and their history to another workspace remains a later, separate feature.

# ADR 0018: Notification Dispatch and In-App Inbox v1

Status: accepted, 2026-08-31

## Context

ADR 0006 made commercial notification scheduling durable and idempotent, and deliberately stopped
there: Phase 2 persisted an outbox row atomically with enrollment and payment state, and claimed no
delivery. That was honest, but it left a queue nothing drains. Every commercial event since has been
adding rows to a table with no reader.

Phase 6 also has messaging, SignalR, email and WhatsApp ahead of it, and each of those is a way of
*sending* something. None of them is a way of *knowing* what was sent, to whom, whether it worked,
and whether the person has seen it. Building a channel before that record exists produces a system
that can deliver and cannot answer questions about delivery, which is exactly the shape that makes
duplicate sends, silent drops and unexplainable support tickets normal.

This slice therefore builds the record and one channel that cannot fail in interesting ways, before
any channel that can.

## Decision

### Four separate facts, not one

The model keeps four things apart, and the separation is the point:

| Concept | Table | What it is |
| --- | --- | --- |
| Scheduled intent | `notifications.OutboxItems` | A business event said somebody should be told, and when |
| Domain notification | `notifications.Notifications` | What one person was actually told, in one workspace |
| Delivery attempt | `notifications.DeliveryAttempts` | One try at one channel, with its outcome |
| Read state | `Notifications.ReadAtUtc` | The reader's own act |

`ReadAtUtc` is never used to record that a channel or a provider acknowledged anything. Conflating
the two is the defect DOMAIN-RULES **NOT-001** has warned about since Phase 1: provider
acknowledgement means the message left; read state means a person looked at it, and a system that
stores one in the other can report neither.

An outbox row is a durable scheduled intent and is not evidence of delivery. A notification row is a
historical snapshot of what was said. An attempt row is evidence that something was tried.

### At-least-once, stated plainly

In-app delivery is **at least once with an idempotent write**. The unique index on
`(TenantId, SourceOutboxItemId)` means a replay after a crash at any boundary loses the insert and
completes the outbox row instead of duplicating the notification, so the observable result is
exactly one notification per intent.

That is a property of a local database constraint, and it does not generalise. When an external
provider is added the honest guarantee will be **at least once with a stable provider idempotency
key and provider-specific reconciliation** — never exactly-once. Attempt rows already carry
`IdempotencyKey`, stable per intent and channel, for that purpose, and `ProviderMessageId` is
reserved and left null because there is no provider to have returned one.

### PostgreSQL claim and lease

Several Worker replicas must be safe without coordinating with each other, so the coordination is in
the database:

1. A short transaction selects due rows and locks them with `FOR UPDATE SKIP LOCKED`
   ([PostgreSQL 18 SELECT](https://www.postgresql.org/docs/18/sql-select.html)). A replica that
   cannot lock a row steps over it rather than blocking or double-processing it.
2. Eligibility is re-established inside that transaction, from the authoritative rows.
3. The item moves to `Processing` with a unique claim token and an expiry, and an attempt row is
   started, so a worker that dies leaves evidence rather than silence.
4. The transaction commits. Nothing external happens while the lock is held.
5. Materialization runs afterwards, per item, in its own transaction. It first re-establishes the
   same eligibility from authoritative state, then renders and writes only if the claim is still
   current and the business reason still holds.

Every finalization presents the claim token it was issued. A worker whose lease expired and whose
item has been taken over cannot overwrite the newer worker's result: the domain refuses the
transition and the stale sweep records nothing.

A crash therefore leaves either a completed terminal result, or a `Processing` item whose lease will
expire and be reclaimed. No item can become permanently invisible. When a lease is reclaimed, the
unfinished attempt it left behind is marked `Abandoned` *before* a replacement is considered, so
history shows an interrupted try rather than a missing attempt number. An abandoned attempt is still
a started attempt and consumes one slot from `MaximumAttempts`; if it was the maximum, the item is
dead-lettered without inventing maximum + 1.

Workspace ordering is by the age of its effective due work, adjusted by durable last-attempt history
after that workspace is served; tenant GUID is only a final deterministic tie-breaker. Thus a
continuously replenished workspace rotates behind older waiting work instead of starving it, and
`SKIP LOCKED` safely divides each workspace's ordered rows between replicas. This follows the
transactional-outbox and
[reliable background jobs](https://learn.microsoft.com/en-us/azure/architecture/best-practices/background-jobs)
guidance without adopting a job framework.

### Atomic in-app materialization

The notification row, the successful attempt and the completed outbox row commit together. If the
post-claim eligibility check instead suppresses the intent, the already-started attempt is completed
as `Suppressed` and the outbox row is cancelled in that transaction; completed historical attempts
are never deleted. If the transaction fails, none of its facts is visible. The integration suite
proves this by failing the commit itself, after all three success statements have run inside the
transaction, so anything that survived would not have been atomic.

### Tenant-safe worker operation

The sweep's only global read is a read-only list of workspace identifiers, taken with
`IgnoreQueryFilters()`. Every tenant-owned write happens in a fresh scope after
`IMutableTenantContext.SetTenant(tenantId)`, so the `SaveChanges` write-scope guard stays fully in
force for every row the worker touches. This is the same discipline the media purge sweep uses, and
for the same reason: a background sweep that bypassed the guard would be exactly the hole the guard
exists to close.

The batch limit is global rather than per workspace. A per-workspace cap multiplied by the number of
workspaces is not a bound; each selected workspace gets an equal first share of one budget. Capacity
a workspace cannot use is redistributed in later rounds without exceeding that budget, and due-age
rotation prevents a continuously busy subset from indefinitely starving another due workspace.

The worker runs under an explicitly anonymous background identity, so audit stamps record no actor
rather than impersonating the coach or client whose enrollment produced the notification.

### Eligibility matrix

A delayed notification describes a world that may have moved, so every relationship is re-established
server-side in the claim transaction and again after that transaction commits, immediately before
anything is rendered. The committed claim is ownership of work, not indefinite authorization to use
its earlier eligibility result. The payload carries identifiers and a schema version, and nothing
else. The legacy Phase 2 shape without `schemaVersion` is interpreted as schema version 1.

Common requirements, each with its own stable suppression code:

| Requirement | Code when it fails |
| --- | --- |
| Workspace exists and is active | `notification-tenant-inactive` |
| Recipient account is not platform-blocked | `notification-recipient-blocked` |
| Recipient has an active membership of this workspace | `notification-membership-inactive` |
| Client profile is still linked to the recipient | `notification-recipient-unlinked` |
| Workspace relationship is not blocked | `notification-relationship-blocked` |
| Enrollment is not Cancelled | `notification-enrollment-cancelled` |

Kind-specific state, using the workspace's **current** configured time zone to decide what today is.
The zone stored on the outbox row is scheduling provenance and is never re-read for this: what today
means now is a question about the workspace now.

| Kind | Still holds when |
| --- | --- |
| `PaymentRequired` | status is `PendingPayment` and today is before `EndDateExclusive` |
| `EnrollmentActivated` | status is `Active` or `Paused` and today is before `EndDateExclusive` |
| `EnrollmentEndingSoon` | status is `Active` or `Paused` and today is before `EndDateExclusive` |
| `EnrollmentExpired` | today is on or after `EndDateExclusive` (and the enrollment is not Cancelled) |
| `EnrollmentRenewed` | `RenewedFromEnrollmentId` is present and today is before `EndDateExclusive` |

A kind whose state no longer holds is suppressed with `notification-state-changed`.

`ICoachingFeatureAccessService` is deliberately **not** the decision here. `PaymentRequired` exists
precisely to describe a state in which feature access is denied, so gating on it would suppress the
one notification the client most needs.

Suppression is not failure. Nothing went wrong, the business reason simply no longer holds, so it
produces no dead letter and never starts a new attempt solely to record suppression. When discovered
before claiming, no attempt exists. When authoritative state changes after claim commit, the attempt
already started by that claim remains durable and completes as `Suppressed`; it is part of the
started-attempt count but there is no retry budget to spend after this terminal cancellation.
Cancelled and dead-lettered are therefore different terminal facts: cancelled means nobody should be
told any more, dead-lettered means somebody should have been and the dispatcher could not safely do
it.

A malformed payload, an unknown payload schema version, a missing template, or an impossible
tenant/aggregate mismatch is a permanent dead letter on its first attempt, because no amount of
retrying will change any of them.

### Retry policy and engineering parameters

One named policy, `notification-exponential-v1`, expressed as a fixed table so it can be asserted
exactly and so changing it is a visible decision:

| Failure after attempt | Next attempt |
| --- | --- |
| 1 | 1 minute |
| 2 | 5 minutes |
| 3 | 15 minutes |
| 4 | 1 hour |
| 5 through `MaximumAttempts - 1` | 6 hours (ceiling repeated) |
| `MaximumAttempts` | dead letter, `notification-attempts-exhausted` |

At the default maximum of six this is exactly 1m, 5m, 15m, 1h and 6h after attempts 1–5,
then dead letter on attempt 6. A configured maximum below six stops at that attempt; a maximum above
six keeps repeating the 6h ceiling. The maximum bounds every started attempt, including a lease later
recorded as `Abandoned`; reclamation can never create attempt maximum + 1.

Startup-validated configuration under `Notifications:Dispatch`:

| Parameter | Default | Allowed |
| --- | --- | --- |
| `PollIntervalSeconds` | 5 | 1–300 |
| `BatchSize` | 25 | 1–200 |
| `ClaimLeaseSeconds` | 120 | 30–900 |
| `MaximumAttempts` | 6 | 1–20 |

Every instant comes from `IClock`, so the schedule is asserted at its boundaries without a test
waiting for it.

### Safe template policy

Templates are a code-owned allowlist compiled into the assembly: no Razor, no HTML, no
database-authored markup, no format string a caller can influence. Rendering therefore cannot become
an injection surface by way of anything a coach types or a payload carries.

The wording is deliberately generic. No template names the client, the coach, the product, the offer,
an amount, a currency, a date, a database identifier, or any part of the payload. An in-app
notification is a pointer to look at the workspace, not a place to restate commercial or
health-adjacent facts to whoever is holding the phone. The renewal wording in particular says only
that a renewal was created, because a renewal may still be awaiting payment and must not imply active
access.

Culture `en` and template version 1 are the only published wordings. Arabic and any other locale are
deferred. The rendered title and body are snapshotted onto the notification: a later template change
publishes a new version and never rewrites what somebody was already told, which is the same
immutability rule a published check-in version has.

### Dead-letter visibility

Tenant owners can read a bounded, paginated list of dead-lettered intents in their own workspace,
carrying only the outbox id, the kind, the scheduled instant, the attempt count, the dead-letter
instant and a stable failure code.

It carries no recipient, no address, no name, no rendered wording, no payload and no exception. A
workspace owner is not automatically entitled to read a member's notifications, and an operational
view is the wrong place to change that. There is no manual replay in this slice: replay is a write
against somebody else's inbox and needs its own decision.

### Why account, reset and invitation delivery stay separate

`AccountEmailSender` and `InvitationDelivery` keep their existing behaviour and are not migrated.

The reason is the token. Confirmation, password-reset and invitation links carry single-use
credentials, and the outbox is a durable, replayable, operator-visible queue row that a dead-letter
view exposes and a worker may retry six times. Putting a live credential there would turn a delivery
mechanism into a credential store with a retention policy nobody has designed, against the
[OWASP forgot-password guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
that reset tokens be short-lived, single-use and not retained.

Merging them needs a design for tokenless delivery — the outbox holding a reference the sender
exchanges for a freshly minted token at send time — and that is a separate decision from this one.
Until then the token-bearing paths stay where they are, and `CommercialNotificationPayload` carries
no token by construction.

### Why quiet hours, preferences and consent wait

An in-app notification is passive persisted state. It does not ring, buzz, arrive at 3am or cost
anybody a message fee: it sits in a list until somebody opens it. Quiet hours and channel preferences
are answers to the question "when may we interrupt you, and how", and this slice never interrupts
anybody.

Designing those controls now would mean designing them against a channel that does not need them,
and then discovering their real requirements when the first interruptive channel arrives. They wait
for email or WhatsApp, which is also when marketing consent and WhatsApp opt-in become real.

### Worker process

Dispatch runs in `src/backend/TB.Gym.Worker`, a `Microsoft.NET.Sdk.Worker` process that is a second
composition root of the same modular monolith and not a microservice. It shares the database, the
domain assemblies and the tenant guards with the API; it hosts no HTTP endpoints, runs no migrations,
and composes only the narrow set of services a sweep needs — deliberately not the API's cookie
authentication, antiforgery, rate limiting or endpoint services.

Infrastructure transitively requires the `Microsoft.AspNetCore.App` shared framework, so the final
container stage uses the .NET 10 ASP.NET runtime image. That supplies assemblies only: the Worker has
no HTTP listener and its Dockerfile exposes no port. An architecture assertion compares the published
runtime framework requirement with the Dockerfile base, and CI starts the built image and verifies
the dispatch-disabled process remains running.

`MediaPurgeWorker` is left exactly as it is. Its own documentation says it is not a foundation for
notification dispatch, and that remains true: this needed durable semantics it does not have.

## Consequences

- The Phase 2 outbox finally has a reader, and the Phase 2 promise not to claim delivery is now
  backed by a record that can distinguish scheduled, attempted, delivered and read.
- Several Worker replicas can run safely, and a crashed one costs a lease expiry rather than a lost
  notification.
- The old `Failed` outbox status is retired. The migration returns those rows to retryable `Pending`
  with their failure code and attempt count intact. Existing `Pending`, `Cancelled` and `Dispatched`
  states retain their meanings and completed facts; nothing is deleted.
- Reverting the migration is destructive: it drops every notification, every read state and the whole
  delivery history. Schema rollback in production means restoring a tested backup or deploying a
  forward repair migration.
- One package was added: `Microsoft.Extensions.Hosting`, the generic host the Worker SDK requires,
  pinned centrally to the repository's .NET 10 patch version.
- Deferred, explicitly: email, SMTP and WhatsApp adapters; channel preferences, quiet hours and
  marketing consent; migration of token-bearing delivery; chat conversations and messages; SignalR
  sending, groups and scale-out; recurring check-in reminders; manual dead-letter replay; localisation
  beyond English; and any generic background-job framework.

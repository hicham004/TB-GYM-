# ADR 0020: Authorized Realtime Messaging Delivery v1

Status: accepted, 2026-09-04

## Context

ADR 0019 built the record: conversations, participants, messages, append-only revisions, one-way
removal, read cursors and a spent-idempotency-key table, all in PostgreSQL. It deliberately built no
channel. `ChatHub` stayed an empty authorized shell and an architecture test said so, because a
delivery channel built before the record it delivers can send but cannot say what was sent, to whom,
or whether anybody has it — and a chat that lives only in a socket frame is lost by the first
disconnect.

This slice adds the channel, and its whole design follows from one sentence: **the channel is a
convenience over a record that is already correct without it.**

## Decision

### PostgreSQL commits first, and the socket is told afterwards

The REST commands from 6B-2A remain the only authoritative mutation path. Creating a conversation,
sending, editing, sender-removing and coach-moderating a message, and advancing a read cursor all
keep their cookie authentication, antiforgery, idempotency keys, optimistic concurrency, tenant
isolation, explicit participation and `ICoachingFeatureAccessService` checks. The hub adds no
mutation and no acknowledgement; an architecture test enumerates its methods exhaustively.

A successful REST mutation means the state **and its realtime publication intent** committed
atomically to PostgreSQL. It does not mean the recipient received, displayed or read anything. A
SignalR or Redis failure afterwards cannot roll the command back, cannot turn a settled idempotent
retry into an error, cannot allocate a second message, revision, deletion event or realtime event,
and cannot claim human read or provider delivery.

### Two sequences, because they answer two questions

Each conversation now owns a second gap-free allocator, `LastEventSequence`, alongside the message
sequence 6B-2A introduced. They exist separately because an edit or a removal of an **old** message
happens after newer messages have been sent. A client resuming from the message sequence would never
ask for it: the message it concerns is already behind the cursor, and the screen would keep showing a
sentence somebody replaced.

So the message sequence says *which messages exist* and never moves; the event sequence says *what has
happened* and is what a reconnecting client resumes from. An edit takes a new event position and keeps
its message's original one. Both counters are advanced under the same conversation row lock, inside
the command's own transaction, so a rolled-back command gives its number back and committed positions
are unique, gap-free and in commit order.

### The event is content-free

`messaging.RealtimeEvents` stores tenant, conversation, event position, a stable kind, the affected
message identity/position/revision where applicable, the source command record, and the server
instant. That is all. It holds no body, no previous revision, no moderation reason, no display name,
email, phone or profile data, no `ClientProfileId`, no rendered wording, no serialized payload and no
exception text — a domain test asserts the type has no string property at all, and an integration test
dumps every column of every realtime table and asserts none of it contains a body, a reason, a name or
an address.

What a participant may see is built **at delivery and catch-up time**, from the live tables, after
that participant's current authorization has succeeded. An event that outlives somebody's access can
therefore never be replayed into content. The event, recipient, attempt and acknowledgement tables are
not a shadow message store.

### Four facts, kept apart

| Fact | Where it lives | What it means |
| --- | --- | --- |
| Persisted | `Message.AvailableAtUtc` | Committed and available to an authorized reader who asks |
| Published | `RealtimeRecipients.PublishedAtUtc` | The hub, and behind it possibly Redis, accepted the frame |
| Application acknowledged | `RealtimeAcknowledgements`, and once onto `Message.RealtimeAcknowledgedAtUtc` | The **other participant's application** accepted a current safe projection and said so over REST |
| Read | `ConversationParticipant.LastReadSequence` | A person looked |

A fifth, provider acknowledgement, has no channel yet: `ProviderAcknowledgedAtUtc` stays null and a
trigger refuses any attempt to set it.

`Published` is never called `Delivered`. Nobody's browser has been asked, and a socket that accepted a
write can be gone by the time the bytes reach it. `MessageDeliveryState` gains exactly one member,
`RealtimeAcknowledged`, and it means the counterpart's *application* had it — live or through
catch-up — not that a person saw it. An acknowledgement from the sender's own second tab is a real
acknowledgement of that event and evidence about nobody else, so the aggregate refuses to write the
counterpart timestamp from it. The timestamp is written once, from the server clock, and a trigger
refuses to move it.

Acknowledgement changes neither participant's read cursor nor any unread count. That confusion is the
defect DOMAIN-RULES **NOT-001** has warned about since Phase 1.

### Delivery is at least once, on purpose

A dispatcher claims a recipient row with `FOR UPDATE SKIP LOCKED`, takes a random claim token and a
lease, starts a durable attempt, re-establishes authorization, materializes the caller-specific
projection, publishes, and only then finalizes. If the process dies between publishing and finalizing,
the lease expires, another replica reclaims the row and publishes again.

That duplicate is the deliberate trade. A duplicate the client discards by event identity is harmless;
silent loss is not. Nothing here claims exactly-once network delivery, and the client is built so that
duplicates, out-of-order arrival and lost frames are all ordinary rather than exceptional.

The claim discipline is the one Phase 6B-1 proved for notifications, with Messaging owning its own
entities and services rather than coupling to Notifications:

- every started attempt consumes one of `MaximumAttempts`, including an attempt abandoned when a
  lease expired, so reclaiming at the maximum closes the row using the real last attempt and never
  manufactures attempt maximum + 1 — including for configured maxima beyond the four-entry backoff
  table, which is exactly where an off-by-one hides;
- a stale claimant can neither publish-finalize, suppress-finalize, reschedule, dead-letter nor
  acknowledge over a newer claimant's result;
- terminal rows cannot be dispatched again;
- the retry schedule is the named, fixed table `messaging-realtime-backoff-v1` (5s, 30s, 2m, 10m,
  then the ceiling repeats), every instant from `IClock`;
- one poisoned row cannot end the hosted loop, and an unavailable database, unmigrated schema or
  unreachable backplane are retried rather than fatal.

### Authorization is re-read, and groups are never authority

SignalR caches the principal for the life of a connection. A socket opened while somebody was an
active, entitled participant keeps presenting that principal after their membership is revoked, their
account is blocked, the coaching relationship is blocked or the Messaging entitlement lapses. Nothing
about a connection expires on its own.

So current authorization is read from PostgreSQL on connect, on every hub method, and again inside the
dispatcher immediately before anything is materialized — active tenant membership, platform and
workspace relationship blocks, explicit immutable participation, and the Messaging decision. A denied
recipient is suppressed with a stable code before a body is ever loaded; an integration test asserts
the revisions table was never even queried, because reading content and then discarding it is not the
same as never reading it.

Groups are routing. They are transient, they are lost on an ordinary reconnect, they cannot be counted
reliably across replicas, and removing somebody from one is best effort. Correctness never depends on
a group having been left or on an in-memory connection registry. Connection identifiers are not
persisted, group counts are not presence, and there is no typing indicator, presence or online status
to be mistaken for one.

### The browser cannot send a tenant header

A browser cannot put a custom header on a WebSocket or an SSE stream, so the REST `X-Tenant-Id`
convention has no equivalent on the hub. The workspace arrives as `?tenantId=<guid>` and is treated as
**routing input, not authorization**: it is read exactly once, at connection, must be exactly one
non-empty GUID (a missing, malformed, empty or duplicated value fails closed), and is immediately
replaced by a server-owned binding that only exists after active membership has been read from
PostgreSQL. A connection can never change workspace; changing workspace means stopping the connection
and opening another. Normal logging never records the hub query string.

Group names are computed by the server from that verified binding plus a conversation identifier.
Clients pass a conversation GUID and nothing else — there is no method that accepts a group name, a
user identifier or a recipient, and an architecture test asserts every hub parameter is a `Guid`.

### The WebSocket handshake is not protected by CORS

A browser will open a WebSocket to another origin and attach the user's cookies to it, and the response
is not gated on a CORS header the way a `fetch` is. Without an explicit check, any page the signed-in
user visits could open an authenticated socket as them.

So `/hubs` requests are checked against an explicit `Messaging:Realtime:AllowedOrigins` allowlist
before authentication runs. There is no wildcard — a wildcard origin with credentials is the
configuration this exists to make impossible — and a request with no `Origin` at all is refused
whenever the list is configured, because a browser always sends one on a handshake and on the
negotiate POST. Outside Development an empty list fails startup, so production cannot reach the
permissive case. Same-origin production and the existing Angular `/hubs` development proxy both keep
working. SignalR Trace logging and `EnableDetailedErrors` stay off outside Development, and message
content is never logged at any level.

### Subscribe before you read

The browser joins the conversation group **first** and only then reads catch-up from the watermark the
full thread read established. The two overlap deliberately: the events between them arrive twice and
the client deduplicates by event identity.

The other order has a window in which an event committed after the read and before the join reaches
nobody and is never asked for again. Duplicates are cheap; a silently missing message is not.
Conversations created before this phase report a watermark of zero, which is the honest answer — they
have no events, and their current state came from the full REST read.

### The API hosts the sweep; the Worker stays what it was

Publishing needs an `IHubContext`, and an `IHubContext` is only useful in a process that holds
connections or has a backplane to reach them through. Giving the notification Worker one would mean
giving a background process an HTTP surface, a listener and a Redis dependency it exists precisely not
to have. So the realtime sweep is an API-hosted `BackgroundService`, and the Worker keeps no Messaging
reference, no SignalR, no Redis and no exposed port — asserted both by an architecture test on the
assemblies and by a CI check on the built image.

### One replica needs no backplane; several do

Two deployment modes, and the configuration refuses to be ambiguous about which one it is in:

- `ScaleOut: SingleProcess` with one declared API replica — the in-process lifetime manager is the
  whole backplane and Redis is not contacted at all;
- `ScaleOut: Redis` with several — the backplane fans each frame out to every replica holding a
  connection.

`ApiReplicaCount > 1` without `ScaleOut: Redis` **fails startup**, with a message that says what to
change. That is not pedantry: several replicas without a backplane deliver each frame only to the
replica that published it, which looks like working software until somebody's client never sees a
reply. Redis mode without an endpoint, and an unknown scale-out mode, also fail startup. The
connection string is never logged — and because the backplane itself announces its endpoints at
Information level on every connection, that category is filtered out entirely. Nothing operational is
lost by doing so: every publication attempt already records a stable, content-free outcome code in
durable attempt history, so a backplane that is down shows up as publications retrying with
`messaging-realtime-publish-transient`, which is the signal an operator can act on.

Transport fallback stays enabled, because a browser behind a proxy that will not upgrade a WebSocket
still has to connect. The consequence is stated rather than avoided: **a multi-replica production
deployment requires load-balancer session affinity.** The WebSockets-only, skip-negotiation exception
that would remove that requirement is deliberately not taken, because it would remove those clients
instead.

### Redis is a backplane and nothing else

Not a cache, not a queue, not a store. A send during a Redis outage is lost for good. What makes that
survivable is that the REST command and the durable event already committed, the failed attempt is
retried under its own policy, the hosted loop lives through it, and an authorized catch-up returns the
event whether or not it was ever republished — including for work that has reached its attempt limit.
Reconnect always reconciles from PostgreSQL, because Redis cannot replay a lost backplane send.

## Database protections

| Invariant | Protection |
| --- | --- |
| One realtime event per conversation event position | Unique `(TenantId, ConversationId, EventSequence)` |
| One event per source mutation | Unique `(TenantId, SourceCommandRecordId)` |
| Positive, gap-free event positions and an honest tip | Check `EventSequence >= 1`; a new conversation cannot be created with event history; the allocator advances one position at a time and never rewinds; and a deferred constraint trigger on both `Conversations` and inserted `RealtimeEvents` requires `LastEventSequence` to identify the newest stored event and every event after the first to have its predecessor |
| An event describes the mutation that produced it | Deferred trigger comparing the event's conversation, message, kind and revision with its source command record and the message row |
| Every kind but a creation names exactly one message | Check tying `MessageId`, `MessageSequence` and `MessageRevisionNumber` to each other and to `Kind` |
| No event can name another tenant's conversation, message or command | Composite FKs `(TenantId, ConversationId)`, `(TenantId, MessageId, ConversationId)` and `(TenantId, SourceCommandRecordId)` |
| Publication state is unique per event and participant | Unique `(TenantId, RealtimeEventId, RecipientUserId)` |
| A recipient is an explicit participant of that exact conversation | Composite FK `(TenantId, ConversationId, RecipientUserId)` → `ConversationParticipants` |
| Every participant gets publication state | Deferred trigger on both `RealtimeEvents` and `RealtimeRecipients` comparing recipient count with participant count |
| Publication state starts pending, never rewinds, never leaves a terminal status | Trigger comparing OLD and NEW |
| A claim consumes exactly one attempt, including a reclaim | Trigger tying a newly issued claim token to `AttemptCount + 1` |
| Attempt numbers are positive, unique, append-only and bounded | Unique `(TenantId, RecipientId, AttemptNumber)`; checks `1..20`; trigger refusing UPDATE of a completed attempt and refusing DELETE |
| Attempts are the contiguous chain `1..AttemptCount` | Deferred trigger on both `RealtimeRecipients` and `RealtimeAttempts` |
| Status, lease, publication, completion and failure-code combinations are valid | Checks tying `ClaimToken`/`ClaimExpiresAtUtc` to `Processing`, `PublishedAtUtc` to `Published`, `CompletedAtUtc` to the terminal set, and a failure code to the suppressed and dead-lettered set |
| One acknowledgement per event and participant | Unique `(TenantId, RealtimeEventId, AcknowledgedByUserId)` |
| Only an event addressed to that participant can be acknowledged | Composite FK `(TenantId, RealtimeEventId, AcknowledgedByUserId)` → `RealtimeRecipients (TenantId, RealtimeEventId, RecipientUserId)` |
| Events and acknowledgements are append-only | Trigger refusing UPDATE and DELETE |
| Publication state and attempts are never deleted | Trigger refusing DELETE |
| The counterpart-delivery instant is written once and never moved | Trigger on `Messages` comparing OLD and NEW |
| No provider has acknowledged anything | Trigger refusing a non-null `ProviderAcknowledgedAtUtc` |
| Every 6B-2A protection | Unchanged; the revision-chain, conversation-tip, removal-agreement and read-cursor triggers are re-asserted against the upgraded schema |

Several are **deferred** constraint triggers rather than immediate ones, because the facts they check
are only true at commit: a conversation and its creation event, an event and its recipient rows, and a
recipient row and its replacement attempt are each written together in one transaction.

## Migration and upgrade

`Phase6B2BRealtimeMessagingDelivery` adds `Conversations.LastEventSequence` defaulting to zero, an
alternate key on `CommandRecords (TenantId, Id)` so an event can name its source, four tables, and the
triggers above. It fabricates no delivery claim: existing 6B-2A conversations start at event cursor
zero with no events and no acknowledgements, and their current state is established by the ordinary
REST read the client performs before it merges any delta.

The revert drops only what this slice added. Unlike the 6B-2A revert it destroys no conversation,
message, revision, removal record or read position — what it loses is the record of what was published
to whom, which attempts were made, and which events each application acknowledged. It also restores the
6B-2A `protect_message` function verbatim, so a reverted database is left with the protections it had
rather than a version mentioning columns whose meaning has gone. As with every migration here, `Down`
exists so the schema is reversible for a database that has just been built; production rollback means
restoring a tested backup or deploying a forward repair migration, exactly as ARCHITECTURE.md section 7
says.

## Angular

One root-scoped realtime service owns one connection per authenticated account and active workspace.
It builds a relative `/hubs/chat?tenantId=...` URL with cookie credentials and no access token — the
session cookie is HTTP-only for a reason, and an `accessTokenFactory` would mean holding a credential
in JavaScript that the session deliberately does not expose. Logging is capped at Warning so no frame
content can reach the browser console.

`withAutomaticReconnect` handles reconnects with bounded jitter but deliberately does **not** retry the
initial `start()`, so the initial attempt has its own cancellable, jittered retry: without it, a first
attempt that failed because the API was still starting would leave the client permanently offline with
no error anybody sees.

Every account, workspace and conversation change is a generation. No delayed start, reconnect callback,
catch-up page, acknowledgement reply, timer or socket frame from an older generation may write. On an
ordinary reconnect the client rejoins, catches up from its last contiguous event position, and asks for
one bounded conversation-list and unread refresh so threads it did not have open are reconciled from
PostgreSQL. A gap runs bounded catch-up rather than skipping the missing position. Compact
invalidations are coalesced into one bounded refresh; there is no polling timer anywhere. Deletion is
terminal for content and a stale revision loses, so no late event can put back a body somebody took
back. Acknowledgements are queued only after an event has actually been merged, batched to the server
bound, retried idempotently, and never advance read state.

Nothing is written to local or session storage: not a body, not an event, not a cursor, not a pending
acknowledgement, not a connection identifier and not a credential. The existing REST command
idempotency keys are retained across a failed response exactly as 6B-2A does — realtime does not
replace command responses. Connection state is exposed accessibly and says only what is true: "Live
updates are off. Refresh to see new messages", never that anything was lost, and never "delivered" or
"seen".

## Dependencies and images

| Dependency | Version | Licence | Where | Why |
| --- | --- | --- | --- | --- |
| `Microsoft.AspNetCore.SignalR.StackExchangeRedis` | 10.0.11 | MIT | `TB.Gym.Api` only | The backplane. Referenced by the API alone so it never travels into the Worker image. |
| `Microsoft.AspNetCore.SignalR.Client` | 10.0.11 | MIT | integration tests only | So the critical path is exercised over a real WebSocket with a real cookie, rather than by invoking hub methods directly. |
| `@microsoft/signalr` | 10.0.11 exact | MIT | `src/web` | The browser client, pinned exactly in the lockfile. |
| `redis` | `8.2.2-alpine`, pinned | BSD-3-Clause | `compose.yaml`, CI, tests | The backplane image. Never `latest`: a backplane that silently changed version between a passing run and a failing one is a variable nobody can hold still. |

The SignalR server core is already in `Microsoft.AspNetCore.App`; no obsolete SignalR package was
added. Redis holds no application data and is declared with persistence switched off.

## Consequences and deferred work

Nothing is weakened. Tenant isolation, the `SaveChanges` write-scope guard, relationship blocking,
entitlement evaluation, optimistic concurrency, append-only audit and same-user-multiple-workspace
separation are unchanged, and every 6B-2A database protection is re-asserted against the upgraded
schema. Messaging still composes with the shared kernel only; the hub's authorization port is a narrow
interface the module declares and Infrastructure implements.

The cost is honest and bounded: one extra event row and two recipient rows per externally visible
mutation, one attempt row per publication try, and a sweep that polls PostgreSQL on an interval. The
event tables are the obvious thing to age out if a workspace ever grows enough to notice, and doing so
would cost only the ability to catch up from an old cursor — never a message.

Deliberately out of scope, and still open: group conversations and any participant set beyond the two
immutable 6B-2A participants; participant add, remove or reassignment; client-created conversations;
typing indicators, presence, reactions, online status, group counts and retained connection
identifiers; attachments, media, voice and video; Markdown, HTML, previews, unfurling and search;
push, email, SMS and WhatsApp delivery, notification preferences, quiet hours and provider
acknowledgement; end-to-end encryption claims; retention, export and legal deletion workflows;
check-in comments and AI summaries; read receipts and any automatic read advancement; client polling;
a generic event bus or job framework, a Redis cache, a manual replay UI, and any new cloud-managed
service.

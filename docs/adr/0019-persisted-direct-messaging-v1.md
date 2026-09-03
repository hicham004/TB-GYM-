# ADR 0019: Persisted Direct Messaging v1

Status: accepted, 2026-09-01; amended after review, 2026-09-01 (idempotency lock order, database invariants, authorization ordering)

## Context

`ChatHub` has existed since Phase 1 as an authorized SignalR shell with no methods, and MSG-001 has
said since then that messages are persisted before delivery. Nothing had been built underneath it.

Phase 6B-1 made the same argument about notifications and settled it the same way: it built the
record of what was said, to whom, and whether it was read, before building a channel that could send
anything. Messaging is the harder case, because a chat that exists only in a socket frame is lost by
the first disconnect, and because a message is content a person wrote — it can be wrong, it can be
regretted, and somebody may have to remove it.

This slice therefore builds the persisted model. Phase 6B-2B adds realtime delivery on top of it.

## Decision

### Persistence precedes delivery

A message is a row in PostgreSQL before anything else happens. There is no realtime path in this
slice, not even an optional one, and `ChatHub` is still empty — an architecture test asserts it. The
ordering is deliberate:

- a socket delivers to whoever is connected; the record is what a reconnecting client catches up
  from, and Phase 6B-2B's catch-up reads the sequences committed here;
- delivery built first has no sequence to resume from, so it either replays everything or loses the
  gap;
- edit, removal and moderation are properties of a stored message. A channel cannot un-send.

The one claim this slice makes about a message is `MessageDeliveryState.Persisted`: committed and
available to an authorized reader who asks for it. The enum has exactly one member, and a domain test
asserts that. "Delivered" and "Read" are not states a REST command returning 200 can establish.

### One conversation shape

A direct conversation contains exactly one active Owner or Coach, one linked Client, and the
tenant-local client profile whose Messaging entitlement governs it. The participant set is explicit
and immutable in this slice: no add, remove, reassign, leave, invite, second coach, archive or close.

At most one conversation exists per `(TenantId, ClientProfileId, CoachUserId)`. A different coach in
the same workspace opens their own thread with the same client and cannot see the first one — a coach
reading somebody else's conversation because they work in the same building is the failure this
design exists to prevent. Concurrent creates are serialized by a transaction-scoped advisory lock on
the pair and settled by the unique index behind it, so both callers receive the same conversation
rather than one receiving an error.

Clients cannot create conversations, choose staff or inspect the roster. A client replies once an
authorized coach has opened a thread; the create route is coach-only by policy.

### Two separate requirements: participation and entitlement

Every read and write requires both:

1. an explicit `ConversationParticipant` row for the signed-in user, and
2. a current `ICoachingFeatureAccessService` decision for `CoachingFeature.Messaging` on the
   conversation's client profile.

They are checked separately because they are different questions. Workspace membership grants
neither. Entitlement is a property of the client's enrollment rather than of who is asking, so when
it lapses the conversation closes **for both sides**, exactly as ADR 0016 decided for check-ins:
letting a coach read a thread whose client cannot is not a conversation, it is a transcript.

A conversation nobody may reach is still stored. An expired, unpaid, paused, cancelled or blocked
relationship exposes no message content and accepts no writes, and restoring access restores the
thread because nothing was deleted to produce the refusal.

Unknown conversation, another workspace's conversation, and a same-workspace non-participant are one
answer: `404`. Distinguishing them would confirm that an identifier exists and who is in it. A known
participant whose entitlement is denied receives the ordinary `403` carrying its stable
`FeatureAccessReason` and no content, so the screen can say why instead of rendering an empty thread.

**Authorization is resolved before the payload is validated.** Every conversation operation
establishes participation and feature access first, and only then looks at the cursor, the moderation
reason or the read sequence it was given. The first implementation validated three of those first, so
a stranger sending a malformed cursor received `400` where a stranger sending a well-formed one
received `404` — which is the identifier-existence oracle the `404` exists to close. The same rule
governs the conversation list: feature access is decided before any message row is queried, so an
unavailable conversation is refused rather than having its bodies fetched and then filtered out of
the response. A counterpart display name is still resolved for a refused row, because a list entry
has to say who it is with, and a display name is the one thing that read was always allowed to
publish.

### Plain text, and only plain text

A message body is plain text: CRLF and CR normalized to LF, outer whitespace trimmed, blank refused,
control characters other than LF and TAB refused, unpaired surrogates refused, at most 2 000
characters after normalization.

There is no HTML, no Markdown, no linkification, no attachment, no embed, no database-authored markup
and no user-influenced template, so there is no rendering step in which a body could become markup.
Angular interpolates it, and a spec sends `<img src=x onerror=...>` through the whole screen and
asserts that no element came out of it.

Normalization happens once, in `MessageContentPolicy`, because the normalized form is what is stored,
what a length limit is measured against, and what an idempotency key is bound to. Normalizing twice
is how a retry that should have been recognised as identical gets written twice.

### Sequence allocation under a row lock

Every message carries a positive `Sequence`, unique within its conversation, enforced by
`UNIQUE (TenantId, ConversationId, Sequence)`.

The allocator is a column on the conversation row. A send opens a transaction inside EF's retry
execution strategy, takes `SELECT "LastSequence" ... FOR UPDATE` on that row, increments it, writes
the message, and commits. `MAX(sequence) + 1` without a lock lets two senders compute the same
number, and the loser then fails on the unique index instead of being ordered behind the winner.

Because the counter is an ordinary column, a rolled-back attempt gives its number back: committed
sequences are unique, gap-free and in commit order. The integration suite proves this with a
deterministic barrier that holds both senders at the lock statement, and separately by failing a
commit after every statement in the transaction has run and then observing that the next send is
number 2 rather than number 3.

Every instant comes from `IClock`. No sent, edited, removed or read timestamp is ever accepted from a
browser.

### One idempotency table for every command, and one lock order

`messaging.CommandRecords` holds one spent key per workspace, with a unique index on
`(TenantId, IdempotencyKey)` alone — not one table or index per command. A key spent on a send cannot
later be honoured as an edit, because the record carries its command type and the match compares both
the type and a SHA-256 fingerprint of the normalized payload.

**The key is a lock in its own right.** Every command — create, send, edit, delete, moderate — takes
a transaction-scoped advisory lock on `(TenantId, IdempotencyKey)` **first**, then rereads the
command record from committed state, and only then takes whatever aggregate lock it needs: the
direct-conversation pair, the conversation row for the sequence allocator, or the participant row for
the read cursor. The order never varies, so two commands can queue behind each other but cannot
deadlock.

The first implementation locked only the aggregates, and that was not enough. Two requests carrying
one key against two different conversations, two different client pairs, or two different command
types share no aggregate at all, so nothing serialized them and the key could be spent twice.
Concurrent identical edits and removals had a second failure of the same kind: they collided on the
message's `xmin` instead of on the key, and the loser was told its version was stale when it had in
fact presented the same command as the winner and should simply have been replayed.

With the key lock in front, the loser of any of those races reads the winner's record before it
touches anything, and answers from it: an identical retry replays the original result, and a key
carrying a different type, actor, target, body or reason receives the stable
`messaging_idempotency_key_reused` conflict. A unique-constraint violation is caught and translated
in every path; it is an implementation detail and never reaches a caller as a server error.

The advisory-lock key spaces are namespaced constants mixed with the identifiers, so the two
messaging locks and the media quota lock cannot collide with each other by construction. Two
different idempotency keys can still hash to one advisory key; the only consequence is that they
serialize with each other, which costs a little concurrency and breaks nothing.

The fingerprint binds workspace, conversation, actor and normalized body (or reason). An identical
retry — including one that differs only in line endings or trailing whitespace — returns the original
result; a reused key carrying different content conflicts and writes neither another message nor
another revision.

An expected concurrency version is deliberately **not** part of an edit, delete or moderate
fingerprint. A client that lost the response and re-read the message before retrying carries a newer
version, and binding to it would turn an honest retry into a conflict.

For a send, the Message, its first revision, the allocated sequence, the conversation activity update
and the command record commit together or not at all.

### Revisions, and one-way removal

A message is never hard-deleted, and its body never lives on the message row. Bodies live in
`messaging.MessageRevisions`, append-only, one row per version; the message row names only which
revision number is current.

That is stronger than a nullable pointer column would be. The current revision is resolved through
`(TenantId, MessageId, RevisionNumber)`, a key that already contains the tenant and the message, so
pointing at another workspace's or another message's revision is not expressible rather than merely
refused. It also avoids a circular foreign key between the two tables, which PostgreSQL would need
deferred in order to insert either row.

Editing appends the next revision, increments the current number, stamps a server-owned
`EditedAtUtc`, and retains every earlier revision. Only the original sender may edit. There is no
edit-time window: inventing one would be a product rule nobody has decided, and the wrong number is
worse than no number. No ordinary API returns an earlier revision — they are audit history, not a
participant-facing revision browser, and offering one would publish a sentence somebody deliberately
replaced.

Removal is one-way and idempotent, and comes in two distinguishable kinds:

| Kind | Who | Reason |
| --- | --- | --- |
| `SenderRemoved` | the sender, on their own message | none, and none may be stored |
| `CoachModerated` | the explicit coach participant, on the other participant's message | required, bounded, retained |

A moderator removes; a moderator never edits. Rewriting somebody else's words under their name is not
a moderation power and no code path offers one. The reason and the removed body are retained for
audit and are never returned to the other participant, never rendered, and never logged. A
non-participant Owner or Coach has no moderation power at all, because the conversation is a 404 to
them.

A removed message keeps its place, its sequence and its metadata, and loses its body. Editing or
restoring it is refused by the domain, by `SaveChanges`, and by a database trigger.

An append-only `messaging.MessageDeletionEvents` row records who removed what, when, why, and which
revision was current at the time — one per message, enforced by a unique index, because removal is
one-way. The mutable message row carries the current state so a read needs no join; the event carries
the facts that state alone would lose.

### Read state is one person's act

`LastReadSequence` and `LastReadAtUtc` belong to the participant row, never to the conversation. A
conversation-wide read flag could only ever describe whoever looked last, and a delivery
acknowledgement — this slice has none, and 6B-2B will — is not a person looking at all. Nothing in
this slice or the next writes a delivery outcome into read state; that is the defect DOMAIN-RULES
**NOT-001** has warned about since Phase 1.

A participant may advance only their own cursor, and it never moves backwards. The advance happens
under that row's lock, so two concurrent advances resolve to the greater valid sequence rather than
to whichever wrote last, and a trigger refuses a decrease whatever produced it.

**A sequence beyond the newest committed message is clamped down to it, not refused.** The client
reports what it has displayed, and a message committed between rendering and reporting is a normal
race rather than a caller error. Clamping records the honest truth — everything that existed has been
read — while making it impossible to mark a message that does not exist. A negative sequence is a
caller error and is refused. The exact boundary is tested on both sides in the domain suite and again
over HTTP.

Unread counts four conditions: the message is in a conversation the caller explicitly participates
in, it was written by the other participant, it is beyond the caller's cursor, and it is not removed.
Your own message is never unread to you, because sending is not being told something; a removed
message is never unread, because a badge pointing at a body nobody can read is noise. The rule is
stated once as `ConversationParticipant.CountsAsUnread`, which the per-message view reads directly and
which the SQL aggregate mirrors; the integration suite proves the two agree.

The global unread count includes only conversations that currently pass the Messaging decision, so an
inaccessible conversation never leaks its existence through a badge.

### Keyset pagination on both lists

The conversation list is ordered by `(LastActivityAtUtc DESC, Id DESC)` and paged by both halves of
that cursor; supplying one without the other is refused, because half a cursor cannot identify a
position. Offset paging on a list ordered by activity would skip or repeat rows every time a message
arrived between two pages, which is not an edge case but the normal state of affairs.

The keyset predicate is a PostgreSQL row-value comparison written as SQL rather than LINQ, because
the tie-breaker compares two `uuid`s and LINQ has no operator for that; it walks the index from the
cursor rather than filtering after sorting.

Message history pages by sequence. PostgreSQL retrieves newest-first because that is the direction
the index serves and the direction a reader pages in; the API returns each page oldest-first because
that is the direction a thread is read in, and reversing in the browser is one more place to get it
wrong. A sequence cursor is stable under insertion: which messages are older than sequence *n* does
not depend on what happens after the tip. Angular merges pages by identifier and re-sorts by
sequence, so an overlapping page cannot duplicate a `@for` key, and stops offering **Load older** when
a page comes back empty rather than asking for the same position for ever.

### Privacy and logging

Message bodies, revision bodies, moderation reasons, participant names, email addresses and client
identifiers appear in no log, no analytics, no exception message and no operational diagnostic. The
integration suite drives a send, an edit, a reply and a moderation and then asserts that none of that
text — including the removal reason — is anywhere in the captured log.

The conversation list returns a counterpart display name and nothing else: no email address, no phone
number, no intake or health data, no membership list. A coach reading a client sees the tenant-local
client profile name their workspace already holds; a client reading their coach sees the coach's
account display name, because a coach has no client profile in their own workspace.

### Database protections

| Invariant | Protection |
| --- | --- |
| One direct conversation per workspace, client and coach | Unique `(TenantId, ClientProfileId, CoachUserId)` |
| Exactly one Coach side and one Client side | Unique `(TenantId, ConversationId, Role)`, a check restricting `Role` to `Coach`/`Client`, and a deferred constraint trigger asserting both exist and match the conversation |
| A sender is an explicit participant | Composite FK `(TenantId, ConversationId, SenderUserId)` → `ConversationParticipants` |
| Positive, unique, gap-free message sequence | Check `Sequence >= 1`; unique `(TenantId, ConversationId, Sequence)`; new conversations must start at zero; allocator updates advance at most one position; and every inserted message after sequence one must have its predecessor |
| The conversation tip identifies its newest committed message | Deferred constraint trigger on both `Conversations` and inserted `Messages`, comparing `LastSequence` and `LastMessageId` with the highest stored message |
| One revision per message and number | Unique `(TenantId, MessageId, RevisionNumber)` |
| Every message has exactly the contiguous revision chain `1..CurrentRevisionNumber` | Deferred constraint trigger on both `Messages` and inserted `MessageRevisions`, so neither a missing current revision nor an unreferenced future revision can commit |
| A revision was authored by the message's sender | Composite FK `(TenantId, MessageId, AuthoredByUserId)` → `Messages (TenantId, Id, SenderUserId)` |
| A deletion event or command record names its message's own conversation | Composite FK `(TenantId, MessageId, ConversationId)` → `Messages (TenantId, Id, ConversationId)` |
| Removal state and its append-only event agree on tenant, conversation, kind, actor, reason, instant and revision | Deferred constraint trigger on both tables |
| Only the two supported values persist for participant role, deletion kind, deletion-event kind and command type | Check constraints enumerating each set |
| Immutable revisions, deletion events and command records | Trigger refusing UPDATE and DELETE |
| No hard deletion of conversations, participants or messages | Trigger refusing DELETE |
| One-way removal, and no editing or rewriting a removed message's actor or reason | Trigger comparing OLD and NEW |
| Sequence allocator advances one position at a time and activity never rewinds | Trigger comparing OLD and NEW |
| A read cursor never regresses, is never negative, and never passes the newest committed sequence | Trigger, check `LastReadSequence >= 0`, and a deferred constraint trigger against the conversation |
| One removal event per message | Unique `(TenantId, MessageId)` |
| One spent idempotency key per workspace | Unique `(TenantId, IdempotencyKey)` |
| Tenant-composite ownership throughout | Every FK in the graph carries `TenantId` |

Several of these are **deferred** constraint triggers rather than immediate ones, because the facts
they check are only true at commit: a conversation and its two participants, a message and its first
revision, and a removal and its event are each written together in one transaction.

The first implementation claimed most of this table and enforced less than half of it. `Role`,
`DeletionKind`, `Kind` and `CommandType` were unconstrained text, so a third participant could sit
beside the Coach and Client under any other spelling and a removal kind nobody could interpret could
be stored. A message could exist with no revision at all — a message that says nothing, because a
body lives only in a revision row — or name a `CurrentRevisionNumber` that pointed at a missing row
or skipped a number in the chain the audit trail depends on. A revision could be authored by somebody
who was not the sender. A deletion event or a command record could name one conversation while its
message lived in another. Removal state could exist with no event, or with an event that disagreed
about who did it and why, and the actor and reason could be rewritten afterwards. A raw write could
push a read cursor past the newest committed sequence and silently hide the next message to arrive.

`xmin` is the concurrency token on the mutable roots. Identifiers are UUIDv7 generated in the
application.

### Rolling this migration back is destructive

`Phase6B2APersistedMessagingCore` drops its triggers and functions, then its six tables, then the
`messaging` schema itself with `RESTRICT` — so the revert leaves nothing of this slice behind, and
refuses rather than cascading if anything unexpected still lives there. That deletes every
conversation, every message, every revision of every message, every record of who removed what and
why, and every participant's read position. None of it can be rebuilt: a body exists only in
`messaging.MessageRevisions` and nothing else holds a copy. Spent idempotency keys go with them, so a
client retry in flight across a rollback would be written a second time on the way back up.

The `Down` method exists so the migration is reversible for a local database that has just been built.
Production rollback means restoring a tested backup or deploying a forward repair migration, exactly
as ARCHITECTURE.md section 7 says.

## Consequences and deferred work

Nothing is weakened: tenant isolation, the `SaveChanges` write-scope guard, relationship blocking,
entitlement evaluation, optimistic concurrency, append-only audit and same-user-multiple-workspace
separation are all unchanged. No package was added, no broker, bus, cache, scheduler or second
database appeared, and the Worker and the notification architecture are untouched.

Messaging composes with the shared kernel only. Infrastructure wires it to
`ICoachingFeatureAccessService`; no other module's `DbSet`, repository or entity is reachable through
a Messaging contract, and an architecture test walks the module's public surface to prove it.

Per-conversation feature access is evaluated once per client profile per request. For a client that
is one evaluation; for a coach it is bounded by the number of distinct clients on the page, and by
their conversation count for the global unread badge. That is acceptable at this scale and is the
obvious thing to cache if a workspace ever grows enough to notice.

**Phase 6B-2B will add**, and only this: SignalR sending, per-conversation group membership,
connection mapping, reconnect and catch-up from the sequences committed here, delivery attempts and
acknowledgements recorded separately from read state, and scale-out when more than one API replica
requires it. `Message.RealtimeAcknowledgedAtUtc` is the column it writes; it is null throughout this
slice and has no public setter.

Deferred and still open: group conversations, multiple coaches in one thread, participant
add/remove/reassignment, client-created conversations, typing indicators, presence, reactions,
attachments and media of any kind, Markdown or link previews, message search, push/email/SMS/WhatsApp
delivery, notification preferences and quiet hours, end-to-end encryption claims,
retention/export/legal deletion workflows, check-in comments, AI summaries, and any generic event bus
or background-job framework.

# ADR 0022: Production Transactional Email Provider and Event Model

Status: accepted, 2026-09-05

## Context

Phase 6B-3A built the entire email channel except the part that sends. There is an independent
per-channel delivery root, a claim-and-lease dispatcher, a named retry schedule, quiet hours,
preferences, append-only consent evidence and an owned `INotificationEmailTransport` seam — with one
implementation that captures messages in a process's memory and contacts nobody. Production email was
disabled by construction and refused to start if anybody switched it on.

That was honest and it was also the end of the road: a channel that cannot send is not a channel. The
remaining work is not "call an API". It is deciding what a provider's answers are allowed to mean,
what may be believed about a message afterwards, and what happens to somebody whose mailbox refuses
mail — because every one of those decisions is either made deliberately now or made accidentally by
whichever code path happens to run first.

Three things make this harder than it looks.

**A send response and a delivery are different facts, separated by minutes.** The synchronous call
establishes that a provider took responsibility for a request. Whether a destination mail server
accepted it arrives later, asynchronously, out of order, and possibly not at all. Collapsing the two
into one "sent" flag is the single most common way delivery state becomes a lie.

**Bounces and complaints are not this system's problem to ignore.** Continuing to mail an address
that hard-bounced, or somebody who pressed "this is spam", damages the sending domain's reputation
for every other message it sends — including the password resets and payment notices other people are
waiting for. [Gmail's sender requirements](https://support.google.com/mail/answer/81126?hl=en) make
this explicit with complaint-rate thresholds. Handling them is part of sending, not an optional
extra.

**Suppression needs to be about a mailbox, and this repository stores no mailboxes.** Phase 6B-3A
spent real effort keeping recipient addresses out of every durable notification row, and that
property is worth more than the convenience of a suppression list keyed on an address.

## Decision

### The provider is Resend, reached through an owned `HttpClient` adapter

Resend is chosen for the same reasons ADR 0021 already cited it while committing to nothing: it
documents an
[idempotency key with a stated retention window](https://resend.com/docs/dashboard/emails/idempotency-keys),
publishes a
[webhook event model](https://resend.com/docs/dashboard/webhooks/event-types) that separates provider
acceptance, recipient-server acceptance, bounce and complaint rather than flattening them, and signs
webhooks with the [Standard Webhooks](https://docs.svix.com/receiving/verifying-payloads/how-manual)
construction — a documented, verifiable scheme rather than a bespoke one. Its API is four fields and
a bearer token.

**No SDK.** The adapter is `HttpClient`, one request record and one response read. An SDK would
authenticate, serialize, retry and throw on this repository's behalf, and every one of those is
already decided here: the retry schedule is durable and named (`notification-exponential-v1`), the
idempotency key is derived from domain state, every failure must be classified into a stable code
before it touches a row, and no exception may carry a response body. Wrapping an SDK to take all of
that back is more code than not having one, and it would put the provider's types one `using`
statement away from the domain. An architecture test asserts no provider or webhook SDK is referenced
anywhere in the repository.

The provider's own logging is removed from the client rather than tuned. `IHttpClientFactory` writes
the request URI at `Information` and every request header at `Trace`, which for this client means the
API key; a deployment that turns on trace logging to debug something should not thereby start writing
its own provider credential into a log aggregator.

### The states, and what each one is allowed to mean

| Fact | Where it lives | What establishes it |
| --- | --- | --- |
| `Materialized` | `NotificationChannelDelivery.Status` | The application built the email and invoked the transport. |
| Provider accepted | `ProviderAcceptedAtUtc` + `ProviderMessageId` on the delivery, and `NotificationProviderMessage` | A 2xx from the provider carrying a usable identifier. |
| Recipient server accepted | `NotificationProviderMessage.RecipientServerAcceptedAtUtc` | An authenticated `email.delivered` event, and nothing else. |
| Bounced | `BouncedAtUtc` + `BounceClass` | An authenticated `email.bounced` event. |
| Complained | `ComplainedAtUtc` | An authenticated `email.complained` event. |
| Suppressed | `NotificationChannelDelivery.Status = Suppressed`, or `NotificationEmailSuppression` | A recheck refused, or a verified permanent failure stopped the mailbox. |
| Read | `Notification.ReadAtUtc` | The reader opening their own inbox. Never a provider event. |

There is no `Delivered`. The word has no single referent in this system, which is why Phase 6B-3A
removed it and why adding a provider does not bring it back.

**An open is not a read.** `email.opened` and `email.clicked` are not modelled, not mapped and not
persisted — not even as an "ignored" row, which would still record that somebody opened their mail.
An open fires when a preview pane renders an image and does not fire when somebody reads the message
as text, so it is a poor measure of anything; recording it would begin exactly the tracking log the
consent evidence was carefully kept from becoming.

### Provider facts live on their own root, so a terminal delivery stays immutable

Phase 6B-3A made a terminal channel delivery immutable, and that rule is worth keeping exactly as it
is. Provider acceptance is synchronous and is written in the same statement that makes the delivery
terminal, so it costs the rule nothing. Everything the provider says afterwards accumulates on
`NotificationProviderMessage` instead, with `NotificationProviderEvent` as append-only history.

Every fact column on that root is **write-once**. This is what makes out-of-order events safe: a
bounce that arrives before the recipient-server acceptance it contradicts does not overwrite
anything, and neither does the acceptance when it turns up second. Both are true statements about
what the provider said, and the event history records which was learned first. Nothing collapses them
into a status the last writer wins.

### The webhook is authenticated by signature, not by session

`POST /api/notifications/email/provider-events` is the one public route in the Notifications module.
It cannot be behind a cookie or an antiforgery token, because the caller is a provider's servers
holding neither. Its authentication is an HMAC-SHA256 signature over the exact request body, which is
strictly stronger for this purpose: a cookie proves a browser had one, while the signature proves the
body came from whoever holds the signing secret and has not been altered by a byte.

The order inside the handler is the security property, and it is strictly: **bound, verify, parse,
resolve, scope, write.**

- The body is read to a configured limit and refused beyond it, before anything else.
- The signature is verified over the raw bytes — never a re-serialized model, which changes
  whitespace and member order and would authenticate something the provider never signed.
- The signed timestamp is checked against a bounded tolerance in **both** directions. Without it a
  capture stays valid forever, and anybody who once observed a bounce event could replay it to
  suppress somebody's mail at any later time.
- Only then is a parser run, with an explicit depth limit.
- The workspace is **resolved** from the provider's message identifier through
  `NotificationProviderMessage`, never asserted by the request. The ingestion contract has no
  parameter that names a tenant, a user or a delivery, so there is no shape in which an
  unauthenticated caller aims an event at somebody else's data.

Idempotency is the provider's own event identifier, unique per adapter across every workspace. The
provider guarantees at-least-once delivery and no ordering, so the same event will arrive twice; a
unique index turns the repeat into a no-op rather than a second bounce and a second suppression.

Responses are deliberately uninformative. Recorded, already recorded, deliberately not recorded, and
about a message this deployment never issued are one `202`. Distinguishing them would tell an
unauthenticated observer which identifiers exist, and would leave a provider retrying an event
nothing can ever act on.

### Suppression is keyed on a mailbox, as a keyed fingerprint

A suppression has to be about an address, not about a member: somebody who mistyped their address,
bounced, and then corrected it must start receiving mail again, and a suppression recorded against
the member would leave them permanently silent for a mistake they already fixed.

That requires correlating "the address that bounced" with "the address we are about to write to", and
the obvious ways to do it are both wrong. Storing the address undoes the property Phase 6B-3A spent
real effort establishing. **A plain SHA-256 of an email address is not a pseudonym either**: the space
of real addresses is small and enumerable, so anybody holding the table recovers every address in it
with a dictionary. The digest is a synonym for the address, not a substitute for it.

So the fingerprint is **HMAC-SHA256 under a configured key**, recorded beside the id of the key that
produced it, under the named policy `notification-address-fingerprint-hmac-sha256-v1`. Reversing it
requires the key as well as the guess. Nothing in this application reads an address out of it; it
exists only to answer "is this the same mailbox as the one that bounced".

Key management is explicit rather than implicit:

- every fingerprint stores its key id, so a row can always be explained;
- rotation is **additive** — a new key becomes the one new fingerprints are written under, while every
  retired key stays configured and keeps matching the suppressions written under it;
- removing a retired key from configuration is the one act that drops those suppressions, and it is a
  deliberate operator decision rather than a side effect of rotating;
- losing the key entirely is recoverable in the only way that matters: the suppressions written under
  it stop matching, mail resumes, and the provider's own suppression list remains the backstop.

The fingerprint recorded at submission comes from the address **this application resolved**, never
from the `to` the provider echoes back. A forged or altered body therefore could not redirect a
suppression even if the signature had somehow been satisfied.

**Which facts suppress**, and which deliberately do not:

| Event | Suppresses | Why |
| --- | --- | --- |
| `email.bounced`, type `Permanent` | Yes | The mailbox does not exist or refuses this sender. |
| `email.complained` | Yes | Continuing after "this is spam" is both harmful and rude. |
| `email.suppressed` | Yes | The provider's own list already holds the address. |
| `email.bounced`, type `Transient` or unclassified | **No** | A full mailbox is not a dead one. |
| `email.delivery_delayed`, `email.failed` | **No** | Soft failures the retry schedule already handles. |

There is no threshold that turns a run of soft failures into a permanent stop, because a threshold
nobody has chosen is not a policy. Anything the provider does not explicitly classify as permanent is
`Undetermined` and suppresses nothing: the cost of failing to suppress is one more bounce, and the
cost of suppressing wrongly is a client who silently stops hearing about their payments.

Suppression affects email only. The in-app delivery of the same notification is untouched, because a
mailbox refusing mail is not a member losing what they are entitled to be told.

**There is no override, no clearing and no replay surface in this phase.** A control that
un-suppresses a mailbox is a control that can be used to keep mailing an address that complained, and
it needs its own decision about who may press it and what is recorded when they do. What a member
*can* do — correct the address on their account — clears it by itself, because the check compares the
address they use now.

### The idempotency key binds the message and the mailbox

The provider remembers an idempotency key for a
[documented 24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys). Two consequences are
enforced rather than documented and hoped for.

The key is `notification:{intent}:email:v1:{fingerprint}` — the logical message, plus the exact
mailbox as a truncated keyed fingerprint. Without the mailbox, a member who corrects a mistyped
address mid-retry presents the provider with the same key and a different payload, which the provider
answers with a `409` rather than a send. With the address itself, a queue row or a log line would end
up holding a mailbox this design spends considerable effort never storing.

And because the key expires, **a retry schedule longer than the retention window would present a key
the provider has already forgotten** — turning the "duplicate" it was meant to collapse into a second
real message in somebody's inbox. The configured `Notifications:Dispatch:MaximumAttempts` is checked
against the configured retention at startup, in both composition roots. With the documented 24 hours
and `notification-exponential-v1`, the ceiling is eight attempts; nine refuses to start.

Even with all of that, the guarantee is at-least-once within the provider's retention window. It is
never exactly-once, and nothing in this repository claims otherwise.

### Response classification

| Provider response | Classification | Reasoning |
| --- | --- | --- |
| 2xx with a valid `id` | Provider accepted | The one thing a send response can establish. |
| 2xx with no usable `id` | **Permanent** | Recording acceptance without the identifier every later event correlates on would produce a delivery nothing can ever say more about. Inventing one would be worse. |
| 401, 403 | **Transient**, logged as an operational fault | A revoked key is a deployment problem, not a problem with the notification. Dead-lettering every due email the moment one appears would discard work that becomes deliverable again as soon as somebody fixes it. The bounded schedule still ends in a dead letter, and the distinct code is what an alert is keyed on. |
| 408, 429, 5xx, timeout, connection failure | Transient | Waiting could help. |
| 409 `invalid_idempotent_request` | Permanent | The key binds the immutable message and the exact mailbox, so an unchanged retry cannot resolve it. |
| Other 4xx | Permanent | The request itself was rejected. |

The provider's error body is deliberately not read, not parsed and not logged. It quotes the request —
including the recipient address — and classification does not need it: the status code carries
everything the dispatcher must decide.

### Nothing sensitive is persisted, anywhere

The address, the rendered subject and the rendered body exist as local variables for the duration of
one transport call. The API key, the signing secret, the raw webhook body, the provider's response
body and its diagnostic text are never written to any column and never reach a log line. An
integration test dumps every text column of every table in the `notifications` schema — scanning the
live schema rather than a hand-kept list, so a column added later is covered automatically — and every
captured log line, and asserts none of them holds any of it.

### Deliverability remains an operator responsibility

Nothing here mutates DNS, creates an account, or verifies a domain. The prerequisites and the ongoing
checks are documented in `ARCHITECTURE.md` section 19 and `docs/LAUNCH-CHECKLIST.md`, and the
production configuration fails closed until they are met.

## Alternatives considered

**The provider's SDK.** Rejected above: it takes back decisions this repository has already made, and
brings provider types within one `using` of the domain.

**Provider facts as columns on the channel delivery.** Rejected. It would require weakening the
terminal-immutability rule that Phase 6B-3A established and that a trigger enforces, in exchange for
one fewer table. Out-of-order events would then be a race the last writer wins.

**Suppression keyed on the member.** Rejected. It permanently silences somebody who corrected a
mistyped address, for a mistake they already fixed.

**Suppression keyed on a plain hash of the address.** Rejected. An unsalted digest of an enumerable
value is a synonym for that value, not a pseudonym for it.

**Trusting the `to` field the webhook echoes.** Rejected. The application already knows which mailbox
it sent to; taking it from the request instead would make the suppression target something an
attacker who ever obtains the signing secret can aim.

**A global, cross-workspace suppression list.** Not adopted. A mailbox that hard-bounces in one
workspace is suppressed in that workspace only. Propagating it would be better for deliverability and
would also let one workspace learn something about another workspace's members, which is a privacy
decision of its own rather than an implementation detail. It is deliberately left open.

**Treating repeated soft bounces as permanent.** Not adopted. It needs a threshold, and an unchosen
threshold is not a policy.

## Consequences

- Production can send transactional email, and every claim it makes about what happened to a message
  traces to either a synchronous provider response or an authenticated provider event.
- Bounce and complaint handling exists from the first message rather than after the first reputation
  problem.
- Suppression is durable, mailbox-scoped, self-clearing on a corrected address, and holds no address.
- A new table's worth of provider history accumulates and has no retention policy yet. It holds no
  personal data — identifiers, owned classifications and instants — but it grows, and a retention
  decision belongs to the same phase that gives dead letters one.
- Reverting the migration discards provider-event history and suppressions, which is why production
  rollback remains a forward repair migration. The provider's events can be replayed from its
  dashboard, which is the practical recovery path.
- Deferred, explicitly: migrating account confirmation, password reset and invitation mail onto
  ADR 0021's tokenless design; tokenless action-email materialization; marketing campaigns and any
  unsubscribe surface; WhatsApp, SMS and push; DNS automation; manual dead-letter replay; a
  suppression override or replay UI; cross-workspace suppression; and production media
  infrastructure.

## References

- [Resend API introduction](https://resend.com/docs/api-reference/introduction) — base URL, bearer
  authentication, the required `User-Agent`, and the default 10 requests per second per team that
  makes `429` a classification worth having.
- [Resend send email](https://resend.com/docs/api-reference/emails/send-email) — the request shape and
  the `{ "id": ... }` response this adapter reads.
- [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys) — the 256
  character limit, the 24-hour retention window, and the `409 invalid_idempotent_request` a reused key
  with a changed payload produces.
- [Resend webhooks](https://resend.com/docs/dashboard/webhooks/introduction) — at-least-once delivery,
  no ordering guarantee, `svix-id` for deduplication, and the retry ladder.
- [Resend webhook event types](https://resend.com/docs/dashboard/webhooks/event-types) and
  [the bounce payload](https://resend.com/docs/webhooks/emails/bounced) — the event vocabulary this
  build maps, and the bounce classification only a `Permanent` value of which suppresses.
- [Verifying webhooks manually](https://docs.svix.com/receiving/verifying-payloads/how-manual) — the
  `{id}.{timestamp}.{body}` signed content, the base64 `whsec_` key, the space-delimited
  `v1,<signature>` list, and constant-time comparison.
- [Svix webhook security](https://docs.svix.com/security) — the five-minute timestamp tolerance and
  the replay attack it exists to prevent.
- [Gmail sender requirements](https://support.google.com/mail/answer/81126?hl=en) — authentication,
  and the complaint-rate thresholds that make bounce and complaint handling a sending requirement
  rather than a refinement.
- [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
  — still the reason account mail stays outside this outbox, per ADR 0021.
- ADR 0018 (notification dispatch), ADR 0021 (tokenless action-email materialization).

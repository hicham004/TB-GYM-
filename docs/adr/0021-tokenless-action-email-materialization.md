# ADR 0021: Tokenless Action-Email Materialization

Status: accepted, 2026-09-05

## Context

ADR 0018 gave a reason for leaving account confirmation, password reset and invitation delivery
outside the notification outbox, and the reason was the token. Those links carry single-use
credentials, and the outbox is a durable, replayable, operator-visible queue row that a dead-letter
view exposes and a worker may retry six times. Putting a live credential there would turn a delivery
mechanism into a credential store with a retention policy nobody has designed, against the
[OWASP forgot-password guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
that reset tokens be short-lived, single-use and unretained.

That reason was correct and it is still correct. What it did not do was say what the alternative
looks like, so "merge them later" has been a sentence rather than a design, and every phase since has
been able to defer it without anybody noticing what it would cost.

Phase 6B-3A now makes the question concrete. There is an email channel with a real delivery model
behind it: independent per-channel deliveries, claims and leases, a named retry schedule, quiet
hours, preferences, consent evidence and an owned transport seam. The obvious next thought is
"account mail should use this too", and the obvious next mistake is to reach that conclusion without
first writing down which parts of it must not apply.

This ADR is a design boundary for a later phase. **Nothing is migrated by it.**
`AccountEmailSender` and `CapturedInvitationDelivery` keep their existing behaviour, the outbox still
carries no token by construction, and `CommercialNotificationPayload` is unchanged.

## Decision

### The outbox queues a request, never a credential

A future action email schedules an **action request**: the kind of action, the account or invitation
it concerns, and a schema version. Identifiers and nothing else, exactly as
`CommercialNotificationPayload` already is.

It does not carry, and no durable notification row may carry:

- a token, a token hash usable as a token, or any bearer value;
- a complete action URL, or a query string containing one;
- a recipient address;
- a rendered subject or body.

The token is **minted at materialization**, from the same Identity provider that mints it today, held
in a local variable for the duration of one transport call, and dropped. This is the same rule Phase
6B-3A already applies to the recipient address, and for the same reason: a queue row that never held
a credential cannot leak one, whatever a dead-letter view, a support export, a database backup, a log
aggregator or a replay feature later does with those rows.

A consequence worth stating plainly: **a transport retry re-mints.** The token is a function of
materialization, not of scheduling, so the retry that happens six hours later mints a token whose
lifetime starts then. That is the correct behaviour for a credential and the wrong behaviour for a
link somebody may already be holding, which is what the invitation section below is about.

### Authorization and recipient are resolved at materialization

Every action email re-establishes, immediately before it renders anything:

- that the account still exists and is not platform-blocked;
- that the action is still wanted — a confirmation for an already-confirmed address is suppressed,
  a reset for an account that has since changed its password is suppressed, an invitation that was
  revoked, expired or already accepted is suppressed;
- the current address, through a narrow authorized contract of the kind
  `INotificationRecipientContacts` already is.

A committed claim is a lease on work, not durable authorization to send. This is the same recheck
Phase 6B-3A performs for commercial notifications and Phase 6B-2B performs for realtime delivery.

### Links are built from a configured origin, never a Host header

Action URLs are constructed from an **allowlisted, configured, HTTPS public origin**. The request's
`Host`, `X-Forwarded-Host` and `Origin` headers are untrusted input and must never reach a link in an
email: a host-header injection turns a password-reset mail into a credential-harvesting mail that the
victim's own account legitimately triggered.

The Worker has no request at all, which makes this easy to get right and easy to get wrong in the
opposite direction: configuration is the only source available, so it must be present and validated
at startup rather than defaulted. `Application:PublicBaseUrl` already exists for the development
capture path; production must require it, require `https`, and refuse to start without it — the same
fail-closed treatment `Notifications:Email` receives in Phase 6B-3A.

### Uniform responses, timing and rate limits are unchanged

Account recovery endpoints keep the behaviour they have: the same response whether or not the address
is known, no enumeration through timing or status, and the existing
`RateLimitPolicies.PublicAuthentication` limit. Moving delivery behind a queue must not change what a
caller can observe, and in particular must not introduce a new latency difference between a known and
an unknown address — the queue write happens either way, or neither way.

### Action pages set referrer protections

A page reached from an action link carries the token in its URL until it is exchanged. It must send
`Referrer-Policy: no-referrer` so a subresource or an outbound click cannot carry the token to a third
party, and it should strip the token from the address bar once exchanged. This is a property of the
Angular action routes rather than of the queue, and it is recorded here because it is part of the same
credential's lifetime.

### A deliberate resend is a different fact from a transport retry

This is the substantive design problem, and it is specific to invitations.

ADR 0002 says resending an invitation **rotates the token**. That is the right behaviour for a person
clicking "Resend", and it is a bug if a transport retry does it. A retry means the first attempt may
have failed *after* the recipient's mail server accepted it — the SMTP conversation completed and the
acknowledgement was lost, the provider returned 500 after queueing, the process died between the send
and the commit. Rotating on retry invalidates a link that is already sitting in somebody's inbox, and
the recipient gets a "this invitation is no longer valid" page for an invitation nobody revoked.

So the two must be different operations on different durable state:

| | Deliberate resend | Transport retry |
| --- | --- | --- |
| Who asks | A coach or owner, over REST | The dispatcher, from its retry schedule |
| Logical send | A **new generation** | The **same generation** |
| Token | A new one; the previous generation's is revoked | Re-minted for the same generation, and the previously minted one for that generation stays valid until its own expiry |
| Outbox | A new intent | The same intent, same channel delivery |

The mechanism is a durable **logical-send generation** on the invitation, plus an append-only record
of the token hashes minted for each generation. A retry mints against the current generation and
appends; the acceptance path accepts any unexpired, unrevoked hash of the current generation. An
explicit resend increments the generation, which revokes every hash of the previous one under
documented rules: revocation is immediate, the resend is audited, and the invitation's expiry is
recalculated from the new generation rather than extended silently.

Two properties follow, and both are the point:

- a transport retry is **stable**: a link that reached somebody keeps working, however many times the
  dispatcher tries;
- a resend is **decisive**: the person who pressed it knows the old link is dead, which is what they
  wanted when they pressed it.

The same generation idea applies to confirmation and reset, where it is simpler because Identity's own
security stamp already invalidates outstanding tokens on a successful use. The invitation case needs
its own record because an invitation is not an Identity artefact.

### Global Identity mail is not tenant mail

Account confirmation and password reset belong to a **global** Identity account. They are not facts
about a workspace, they can happen before the account has any membership at all, and the account may
belong to several workspaces at once.

The tenant notification outbox requires a `TenantId` on every row, has a global query filter keyed on
it, and enforces tenant-composite foreign keys throughout. Assigning a fabricated, arbitrary or
"first available" tenant to global mail to make it fit that shape is **refused**. It would put one
workspace's operator in the dead-letter view of another person's password reset, make the row visible
to a tenant-scoped export, and quietly assert a relationship that does not exist.

If global action mail is ever queued durably it needs either its own global-scoped table or an
explicitly nullable tenant with the query filter, the write-scope guard and the dead-letter view all
taught about that shape — which is a decision of its own, not a migration.

### Service mail and marketing mail stay separate purposes

Action email is the most transactional mail this product will ever send: somebody asked for it
seconds earlier and cannot proceed without it. That makes it tempting to treat "transactional" as a
label that can be stretched over anything the business would like delivered, which is precisely the
move this design refuses.

Phase 6B-3A therefore classifies purpose explicitly on the notification rather than inferring it
from template wording, and marketing selection fails closed without its own current affirmative
consent. Marketing may never ride on the service-email preference, and no promotional message may be
reclassified as transactional to escape a consent or opt-out obligation.

Lebanon's [Law 81/2018 Article 32](https://nhrclb.org/archives/8228) constrains unsolicited
promotional messages and requires a free and accessible opt-out. The engineering consequence adopted
here is conservative: keep the two purposes structurally separate now, so that adding a marketing
path later is a new consent flow and a new unsubscribe obligation rather than a quiet reuse of a
preference somebody gave for payment reminders. Recording that reasoning is not a legal opinion —
a production marketing programme requires review by Lebanese counsel, and this ADR does not
substitute for it. See also ADR 0003.

When action email does move onto this model, it stays `ServiceTransactional` and remains outside any
unsubscribe surface: a password-reset message the user just requested is not bulk mail, and RFC 8058
one-click unsubscribe applies to the promotional path this repository does not yet have.

### What is not decided here

- Whether account mail is queued at all, or keeps sending inline. Inline sending with a synchronous
  provider call is a legitimate answer for a credential whose value decays in minutes.
- The provider. This ADR constrains what may be persisted, not who transmits.
- Bounce, complaint and suppression-list handling, which is provider-shaped work.

## References

The provider-behaviour references below informed the retry, idempotency and acknowledgement
constraints. **No provider is added because of them**, and none of them is a commitment.

- [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
  — short-lived, single-use, unretained tokens; uniform responses; no enumeration.
- [ASP.NET Core account confirmation and password recovery](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/accconfirm?view=aspnetcore-10.0)
  — the token providers and lifetimes this repository already uses.
- [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys) — a provider
  idempotency key has a **retention window**, so a retry after that window is a second message
  however stable the key is. Attempt rows already carry a stable per-intent, per-channel key; a
  provider adapter must also honour the provider's own retention limit rather than assuming the key
  is eternal.
- [Resend webhooks](https://resend.com/docs/webhooks/introduction) and
  [event types](https://resend.com/docs/webhooks/event-types) — delivery, bounce and complaint arrive
  **asynchronously and out of order**, which is why `ProviderAcceptedAtUtc` and provider
  acknowledgement are separate columns from materialization rather than the same fact.
- [Gmail sender requirements](https://support.google.com/mail/answer/81126?hl=en) and
  [bulk sender guidelines](https://support.google.com/a/answer/14229414?hl=en) — authentication,
  one-click unsubscribe for bulk mail, and complaint-rate thresholds. Relevant to a future marketing
  path and to why service mail and marketing mail are separate purposes in Phase 6B-3A.
- [RFC 8058](https://www.rfc-editor.org/rfc/rfc8058.html) — one-click unsubscribe. It applies to bulk
  and promotional mail rather than to transactional action mail, which is exactly the distinction the
  `NotificationPurpose` classification exists to keep honest.

## Consequences

- The Phase 6B-3A model can absorb action email later without redesigning it: identifiers in the
  queue, credentials at materialization, and a transport seam that never sees durable state.
- Invitations gain a design problem with a written answer rather than an unwritten one. Implementing
  it means a schema change — a generation counter and an append-only token-hash record — and that
  work is deliberately not in this phase.
- Global Identity mail is explicitly out of scope for the tenant outbox, so nobody has to rediscover
  why a `TenantId` on a password reset is wrong.
- Deferred, explicitly: any migration of account confirmation, password reset or invitation delivery;
  a production email provider; webhooks; bounce, complaint and suppression-list processing;
  DKIM/SPF/DMARC automation; and unsubscribe endpoints.

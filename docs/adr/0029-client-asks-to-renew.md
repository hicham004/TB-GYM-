# ADR 0029: A client asks their coach to renew

Status: accepted, 2026-09-25 (Step 3B2)

## Context

When a client's plan runs out, Today used to say only "Your coaching plan has ended. Contact your
coach." Messaging closes with the plan, so the client had no way to act, and the coach had no signal
that a lapsed client wanted to continue. Renewals are how a coach keeps earning, and how the platform
keeps counting that client (ADR 0028).

## Decision

Business rules, decided by the product owner on 2026-09-25:

- **Today says "Your coaching plan with {coach} ended on {date}."** with an **Ask to renew** button.
  The date is the plan's last covered day. The wording uses no pronouns.
- **Only when the whole plan has run out**: every feature the client had has passed its end date, and
  nothing else is waiting. No button when the coach cancelled or paused the plan, when one feature
  still runs, when a renewal awaits payment or starts later, or when the relationship is blocked.
  The rule is `RenewalEligibility`, read from the same access decisions every feature uses.
- **The coach is told in-app, naming the client** ("Maya Rahman asked to renew"), with a link to the
  client's page. This is the one notification whose title names someone: a coach with many clients
  could not act on "a client asked". The name is read when the inbox row is written, never stored in
  the payload, and the notice is never emailed.
- **At most once per client in any 7 days**, counted in workspace calendar days. A second tap, or
  asking again inside the window, shows the first request ("Renewal request sent on … You can ask
  again from …").
- **Messaging rules do not change**: it stays closed when a plan ends.

## Implementation

- `subscriptions."RenewalRequests"` is append-only (trigger) and holds the client, the ended
  enrollment, the coach told, and `[RequestedOn, AskAgainFrom)`. A PostgreSQL GiST exclusion
  constraint (`EX_RenewalRequests_OnePerWindow`) keeps two windows of one client from overlapping, so
  a double tap or two concurrent requests store one request; the loser answers with the winner.
- The request and its notice commit together: the notice is an in-app-only outbox intent
  (`RenewalRequested`, key `renewal-requested:{requestId}:v1`) whose payload holds only the client's
  id. The dispatcher delivers it only while the recipient is still the client's assigned coach and
  the client has not left, and names the client then.
- `GET /api/client-renewal/me` and `POST /api/client-renewal/me/requests` are client-only, tenant-
  scoped, antiforgery-protected and rate-limited. A released client has no active membership and is
  refused before the service runs. The inbox returns `clientProfileId` for this kind only; the
  client's page still authorizes the coach.

## Consequences

- A coach sees who wants to continue without the client needing an open channel.
- A client whose plan the coach cancelled cannot ask; a later cancelled-then-expired history is read
  the same way the access rules read it.
- Not built: showing open renewal requests on the coach's client page or client list, and any
  email or push for this notice.

# ADR 0037: Website module, Talk-to-us requests and same-origin analytics

Status: accepted, 2026-10-13 (UI plan R6.2g)

## Context

The homepage (R6.2f) tells a gym to "talk to us" and had nowhere to send it. A gym that writes to
TB Gym is nobody's member yet: the request belongs to TB Gym, not to any coaching space, and no
existing module owns anything that is not tenant-owned or an account. The owner also wants to know
whether anybody reads the page, without a cookie banner and without a third-party script on a page
whose CSP allows none.

## Decision

A new module, `TB.Gym.Modules.Website`, owns what a visitor who is nobody's member can do and read:
the Talk-to-us request (`website."ContactRequests"`) and the website's public settings (the WhatsApp
number, the analytics script). The table has no `TenantId` column, as the global account-mail queue
has none (ADR 0021): a column that does not exist cannot be fabricated or exported with a workspace.
The facts a person wrote are frozen by a trigger and by the model; only the email's bookkeeping
changes afterwards, and a request is never deleted.

The owner's email about a request rides the action-mail sweep as its fourth queue, with the same
claim, lease, attempt budget and `action-mail-exponential-v1` schedule as the other three, through the
same transport. The recipient is `Website:ContactRecipient`; while it is empty, or while email is off
and no transport is composed (audit A1, BEB-1), the sweep claims nothing, so requests wait as pending
and go out the day both are there. No log line carries the
person's name, contact or words.

Three cheap filters stand in front of the form, none of them a CAPTCHA: a honeypot field a person
never sees (a filled one is answered as accepted and kept nowhere), a server-signed stamp issued when
the form comes into view and refused when sent back within three seconds, and two per-address
allowances, nginx's on the one path the edge sends through it (six a minute) and the API's own
behind it (five an hour), on top of the antiforgery token every state change already needs.

Analytics is Plausible, loaded from this origin alone: nginx proxies the site's script and its
events under `/stats/`, the queue stub Plausible writes inline is written from the bundle instead, so
the CSP stays `script-src 'self'` with no nonce and no third-party host. It is off until the owner
names the site's script in configuration; the privacy wording that goes with it is the owner's.

## Consequences

- `ARCHITECTURE.md` §3 gains the Website module; the API and the Worker both compose it.
- The production edge sends `/api/website/contact-requests` through the web container, which is
  therefore the API's second trusted proxy at a fixed address.
- The owner reads the email. Since audit A1 (BEB-1) the platform admin page also lists every request
  whose email has not gone out, waiting or dead-lettered (`GET /api/platform-admin/contact-requests`,
  mapped by this module under the admin policy), so a request sent while email is off is still read.
- Nothing here moves money and no legal wording is written by the code.

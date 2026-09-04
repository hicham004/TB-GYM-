# TB Gym Architecture

Status: Phase 6A check-ins complete, 2026-08-26; Phase 5/6 audit remediation applied, 2026-08-29;
Phase 6B-1 notification dispatch and in-app inbox complete, 2026-08-31; Phase 6B-2A persisted
direct messaging complete, 2026-09-01; Phase 6B-2B authorized realtime messaging delivery complete,
2026-09-04

## 1. Architectural style

TB Gym is a modular monolith with one deployable ASP.NET Core API, one Angular SPA,
and one PostgreSQL database. It is not a microservice system. The modules have explicit
ownership and dependency rules so a module can be extracted later if operational evidence
justifies the extra distributed-system cost.

```text
Browser
  |
  | same-origin HTTP, cookie session, XSRF token, SignalR
  v
Angular SPA / Nginx
  |
  v
ASP.NET Core API (composition root)
  |-- identity and tenant authorization
  |-- application modules
  |-- provider abstractions
  v
EF Core / Npgsql
  v
PostgreSQL (schema per functional module, tenant discriminator per owned row)
```

The backend and database are the source of truth. Angular may guide the user, but it must
not decide access, totals, dates, progression, subscription validity, or any other business
invariant.

## 2. Repository layout

```text
base44/                  Legacy React/Base44-compatible reference application
docs/                    Architecture, domain rules, and roadmap
scripts/                 Repeatable local commands
src/backend/
  BuildingBlocks/        Very small shared kernel
  Modules/               One assembly per bounded module
  TB.Gym.Api/             HTTP composition root and host
  TB.Gym.Worker/         Background composition root; notification dispatch, no HTTP surface
  TB.Gym.Infrastructure/ EF Core, Identity stores, security, providers
src/web/                  Angular standalone application
tests/backend/            Domain, architecture, and API integration tests
```

One assembly per module is intentional at this stage. It gives enforceable boundaries
without creating four projects per mostly empty module. As a module grows, organize it
internally into `Domain`, `Application`, `Contracts`, and endpoint folders. Split a module
into additional projects only when that produces a measurable boundary benefit.

## 3. Bounded modules

| Module | Owns |
| --- | --- |
| Identity | Global account, credential, lockout, platform roles, sessions, legal consent |
| Tenancy | Coach workspace, membership, tenant role, tenant lifecycle |
| Clients | Tenant-specific profile, onboarding/intake, relationship block state/history |
| Invitations | Invite lifecycle, prefilled fields, acceptance and account linking |
| Subscriptions | Products, immutable offers, enrollments, entitlement coverage, payments, renewal |
| Training | Immutable template versions, assigned mesocycle snapshots, prescriptions, executions, actuals |
| Exercise Library | Tenant exercise metadata, muscles, tags, approved alternatives, media associations |
| Nutrition | Versioned foods/cooking factors, immutable recipes and meal-plan versions, assigned client snapshots, daily actuals, energy/macro calculations, structured allergens, reviewed AI drafts |
| Progress | Daily bodyweight, weekly summaries, measurements, dated progress photos and progress views |
| Strength | Append-only max history, canonical RPE/RIR, versioned estimates, recommendations, rounding |
| Check-ins | Form lineages, immutable published versions, stable question keys, assignments, typed client answers, one-way submission/review, comparison projections |
| Messaging | Tenant-scoped direct coach/client conversations, explicit participants, message history, immutable revisions, one-way removal and moderation, per-participant read state |
| Notifications | Idempotent outbox, durable dispatch, versioned templates, per-channel delivery attempts, in-app notifications and read state, future channel ports |
| Media | Object metadata, signature/scanner lifecycle, protected access, subordinate renditions, external embeds, retention |
| Gamification | Tenant theme, levels, ranks and auditable experience events |
| Integrations | AI, payment, nutrition-data and other external provider contracts |

Theme and gamification currently share one boundary because theme-driven labels and rewards
are one optional presentation capability. Split them only if their lifecycles diverge.

## 4. Dependency rules

The allowed compile-time direction is:

```text
SharedKernel <- Modules <- Infrastructure <- API
                  ^                         /
                  +------------------------+
```

The API is the composition root and may reference modules to map endpoints. Infrastructure
may reference modules to implement persistence and external ports. A module may reference
only the shared kernel and platform framework libraries, never another module assembly.
`TB.Gym.Architecture.Tests` enforces the no-module-to-module-reference rule.

`TB.Gym.Worker` is a **second composition root of the same monolith, not a microservice**. It shares
the database, the domain assemblies and the tenant guards with the API; what it does not share is the
HTTP surface. It may reference Infrastructure and the modules, and nothing may reference it back —
which is what the architecture tests assert, along with the absence of any broker, bus, scheduler or
second database. It hosts no endpoints and runs no migrations. See
`docs/adr/0018-notification-dispatch-and-in-app-inbox-v1.md`.

Additional rules:

1. A module owns its domain language and tables. Another module cannot write those tables
   or reuse its entities as a shortcut.
2. Cross-module workflows use narrow public contracts or integration events. They do not
   expose `DbSet`, `IQueryable`, or internal domain objects.
3. The shared kernel contains only genuinely universal primitives such as the clock,
   request identity, tenant context, audit base type, policy names, and the narrow coaching
   feature-access decision port used by every protected module.
4. Infrastructure contains mechanisms, not fitness policy. Formulas and access decisions
   belong in their owning modules.
5. A single `GymDbContext` is acceptable in the monolith and permits atomic local
   transactions. Table ownership and schema boundaries still apply.
6. Add an outbox before asynchronous cross-module side effects become production critical.
   Do not add an in-memory event bus and pretend it guarantees delivery.

Assigned nutrition plans support one audited, one-way cancellation that releases their date
reservation so a misassignment can be corrected; a partial exclusion constraint and a targeted
trigger keep the snapshot itself immutable.

Nutrition follows the same historical layering as training without sharing its entities:
`FoodItemVersion -> RecipeVersion -> MealPlanTemplateVersion -> ClientNutritionPlan ->
DailyNutritionLog`. Publishing locks library versions; assignment deep-copies the selected
plan graph and calculation snapshot reference; actual consumption is stored separately.
The module owns calculation, preparation-basis, allergen, AI-review, and coverage policy.
Infrastructure owns EF persistence and the USDA FoodData Central HTTP adapter. See
`docs/adr/0008-nutrition-engine-v1.md`.

Progress Phase 5A extends the Phase 1 `BodyweightObservation` rather than introducing another
profile weight. It stores canonical kilograms plus the entered value/unit, keeps one current
row per tenant/client/local date, and appends prior-value correction records. Client logging
and history are membership-scoped but deliberately independent of coaching entitlements;
coach views require a coach role, a tenant-local client, and an unblocked workspace
relationship. Workspace-aligned weekly means and the time-aware `BodyweightTrendEwma` v2
estimate read Progress data only and do not recalculate or mutate Nutrition. See
`docs/adr/0009-bodyweight-and-trend-v1.md`.

Progress Phase 5B-1 mirrors that tenant/auth/history boundary for typed body measurements.
Girths store canonical centimetres, body fat stores canonical percent, and corrections append
prior values. See ADR 0010.

Progress photos (5B-2) and their thumbnails (5B-3) reuse the Media pipeline without the Progress
assembly referencing Media; the combined dashboard (5B-4) is a read-side projection in
Infrastructure that owns no tables. See ADRs 0011-0013.

An uploaded image is bounded by its decoded dimensions, not by its compressed size: a few kilobytes
of PNG or JPEG can describe a bitmap of gigabytes, so the codec header is checked against
`MediaUploadPolicy.TryValidateDecodedImage` — 8 000 px per edge, 30 megapixels, approximately 120 MB
for one RGBA pixel buffer — before any pixel buffer is allocated. That number is not peak process
memory: orientation can require a second full bitmap and codec/encoder data, managed streams and the
thumbnail add more. The per-tenant upload gate is retained and the decode/re-encode section also has
a configurable, startup-validated process-wide concurrency cap. A progress photo is recorded only
against a media asset that reached `Ready`; a refused or unscannable upload commits no photo. Each
object is reserved durably before storage and ends attached, confirmed deleted, or retained as
quota-counted cleanup state for the purge sweep, so a failed attempt never loses an object key or
occupies the client's date-and-pose uniqueness slot. See ADR 0011.

Phase 5B-6 closes the one correction the model could not express. A bodyweight observation's
measurement date is its identity — the unique index is keyed on it and a trigger refuses to change
it — so a mis-dated entry is corrected by void-and-replace rather than by editing the date. The
original is voided with a required reason and actor and retained as history; a replacement carrying
the same weight is created on the correct date in the same transaction. The unique index is partial
on an `IsActive` predicate, tied to the status by a check constraint, so a voided row keeps its date
without reserving it and the freed date can be logged again. Every current-truth read excludes
voided rows, including the onboarding earliest-observation lookup; the audit read still resolves
them. See `docs/adr/0015-bodyweight-date-correction-v1.md`.

## 5. Multi-tenancy

The initial model is a shared database with a tenant discriminator. A tenant represents a
logical coaching workspace, not necessarily a physical gym or company. A solo coach owns a
workspace directly; the same workspace can later contain an Owner and multiple Coaches. No
coach requires a parent gym. One global Identity user may have memberships in multiple
tenants, with a separate tenant role in each. Platform administrator is a global role;
Owner, Coach, and Client are tenant membership roles.

A global identity may be linked to separate client profiles under multiple coaches. Those
profiles and every coaching fact remain tenant-local; only credentials and basic account
identity are global. See `docs/adr/0001-workspace-tenancy.md` and
`docs/adr/0002-identity-and-invitations.md`.

Request flow:

1. ASP.NET Core Identity authenticates the user from an HTTP-only cookie.
2. The SPA sends the selected workspace in `X-Tenant-Id`.
3. The tenant authorization handler treats that header only as a request, verifies an
   active membership and active tenant, then sets the scoped tenant context.
4. Tenant-owned EF entities use a global query filter tied to that context.
5. `SaveChanges` rejects tenant-owned writes whose `TenantId` differs from the active
   context.
6. Unique keys and indexes include `TenantId`; future foreign keys between tenant-owned
   rows should include it where PostgreSQL can enforce the ownership relationship.

`ClientProfile` proves this pipeline now. Every new tenant-owned aggregate must receive the
same filter, write guard, composite indexes, authorization test, and cross-tenant negative
integration test. Calling `IgnoreQueryFilters` is restricted to explicit platform operations
that separately authorize and scope the query.

Database row-level security can be added later as defense in depth after connection/session
context and migration behavior are integration-tested. It must not replace application
authorization. Separate database-per-tenant deployment is reserved for contractual or
regulatory customers; it is not the default SaaS topology.

See the official EF Core guidance on
[global query filters](https://learn.microsoft.com/en-us/ef/core/querying/filters) and
[multi-tenancy](https://learn.microsoft.com/en-us/ef/core/miscellaneous/multitenancy).

## 6. Authentication and authorization

The SPA uses ASP.NET Core Identity with a same-origin server cookie:

- The authentication cookie is HTTP-only, secure in production, SameSite Lax, and never
  stored in browser storage.
- State-changing requests validate ASP.NET Core antiforgery tokens. The framework cookie
  (`tb-gym-antiforgery`) is HTTP-only; `/api/auth/csrf` publishes the paired request token
  in the readable `XSRF-TOKEN` cookie, which Angular sends as `X-XSRF-TOKEN`.
- Failed API authorization returns 401 or 403, never an HTML redirect.
- Password lockout and unique email are enabled; production requires confirmed email.
- Public authentication is rate-limited by source address. Sensitive authenticated writes and media
  uploads are rate-limited by the **signed-in user id alone**, and authenticated API responses use
  `no-store`. The limiter runs after `UseAuthentication`, because a partition on `context.User` is
  meaningless before the cookie has been read: running it first left every authenticated write in a
  source-address bucket. The workspace is deliberately not part of the key. It could only come from
  the raw `X-Tenant-Id` header, which is untrusted by design and is not verified until the tenant
  authorization handler runs later — so mixing it in let a caller reset their own allowance by
  varying a header they control, and a limit whose partition the attacker chooses is not a limit.
  One bucket per user is strictly tighter than one per user and workspace.
- Tenant policies verify membership on every scoped request. A UI role check is cosmetic.
- Account authentication and coaching-feature access are separate. An unpaid client can
  authenticate and view permitted profile/account data. `ICoachingFeatureAccessService`
  combines membership, platform block, workspace-local relationship block, entitlement,
  dates, enrollment lifecycle, and payment on every protected feature request.
- Access denies by default and returns a stable reason code. Angular may explain that reason
  but cannot override it.
- A read that composes across domains evaluates access per section, for the feature that owns
  each section's data, before reading it. Progress data is deliberately entitlement-independent
  and stays readable; a section whose feature is gated is returned present, explicitly
  unavailable, with its reason and no content. Omitting it would be indistinguishable from
  emptiness, and populating it would leak exactly what the entitlement gates.

Legal document versions are global identity records, while a workspace consent acceptance is
contextual. Listing current documents accepts an optional workspace context, verifies active
membership, and never treats acceptance in Workspace A as acceptance in Workspace B.

Cookie authentication assumes the SPA and API are served under one public origin. The
Angular development proxy and production Nginx configuration preserve that model.

Private media follows the same-origin model without requiring Angular headers on native
subresource requests. An authorized API call sets a short-lived HTTP-only cookie scoped to
one asset content path. Its protected payload binds tenant, user, and asset. The content
endpoint requires the normal auth cookie, restores only that bound tenant context, rechecks
membership, current feature access, and assignment history, then streams server-controlled
content with range support. A previously issued grant therefore does not survive revoked
entitlement.

A subordinate rendition, such as a progress-photo thumbnail, is served beneath that same asset
content path and is covered by that same cookie, so it needs no grant, route pattern, or policy of
its own. The variant is selected only after the grant has been unprotected and the parent asset has
been authorized, inside the same method, so a rendition can never be reached by a caller who could
not already reach the original.

Active membership of the asset's tenant is the first thing every media authorization decision
establishes, for the subject of a progress photo as much as for a coach. Authentication plus an
unexpired grant is not sufficient: a grant may be configured for as long as four hours, so a check
that trusted user identity alone let a removed or deactivated member keep reading that workspace's
images until the cookie expired. Rechecking on every original and every thumbnail request is what
makes removal take effect immediately rather than eventually.

A screen that shows many protected thumbnails needs one grant per asset before the browser can
fetch any of them, and asking per tile is one request per asset. `POST /api/media/access` is the
bounded alternative: it accepts at most 32 asset ids, authorizes each through exactly the decision
the single-asset route makes, and sets one path-scoped cookie per granted asset. It is a transport
convenience and nothing more — no grant's scope is widened, no URL becomes public, and an asset the
caller may not read is absent from the result rather than reported.

The grant carries its absolute expiry inside the protected payload and the content endpoint
compares that expiry against `IClock`, so expiry is deterministic and testable rather than
dependent on a provider-internal wall clock. `Media:AccessLifetimeSeconds` is configurable
between 60 seconds and 4 hours and defaults to 1800. The default is sized for one realistic
viewing session because each seek in a paused video issues a fresh Range request carrying the
same grant; a shorter lifetime interrupts playback without adding protection, since the
content endpoint reauthorizes membership and entitlement on every request and therefore
revokes access immediately regardless of the remaining lifetime.

## 7. Persistence

PostgreSQL 18 is the target database, accessed through EF Core 10 and Npgsql. Functional
modules own PostgreSQL schemas such as `identity`, `tenancy`, and `clients`; these are not
schemas per customer. EF migrations live in Infrastructure and the migration history uses
the `platform` schema.

Persistence conventions:

- UUIDv7 identifiers are generated in the application.
- Instants use `DateTimeOffset` in UTC. Calendar values use `DateOnly` plus an explicit
  tenant time zone where conversion is required.
- Service periods use half-open intervals `[start, endExclusive)` so adjacent periods do
  not overlap.
- Auditable rows carry created/updated time and actor identifiers.
- PostgreSQL `xmin` is the initial optimistic concurrency token for mutable aggregates.
- Money uses an exact decimal amount plus ISO currency. Offers and enrollment commercial
  snapshots preserve immutable price/currency; payments are append-only ledger operations.
- Workspace defaults use an IANA time zone, culture, configurable week start, and ISO
  currency. Initial Lebanon defaults are `Asia/Beirut`, `en-LB`, Monday, and `USD`; none are
  global business constants.
- Database check, unique, foreign-key, and exclusion constraints duplicate critical domain
  guards where possible.

The subscription module stores one `EnrollmentEntitlement` coverage row per included
feature. A partial GiST exclusion constraint over tenant, client, feature, and a PostgreSQL
date range rejects conflicting coverage under concurrent requests. It does not globally
reject simultaneous products: training and nutrition can coexist when their entitlement
sets do not conflict. An explicit offer-level concurrency rule removes a coverage row from
the exclusion predicate. PostgreSQL
[exclusion constraints](https://www.postgresql.org/docs/18/ddl-constraints.html) protect the
cross-row invariant after application pre-validation.

Database triggers complement the domain model by rejecting updates/deletes to payment,
relationship-event, offer-entitlement, and consent ledgers. Separate triggers protect offer
terms and enrollment price/date snapshots while still allowing lifecycle status changes.

Phase 3 extends database defense in depth to immutable template-version content, append-only
strength max and working-max history, append-only workout notes/progression applications,
started/completed prescription snapshots, and completed actual performance. A second GiST
exclusion constraint rejects overlapping primary mesocycles per tenant/client/date range,
while `pg_trgm` indexes support tenant-local exercise and tag search.

Local Docker startup may apply migrations because there is one API instance. Production
migrations run as a separate deployment step, not concurrently in every API replica.
Schema rollback means restoring a tested backup or deploying a forward repair migration;
destructive down migrations are not a production strategy.

The current audit fields are operational metadata, not a complete legal audit log. Payment,
block, prescription, and sensitive profile changes will need immutable domain audit events.

## 8. Angular application

The Angular 22 application is standalone and feature-oriented:

- root providers and interceptors live under `core`;
- feature routes are lazy loaded;
- Signals own local UI/session state;
- relative API URLs retain a same-origin security model;
- Angular's built-in XSRF integration is used;
- forms display server validation but never replace it;
- a control whose value feeds a `computed` must itself be a signal, because a computed reading a
  plain field never re-evaluates and silently disables whatever depends on it;
- currency inputs accept either case and are normalised on send, matching the server's ISO code;
- feature code does not calculate authoritative fitness or billing state.
- English source text is marked for Angular extraction and layouts use logical CSS properties
  so a later Arabic locale can provide RTL presentation without component rewrites.

**Ratified convention — inline field validation.** A *derived* validation reason is one the form
works out for itself from what has been entered: "choose a due date", "this question has to be
answered". It is distinct from a *server* error, which reports what the backend actually said. The
two are displayed differently because they are different events.

A derived field- or question-level reason appears once that field has been left, or once a submit
has been attempted, whichever comes first. Once shown it stays and updates live. It renders as
plain text — never `role="alert"`. It is linked to its control with `aria-describedby`, and the
control carries `aria-invalid="true"` for exactly as long as the reason is showing.

Each form has one `role="alert"` summary region, present in the DOM from first render so the live
region is registered before anything lands in it, `tabindex="-1"` so it can take focus without
entering the tab order, and populated only when a submit is refused, naming everything outstanding
at once. A refused submit moves focus to it, so the refusal is where the user already is.

**Submit controls are not disabled by invalidity.** They are disabled only while a request is in
flight. Phase 6A-5 shipped the opposite and Phase 6A-6 measured it in Chrome 150: with the form's
default button disabled, pressing Enter in a field fires no `submit` event, a real mouse click on
the button fires no `click` event, and the button cannot take focus at all — so it can neither be
acted on nor announce why it is refusing, and the summary it pointed at was unreachable. The
6A-5 tests passed only because they dispatched a `submit` event directly, which no user can do.
An invalid form now lets the attempt happen and refuses it out loud: nothing reaches the API, the
summary fills, and focus moves there.

`role="alert"` is an assertive live region, so it is reserved for the two cases where something has
just happened: a server error, and a refused submit. Using it for text that is already present when
it renders is an anti-pattern — announcement is inconsistent across assistive technologies, and the
region re-fires on every keystroke as the reason is re-evaluated. That is what the four in-scope
sites did before this chunk.

Touched state is tracked by `core/forms/form-attempt.ts`, one `FormAttempt` per form, keyed by field
name. `shows(field, messages)` is the single expression the text, `aria-invalid`, and
`aria-describedby` all read, so they cannot drift apart. Reasons with no control of their own — how
many questions a draft has, which client is selected — are keyed form-level and only a submit
attempt reveals them, because there is nothing for the user to leave.

Derived reasons never write into the `error` signal. That channel carries what the server said, and
a reason the form worked out for itself has never been near the server.

Phase 6A-5 applied this to the four sites that rendered derived reasons on a pristine form, all in
`features/checkins/` and spread across three templates. The remaining 8 `ngModel` templates (11
carry `ngModel`, 3 are the ones converted here) and all 12 reactive-forms templates have **not**
been retrofitted, and that is deliberate: they render server errors only, so they have no
derived-reason lists to mistime and are not currently wrong today. They adopt this convention when
they next gain derived validation or are otherwise changed.

Three sites were examined and excluded, because each reports an action that has already happened
rather than a standing property of the form: `today-nutrition` sets a per-meal error only inside
`save(slot)`; `client-intake-form` sets `localError` only inside `save()`/`complete()`, which is
already this convention's summary-region shape on a reactive form; and `client-training` renders a
server-computed coverage verdict that only exists once a progression preview has been requested.

The `client-training` exclusion was re-examined in 6A-6 and confirmed: a coverage verdict is the
server's answer to a preview the user just asked for, so an assertive region is right for it, and
it carries no derived per-field reasons. But its **Apply reviewed preview** button is disabled by
exactly the condition that renders the verdict, which is the same defect 6A-6 fixed in check-ins —
a control that cannot be pressed, reached, or focused while the thing explaining it sits next to
it. That is recorded as known and left, because it is Phase 3 training code and deciding what
`applyProgression` should do outside coverage is a domain question, not a display one.

Phase 1 transport contracts are generated from the running API's OpenAPI document with
`npm run api:generate` and checked in for deterministic Angular builds. The API client maps
generated DTOs into stable Angular view models; generated files are never edited manually
and remain separate from backend domain entities.

Phase 2 adds lazy-loaded product management and a focused commercial section on the client
view. Coaches create products/offers, assign service, record payment, renew, manage lifecycle,
and see backend access explanations without exposing raw database concepts.

Phase 3 adds lazy coach routes for the exercise library and program builder, a client-training
section on each coach client view, and a separate focused client `Today` route. The mutable
Angular builder draft exists only for editing ergonomics; saving creates a backend-owned
immutable template version. Assignment, calculated loads, unlock state, substitutions,
completion, and history always come back from the API.

Workout entry uses a separate local draft map keyed by set-performance ID. Saving one set
reconciles only that set and the authoritative execution version; other dirty drafts survive
success, failure, stale responses, and normal read-model refreshes. Writes for one workout
are serialized to preserve optimistic-concurrency order and duplicate taps are suppressed.

The `Today` read model first selects only sessions whose `ScheduledDate` equals the tenant's
current date, then loads the selected prescription/execution IDs with no-tracking split
queries. It does not materialize historical mesocycles before filtering. A PostgreSQL
integration interceptor measures 21 SQL commands for the complete authenticated request
(including authentication, tenant policy, and commercial access) and enforces a ceiling of
24; the schedule SQL must contain client and date predicates.

## 9. Realtime, jobs, and integrations

**Phase 6B-2A built the persisted model; Phase 6B-2B added the channel over it** — see sections 16 and
17, `docs/adr/0019-persisted-direct-messaging-v1.md` and
`docs/adr/0020-authorized-realtime-messaging-delivery.md`.

`ChatHub` is now a strongly typed hub with exactly three members: `OnConnectedAsync`,
`SubscribeConversation` and `UnsubscribeConversation`. Every domain mutation stays on REST, where the
cookie authentication, antiforgery, idempotency key, optimistic concurrency and authorization stack
already are. An architecture test enumerates the hub's surface exhaustively and asserts every
parameter is a `Guid`, so a client can name a conversation and never a group, a user or a recipient.

One API replica needs no backplane. More than one declared replica requires Redis and refuses to start
without it, because otherwise each frame reaches only the replica that published it. Transport
fallback stays enabled, so a multi-replica production deployment needs load-balancer session affinity.
Redis is a backplane and nothing else: a send during an outage is lost, and PostgreSQL plus catch-up —
not Redis — is what makes that survivable.

Commercial notifications persist an outbox item atomically with enrollment/payment state. Each item
retains the tenant time zone used to calculate its UTC schedule and a unique deduplication key. A
completed/cancelled item cannot be dispatched again, and activation cancels a still-pending
payment-required item without deleting its history.

**Phase 6B-1 gives that outbox a reader.** `TB.Gym.Worker` is a separate .NET Worker Service process
— a second composition root, not a microservice — that sweeps due intents on a `PeriodicTimer`,
starting with one immediate sweep, never overlapping ticks, and surviving an unavailable database or
an unmigrated schema by retrying on the next tick rather than ending its loop.

Four facts are kept apart, and the separation is the design: the **outbox item** is a durable
scheduled intent; the **notification** is what one person was actually told; the **delivery attempt**
is one try at one channel; and **read state** is the reader's own act. Provider acknowledgement is
never recorded as read state.

Claiming is PostgreSQL, not application coordination. A short transaction locks due rows with
`FOR UPDATE SKIP LOCKED`, re-establishes eligibility from the authoritative rows, writes a unique
claim token and expiry, and starts an attempt row; nothing external happens while that lock is held.
After that transaction commits, materialization re-establishes eligibility again from authoritative
state in its own transaction. That second check prevents the claim from becoming a durable permission
to send after payment, cancellation, membership, block or other relevant state changes. The
notification row, the successful attempt and the completed outbox row then commit together or not at
all. Every finalization presents its claim token, so a worker whose lease expired cannot overwrite the
newer claimant's result. A crash leaves either a terminal result or a `Processing` item whose lease
expires and is reclaimed, with the interrupted attempt recorded as `Abandoned` before its replacement
is considered — no item can become permanently invisible.

Several replicas are safe because of that, and because the sweep's only global read is a read-only
list of workspace ids: every tenant-owned write happens in a fresh scope after `SetTenant`, so the
`SaveChanges` write-scope guard stays in force. The batch cap is global rather than per workspace.
Workspace selection uses effective due age plus durable last-service history, not tenant GUID order;
equal first shares prevent a busy workspace from taking the budget, and unused shares are
redistributed without exceeding the cap.

In-app delivery is **at least once with an idempotent write**: a unique
`(TenantId, SourceOutboxItemId)` index makes a replay after a crash at any boundary complete the
outbox row instead of writing a second notification. That is a local database property and does not
generalise — a future external provider will be at-least-once with a stable idempotency key and
provider-specific reconciliation, never exactly-once.

Templates are a code-owned, versioned allowlist: no Razor, no HTML, no database-authored markup, no
user-influenced format string, and no client name, price, currency, product, date, identifier or
payload content in any wording. The rendered title and body are snapshotted onto the notification, so
a later template version never rewrites what somebody was already told.

Retry is the named `notification-exponential-v1` policy. With the default maximum of six, failures
after attempts 1–5 wait 1m, 5m, 15m, 1h and 6h, and attempt 6 dead-letters. A configured maximum from
7 through 20 repeats the 6h ceiling until that maximum; a lower configured maximum dead-letters at
that attempt. Every started attempt counts, including an abandoned lease, and no replacement may
create maximum + 1. Permanent failures dead-letter immediately. Suppression and dead-lettering are
different terminal facts. A pre-claim suppression starts no attempt; if authoritative state changes
after the claim commits, the already-started attempt remains in history and completes as `Suppressed`.
Tenant owners get a bounded dead-letter view carrying an id, a kind, instants, an attempt count and a
stable failure code — no recipient, payload, wording or exception. `AccountEmailSender` and
`InvitationDelivery` keep their existing behaviour:
their links carry single-use credentials, which do not belong in a durable replayable queue row.
Email and WhatsApp are still not implemented. See
`docs/adr/0018-notification-dispatch-and-in-app-inbox-v1.md`.

Media, nutrition data, AI, and payment providers sit behind module-owned ports. Provider
payloads and credentials do not leak into domain objects. AI output is untrusted input: it
requires schema validation, provenance, human approval where appropriate, and normal domain
validation before persistence.

Phase 3 provides a local streaming object-store adapter and a development signature scanner.
Production fails media publication closed until a real scanning adapter is configured.
Phase 3 also enforces request-size, endpoint rate/concurrency, and configurable workspace
quota limits, and tombstones historically referenced media. The local storage implementation
is not the production object-store decision; managed object storage, scanner, and CDN/private
delivery remain later production work. Incomplete local ingestion is now durably reconciled rather
than left to provider-level orphan discovery.

Retention processing is now in the application. One in-process `BackgroundService` — the only
hosted service inside the API — sweeps tombstoned media whose retention has elapsed, deleting
derivative objects before originals and recording completion. It is deliberately minimal and is not
a job platform: it holds no queue, no schedule table, and no dispatch abstraction, and it was never a
foundation for notification-outbox delivery, which needed durable semantics it does not have —
Phase 6B-1 built those separately in `TB.Gym.Worker` rather than generalising this loop. Several
API replicas may run it because each sweep claims rows with `FOR UPDATE SKIP LOCKED`, per workspace
so the tenant write-scope guard stays in force for every write it makes. The same sweep first
reclaims due incomplete-ingest reservations, including a crashed pre-write reservation after its
15-minute lease. Storage allowances count originals, derivatives, tombstoned bytes still on disk,
and non-purged ingest reservations; they exclude only purged/deleted bytes and are
checked and committed inside one transaction holding a transaction-scoped advisory lock keyed on the
workspace, so concurrent uploads cannot jointly exceed a limit. Admission orders concurrent durable
reservations by creation instant and id: a candidate counts reservations ahead of it, while every
later candidate observes the winner as committed asset bytes. This avoids symmetric rejection when
exactly one valid upload fits without weakening the hard limit.

## 10. Operations and scaling

The API emits structured JSON console logs and exposes:

- `/health/live`: process liveness, no database dependency;
- `/health/ready`: PostgreSQL connectivity;
- `/openapi/v1.json`: development OpenAPI document.

Production configuration comes from environment variables or a secret manager. Secrets,
connection strings, uploaded files, and local databases are not committed.

Docker persists local uploads and ASP.NET Core Data Protection keys in separate named
volumes. Multiple API replicas must share an external key repository and object storage;
container-local files are never a horizontal-scaling design.

Scale in this order:

1. Tune queries, indexes, payloads, and object delivery.
2. Run stateless API replicas behind a load balancer and use managed PostgreSQL/object
   storage.
3. Add a separate worker process, outbox, and SignalR scale-out when needed.
4. Partition very large append-only tables such as messages or measurements only after
   observed volume supports it.
5. Extract a module into a service only when it needs independent scale, ownership, release
   cadence, or isolation. Give the service ownership of its data and accept asynchronous
   consistency explicitly.

### Source encoding: settled, do not re-investigate

Measured in Phase 6A-6 and recorded so this is not opened a third time.

**`base44/` is mojibake-corrupted: 37 files, and it stays that way.** They carry the full
signature — `â€` sequences from UTF-8 em dashes and curly quotes decoded as CP1252, `ðŸ` from
mangled emoji, `Â` prefixes, and a BOM in all 37. The corruption is present in the initial commit
`a256840`, the only commit that has ever touched `base44/`, so it was imported already broken and
predates this repository's own code. It is double-encoded but *well-formed* UTF-8, which is exactly
what the PowerShell 5.1 ANSI round-trip produces: corruption that compiles and reviews clean.
`base44/` is a preserved legacy reference, so it is deliberately not rewritten.

**The project's own source is clean.** A repository-wide scan of tracked non-`base44` source found
zero invalid UTF-8, zero mojibake signatures, and every tracked `.ps1` file pure ASCII. BOMs on
SDK-generated .NET files are the SDK's own convention, not corruption.

Two earlier sweeps reported this wrongly, both because of the measuring tool rather than the files.
`LC_ALL=C grep -P` **errors out** ("-P supports only unibyte and UTF-8 locales") and, piped to
`wc -l`, reports zero as though it had found nothing; and byte escapes like `\xC3\x82` in a
`git grep -P` pattern match those code points as characters, not as raw bytes. Verify encoding by
decoding the file and inspecting code points — `Buffer.compare(Buffer.from(text,'utf8'), buf)` for
validity, and a search for `â€`/`ðŸ`/`Â`+continuation for mojibake — never with a byte-class grep
under a C locale.

## 11. Testing strategy

- Domain tests cover formulas, state transitions, intervals, and access rules.
- Architecture tests protect dependency and ownership boundaries.
- API integration tests cover HTTP behavior, authentication, tenant isolation, antiforgery,
  PostgreSQL constraints, and concurrency.
- Angular tests cover stores, guards, interceptors, and critical feature interactions.
- A feature's primary action is tested through its rendered controls, not by calling the
  component method behind it. `src/testing/dom.ts` addresses a control by the caption a user reads
  (or its `aria-label`), drives it with the event that kind of control actually reports, and
  settles change detection across the passes Angular's forms pipeline needs. A spec that calls the
  method proves the method; only a spec that drives the control proves the screen is wired to it.
- Container-backed tests use real PostgreSQL for behavior SQLite cannot reproduce, including
  ranges, exclusion constraints, case handling, and `xmin`.
- Every production incident involving an invariant should produce a regression test.

Phase 2 adds domain state-machine tests, Angular commercial contract mapping, and real
PostgreSQL workflows covering unpaid/paid access, payment history, renewal, overlap races,
simultaneous identical assignment/payment retries, non-conflicting services, stale writes,
currency snapshots, notification idempotency, append-only triggers, and relationship
isolation when one identity is a client in two workspaces.

Phase 3 adds fixed-reference domain tests for snapshot isolation, exertion, estimators,
rounding, progression, substitutions, dates, and media signatures. Its PostgreSQL HTTP test
runs the real coach-to-client workflow. Focused scenarios separately verify lifecycle and
same-date replacement, coverage boundaries and atomic progression rejection, overlap races,
multi-workspace notes, entitlement expiry, private browser media grants, tenant isolation,
stale/double progression, and the bounded `Today` SQL shape. The release check sets
`TB_GYM_REQUIRE_POSTGRES_TESTS=true`; an unavailable PostgreSQL environment fails rather than
being reported as a passing integration run.

Phase 6A-4 closes the blindness that let a dead Assign button ship behind a green suite: before it,
18 Angular spec files existed and only 6 touched the DOM, with 8 of 13 features carrying no spec at
all. It adds 21 spec files covering auth, invitations, commercial, clients, workspace, profile,
account, nutrition, and training, each driving the real controls of that feature's primary action
and asserting both that the action becomes performable and that it calls the API with the right
payload. Every added test was proven to fail against deliberately broken wiring before being
accepted. The pass found two dead controls in the commercial screens, both fixed.

Checkpoint counts on 2026-08-21 are intentionally separated: 63 tests repository-wide
(29 domain, 1 architecture, 16 PostgreSQL API integration, 17 Angular); 31 are Phase 3
specific (12 domain, 8 PostgreSQL integration, 11 Angular); and 19 focused tests were added
by the remediation pass (5 domain, 7 PostgreSQL integration, 7 Angular). The required full
PostgreSQL run executed all 16 integration tests with zero skips. A separate headless-Chrome
acceptance run exercises the live Angular/API/PostgreSQL stack, native protected media,
coach cancellation/replacement, multi-set drafts, completion, responsive layout, tenant
denials, grant tampering, and clock-driven grant expiry.

## 12. Phase 2 commercial flow

```text
CoachingProduct
  -> immutable ProductOffer (duration + money + features)
  -> ClientEnrollment (dated commercial snapshot)
       -> EnrollmentEntitlement coverage rows
       -> append-only PaymentRecords
       -> idempotent NotificationOutboxItems

ClientProfile + TenantMembership + ClientEnrollment
  -> ICoachingFeatureAccessService
  -> FeatureAccessDecision
```

Renewal always creates another enrollment. A fixed-duration enrollment is fully paid only
when same-currency receipt operations equal its snapshotted price. Partial payments remain
historical but grant no proportional access. Refund/reversal operation names and provider
ports exist for forward compatibility; their business workflows are not implemented in
Phase 2. See ADR 0005 and ADR 0006.

## 13. Phase 3 training flow

```text
Exercise Library + coach media
  -> immutable ProgramTemplateVersion
  -> assignment command + one Training enrollment + explicit start/time zone
  -> deep TrainingMesocycle snapshot + WorkingMaxSnapshots
  -> date-derived Planned/Active or audited Completed/Cancelled lifecycle
  -> published/date/reveal availability
  -> WorkoutExecution prescription snapshot
  -> separate SetPerformance actuals + authored notes + completion
```

One enrollment can authorize several sequential mesocycles and can temporarily authorize
none. The template, assigned mesocycle, and workout execution are intentionally three
different historical layers. Progression is a reviewed, hashed append operation, and global
strength changes never rewrite a captured program. A completed workout remains available in
the dated client view on its scheduled day so terminal mesocycle state does not erase the
just-completed prescription/performance comparison. See ADR 0007.

## 14. Phase 6A check-in flow

```text
CheckInForm lineage
  -> draft CheckInFormVersion (stable QuestionKey per question)
  -> publish freezes the version, its questions and its options at the database
  -> CheckInAssignment pins one published version + one client + workspace-local due date
  -> CheckInResponse (one per assignment): Draft -> Submitted -> Reviewed, one way
  -> typed CheckInAnswer rows + CheckInAnswerChoice rows FK'd to that version's own options
  -> append-only CheckInResponseEvent for submit and review
  -> comparison: read-side projection over two responses, aligned by QuestionKey
```

The form, the published version, the assignment and the response are four deliberately separate
layers. A version is the unit of truth: publishing freezes it, and an assignment resolves the exact
version it named rather than the lineage's latest publication, so a later version can never change
what a client was asked or what a submission means.

Snapshotting is by immutability rather than by copying. An answer stores no question or option text;
a submission renders its original wording by reading the frozen version's rows. The answer chain is
held by composite foreign keys that carry each parent's discriminating columns, so answering a
question of another version, or selecting an option belonging to another question, is refused by
referential integrity rather than by application code.

Drafts are lenient and submission is strict, validating the whole response in one pass and returning
every failure together. Review is a state change plus an append-only event and never touches an
answer. Comparison stores nothing, aligns by `QuestionKey`, carries each side's own wording, and
reports a one-sided question explicitly rather than as an empty answer. No answer is interpreted:
there is no score, rating, adherence measure or trend over check-in content.

The Angular surface is three lazy routes under `/checkins`: the coach's form builder (`forms`), the
coach's client view for assigning, reviewing and comparing (`clients`), and the client's own
answering screen (`me`). The builder renders a published version read-only and offers a derived
draft instead of an edit; the answering screen saves an incomplete draft freely and blocks only
submission. Every rule it enforces is a duplicate of a server rule, never the only copy.

A refused read is rendered from the `accessReason` the 403 carries, in the audience's own words,
and it replaces the list it was refused rather than sitting above an empty one — a client who may
not read their two submissions is never told they have none, and a blocked coach is never told
nothing was assigned. Only an unexplained failure falls back to a generic error.

An unsubmitted draft is private to the client writing it. The coach's read returns the response, its
status and its dates with no answers and an explicit `AnswersWithheld`, decided once in the backend
mapping rather than by the screen; the client's own read is complete. The coach's assignment list
carries each response's status so the screen needs no per-assignment read, and every asynchronous
result on that screen checks which client it was requested for before it writes anything, so a
reply that arrives after the coach has moved on is discarded rather than shown under the wrong name.
Due-date validation reads the workspace's own `currentDate` from `GET /api/workspace` rather than
deriving today from the browser clock, which is a different calendar around midnight.

See ADR 0017 for authoring and ADR 0016 for responses.

## 15. Phase 6B-1 notification flow

```text
commercial event
  -> NotificationOutboxItem (durable scheduled intent, tenant time zone, deduplication key)
       Pending -> Processing -> Dispatched | DeadLettered, or Cancelled from either
  -> Worker sweep: FOR UPDATE SKIP LOCKED, eligibility recheck, claim token + lease
        -> NotificationDeliveryAttempt (per channel, per attempt, immutable once completed)
  -> post-claim eligibility recheck, then versioned code-owned template rendered once
  -> Notification (tenant-owned snapshot for one recipient)
  -> ReadAtUtc (the reader's own act, never a provider acknowledgement)
```

The Angular surface is one lazy route at `/notifications`, offered to every active member whatever
their role, plus an unread badge in the topbar. The badge and the inbox are both scoped to the
recipient-and-workspace pair: whenever that pair changes, both are cleared *before* anything is
fetched, and every asynchronous reply — list, Load More, unread count, mark-read success and
mark-read failure — checks which pair it was asked for before it writes. Without that, a slow reply
for the workspace the user has just left lands on top of the current one.

Load More advances its server offset by the number of server rows consumed, not the number of unique
rows rendered. An insertion between pages can make adjacent pages overlap; de-duplication keeps DOM
keys unique while the consumed offset still advances until the bounded result set is exhausted.

Unread is carried by a border weight, a marker glyph and the word "Unread", never by colour alone,
and the badge count is announced in words beside the link rather than left as a bare number. Marking
read is idempotent and is the only write the screen makes. There is no polling and no SignalR in this
slice: an in-app notification is passive persisted state, read when the screen is opened.

The dead-letter view is owner-only, bounded and paginated, and returns identifiers, a kind, instants,
an attempt count and a stable failure code — never a recipient, a payload, rendered wording or an
exception. See ADR 0018.

## 16. Phase 6B-2A persisted messaging flow

```text
coach opens a direct conversation with a linked client
  -> Conversation (TenantId, ClientProfileId, CoachUserId) — at most one, ever
       + exactly two ConversationParticipants (one Coach side, one Client side), immutable
  -> send: row lock on the conversation allocates the next Sequence
       -> Message (no body) + immutable MessageRevision 1 + activity update + spent idempotency key,
          all in one transaction
  -> edit: append MessageRevision n+1, bump CurrentRevisionNumber, stamp EditedAtUtc
  -> remove: one way, SenderRemoved or CoachModerated, plus an append-only MessageDeletionEvent
  -> read:  the participant's own LastReadSequence, monotonic, clamped to the newest committed
```

Persistence comes before delivery, and the reason is the same one Phase 6B-1 gave for notifications:
a channel built first can send and cannot say what was sent, to whom, or whether anybody saw it. A
chat that exists only in a socket frame is additionally lost by the first disconnect, and edit,
removal and moderation are properties of a stored message that a channel cannot express.

**Two separate requirements gate every operation**, and both must hold: an explicit
`ConversationParticipant` row, and a current `CoachingFeature.Messaging` decision for the
conversation's client profile. Workspace membership grants neither, so another Owner or Coach of the
same workspace is refused exactly as a stranger is — `404`, indistinguishable from an unknown
conversation and from another workspace's. A known participant whose entitlement is denied receives
the ordinary `403` carrying its stable reason and no content. Nothing is deleted to produce a
refusal, so restoring access restores the thread.

**One lock order, everywhere.** Every command takes a transaction-scoped advisory lock on
`(TenantId, IdempotencyKey)` first, rereads the command record from committed state, and only then
takes an aggregate lock. Locking only the aggregates was not enough: one key presented against two
conversations, two client pairs or two command types shares no aggregate, so nothing serialized it,
and concurrent identical edits or removals collided on the message's `xmin` and were told their
version was stale when they should have been replayed. With the key lock in front, an identical retry
replays the original result and a reused key carrying different content receives the stable conflict
— never a unique-constraint violation surfaced as a server error.

**Sequences are allocated under a row lock**, not by `MAX(sequence) + 1`. The allocator is a column
on the conversation, incremented inside the sending transaction under `FOR UPDATE` — the second lock,
after the key — so committed sequences are unique, gap-free and in commit order, and a rolled-back
attempt returns its number rather than leaving a hole.
`UNIQUE (TenantId, ConversationId, Sequence)` is one guarantee behind it. Database triggers also
require a conversation to start with an empty sequence, restrict each allocator update to one
position, require an inserted message after sequence one to have its predecessor, and assert from
both sides at commit that `(LastSequence, LastMessageId)` names the highest stored message. Raw SQL
therefore cannot manufacture an unread position or commit a message beyond the durable tip.

**A message body never lives on the message row.** Bodies are append-only `MessageRevision` rows and
the message names only which revision number is current, resolved through
`(TenantId, MessageId, RevisionNumber)` — a key that already contains the tenant and the message, so
pointing at another workspace's revision is not expressible rather than merely refused, and no
circular foreign key is needed. A deferred constraint runs from both the message root and every
inserted revision, so the stored rows must be exactly the contiguous chain
`1..CurrentRevisionNumber`; neither a missing current revision nor an unreferenced future revision
can commit. Removal is one way, comes in two distinguishable kinds, keeps the
message in place with no body, and is recorded as an append-only event carrying the actor, the
instant, the reason and the revision number at the time. A moderator removes and never edits.

**Read state belongs to the participant**, never to the conversation and never to a delivery
outcome. The cursor only moves forward, is advanced under its own row lock so concurrent advances
resolve to the greater sequence, and a sequence beyond the newest committed message is **clamped**
down to it rather than refused — a message committed between rendering and reporting is a race, not a
caller error. A deferred constraint trigger refuses a raw write that would push the cursor past the
conversation's newest committed sequence, which would otherwise silently hide the next message.

**Authorization is resolved before the payload is validated**, on every conversation operation and in
the conversation listing. Answering a malformed request differently from a well-formed one is an
oracle for whether an identifier exists, and fetching an unavailable conversation's bodies before
filtering them out of the response is not the same as never fetching them.

Both lists are keyset-paginated: conversations by `(LastActivityAtUtc, Id)` with both cursor halves
required, and history by sequence, retrieved newest-first for the index and returned oldest-first for
the reader.

The Angular surface is one lazy route at `/messages` for every active member, plus a **separate**
unread badge in the topbar. Message unread and notification unread are counted and shown apart: one
is a workspace event somebody scheduled, the other is a person waiting for a reply, and a single
badge summing them could be neither explained nor acted on. Every piece of state on that screen
belongs to one account, one workspace and one conversation; all three are cleared before anything is
fetched when any of them changes, and every asynchronous reply — list, history, send, edit, delete,
moderation, read cursor and unread count — checks which of the three it was asked for before it
writes. Phase 6B-2B added realtime delivery to that screen;
there is still no polling.

Message bodies, revision bodies, moderation reasons, names and addresses reach no log, analytics,
exception or operational view. See `docs/adr/0019-persisted-direct-messaging-v1.md`.

## 17. Phase 6B-2B authorized realtime messaging delivery

```text
REST command (cookie, antiforgery, idempotency key, concurrency, authorization)
  -> one transaction, on the conversation row lock:
       message / revision / removal state  +  RealtimeEvent (content-free, next event position)
       + one RealtimeRecipient per explicit participant  + spent idempotency key
  -> API-hosted sweep, per replica:
       FOR UPDATE SKIP LOCKED  ->  claim token + lease  ->  RealtimeAttempt (started)
       -> re-read authorization from PostgreSQL
            denied  -> suppress with a stable code; no body is ever loaded
            allowed -> materialize the caller-specific safe projection
       -> IHubContext -> in-process manager, or Redis backplane across replicas
            full event   -> tenant + conversation + user group (open thread merges it)
            invalidation -> tenant + user group        (closed thread refreshes its row)
       -> finalize: attempt Published, recipient Published
  -> browser: subscribe, then catch up, then acknowledge what it actually merged
       POST /realtime-acknowledgements -> append-only fact
            -> counterpart's Message.RealtimeAcknowledgedAtUtc, set once, never moved
```

**The channel is a convenience over a record that is already correct without it.** PostgreSQL commits
before anything is sent, and a SignalR or Redis failure afterwards cannot roll the command back,
cannot turn a settled idempotent retry into an error, and cannot allocate a second anything.

**Two sequences, because they answer two questions.** The message sequence says which messages exist.
The event sequence says what has happened, and is the only thing a reconnecting client can resume
from: an edit or removal of an old message happens after newer messages, so a client resuming from the
message sequence would never ask for it. Both advance under the same conversation row lock inside the
command transaction, so a rollback returns the number and committed positions are gap-free.

**The event carries no content.** It holds identifiers, a position, a stable kind and a server instant.
What a participant may see is materialized at delivery and catch-up time, from the live tables, after
that participant's current authorization has succeeded — so an event that outlives somebody's access
can never be replayed into content.

**Four facts stay apart.** Persisted, Published, application-acknowledged and read. `Published` means
the hub accepted the frame and is never called `Delivered`. `RealtimeAcknowledged` means the other
participant's *application* accepted a current safe projection; a sender acknowledging their own event
never sets it, and no acknowledgement touches read state. Provider acknowledgement has no channel and
a trigger refuses to set its column.

**Delivery is at least once by design.** A crash after the hub accepted a frame and before the row is
finalized produces a duplicate after the lease is reclaimed. The client discards it by event identity;
silent loss would have no such remedy.

**Authorization is re-read, and groups are routing.** SignalR caches the principal for the life of a
connection, so membership, blocks, participation and the Messaging decision are re-read on connect, on
every hub method, and again immediately before materialization. Groups are transient, lost on
reconnect, and never authority.

**The browser cannot send a tenant header on a WebSocket**, so the workspace arrives as `?tenantId=`
routing input, is verified against PostgreSQL once, and is then a server-owned binding a connection can
never change. A WebSocket handshake is not protected by CORS, so `/hubs` is checked against an explicit
origin allowlist before authentication; outside Development an empty list fails startup.

**Subscribe, then read.** The overlap between the two is deliberate and deduplicated; the other order
has a window in which an event reaches nobody and is never asked for again.

**The API hosts the sweep.** Publishing needs an `IHubContext`, which is only useful in a process that
holds connections, so `TB.Gym.Worker` keeps no hub, no listener, no exposed port and no Redis
dependency — asserted on the assemblies and on the built image.

**One replica needs no backplane; more than one fails startup without Redis.** Transport fallback stays
on, so multi-replica production needs load-balancer session affinity. Redis is a backplane and nothing
else: a send during an outage is lost, and PostgreSQL plus catch-up is what makes that survivable. The
backplane connection string is never logged, and the backplane's own endpoint chatter is filtered out.

See `docs/adr/0020-authorized-realtime-messaging-delivery.md`.

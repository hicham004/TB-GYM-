# TB Gym Delivery Roadmap

This roadmap favors complete vertical slices and enforceable invariants over building 13
screens backed by partial logic. Phase ordering reflects dependency, not visual priority.

## Phase 0: Foundation scaffold

Status: implemented by this architecture pass.

- Preserve the legacy application under `base44/` as a reference.
- Establish .NET 10, EF Core 10, PostgreSQL 18, and Angular 22 workspaces.
- Create module assemblies and enforce no direct module-to-module references.
- Prove Identity cookie/XSRF setup, tenant membership authorization, EF tenant filtering,
  audit fields, `xmin` concurrency, health checks, OpenAPI, and one client endpoint.
- Add provider ports for jobs, messaging channels, storage, nutrition data, AI, and payment.
- Add Docker local development and domain/architecture/API/Angular smoke tests.
- Record architecture and unresolved domain decisions.

Exit: clean restore/build/test/format/lint/audit; API liveness works without PostgreSQL and
readiness accurately reports PostgreSQL availability.

## Phase 1: Identity, tenancy, and client onboarding

Dependencies: approved tenant/account/invitation and field-ownership decisions recorded in
ADRs 0002-0004.

Status: implemented and reviewed 2026-08-20 for the approved "coach invites the first real
client" vertical slice.

- Record ADRs for tenant shape, identity reuse, time zone, privacy jurisdiction, and field
  ownership.
- Complete account lifecycle: registration/invite-only policy, email verification, password
  reset, security stamp invalidation, lockout, session management, and platform block.
- Create a workspace automatically for an independent coach, support workspace switching,
  and persist configurable culture, time zone, currency, and week-start settings.
- Build client invitation drafts, email delivery records, expiry, resend, revoke,
  acceptance, and existing-account linking.
- Build client intake with coach/client field permissions, units, sensitive-data handling,
  validation, initial bodyweight persistence, coach-only notes, and field-level audit events.
- Generate the Angular API client from versioned OpenAPI and map generated DTOs to view
  models.
- Add PostgreSQL integration fixtures and cross-tenant denial tests for every route.
- Add CI for .NET, Angular, migrations, formatting, dependency audit, and container build.

Exit: a coach can securely create a workspace, invite a new or existing user, complete the
approved intake workflow, and prove that another tenant cannot read or mutate it.

Explicitly deferred: organization staff invitations and membership administration,
WhatsApp delivery, production media/profile photos, and a production transactional email
adapter. Their boundaries exist, but they are not represented as finished Phase 1 behavior.

## Phase 2: Subscriptions, manual payments, and access

Dependencies: Phase 1.

Status: implemented 2026-08-20 for the commercial/access foundation. Phase 3 must not start
until Phase 2 is reviewed and the Phase 3 decisions in `DOMAIN-RULES.md` are answered.

- Separate products, immutable offers, enrollments, entitlement coverage, payments, and
  workspace relationship status. Fixed-duration offers are implemented; recurring billing
  remains architecture only.
- Add explicit pending/active/paused/cancelled/expired transitions, historical renewal, and
  full-payment access with append-only manual receipts.
- Add PostgreSQL checks, tenant-composite foreign keys, immutable-ledger triggers, and a
  partial GiST exclusion constraint per tenant/client/feature/date range.
- Centralize coaching-feature access and return backend reason codes for unpaid, upcoming,
  paused, expired, blocked, and granted states.
- Build coach product management and client commercial workflows for assignment, payment,
  history, renewal, lifecycle, and workspace-local block/unblock.
- Persist idempotent, timezone-aware notification outbox jobs for payment required,
  activation, ending soon, expiration, and renewal. Provider dispatch remains deferred.
- Add versioned legal-document and append-only consent architecture without inventing legal
  wording.
- Test adjacent/overlapping coverage, a real race, non-conflicting concurrent services,
  simultaneous identical command retries, stale writes, payment idempotency/history,
  currency snapshots, access authorization, notification deduplication, tenant isolation,
  and relationship-scoped blocking.

Exit: enrollment, payment, entitlement, and relationship state reliably determine access,
with no duplicate or overwritten commercial history.

Explicitly deferred: automated/recurring provider payments, refunds/reversals/credits,
installment schedules, a notification dispatch worker, final legal documents, and any
training/nutrition/chat feature implementation.

## Phase 3: Exercise library, training, and strength

Dependencies: Phase 2.

Status: implemented and independently remediated 2026-08-21. Decisions and intentionally
deferred scope are recorded in ADR 0007.

- Build tenant exercise/category library, exercise versions, media metadata, uploads, and
  signed viewing access.
- Build training templates, weeks, days, ordered exercises, per-exercise defaults, and
  per-set overrides.
- Implement assignment as a deep client snapshot tied to one subscription and versioned
  source template.
- Implement coach edits, audit history, future-week locking, explicit reveal overrides,
  daily client view, completion, and typed notes.
- Build versioned 1RM observations and program strength snapshots.
- Implement one documented RPE/RIR/load model with valid ranges, plate rounding,
  explanations, deterministic duplication, and manual override protection.
- Add invariant and snapshot tests before adding advanced progression models.

Exit: a coach can safely assign and adjust a mesocycle, and a client can see/complete only
authorized dated work while calculations remain reproducible.

Implemented exit evidence includes a real PostgreSQL coach/client workflow, database-level
history guards, generated Angular contracts, a dense template/exercise workflow, enrollment-
bounded client assignment, reviewed progression, protected media, and a focused client
workout logger. The remediation adds reachable audited lifecycle operations, one authoritative
coverage policy for all date mutations, native-browser private media delivery, resilient
per-set Angular drafts, bounded/predicated `Today` reads, upload abuse controls, paged growing
collections, fixed strength boundaries, and required PostgreSQL release tests.

The remediation checkpoint contains 31 Phase-3-specific automated tests, including 19 added
during remediation, and was accepted through a live Chrome coach/client journey against the
Dockerized API and PostgreSQL. The browser run also verifies the compact mobile workout grid,
native protected-media rendering without `X-Tenant-Id`, and real five-minute grant expiry.

Explicitly deferred: supplemental mesocycles, intentional future working-max rebase,
completion correction, arbitrary edits to started sessions, more progression transforms,
large analytics/PR dashboards, a production object-store/scanner/CDN adapter, and media
retention/purge jobs. Configurable local workspace quota enforcement is delivered; provider-
level quota accounting and physical purge are not.

## Phase 4: Nutrition and meal planning

Dependencies: Phase 2 and client intake; open decisions 4, 5, and 9 in `DOMAIN-RULES.md`.

Status: implemented 2026-08-22; production launch remains gated on qualified nutrition,
clinical, and legal review plus configuration of the USDA API key and a real AI provider.

- Approve BMR, TDEE, calorie-target, unit, and macro calculation policies with a qualified
  domain reviewer.
- Build ingredient/source records, raw/cooked basis, recipe versions, servings/yield,
  instructions, macros, provenance, and manual override audit.
- Build recipe library and reviewed provider import. Do not scrape generic search results.
- Build meal-plan templates, slots, alternatives, target totals, chosen totals, and assigned
  client snapshots tied to subscriptions.
- Add a provider-neutral AI draft flow with schema validation, visible failures, review, and
  usage/cost limits.
- Test calculations with fixed reference cases, rounding, invalid residual calories,
  provider discrepancies, allergens, and template isolation.

Exit: every displayed target and recipe total has one explainable source and historical
assignments cannot change through library edits.

Delivered: named/versioned BMR, occupation-and-steps PAL, TDEE, macro, Atwater and EU 1169
policies; structured EU14/US9 allergens; sourced preparation factors; versioned coach/label/
USDA foods; immutable recipes and meal plans; enrollment-bound deep assignment snapshots;
separate daily actuals; reviewed AI-draft state machine; paginated coach library and simple
client logger. USDA FoodData Central is the only external nutrition source. The AI adapter is
intentionally unavailable until a provider is selected and configured. Progress/bodyweight,
AI provider selection, provider SDK integration, and production clinical approval are deferred.

## Phase 5: Bodyweight and progress

Dependencies: Phases 2-4; approved weekly summary rule.

Status: complete through Phase 5B-6, implemented 2026-08-23 and 2026-08-24 — bodyweight and trend,
body measurements, progress photos and thumbnails, the combined cross-domain dashboard, media purge
and storage quotas, and mis-dated bodyweight correction.

- Build dated bodyweight observations, correction history, unit conversion, one-entry-per-day
  constraint, and client/coach permissions.
- Resolve dates to authoritative subscription/program periods on the backend.
- Build week grids, missing-day display, observed-day counts, weekly means, mesocycle change,
  and trend endpoints.
- Add program/date adjustment impact analysis so existing logs cannot be orphaned silently.
- Add privacy-safe exports and retention/deletion workflows.

Exit: progress remains coherent across date edits, missing days, subscriptions, diet, and
training, with testable statistics.

Phase 5A delivered the existing Phase 1 intake weight as the first progress observation,
daily client/coach entry, canonical kg conversion with entered-unit retention, append-only
correction history, tenant-local dates, workspace-week grids and observed-day means, and the
time-aware `BodyweightTrendEwma` v2 estimate in client and coach views. The estimate uses a
10-day time constant, a bounded 90-day warm-up, and a three-observation minimum. Own access is
not entitlement-gated; coach-facing access respects relationship blocking.

Phase 5B-1 adds typed daily girth/body-fat observations, explicit canonical units, absent
missing facts, tenant/date/type uniqueness, and append-only optimistic-concurrency correction
history inside the existing Progress module and UI.

Phase 5B-2 adds dated, private progress photos on the existing media pipeline with a purpose
discriminator, blocking-aware authorization, one-way audited removal, and database-enforced
immutability. See `docs/adr/0011-progress-photos-v1.md`.

Phase 5B-3 adds server-side thumbnails for progress photos as subordinate derivatives of their
parent media asset, rendered from the already-sanitised pixels, served on the existing grant-cookie
content route, and authorized by the same check as the original. See
`docs/adr/0012-progress-photo-thumbnails-v1.md`.

Phase 5B-4 adds the combined progress dashboard as a read-side projection with no tables of its
own: bodyweight, measurements and photo timelines composed in Infrastructure alongside nutrition
and training context, where each cross-domain section is gated on its own
`ICoachingFeatureAccessService` decision and reports counts against explicit denominators. See
`docs/adr/0013-progress-dashboard-v1.md`.

Phase 5B-5 adds physical purge of tombstoned media and storage quotas: removing a progress photo
now schedules its bytes, a single in-process background sweep deletes derivatives then originals
under `FOR UPDATE SKIP LOCKED` so replicas are safe, and both the workspace allowance and a new
per-client progress-photo allowance are enforced under a transaction-scoped advisory lock. See
`docs/adr/0014-media-purge-and-storage-quotas-v1.md`.

Phase 5B-6 adds correction of a mis-dated bodyweight observation as void-and-replace, keeping the
measurement date immutable: the original is voided with a required reason and actor and retained,
a replacement carrying the same weight is created on the correct date in the same transaction, and
the unique index becomes partial on active rows so a freed date can be logged again. See
`docs/adr/0015-bodyweight-date-correction-v1.md`.

Explicitly deferred to a later phase: photo comparison, device/wearable import, a coach-facing
storage-usage view, alerting on assets stuck pending purge, provider-level inventory reconciliation,
voiding a bodyweight observation without a replacement, bulk re-dating, and the same date correction
for body measurements and progress photos. Previously deferred: mesocycle-aligned summaries and
change statistics, subscription/program period linking, date-adjustment impact analysis,
privacy-safe exports, retention/deletion workflows, device imports, and any coupling to nutrition
calculations.

## Phase 6: Messaging, notifications, and production media

Dependencies: Phase 1 tenancy; can overlap Phases 3-5 after access policies stabilize.

### Phase 6A: Check-ins (complete)

Status: complete through 6A-6, implemented 2026-08-24 to 2026-08-26 — check-in authoring, client
responses, live-browser verification and hardening, Angular interaction-test coverage, the
application-wide form-validation display convention, and the disabled-submit correction that made
its summary region reachable.

6A-1 (authoring) and 6A-2 (responses) are implemented and are the first production consumers of
`CoachingFeature.CheckIns`. See ADR 0017 (authoring) and ADR 0016 (responses), plus
`DOMAIN-RULES.md` section 13. Both halves have a coach and client UI under `/checkins`.

- 6A-1: form lineage, draft versions, published versions frozen at the database, stable
  `QuestionKey` carried across versions, and assignment of one published version to one client with
  a workspace-local due date.
- 6A-2: per-assignment response with a one-way `Draft -> Submitted -> Reviewed` lifecycle, typed
  answers whose version and option membership are held by composite foreign keys, whole-response
  validation returning every failure at once, coach review as an append-only event, and comparison
  as a read-side projection aligned by `QuestionKey` that reports one-sided questions explicitly.

- 6A-3: verification and hardening, no new surface. The full coach and client journey was driven in
  a live browser against a real API and PostgreSQL, in two profiles, including the three denial
  paths. It found one blocking defect — the coach's Assign button could never enable, because the
  assignment draft was a plain object behind a `computed`, so the screen was dead while every unit
  test passed — and two denial surfaces that rendered a refusal as an empty list. All three are
  fixed with regression tests that drive the rendered controls rather than the component fields.
  The authoring-route entitlement deviation is ratified in ADR 0017 rather than left in a comment.

- 6A-4: Angular interaction-test coverage, no new surface. Before it, 18 spec files existed and only
  6 touched the DOM, with 8 of 13 features carrying no spec at all — which is why a dead Assign
  button shipped behind a green suite. It adds `src/testing/dom.ts` and 21 spec files that drive
  each feature's primary action through its rendered controls. Two more dead controls were found in
  the commercial screens and fixed.

- 6A-5: the form-validation display convention, no new surface. Of 35 `role="alert"` occurrences
  across 27 templates, 4 rendered _derived_ validation reasons on a pristine form; the rest report
  server errors or completed actions and are correct as assertive announcements. The four are now
  plain text gated on touched-or-submit-attempted, linked to their controls by `aria-describedby`
  with `aria-invalid`, with one `role="alert"` summary per form populated only by a refused submit
  and named by the submit button's `aria-describedby`. Touched state is one shared mechanism,
  `core/forms/form-attempt.ts`. See `ARCHITECTURE.md` section 8.

- 6A-6: the disabled-submit correction. 6A-5 kept submit buttons disabled while a form was invalid,
  which made its own summary region unreachable — measured in Chrome 150: a disabled default button
  receives no click, is not activated by Enter, and cannot take focus, so nothing could ever
  populate the summary and the button could not explain itself. Its tests passed only by dispatching
  a `submit` event no user can produce. Submit controls are now disabled solely while a request is
  in flight; a refused attempt reaches no API, fills the summary, and moves focus to it. The
  `submitForm` test helper was deleted rather than kept, because driving an interaction no user can
  perform is the same defect as calling a method no template calls.

Exit: a submitted check-in still renders the exact wording it was asked in after a later version is
published, and no answer is scored, rated or interpreted anywhere. A refused read names its reason
and is never shown as an empty list.

Ratified in Phase 6A and carried forward: the authoring-route entitlement deviation (ADR 0017); the
entitlement-lapse rule, under which a lapsed client keeps neither read nor write access to check-ins
including ones already submitted, and the refusal names its own reason; snapshot-by-immutability,
where publishing freezes a version at the database rather than copying it per assignment;
`QuestionKey` as the stable cross-version question identity that makes comparison possible; and the
form-validation display convention above.

Explicitly deferred to 6B or later: recurring scheduling, tasks and habits, reminders and
notifications, comments or chat on a check-in, signatures, file uploads, conditional branching, AI
interpretation, exports, a cross-client outstanding-check-in view, comparing more than two responses,
charting one question over time, and retrofitting the validation convention onto the 8 remaining
`ngModel` templates and 12 reactive-forms templates that have no derived-reason lists today.

#### Phase 5/6 audit remediation (2026-08-29)

A deep review of Phases 5 and 6 found defects in already-shipped surfaces. No new feature scope: every
change below closes something that was wrong, and each carries a regression test that fails against
the behaviour it replaced.

- **Draft privacy.** A coach's read of an unsubmitted check-in returned the client's answers. The
  redaction is in the backend mapping; the coach sees status and dates with `AnswersWithheld`. See
  ADR 0016.
- **Media access revalidates membership.** A progress-photo grant has a configurable bounded
  lifetime and the subject's own check trusted user identity alone, so a removed member kept reading
  that workspace's images until it expired. Every original and thumbnail request now establishes
  active membership first. See ADR 0011.
- **Decoded-image limits.** The compressed byte cap never bounded decoded memory. 8 000 px per edge
  and 30 megapixels are checked against the codec header before allocation; 120 MB describes one
  RGBA buffer, not peak memory. Per-tenant upload serialization and a configurable process-wide
  decode cap bound concurrency. See ADR 0011.
- **Media readiness.** A refused or unscannable upload reported success and a progress photo was
  recorded against it, occupying the date/pose slot with no readable image. It now fails truthfully
  (`503` unavailable/operational scanner, `400` actual refusal) and commits nothing. Every accepted
  key is attached, confirmed deleted, or retained as quota-counted durable cleanup state; the purge
  sweep reconciles the latter. A readiness check reports an unconfigured scanner as `Degraded`.
  See ADR 0011.
- **Duplicate progress-photo race.** The cleanup replayed the failed insert on the same tracked
  context and escaped as a `500`, leaving the ready orphan it existed to prevent. See ADR 0011.
- **Dashboard thumbnails.** Protected paths were bound to `img.src` with no grant, so a first visit
  showed nothing. A bounded preview (8 per pose) plus one bounded batch grant. See ADR 0013.
- **Dashboard range and training denominator.** Weekly figures were computed over a widened read.
  Cancelled mesocycles now retain executed sessions and their completed/in-progress history in both
  denominator and numerator, while withdrawing unexecuted sessions. See ADR 0013.
- **Archived check-in forms** are refused server-side on save, publish and rename and render every
  version, including a Draft, read-only until Restore; form metadata is edited through the rename
  operation with the form's own token. See ADR 0017.
- **Concurrent first draft save** returns one draft and one stable `409`.
- **Check-in assignment lists** carry response status only, sort deterministically newest-first,
  and load bounded pages through every assignment on both coach and client screens. Generation
  ownership prevents stale list/detail/mutation/comparison results crossing clients or workspaces.
- **Workspace-local today** travels on `WorkspaceDetails.CurrentDate` so due-date validation agrees
  with the server across midnight.
- **Purge sweep cap** is global rather than per workspace. See ADR 0014.
- **Inherited cross-cutting hardening, not a Phase 6 feature:** the rate limiter ran before
  `UseAuthentication` and partitioned on the raw `X-Tenant-Id` header, so authenticated writes fell
  into a source-address bucket a caller could reset at will. It now runs after authentication and
  partitions on the signed-in user id alone. See `ARCHITECTURE.md` section 6.

#### Known and left open at the end of Phase 6A

Each verified against the repository on 2026-08-26. None is a check-in defect; they are recorded
here because they were found during 6A and would otherwise be re-discovered.

1. **Console noise on the coach's client detail view.** Opening a client with no nutrition or
   progress data logs one 403 for `/api/nutrition/.../plans` and four 404s for `/api/progress/...`.
   `client-details` composes `ClientNutrition`, `ProgressDashboardView` and `ProgressView`, and each
   child loads its own data on init without first asking whether the client has any. Pre-existing
   Phase 4/5 behaviour; the requests are correctly authorized and correctly refused, so this is
   noise, not a leak.
2. **`Phase3TrainingWorkflowTests` is a partial class spanning many files** in
   `tests/backend/TB.Gym.Api.IntegrationTests`, holding most of the integration suite — including
   later-phase tests. New phases keep extending a class named for Phase 3. Pre-existing since Phase
   3 and undocumented as a deliberate pattern; renaming it is scope creep, but nobody should assume
   the name describes the contents.
3. **Five feature components carry no Angular spec**: `dashboard`, `clients/client-details`,
   `training/client-training`, `training/exercise-library`, `training/program-builder`.
4. **The form-validation convention is not retrofitted.** 8 remaining `ngModel` templates and all 12
   reactive-forms templates still render server errors only. Deliberate: they have no derived-reason
   lists to mistime, so they are not wrong today. See `ARCHITECTURE.md` section 8.
5. **`client-training`'s "Apply reviewed preview" button is disabled by the same condition that
   renders its coverage message**, which is the defect 6A-6 fixed in check-ins: a disabled control
   cannot be pressed, reached by Enter, or focused, so it cannot explain itself. Left because
   deciding what `applyProgression` should do outside coverage is a Phase 3 domain question.
6. **`AccountEmailSender` and `InvitationDelivery` bypass the notification outbox entirely.** Two
   Phase 1 delivery paths that reference no outbox type at all, parallel to the Phase 2 commercial
   outbox. Still open after 6B-1, and now for a sharper reason than "there is no dispatcher": their
   links carry single-use credentials, and the outbox is a durable, replayable, operator-visible
   queue row that a dead-letter view exposes and a worker may retry. Merging them requires a
   tokenless design in which the sender mints the token at send time. See ADR 0018.
7. **Ports 5134 and 4200 are held by Docker Desktop forwards** (`com.docker.backend`, `wslrelay`)
   dating from 2026-08-17. **5134 serves a stale pre-Phase-4 OpenAPI document.** Any contract
   regeneration must start a fresh API on another port with `ASPNETCORE_ENVIRONMENT=Development` and
   `TB_GYM_OPENAPI_URL`; regenerating against 5134 silently produces a contract several phases old.
8. **`base44/` encoding is settled, not open** — 37 genuinely mojibake files, deliberately not
   rewritten, with the project's own source verified clean. Recorded in `ARCHITECTURE.md` section 10
   so it is not investigated a third time.

Fixed during 6A-4 and 6A-5, no longer open: the check-in status badge running into the submitted
date, the missing form version on the client's own check-in list, the "Workspace Workspace" topbar,
and the assign form announcing its outstanding reasons on a form nobody had touched.

### Phase 6B-1: Notification dispatch and in-app inbox (complete)

Status: complete, implemented 2026-08-31. See
`docs/adr/0018-notification-dispatch-and-in-app-inbox-v1.md`, `ARCHITECTURE.md` sections 4, 9 and 15,
and `DOMAIN-RULES.md` **NOT-001** to **NOT-008**.

The Phase 2 outbox finally has a reader. This slice is deliberately the record of delivery rather
than a delivery channel: it builds what can answer _what was sent, to whom, whether it worked, and
whether anybody has seen it_ before any channel that can fail in interesting ways is added.

- **A separate Worker process.** `src/backend/TB.Gym.Worker` is a `Microsoft.NET.Sdk.Worker` service
  and a second composition root of the same monolith, not a microservice: same database, same domain
  assemblies, same tenant guards, no HTTP surface, no migrations, and a narrow registration path that
  does not drag in the API's cookie authentication, antiforgery, rate limiting or endpoint services.
  It runs under an explicitly anonymous background identity. Its container uses the .NET 10 ASP.NET
  runtime because Infrastructure transitively requires `Microsoft.AspNetCore.App`, but exposes no
  port and starts no HTTP listener. Architecture and live-container smoke checks guard that contract.
  `MediaPurgeWorker` is untouched.
- **Four separate facts.** Scheduled intent, domain notification, per-channel delivery attempt, and
  the reader's own read state. Provider acknowledgement is never stored as read state.
- **Durable multi-replica claiming.** `FOR UPDATE SKIP LOCKED`, a unique claim token with an expiry,
  a global batch cap, and fair ordering by effective due age plus durable service history rather than
  tenant GUID. Unused workspace shares are redistributed inside the same global cap. Eligibility is
  checked inside the claim transaction and again after claim commit, inside materialization, so the
  claim cannot authorize stale delivery after a payment, cancellation, membership or block change.
  Materialization commits the notification, terminal attempt and completed or cancelled outbox row
  together, with no lock held between the two transactions. A crash leaves either a terminal result
  or a lease that expires and is reclaimed, with the interrupted attempt recorded as `Abandoned`
  first.
- **At-least-once, stated plainly.** A unique notification-per-source-intent constraint makes replay
  idempotent locally. This is not claimed to generalise to a future external provider.
- **Retry, suppression and dead letters.** The named `notification-exponential-v1` default schedule
  waits 1m, 5m, 15m, 1h and 6h after attempts 1–5, then dead-letters attempt 6. Configured maxima are
  1–20; above six the 6h ceiling repeats until the maximum. Every started attempt, including an
  abandoned lease, counts and maximum + 1 is impossible. Permanent failures dead-letter on their
  first attempt. Pre-claim suppression starts no attempt; post-claim suppression preserves and
  completes the already-started attempt as `Suppressed`. Stable, bounded, non-sensitive failure codes
  are used throughout.
- **Safe templates.** A code-owned, versioned, English-only allowlist with no Razor, HTML,
  database-authored markup or user-controlled format string, and no name, price, currency, product,
  date, identifier or payload content in any wording. Rendered text is snapshotted per notification.
- **Tenant-member inbox.** `GET /api/notifications`, `GET /api/notifications/unread-count`,
  `POST /api/notifications/{id}/read`, plus an owner-only bounded dead-letter view carrying no
  recipient, payload, wording or exception.
- **Angular.** A lazy `/notifications` route for every active member, an accessible unread badge,
  bounded Load More whose server offset advances by consumed rows even when overlapping pages are
  de-duplicated, mark-read, and generation ownership so no stale reply can cross a workspace or
  account boundary. No polling and no SignalR.

Exit: two Worker replicas racing on one intent produce one notification and one terminal dispatch; a
crashed claim always becomes visible again; a stale claimant can finalize nothing; and no recipient,
payload or rendered wording reaches an operational view or a log.

Explicitly deferred from 6B-1 and still open: email/SMTP/WhatsApp adapters and provider
reconciliation; channel preferences, quiet hours, marketing consent and WhatsApp opt-in (they wait
for the first interruptive channel); migrating account-confirmation, password-reset and invitation
delivery onto the outbox, which needs a tokenless design first; manual dead-letter replay;
localisation beyond English; SignalR sending, groups, reconnect and scale-out; recurring check-in
scheduling and reminders; and any generic background-job framework. Chat conversations and messages
were delivered by 6B-2A below.

SignalR sending, group membership, acknowledgements, reconnect/catch-up and scale-out were delivered
by 6B-2B below.

Explicitly deferred from 6B-2A and 6B-2B and still open: client polling; group conversations;
multiple coaches in one conversation; participant add/remove/reassignment; client-created
conversations; typing indicators; online presence; reactions, group counts and retained connection
identifiers; attachments, images, files, voice notes and video; Markdown, HTML, previews and link
unfurling; message search; push, email, SMS and WhatsApp delivery and provider acknowledgement;
notification preference changes and quiet hours; end-to-end encryption claims; retention, export and
legal deletion workflows; read receipts and any automatic read advancement; check-in comments; AI
summaries; a manual replay UI or generic operations console; and any generic event bus, job framework,
Redis cache or new cloud-managed service.

### Phase 6B-2A: persisted direct messaging (complete)

Status: complete, implemented 2026-09-01. See
`docs/adr/0019-persisted-direct-messaging-v1.md` and `DOMAIN-RULES.md` MSG-001 through MSG-011.

- **Persistence before delivery.** PostgreSQL is the source of truth and `ChatHub` gained nothing:
  it is still an empty authorized shell, and an architecture test says so. A channel built first can
  send and cannot say what was sent, to whom or whether anybody saw it, and a chat living only in a
  socket frame is lost by the first disconnect.
- **One conversation shape.** Direct, exactly two explicit and immutable participants — one active
  Owner or Coach, one linked Client — governed by the tenant-local client profile's Messaging
  entitlement. At most one per `(TenantId, ClientProfileId, CoachUserId)`, with concurrent creation
  returning the same conversation. A second coach opens their own thread and never sees the first.
- **Participation and entitlement are separate requirements**, both mandatory on every operation.
  Unknown, wrong-workspace and same-workspace non-participant are one indistinguishable 404; a denied
  participant gets the stable feature-access refusal with no content. Nothing is deleted to refuse.
- **Locked sequence allocation.** A counter on the conversation row, incremented under `FOR UPDATE`
  inside the sending transaction, with `UNIQUE (TenantId, ConversationId, Sequence)` behind it.
  Committed sequences are unique, gap-free and ordered; a rolled-back send returns its number.
- **One idempotency table for every command**, keyed on `(TenantId, IdempotencyKey)` alone and bound
  to a fingerprint of the normalized payload, so a key cannot be spent twice or across command kinds.
  The key is locked before any aggregate, in one order everywhere, so two requests sharing a key but
  no aggregate are still settled by it; the browser retains its key across a failed attempt so a
  retry after a lost response is the same command.
- **Append-only revisions and one-way removal.** Bodies live only in `MessageRevisions`; the message
  names the current revision number. Sender-only editing with no invented time window; two
  distinguishable removal kinds, a required and never-disclosed moderation reason, and an append-only
  removal event. A moderator removes and never edits.
- **Read state is the participant's own act**, monotonic, clamped at the newest committed sequence,
  advanced under its own row lock, and never written from any delivery outcome.
- **Keyset pagination** on both lists, plain-text-only bodies, and no message content, reason, name
  or address anywhere in a log.
- **Angular.** A lazy `/messages` route for every active member, a separate accessible unread badge,
  conversation list, thread, stable Load older, composer, edit, delete, coach moderation, explicit
  read advancement, and generation ownership over account, workspace and conversation. No polling and
  no SignalR.

Exit: two concurrent sends commit unique gap-free sequences; an identical retry writes one message; a
failed commit leaves nothing behind and gives its sequence back; a non-participant coach in the same
workspace sees a 404; and no message body or removal reason reaches a log.

A review-remediation pass on 2026-09-01 closed four classes of defect the first implementation had
claimed but not held: the idempotency namespace was only serialized where two requests happened to
share an aggregate; several invariants ADR 0019 called impossible were unenforced text columns or
missing cross-row checks; three handlers validated their payload before resolving authorization, and
the conversation listing read bodies it then suppressed; and the browser minted a fresh command key
on every click, so a retry after a lost response duplicated the original write. Each was reproduced
by a failing deterministic test before it was fixed. Final independent review also closed the
remaining revision-side bypass: the exact `1..CurrentRevisionNumber` chain is now asserted when either
the message root changes or a revision is inserted, so an unreferenced future revision cannot commit.
The same independent review closed both directions of a conversation-tip bypass: the allocator now
starts empty and advances one position at a time, each later message requires its predecessor, and a
deferred assertion on both sides requires `LastSequence` and `LastMessageId` to identify the newest
stored message.

### Phase 6B-2B: authorized realtime messaging delivery (complete)

Status: complete, implemented 2026-09-04. See
`docs/adr/0020-authorized-realtime-messaging-delivery.md` and `DOMAIN-RULES.md` MSG-012 through
MSG-021.

- **PostgreSQL before the socket.** Every successful 6B-2A command now writes one content-free
  realtime event and one publication row per explicit participant in the same transaction as the
  mutation. REST stays the only authoritative mutation path; the hub adds no write and no
  acknowledgement. A SignalR or Redis failure afterwards changes nothing about the command that
  already succeeded.
- **Two sequences.** A second gap-free allocator on the conversation answers "what has happened",
  separately from the message sequence's "which messages exist". An edit or removal of an old message
  takes a new event position and keeps its original message position, which is the only way a client
  resuming from a cursor can ever learn about it.
- **Content-free events.** Identifiers, a position, a stable kind and a server instant. The projection
  a participant may see is materialized at delivery and catch-up time, after that participant's
  current authorization has succeeded.
- **Four facts kept apart.** Persisted, Published (the hub accepted the frame — never "Delivered"),
  application-acknowledged (the _other_ participant's application merged a current safe projection),
  and read. A sender acknowledging their own event never sets the counterpart timestamp; no
  acknowledgement touches read state; provider acknowledgement stays null and a trigger enforces it.
- **Claimed, leased, at least once.** `FOR UPDATE SKIP LOCKED`, a random claim token and expiry, a
  durable attempt started before anything leaves the process, re-authorization immediately before
  materialization, and the named `messaging-realtime-backoff-v1` schedule. Every started attempt
  counts including abandoned ones, maximum + 1 is impossible, terminal rows never restart, and a
  stale claimant can finalize nothing.
- **Hub, binding and origins.** A strongly typed hub with only `OnConnectedAsync`,
  `SubscribeConversation` and `UnsubscribeConversation`. The workspace arrives as `?tenantId=` routing
  input because a browser cannot header a WebSocket, is verified against PostgreSQL once, and becomes
  a binding the connection can never change. Group names are server-computed; a client passes a
  conversation identifier and nothing else. `/hubs` is checked against an explicit origin allowlist
  before authentication, and an empty list fails startup outside Development.
- **Subscribe, then catch up.** Bounded ascending keyset paging on the event position, at most 100 per
  page, looped until caught up. The deliberate overlap is deduplicated by event identity; the other
  order loses events committed between the read and the join.
- **Scale-out.** One replica uses the in-process lifetime manager; more than one declared replica
  requires Redis and fails startup without it. Transport fallback stays on, so multi-replica
  production requires load-balancer session affinity. Redis is a backplane only — a send during an
  outage is lost, and PostgreSQL plus catch-up is what makes that survivable.
- **Angular.** One root-scoped connection per account and workspace, its own cancellable jittered
  retry for the initial `start()` that `withAutomaticReconnect` does not provide, generation ownership
  over every callback, rejoin-then-catch-up on reconnect, gap recovery, terminal deletion, coalesced
  invalidations with no polling timer, and bounded idempotent acknowledgement batches. Failed
  catch-up and acknowledgement calls retry without needing a later frame, a superseded catch-up cannot
  suppress the newly selected thread, and a defensive page bound yields and continues rather than
  truncating history. Nothing is written to browser storage.

Independent review added the forward-only `Phase6B2BRealtimeIntegrityHardening` migration after the
published 6B-2B migration. It closes exact command-to-event-kind matching, requires attempt rows to be
inserted as `Started`, and derives the message counterpart timestamp from its durable ACK facts. The
ACK write path now resolves a concurrent duplicate per event, so one overlap cannot roll back unrelated
positions from the same bounded batch.

Exit: two dispatchers racing on one backlog claim each row once; an expired claim is reclaimed and its
stale claimant finalizes nothing; a crash after publication duplicates identifiably rather than losing
anything; membership removal, a workspace block and entitlement loss each suppress publication before
any body is loaded; a client connected to one API replica receives an event published by another
through a real Redis backplane; a Redis outage leaves PostgreSQL correct and the sweep alive; and no
message body, moderation reason, participant identity or backplane endpoint reaches any log.

### Phase 6B-3A: independent notification channels, preferences, quiet hours and consent (complete)

Status: complete, implemented 2026-09-05. See
`docs/adr/0021-tokenless-action-email-materialization.md`, `ARCHITECTURE.md` section 18 and
`DOMAIN-RULES.md` NOT-001 through NOT-016.

- **The lifecycle moved off the intent.** Phase 6B-1 kept one mutable dispatch lifecycle on the outbox
  item even though attempts already named a channel, which cannot represent an in-app success beside
  an email retry. The outbox item is now the immutable logical notification, and each selected channel
  owns a `NotificationChannelDelivery` — unique per intent and channel — holding its own status, due
  instant, attempt count, claim lease, retry schedule, terminal result and transport metadata. No
  channel can block, read or complete another.
- **Every 6B-1 guarantee preserved, now per channel.** PostgreSQL commits before side effects, exact
  maximum-attempt enforcement, abandoned started attempts consuming capacity, post-claim suppression
  remaining an auditable terminal attempt, stale claimants finalizing nothing, the bounded
  `notification-exponential-v1` schedule, one global sweep cap, fair tenant scheduling, and eligibility
  rechecked both after the claim commits and immediately before materialization.
- **Selected once, rechecked twice.** Channel rows are written in the scheduling transaction with the
  selection reason and policy version snapshotted. In-app is unconditional and cannot be switched off
  here; email is off by default and requires an explicit opt-in. Opting in later never resurrects
  historical notifications; opting out afterwards still suppresses a pending email, and an opt-out
  after the claim commits completes the started attempt as `Suppressed` rather than sending.
- **Purpose is explicit.** `ServiceTransactional` or `Marketing`, decided by a code-owned catalogue
  rather than inferred from wording. Every notification this repository produces is transactional.
  Marketing is reserved, produced by nothing, fails closed without current affirmative consent, and may
  never ride on the service-email preference — the separation Lebanon's Law 81/2018 Article 32 makes
  worth having structurally rather than editorially.
- **Append-only consent.** Every email decision appends immutable evidence naming the channel, purpose,
  decision, UTC instant, policy version, source and actor — and no IP address, user agent, address or
  rendered message. The mutable preference points at the exact event explaining it, and a database check
  refuses an enabled channel whose evidence does not say `Granted`.
- **Quiet hours defer, never fail.** A half-open local window in the workspace's current IANA zone under
  `notification-quiet-hours-v1`. Equal start and end is refused, unknown zones fail closed, both
  daylight-saving edge cases resolve forward, and a deferral moves the due instant without spending an
  attempt or leaving the worker polling.
- **A port, not a provider.** `INotificationEmailTransport` with one in-memory captured adapter for
  development and tests. Production email is disabled by default and fails closed: an unknown adapter,
  an enabled channel with nothing behind it, or the captured adapter in Production each refuse startup.
  No recipient, subject, body, URL or token reaches any column, dead-letter row or log; the address is
  resolved at materialization through a narrow contract that reverifies membership. `ProviderMessageId`
  and provider acceptance stay null, and the vocabulary says captured, never delivered.
- **API and Angular.** `GET`/`PUT /api/notifications/preferences` for the caller's own settings only —
  cookie-authenticated, antiforgery-protected, tenant-verified, optimistically concurrent and
  idempotent, with no shape that lets one member opt another in. A lazy `/notifications/settings`
  route shows the workspace zone, toggles service email, configures quiet hours, survives a failed save
  with the user's choices intact, and never lets a stale workspace reply overwrite the current one.

Two forward migrations ship: `Phase6B3AIndependentChannelDelivery` backfills an in-app delivery for
every existing intent and reconnects historical attempts to it, preserving every legacy `Pending`,
`Failed`, `Cancelled`, `Suppressed` and `Dispatched` fact along with inbox rows and pagination
identities; `Phase6B3AIntegrityCorrections` adds the tenant-composite foreign keys, enumerated
vocabulary checks, consent-evidence agreement and the immutability triggers.

Exit: in-app completion and email retry are independent; email completion cannot duplicate an inbox
row; duplicate workers cannot materialize one delivery twice; a post-claim opt-out prevents capture;
quiet-hours deferral spends no attempt across normal, overnight, boundary, DST-gap and DST-fold cases;
preference commands survive real races; cross-tenant preference, delivery and attempt relationships are
rejected by the database; and no recipient or rendered content reaches PostgreSQL or a log.

### Phase 6B remaining

- Integrate a production email provider behind the existing transport port, then webhooks, bounce and
  complaint handling, suppression lists and deliverability (SPF/DKIM/DMARC) work.
- Migrate account confirmation, password reset and invitation mail onto the tokenless design in
  ADR 0021, including the durable logical-send generation that keeps a transport retry from rotating
  an invitation token.
- Implement production object storage, production upload scanning, provider inventory
  reconciliation, signed URLs, and the production retention/operations controls. Reservation-backed
  incomplete-ingest cleanup, transformations, quotas, and application-known purge are already
  delivered.
- Integrate one email and one WhatsApp provider behind existing ports.

Exit: realtime delivery is convenient but persisted state remains correct during disconnects,
retries, duplicate callbacks, and multiple API replicas.

## Phase 7: Theme and gamification

Dependencies: authoritative completion/diet events; open decisions 8 and 9 in
`DOMAIN-RULES.md`.

- Build constrained tenant theme tokens and licensed uploaded/generated assets.
- Build versioned experience rules, append-only experience ledger, levels, ranks, progress
  display, compensating entries, and anti-duplication tests.
- Test accessibility, reduced motion, asset failure, and rule-version changes.
- Keep generic progression branding unless third-party theme rights are documented.

Exit: presentation can vary per tenant without changing domain/API vocabulary, and every
experience point traces to one authoritative event.

## Phase 8: SaaS productization and scale hardening

Dependencies: validated core product.

- Coach onboarding, SaaS plans/quotas, tenant billing, admin support workflow,
  data export/deletion, and production legal-document publication/consent enforcement.
- Production secret management, managed PostgreSQL backups/PITR, object lifecycle, TLS,
  WAF/rate limits, observability, alerting, runbooks, and disaster-recovery exercises.
- Load/security/accessibility testing and independent review of authentication,
  multi-tenancy, file upload, privacy, and health-adjacent features.
- Measure database/message/media load before caching, partitioning, or service extraction.
- Extract a module only through an ADR with ownership, consistency, failure, deployment, and
  migration consequences documented.

Exit: production SLOs, recovery objectives, compliance obligations, support process, and
unit economics are known and exercised.

## Continuous requirements

Every phase must update architecture/domain docs, ship migrations with rollback/recovery
notes, preserve tenant isolation, add automated invariant tests, keep structured logs free of
sensitive data, and pass `scripts/check.ps1`. No phase is complete when only its screens work.

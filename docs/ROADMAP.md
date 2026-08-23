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

Status: Phase 5A bodyweight/trend, Phase 5B-1 body measurements, and Phase 5B-2 progress
photos implemented 2026-08-23. The combined cross-domain progress dashboard has not started.

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

Explicitly deferred to a later phase: the combined cross-domain progress dashboard, photo
comparison, physical purge of tombstoned bytes, per-client storage quotas, counting derivative
bytes toward the workspace quota, and device/wearable import. Previously deferred:
mesocycle-aligned summaries and change statistics, subscription/program period linking,
date-adjustment impact analysis, privacy-safe exports, retention/deletion workflows, device
imports, and any coupling to nutrition calculations.

## Phase 6: Messaging, notifications, and production media

Dependencies: Phase 1 tenancy; can overlap Phases 3-5 after access policies stabilize.

- Persist tenant-scoped conversations, participants, messages, read state, and moderation
  metadata.
- Complete SignalR authorization, reconnect/catch-up, delivery, and scale-out tests.
- Run outbox dispatch in a separate worker; add retries, dead-letter visibility, templates,
  consent, quiet hours, and channel preferences.
- Implement production object storage, upload scanning, transformations, signed URLs,
  retention, quotas, and orphan cleanup.
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

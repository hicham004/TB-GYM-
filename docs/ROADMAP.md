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

Dependencies: decisions 1-3 and 12 in `DOMAIN-RULES.md`.

- Record ADRs for tenant shape, identity reuse, time zone, privacy jurisdiction, and field
  ownership.
- Complete account lifecycle: registration/invite-only policy, email verification, password
  reset, security stamp invalidation, lockout, session management, and platform block.
- Complete tenant lifecycle and Owner/Coach/Client membership administration.
- Build invitation drafts, email/WhatsApp delivery records, expiry, resend, revoke,
  acceptance, and existing-account linking.
- Build client intake with coach/client field permissions, units, sensitive-data handling,
  validation, photo metadata, and audit events.
- Generate the Angular API client from versioned OpenAPI and map generated DTOs to view
  models.
- Add PostgreSQL integration fixtures and cross-tenant denial tests for every route.
- Add CI for .NET, Angular, migrations, formatting, dependency audit, and container build.

Exit: a coach can securely create a workspace, invite a new or existing user, complete the
approved intake workflow, and prove that another tenant cannot read or mutate it.

## Phase 2: Subscriptions, manual payments, and access

Dependencies: Phase 1; decisions 4-6.

- Model subscription aggregate, half-open service period, state machine, manual payment
  ledger, coach/platform blocks, cancellation, renewal, and audit history.
- Add PostgreSQL range/check/exclusion constraints that make overlapping live periods
  impossible under concurrent requests.
- Centralize the account access decision and enforce it on content APIs, not only navigation.
- Add profile-only client experience and coach payment registration/reversal workflow.
- Add idempotent three-day renewal notification scheduling through an outbox/worker.
- Test adjacent periods, overlap races, stale updates, payment reversals, blocks, expiry, and
  time-zone boundaries.

Exit: subscription and payment state reliably determines access, with no duplicate or
overwritten periods/payments.

## Phase 3: Exercise library, training, and strength

Dependencies: Phase 2; decisions 6, 9, and 10.

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

## Phase 4: Nutrition and meal planning

Dependencies: Phase 2 and client intake; decisions 7 and 8.

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

## Phase 5: Bodyweight and progress

Dependencies: Phases 2-4; approved weekly summary rule.

- Build dated bodyweight observations, correction history, unit conversion, one-entry-per-day
  constraint, and client/coach permissions.
- Resolve dates to authoritative subscription/program periods on the backend.
- Build week grids, missing-day display, observed-day counts, weekly means, mesocycle change,
  and trend endpoints.
- Add program/date adjustment impact analysis so existing logs cannot be orphaned silently.
- Add privacy-safe exports and retention/deletion workflows.

Exit: progress remains coherent across date edits, missing days, subscriptions, diet, and
training, with testable statistics.

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

Dependencies: authoritative completion/diet events; decision 11 and rights review.

- Build constrained tenant theme tokens and licensed uploaded/generated assets.
- Build versioned experience rules, append-only experience ledger, levels, ranks, progress
  display, compensating entries, and anti-duplication tests.
- Test accessibility, reduced motion, asset failure, and rule-version changes.
- Keep generic progression branding unless third-party theme rights are documented.

Exit: presentation can vary per tenant without changing domain/API vocabulary, and every
experience point traces to one authoritative event.

## Phase 8: SaaS productization and scale hardening

Dependencies: validated core product.

- Coach onboarding, plans/quotas, tenant billing abstraction, feature entitlements, admin
  support workflow, data export/deletion, and terms/consent records.
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

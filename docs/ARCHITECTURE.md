# TB Gym Architecture

Status: Phase 5B-1 body measurements implemented, 2026-08-23

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
| Messaging | Tenant-scoped coach/client conversations and messages |
| Notifications | Idempotent outbox, delivery scheduling, email and future channel ports |
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
prior values. Phase 5B-2, progress photos, and dashboards have not started. See ADR 0010.

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
- Public authentication is rate-limited by source address. Sensitive authenticated writes
  are rate-limited by actor/workspace, and authenticated API responses use `no-store`.
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
- feature code does not calculate authoritative fitness or billing state.
- English source text is marked for Angular extraction and layouts use logical CSS properties
  so a later Arabic locale can provide RTL presentation without component rewrites.

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

`ChatHub` proves SignalR hosting and tenant authorization readiness; full conversation
membership, persistence, delivery acknowledgements, and reconnect behavior remain future
work. Scale-out adds a managed SignalR service or Redis backplane only when multiple API
replicas require it.

Commercial notifications now persist an outbox item atomically with enrollment/payment state.
Each item retains the tenant time zone used to calculate its UTC schedule and a unique
deduplication key. A completed/cancelled item cannot be dispatched again, and activation
cancels a still-pending payment-required item without deleting its history. Production flow
remains: dispatch from a worker, record each attempt, retry transient failures with backoff,
and re-evaluate eligibility before sending delayed items. Phase 2 proves scheduling but
deliberately does not claim provider delivery. WhatsApp is not implemented.

Media, nutrition data, AI, and payment providers sit behind module-owned ports. Provider
payloads and credentials do not leak into domain objects. AI output is untrusted input: it
requires schema validation, provenance, human approval where appropriate, and normal domain
validation before persistence.

Phase 3 provides a local streaming object-store adapter and a development signature scanner.
Production fails media publication closed until a real scanning adapter is configured.
Phase 3 also enforces request-size, endpoint rate/concurrency, and configurable workspace
quota limits, and tombstones historically referenced media. The local storage implementation
is not the production object-store decision; managed object storage, scanner, CDN/private
delivery, and orphan cleanup remain Phase 6 work.

Retention processing is now in the application. One in-process `BackgroundService` — the only
hosted service in this repository — sweeps tombstoned media whose retention has elapsed, deleting
derivative objects before originals and recording completion. It is deliberately minimal and is not
a job platform: it holds no queue, no schedule table, and no dispatch abstraction, and it is not a
foundation for notification-outbox delivery, which needs durable semantics it does not have. Several
API replicas may run it because each sweep claims rows with `FOR UPDATE SKIP LOCKED`, per workspace
so the tenant write-scope guard stays in force for every write it makes. Storage allowances count
originals and derivatives, count tombstoned bytes still on disk, exclude purged bytes, and are
checked and committed inside one transaction holding a transaction-scoped advisory lock keyed on the
workspace, so concurrent uploads cannot jointly exceed a limit.

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

## 11. Testing strategy

- Domain tests cover formulas, state transitions, intervals, and access rules.
- Architecture tests protect dependency and ownership boundaries.
- API integration tests cover HTTP behavior, authentication, tenant isolation, antiforgery,
  PostgreSQL constraints, and concurrency.
- Angular tests cover stores, guards, interceptors, and critical feature interactions.
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

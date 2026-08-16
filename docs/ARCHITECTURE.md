# TB Gym Architecture

Status: foundation scaffold, 2026-08-15

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
| Identity | Global user account, credential, lockout, platform roles, sessions |
| Tenancy | Coach workspace, membership, tenant role, tenant lifecycle |
| Clients | Tenant-specific profile, onboarding/intake, coach block state |
| Invitations | Invite lifecycle, prefilled fields, acceptance and account linking |
| Subscriptions | Service periods, manual payments, renewal and account access policy |
| Training | Templates, assigned snapshots, mesocycles, sessions, prescriptions, completion |
| Exercise Library | Exercises, categories, coaching instructions, video associations |
| Nutrition | Ingredients, recipes, meal choices, plans, calorie and macro snapshots |
| Progress | Daily bodyweight, weekly summaries, measurements and progress views |
| Strength | Versioned 1RM observations, RPE/RIR tables, deterministic load progression |
| Messaging | Tenant-scoped coach/client conversations and messages |
| Notifications | Notification records, delivery scheduling, email and WhatsApp ports |
| Media | Object metadata, upload authorization, signed access, retention |
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
   request identity, tenant context, audit base type, and policy names.
4. Infrastructure contains mechanisms, not fitness policy. Formulas and access decisions
   belong in their owning modules.
5. A single `GymDbContext` is acceptable in the monolith and permits atomic local
   transactions. Table ownership and schema boundaries still apply.
6. Add an outbox before asynchronous cross-module side effects become production critical.
   Do not add an in-memory event bus and pretend it guarantees delivery.

## 5. Multi-tenancy

The initial model is a shared database with a tenant discriminator. A tenant represents a
coach's business/workspace. One global Identity user may have memberships in multiple
tenants, with a separate tenant role in each. Platform administrator is a global role;
Owner, Coach, and Client are tenant membership roles.

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
- State-changing requests validate ASP.NET Core antiforgery tokens. Angular reads the
  `XSRF-TOKEN` cookie and sends `X-XSRF-TOKEN`.
- Failed API authorization returns 401 or 403, never an HTML redirect.
- Password lockout and unique email are enabled; production requires confirmed email.
- Tenant policies verify membership on every scoped request. A UI role check is cosmetic.
- Account access is a separate domain decision that combines platform block, coach block,
  membership, subscription, and payment standing.

Cookie authentication assumes the SPA and API are served under one public origin. The
Angular development proxy and production Nginx configuration preserve that model.

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
- Money will use an exact decimal amount plus ISO currency; payments are append-only ledger
  entries rather than an overwritten amount.
- Database check, unique, foreign-key, and exclusion constraints duplicate critical domain
  guards where possible.

The subscription module should use a PostgreSQL date range and a partial GiST exclusion
constraint to reject overlapping live periods for the same tenant/client. PostgreSQL
[exclusion constraints](https://www.postgresql.org/docs/18/ddl-constraints.html) are suited
to this cross-row invariant.

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

The scaffold has small typed transport models for its proof endpoints. Once Phase 1 contracts
stabilize, CI should export OpenAPI and generate the Angular transport client. Generated DTOs
must stay separate from Angular view models and backend domain entities.

## 9. Realtime, jobs, and integrations

`ChatHub` proves SignalR hosting and tenant authorization readiness; full conversation
membership, persistence, delivery acknowledgements, and reconnect behavior remain future
work. Scale-out adds a managed SignalR service or Redis backplane only when multiple API
replicas require it.

Notifications expose background job, email, and WhatsApp abstractions. Production flow will
be: commit domain state and an outbox message atomically, dispatch from a worker, record each
attempt, retry transient failures with backoff, and make handlers idempotent. Scheduled
renewal and week-unlock jobs must recalculate eligibility before sending or changing state.

Media, nutrition data, AI, and payment providers sit behind module-owned ports. Provider
payloads and credentials do not leak into domain objects. AI output is untrusted input: it
requires schema validation, provenance, human approval where appropriate, and normal domain
validation before persistence.

## 10. Operations and scaling

The API emits structured JSON console logs and exposes:

- `/health/live`: process liveness, no database dependency;
- `/health/ready`: PostgreSQL connectivity;
- `/openapi/v1.json`: development OpenAPI document.

Production configuration comes from environment variables or a secret manager. Secrets,
connection strings, uploaded files, and local databases are not committed.

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

The current scaffold includes domain, architecture, API smoke, and Angular shell tests. Full
PostgreSQL integration coverage begins with Phase 1.

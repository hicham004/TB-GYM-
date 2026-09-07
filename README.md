# TB Gym

A multi-tenant SaaS platform for independent fitness coaches: client onboarding, commercial
enrollments and payments, training programmes, nutrition planning, progress tracking, check-ins,
and realtime coach–client messaging.

Built as a .NET 10 modular monolith behind an Angular 22 single-page application, on PostgreSQL 18.
One deployable API, one background worker, one database — with explicit module boundaries so a
module can be extracted later if operational evidence ever justifies the cost of distributing it.

---

## The engineering position

The interesting problem here is not the CRUD. It is that a coaching platform holds money, health
data and private conversations for many independent businesses in one database, and every one of
those is a place where "mostly correct" is indistinguishable from broken until somebody is harmed
by it.

The approach this codebase takes is that **the database enforces the invariants, and the
application is not trusted to remember them.**

**Tenant isolation is structural.** Every tenant-owned row carries `TenantId`, a global query
filter, a `SaveChanges` write-scope guard, and tenant-aware indexes. Child rows reference parents
through _composite_ foreign keys that include the tenant, so a row pointing at another workspace's
parent is not expressible rather than merely refused. Cross-tenant access has negative tests
throughout.

**History is append-only where it matters.** Payments, enrollment snapshots, strength maxima,
message revisions, moderation events and legal acceptances are never mutated or hard-deleted.
Corrections append; they do not overwrite. Database triggers refuse `UPDATE` and `DELETE` on those
tables, so a future migration or background job cannot quietly rewrite the record either.

**Concurrency is settled in PostgreSQL, not in application coordination.** Sequence allocation
takes a row lock inside the writing transaction rather than computing `MAX + 1`. Idempotency keys
are serialized by transaction-scoped advisory locks in one consistent order, so two requests
sharing a key but no aggregate are still settled by it. Background dispatch claims work with
`FOR UPDATE SKIP LOCKED` under a random claim token and a lease, so replicas divide a backlog
instead of duplicating it, and a crashed claim becomes visible again rather than disappearing.
Overlapping enrollment coverage is prevented by a GiST exclusion constraint.

**Claims are only made when they can be substantiated.** A message that has been committed is
`Persisted`, not `Delivered`. A frame the hub accepted is `Published`, which says nothing about
whether a browser received it. An application acknowledgement says the other participant's client
merged it, not that a person read it. Those are four separate durable facts and no code path writes
one from another — because "delivery" recorded as "read" is a bug you cannot detect from the UI.

**Correctness is argued in writing before it is coded.** Twenty [architecture decision
records](docs/adr/) capture the reasoning and the rejected alternatives; 137 numbered rules in
[DOMAIN-RULES.md](docs/DOMAIN-RULES.md) state the invariants the code and the schema must both
uphold. Several ADRs document defects found in review and the failing test written before the fix.

**927 automated tests**, none skipped: domain rules, architecture boundary enforcement, PostgreSQL
integration tests against a real database, real-WebSocket and multi-replica Redis scale-out tests,
and Angular interaction tests. Races are settled with deterministic barriers rather than sleeps, so
a concurrency test that never actually contended fails loudly instead of passing by luck.

---

## Stack

| Layer    | Choice                                                                             |
| -------- | ---------------------------------------------------------------------------------- |
| API      | .NET 10, C# 14, ASP.NET Core minimal APIs, SignalR                                 |
| Data     | EF Core 10, Npgsql, PostgreSQL 18                                                  |
| Frontend | Angular 22 standalone components, Signals, strict TypeScript, lazy routes          |
| Realtime | SignalR with an optional Redis backplane for multi-replica deployments             |
| Auth     | ASP.NET Core Identity, HTTP-only same-origin cookies, antiforgery on state changes |
| Hosting  | Docker Compose: API, worker, Angular via Nginx, PostgreSQL, Redis                  |

## Architecture

```text
Browser
  |  same-origin HTTP, cookie session, XSRF token, SignalR
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
PostgreSQL (schema per module, tenant discriminator per owned row)
```

Sixteen bounded modules own their own entities, tables and vocabulary: Identity, Tenancy, Clients,
Invitations, Subscriptions, Training, Exercise Library, Nutrition, Progress, Strength, Check-ins,
Messaging, Notifications, Media, Gamification and Integrations. A module may reference only the
shared kernel — never another module — and architecture tests enforce that on the built assemblies
rather than by convention.

`TB.Gym.Worker` is a second composition root of the same monolith, not a microservice: same
database, same domain assemblies, same tenant guards, no HTTP surface. It runs durable notification
dispatch and action-mail dispatch, and it shares the API's data-protection key ring because it mints
the confirmation and reset tokens the API unprotects. Realtime publication lives in the API instead,
because it needs connections to publish to.

## Status

Phases 0 through 6B are implemented and reviewed:

- **Identity and tenancy** — registration, invitation-only client onboarding, email verification,
  workspace membership and roles, same account across multiple workspaces.
- **Commercial** — coaching products, immutable priced offers, dated client enrollments, per-feature
  entitlement coverage, append-only manual payments, renewal and history.
- **Training and strength** — immutable programme template versions, assigned mesocycle snapshots,
  prescriptions versus recorded actuals, append-only strength maxima, named and versioned
  progression strategies with a preview/apply flow.
- **Nutrition** — versioned foods and recipes, immutable meal-plan versions, assigned client
  snapshots, daily actuals, named calculation formulas, structured allergens.
- **Progress** — bodyweight and trend, body measurements, dated progress photos with EXIF-stripping
  re-encoding, thumbnails, storage quotas and a purge worker.
- **Check-ins** — form lineages, immutable published versions, stable question keys, typed answers,
  one-way submission and review.
- **Notifications** — idempotent outbox, durable claimed dispatch with retry and dead-lettering,
  versioned templates, in-app inbox and read state; independent per-channel delivery with member
  preferences, quiet hours and append-only consent evidence; then production transactional email
  through one provider, with signed provider events, and bounce and complaint suppression keyed on a
  mailbox that is never stored.
- **Messaging** — persisted direct conversations with append-only revisions, one-way removal and
  coach moderation; then authorized realtime delivery with catch-up, application acknowledgement and
  Redis-backed multi-replica scale-out.
- **Action mail** — account confirmation, password reset and client invitations on a tokenless
  design: the queue holds identifiers, the token is minted at materialization and never stored, links
  are built from one validated configured origin rather than any request header, and public password
  recovery answers identically for every address. Invitations carry a logical-send generation, so a
  deliberate resend kills the previous link while a transport retry leaves one that may already be in
  somebody's mailbox working.

Not implemented: gamification and tenant theming, SaaS productization and tenant billing, AI
features, recurring billing, marketing email and any unsubscribe surface, and production provider
integrations for WhatsApp and object storage. [ROADMAP.md](docs/ROADMAP.md) tracks each of these with
its exit criteria, and [LAUNCH-CHECKLIST.md](docs/LAUNCH-CHECKLIST.md) tracks what production would
still require.

The `base44/` directory preserves the previous React application as reference material only. It is
not part of the new architecture.

## Running it

Docker Compose is the shortest complete path — it starts PostgreSQL and Redis, applies migrations,
starts the API and worker, and serves Angular through Nginx.

```powershell
Copy-Item .env.example .env    # set POSTGRES_PASSWORD, and TB_GYM_ADMIN_PASSWORD if seeding
docker compose up --build
```

The application is at <http://localhost:4200> and the API at <http://localhost:5134>, with
`/health/live`, `/health/ready` and, in development, `/openapi/v1.json`. PostgreSQL is published on
host port `5433` so it does not collide with a native installation.

Register a coach from the sign-in screen to create a workspace. In development the captured mail
adapter materializes confirmation and invitation mail immediately and the response carries the local
action link, so the full flow can be exercised without an email provider.

Password recovery is the deliberate exception: it returns no link, in any environment. A response
that carried one for a known address and none for an unknown one would tell an unauthenticated caller
which addresses have accounts, and a difference that exists only outside production is one nobody
tests where it matters. The development reset link is materialized by the same queue and read from the
captured adapter.

To run against a local toolchain instead, set the PostgreSQL values in `.env`, start PostgreSQL, and
run `.\scripts\run-api.ps1` and `.\scripts\run-web.ps1` in separate terminals.

### Verification

```powershell
.\scripts\check.ps1
```

Builds the solution in Release, runs the full backend suite against a real PostgreSQL database
(and Redis, when Docker is available), then checks Angular formatting and lint, builds it, runs
Vitest, and audits npm dependencies. CI runs the same gates plus EF model drift detection and
container image smoke tests.

The backend suite needs a reachable PostgreSQL. It uses two connection strings: `ConnectionStrings__Database`
for the application and `TB_GYM_TEST_ADMIN_CONNECTION` for the administrative connection that creates
one database per test class and drops it afterwards. Both are derived from the `POSTGRES_*` values in
`.env`, so the setup above is enough; to run against a different database, set the two variables
yourself before running the script. `check.ps1` verifies them before it builds and stops with the
names to set rather than failing every integration test after a full Release build.

Docker also has to be running for the run to be free of skips: the Redis scale-out tests start their
own pinned Redis container, and without a daemon they report inconclusive instead of executing. CI
requires them.

Angular transport contracts are generated from the API's OpenAPI document and checked in. When an
API contract changes, run the development API and regenerate them with `npm run api:generate` from
`src/web`; the generated directory is never edited by hand.

## Documentation

| Document                                        | Contents                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md)         | Module boundaries, dependency rules, persistence and security architecture |
| [DOMAIN-RULES.md](docs/DOMAIN-RULES.md)         | 137 numbered business invariants and open decisions                        |
| [ROADMAP.md](docs/ROADMAP.md)                   | Delivery phases with exit criteria and explicit deferrals                  |
| [adr/](docs/adr/)                               | 20 architecture decision records, including rejected alternatives          |
| [LAUNCH-CHECKLIST.md](docs/LAUNCH-CHECKLIST.md) | Outstanding production requirements                                        |
| [AGENTS.md](AGENTS.md)                          | Coding standards and constraints enforced across the repository            |

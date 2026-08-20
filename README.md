# TB Gym

TB Gym is being rebuilt as a multi-tenant coaching SaaS using an Angular 22 SPA, a .NET 10
modular-monolith API, EF Core, and PostgreSQL 18. The previous React/Base44-compatible
application is preserved under `base44/` and is reference material only.

## Start with Docker

Docker is the shortest complete path because it starts PostgreSQL, applies the EF
migrations, seeds a development owner, starts the API, and serves Angular through Nginx.

```powershell
Copy-Item .env.example .env
# Set a local POSTGRES_PASSWORD in .env. If seeding is enabled, also set
# TB_GYM_ADMIN_PASSWORD to a unique local password.
docker compose up --build
```

Open <http://localhost:4200>. The API is also exposed at
<http://localhost:5134>; liveness is `/health/live`, readiness is `/health/ready`, and the
development OpenAPI document is `/openapi/v1.json`.

Development seeding is disabled in the example configuration. To use it, enable it and set
the local admin email and password in the ignored `.env` file.

You can also register a new coach from the sign-in screen. A solo coach automatically owns
a new workspace. Development confirmation, reset, and invitation responses include a local
action link so the complete flow can be exercised without an external email account. A
transactional email provider must be configured before a production launch.

The container database is exposed on host port `5433` by default, leaving the conventional
`5432` port available for an existing native PostgreSQL installation. Services inside the
Compose network still use PostgreSQL port `5432`.

PostgreSQL 18 changed the official image data mount to `/var/lib/postgresql`; `compose.yaml`
uses that path so the named volume persists correctly.

## Run without Docker

Set the PostgreSQL values in the ignored `.env`, start PostgreSQL, then run these in separate
terminals:

```powershell
.\scripts\run-api.ps1
.\scripts\run-web.ps1
```

The scripts use `.tools/dotnet` and `.tools/node` when present, otherwise system toolchains.
The API is <http://localhost:5134> and Angular is <http://localhost:4200>. Automatic migration
and development seeding are disabled by default outside the Docker environment.

## Verify

```powershell
.\scripts\check.ps1
```

This restores and builds the .NET solution, runs backend tests, checks Angular formatting and
lint, builds Angular, runs Vitest, and audits npm dependencies.

When an API contract changes, run the development API and regenerate the checked-in Angular
transport contracts:

```powershell
Set-Location src\web
npm run api:generate
```

## Architecture

- [Architecture](docs/ARCHITECTURE.md)
- [Domain rules and open decisions](docs/DOMAIN-RULES.md)
- [Delivery roadmap](docs/ROADMAP.md)
- [Production launch checklist](docs/LAUNCH-CHECKLIST.md)
- [Permanent coding-agent rules](AGENTS.md)
- [Legacy application notes](base44/LEGACY.md)

Phases 1 and 2 implement identity/onboarding plus the commercial foundation: coaching
products, immutable offers, dated client enrollments, per-feature entitlements, append-only
manual payments, renewal/history, workspace-local block state, centralized access decisions,
notification outbox scheduling, and legal-consent architecture. Training, nutrition, chat,
gamification, AI, recurring billing, and production provider delivery are not implemented.

# TB Gym

TB Gym is being rebuilt as a multi-tenant coaching SaaS using an Angular 22 SPA, a .NET 10
modular-monolith API, EF Core, and PostgreSQL 18. The previous React/Base44-compatible
application is preserved under `base44/` and is reference material only.

## Start with Docker

Docker is the shortest complete path because it starts PostgreSQL, applies the initial EF
migration, seeds a development owner, starts the API, and serves Angular through Nginx.

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Open <http://localhost:4200>. The API is also exposed at
<http://localhost:5134>; liveness is `/health/live`, readiness is `/health/ready`, and the
development OpenAPI document is `/openapi/v1.json`.

The example development login is `admin@tbgym.local` / `ChangeMe!12345`. Change it in `.env`.
These defaults are for local development only.

PostgreSQL 18 changed the official image data mount to `/var/lib/postgresql`; `compose.yaml`
uses that path so the named volume persists correctly.

## Run without Docker

Start PostgreSQL with the connection in
`src/backend/TB.Gym.Api/appsettings.Development.json`, then run these in separate terminals:

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

## Architecture

- [Architecture](docs/ARCHITECTURE.md)
- [Domain rules and open decisions](docs/DOMAIN-RULES.md)
- [Delivery roadmap](docs/ROADMAP.md)
- [Permanent coding-agent rules](AGENTS.md)
- [Legacy application notes](base44/LEGACY.md)

The current implementation is a foundation proof, not the 13-feature finished product. Its
small client endpoint demonstrates Angular to authenticated API to tenant-filtered EF
persistence; feature delivery follows the roadmap after the listed product decisions are
approved.

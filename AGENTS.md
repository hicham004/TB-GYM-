# Instructions for TB Gym Coding Agents

## Read first

- Read `docs/ARCHITECTURE.md`, `docs/DOMAIN-RULES.md`, and `docs/ROADMAP.md` before changing
  architecture or domain behavior.
- Read ADRs 0005-0007 before changing commercial access, training, strength, progression,
  notifications, media, or legal consent. Phase 3 is complete; do not begin Phase 4 without
  the user's approval.
- `base44/` is a preserved legacy reference, not the new architecture. Do not edit, delete,
  or copy its generic CRUD/security model unless the user explicitly requests legacy work.
- The backend/database is the source of truth. Never implement an invariant only in Angular.

## Stack and structure

- Backend: .NET 10 LTS, C# 14, ASP.NET Core, EF Core 10, Npgsql, PostgreSQL 18.
- Frontend: Angular 22 standalone components, Signals, strict TypeScript, lazy feature routes.
- Architecture: modular monolith. Do not introduce microservices, a distributed event bus,
  or separate databases without an approved ADR and demonstrated need.
- Keep `TB.Gym.SharedKernel` tiny. Module projects may reference SharedKernel only, never
  another `TB.Gym.Modules.*` assembly. Infrastructure and API compose modules.
- `ICoachingFeatureAccessService` is the approved shared authorization port. Future training,
  nutrition, check-in, messaging, and resource APIs must evaluate it server-side.
- A module owns its entities, rules, tables, and terminology. Cross-module work uses narrow
  contracts or durable integration events, never another module's `DbSet`/repository.

## Naming and code

- Namespaces and projects use `TB.Gym.*`; C# public members use PascalCase and async methods
  end in `Async`. Angular files use the repository's concise Angular 22 naming style.
- Prefer domain names from `DOMAIN-RULES.md`; do not reintroduce ambiguous `BMR` for TDEE or
  calorie target.
- Never edit `src/web/src/app/core/api/generated/` manually. Run `npm run api:generate`
  against the development OpenAPI endpoint and map generated DTOs into owned Angular view
  models.
- Use framework features before adding packages. Explain and document each new dependency.
- Keep provider SDK types behind owned interfaces. AI/provider output is untrusted input.
- Use UTC instants, `DateOnly` for calendar dates, explicit tenant time zones, half-open
  periods `[start, endExclusive)`, exact decimal money plus currency, and explicit units.
- Use succinct comments only for non-obvious reasoning. Do not commit secrets or user data.

## Security and tenancy

- Treat `X-Tenant-Id` as untrusted until active membership is verified server-side.
- Every tenant-owned entity needs `TenantId`, a global query filter, write-scope guard,
  tenant-aware indexes/constraints, and cross-tenant negative tests.
- Authorization belongs on API/resource operations. Angular role checks are presentation.
- Keep Identity in HTTP-only same-origin cookies with antiforgery on state changes. Never put
  session credentials in local/session storage.
- Sensitive profile/health/media data must not appear in logs, analytics, exceptions, or
  notification payloads.

## Persistence and invariants

- Add EF migrations for schema changes; never hand-edit production state.
- Use database checks, unique/composite foreign keys, and PostgreSQL exclusion constraints
  for critical invariants where possible, plus friendly domain validation.
- Preserve audit/history for subscriptions, payments, blocks, programs, strength snapshots,
  and calculations. Do not overwrite history or hard-delete paid/completed facts.
- Commercial naming is deliberate: `CoachingProduct` -> immutable `ProductOffer` -> dated
  `ClientEnrollment` -> feature coverage and append-only `PaymentRecord`. Do not collapse
  these into a generic Subscription DTO/table.
- Renewal creates a new enrollment. A new price/duration/currency creates a new offer. Never
  mutate enrollment snapshots or payment history.
- Enrollment overlap is prohibited per tenant/client/feature/date range, not globally. Keep
  the PostgreSQL GiST exclusion constraint and concurrency test intact.
- Workspace relationship block overrides feature access only in that tenant. It must never
  become a global Identity block.
- Phase 2 manual receipts must match enrollment currency; partial receipts grant no access
  until the exact price is paid. Do not add FX, credit, refunds, waiver, or recurring billing
  behavior without an approved domain decision and ledger operation design.
- Idempotency keys are bound to normalized command payloads. Identical concurrent retries
  return the original result; changed payloads with a reused key must conflict.
- Notification outbox keys are idempotent and schedules are calculated in tenant time. Do not
  claim provider delivery until a durable dispatcher exists.
- Legal acceptances are append-only and require an approved published document version. Do
  not invent or seed legal wording.
- Mutable aggregates require optimistic concurrency and conflict handling.
- Template assignment creates a client snapshot. Master-template edits never mutate assigned
  programs or diets.
- Keep `ProgramTemplate`, immutable `ProgramTemplateVersion`, client `TrainingMesocycle`, and
  `WorkoutExecution` separate. Starting a workout snapshots prescriptions; actuals never
  overwrite prescribed values.
- One enrollment may authorize zero or several sequential mesocycles. Do not collapse
  enrollment and mesocycle. Keep the primary-mesocycle GiST overlap constraint. Assignment,
  rescheduling, and progression must all use `TrainingCoveragePolicy`.
- Planned/Active mesocycle status is date-derived. Completed/Cancelled is terminal and
  audited; never delete an assignment to correct it or mutate terminal programming.
- Main lifts are `Locked`. `CoachApprovedSwap` permits only captured alternatives and records
  the performed exercise without changing the prescription.
- Strength observations and mesocycle working maxes are append-only snapshots. Do not
  silently rebase a program after a global max changes or convert kg/lb implicitly.
- RPE is canonical: Phase 3 accepts RPE 5-10 or RIR 0-5 in 0.5 steps. Calculation,
  progression, and rounding strategies must remain named, versioned, explainable, and tested;
  manual coach overrides win.
- Progression must remain `Preview -> hash/concurrency check -> Apply`; no bulk transform may
  persist before coach review, and apply must recheck enrollment coverage server-side.
- Private media access must reauthorize tenant/user/asset, validate signature and size, use
  generated object keys, and fail closed in production when scanning is unavailable. Native
  image/video requests use the short-lived path-scoped grant cookie, never public URLs or a
  required `X-Tenant-Id` subresource header.
- Keep unsaved workout-entry drafts separate from API DTOs and keyed by set-performance ID.
  Saving or failing one set must not erase another set's dirty values.
- Keep formulas named/versioned with inputs and provenance. Add fixed reference tests.

## Testing

- Domain rule or bug fix: add focused domain tests.
- Module/dependency change: update architecture tests.
- Endpoint/security/persistence change: add API integration tests, including unauthorized,
  wrong-tenant, constraint, and concurrency cases.
- Angular state/interaction change: add Vitest coverage. Keep feature routes lazy.
- PostgreSQL-specific behavior must be tested against PostgreSQL, not SQLite/in-memory EF.
- Run `./scripts/check.ps1` before finishing. Also run `git diff --check`.

## Commands

```powershell
# Full local verification
.\scripts\check.ps1

# API and Angular in separate terminals (requires PostgreSQL for readiness/data)
.\scripts\run-api.ps1
.\scripts\run-web.ps1

# Complete Docker development stack
docker compose up --build

# Add an EF migration
dotnet tool restore
dotnet ef migrations add <Name> `
  --project src/backend/TB.Gym.Infrastructure `
  --startup-project src/backend/TB.Gym.Api `
  --context GymDbContext `
  --output-dir Persistence/Migrations
```

Update the three docs when a decision, boundary, invariant, or phase changes. A working UI is
not evidence that business state is correct.

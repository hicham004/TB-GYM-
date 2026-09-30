# Instructions for TB Gym Coding Agents

## How we work

- **Goal:** every session moves TB Gym closer to coaches and gyms using it and paying for it.
  Follow the agreed order in `docs/ROADMAP.md`; anything else goes in your report as a
  suggested follow-up, not into the code.
- **Plan first:** before coding, state in a few lines what you will build, what you won't,
  and any business question. Ask business questions with your recommendation; decide
  technical questions yourself.
- **Build complete slices:** backend rule, API, screen and tests together, small enough to
  finish and commit in one session.
- **Verify in proportion:** during work, run the tests for the area you changed. Before reporting,
  run the full backend suite (about an hour) only when backend code changed, and the web checks
  only when web code changed; docs-only work needs neither. Click through any new or changed screen
  in a real browser. Security, tenant isolation and money correctness are always tested, never
  traded off.
- **Keep docs light:** when a decision, boundary, invariant or phase changes, update the
  existing docs in a few lines. Write an ADR (one page at most) only for a business decision or
  a module boundary change. No new reports, audits or checklists unless the user asks.
- **Report plainly:** what changed for coaches and clients, test results, what was not done
  or not verified, and the next step. Commit only when the user says so.

## Read first

- Read the sections of `docs/ARCHITECTURE.md`, `docs/DOMAIN-RULES.md` and `docs/ROADMAP.md` that
  cover the area you change.
- Before changing an area, read its ADR(s) in `docs/adr/`.
- Current work follows the commercial plan in `docs/ROADMAP.md`; do not start a roadmap phase
  or feature outside it without the user's approval.
- Any screen, style or UX work follows `docs/UI-REDESIGN-PLAN.md`, the only UI/UX plan. It overrides
  older frontend docs and the retired Figma file. Screens may be restructured freely; backend rules
  here still apply to any data they touch. "Do the next step" means the first unfinished row of its
  §0 status table; stop at 🚦 gates, and update that row when the step is built.
- `base44/` is a preserved legacy reference, not the new architecture. Do not edit, delete,
  or copy its generic CRUD/security model unless the user explicitly requests legacy work.
- The backend/database is the source of truth. Never implement an invariant only in Angular;
  authorization belongs on API/resource operations, and Angular role checks are presentation.
  A working UI is not evidence that business state is correct.

## Stack and structure

- Backend: .NET 10 LTS, C# 14, ASP.NET Core, EF Core 10, Npgsql, PostgreSQL 18.
- Frontend: Angular 22 standalone components, Signals, strict TypeScript; keep feature routes lazy.
- Architecture: modular monolith. Do not introduce microservices, a distributed event bus,
  or separate databases without an approved ADR and demonstrated need.
- Keep `TB.Gym.SharedKernel` tiny. Module projects may reference SharedKernel only, never
  another `TB.Gym.Modules.*` assembly. Infrastructure and API compose modules.
- `ICoachingFeatureAccessService` is the approved shared authorization port. Training, nutrition,
  check-in, messaging, and resource APIs must keep evaluating it server-side, as must any new
  coaching-feature API.
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
- PowerShell 5.1 `Get-Content`/`Set-Content`/`Add-Content` corrupt UTF-8; for repo files use
  `[IO.File]::ReadAllText`/`WriteAllText` with `[Text.UTF8Encoding]::new($false)`; keep `.ps1` ASCII.

## Security and tenancy

- Treat `X-Tenant-Id` as untrusted until active membership is verified server-side.
- Every tenant-owned entity needs `TenantId`, a global query filter, write-scope guard,
  tenant-aware indexes/constraints, and cross-tenant negative tests.
- A Coach acts only on assigned clients (ADR 0026). Name client route parameters `clientProfileId`
  or `clientId` so the tenant handler checks them; any other route reaching a client must ask
  `CoachClientScope` and answer 404 for another coach's client.
- A released or departed client is read-only (ADR 0027). A write that reaches a client through
  another row must call `CoachClientScope.EnsureNotReleasedAsync`. A returning client has an old
  ended profile too, so every client self-service lookup must use `ClientProfiles.CurrentFor(userId)`.
- Keep Identity in HTTP-only same-origin cookies with antiforgery on state changes. Never put
  session credentials in local/session storage.
- Sensitive profile/health/media data must not appear in logs, analytics, exceptions, or
  notification payloads.

## Persistence and invariants

- Add EF migrations for schema changes; never hand-edit production state.
- Use database checks, unique/composite foreign keys, and PostgreSQL exclusion constraints
  for critical invariants where possible, plus friendly domain validation.
- Preserve audit/history for subscriptions, payments, blocks, programs, strength snapshots,
  and calculations. Never overwrite history or hard-delete paid/completed facts; enrollment
  snapshots, payment history, strength observations and mesocycle working maxes are append-only.
- These rules cover money between a coach and their client.
  - Commercial naming is deliberate: `CoachingProduct` -> immutable `ProductOffer` -> dated
    `ClientEnrollment` -> feature coverage and append-only `PaymentRecord`. Do not collapse
    these into a generic Subscription DTO/table.
  - Renewal creates a new enrollment. A new price/duration/currency creates a new offer.
  - Enrollment overlap is prohibited per tenant/client/feature/date range, not globally. Keep
    the PostgreSQL GiST exclusion constraint and concurrency test intact.
  - Phase 2 manual receipts must match enrollment currency; partial receipts grant no access
    until the exact price is paid. Do not add FX, credit, refunds, waiver, or recurring billing
    behavior without an approved domain decision and ledger operation design.
- Platform billing (TB Gym billing workspaces, ADR 0028) is a separate module with exact money,
  immutable price plans and invoices, and append-only voids and payments. Prices live only in the
  published plan. An unpaid workspace is read-only for staff in the tenant authorization handler:
  a new state-changing staff endpoint is blocked then unless it is a read or personal setting
  marked `AllowedWhileWorkspaceReadOnly` (an integration test pins that list).
- Workspace relationship block overrides feature access only in that tenant. It must never
  become a global Identity block.
- Idempotency keys are bound to normalized command payloads. Identical concurrent retries
  return the original result; changed payloads with a reused key must conflict.
- Notification outbox keys are idempotent and schedules are calculated in tenant time.
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
- Do not silently rebase a program after a global max changes or convert kg/lb implicitly.
- RPE is canonical: Phase 3 accepts RPE 5-10 or RIR 0-5 in 0.5 steps.
- Keep formulas and calculation, progression and rounding strategies named, versioned and
  explainable, with inputs and provenance and fixed reference tests; manual coach overrides win.
- Training work: read `docs/DOMAIN-RULES.md` sections 4-5 first.
- Media work: read the MED rules in `docs/DOMAIN-RULES.md` section 8 and ADRs 0023-0025 first.

## Testing

- Domain rule or bug fix: add focused domain tests.
- Module/dependency change: update architecture tests.
- Endpoint/security/persistence change: add API integration tests, including unauthorized,
  wrong-tenant, constraint, and concurrency cases.
- Angular state/interaction change: add Vitest coverage.
- PostgreSQL-specific behavior must be tested against PostgreSQL, not SQLite/in-memory EF.
- Before reporting, run only the `./scripts/check.ps1` steps for the side you changed: the backend
  build and `dotnet test` when backend code changed, the npm steps when web code changed. If Docker
  isn't running, run those steps directly. Always run `git diff --check`.
- The full backend suite can take about an hour. Start it once with a log and an exit-code marker,
  arrange a completion watcher, and do other useful work or wait for the notification instead of
  repeatedly polling. Read the final result before reporting; do not mistake silence for a pass.

## Commands

```powershell
# Full local verification
.\scripts\check.ps1

# API and Angular in separate terminals (requires PostgreSQL for readiness/data)
.\scripts\run-api.ps1
.\scripts\run-web.ps1

# Fill the dev database with the Atlas Performance demo (UI-REDESIGN-PLAN.md R0.1); stop the API first
.\scripts\demo-workspace.ps1

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

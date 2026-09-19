# TB Gym — Frontend, UX, and Frontend-Logic Audit

Overall conclusion: TB Gym has substantial domain coverage and several carefully implemented workflows, but the frontend is not yet polished enough for a confident closed-beta launch. The largest risks are navigational, responsive, accessibility, tenant-state, and page-composition problems—not missing decorative styling.

No P0 issue was found. Seven P1 problem areas should be addressed before broader client use.

## 1. What this means in normal language

The application already handles a surprisingly broad coaching workflow: clients, invitations, commercial access, programming, nutrition, check-ins, messaging, progress, notifications, and account management.

The backend-led business rules are generally respected. I did not find Angular pretending to grant access the backend would reject.

The frontend’s main weaknesses are:

- Important functionality can be difficult or impossible to discover. Client nutrition has a working route but no navigation path.
- Coach navigation breaks even at common desktop widths.
- Several forms fail silently when submitted incorrectly.
- The progress page renders broken dates and thousands of pixels of “No observation” rows.
- The coach client page attempts to display nearly the whole product in one document.
- Some older screens can apply an obsolete API response after the coach changes workspace.
- Unsaved workout and editor state can be lost by navigation or refresh.
- Good empty, locked, loading, and error states exist in places, but are not consistently applied.
- The test suite has strong component coverage, but there is no browser-level accessibility, responsive, navigation, or visual-regression protection.

The recommended response is not a wholesale redesign. Retain the domain model and current Angular architecture, then establish a coherent shell, navigation model, page hierarchy, form standard, and tenant-safe loading pattern.

---

## 2. Audit coverage and limitations

### Coverage

I reviewed:

- The repository architecture, domain rules, roadmap, ADRs 0005–0007, and planning document.
- All 28 routable screens.
- Coach/owner, client, authenticated, signed-out, locked, empty, error, and invitation-acceptance states.
- Desktop widths of 1440 and 1024 pixels and mobile widths of 390/360 pixels.
- Keyboard behavior, accessible names, headings, validation output, route focus, scroll behavior, and navigation state.
- API request behavior, duplicate calls, expected 403/404 responses, and console output.
- Signals, effects, tenant ownership, draft handling, DTO mapping, route guards, API composition, styling, and tests.
- Production bundle output and package audit.
- Competing coaching products and current accessibility/browser guidance.

Representative runtime evidence:

- [Coach dashboard at desktop width](</C:/Users/Admin/AppData/Local/Temp/tbgym-audit-dashboard-1440x900.png>)
- [Coach client mega-page](</C:/Users/Admin/AppData/Local/Temp/tbgym-audit-client-details-1440x900.png>)
- [Broken client progress page](</C:/Users/Admin/AppData/Local/Temp/tbgym-audit-client-progress-1440x900.png>)
- [Progress page on mobile](</C:/Users/Admin/AppData/Local/Temp/tbgym-audit-client-progress-390x844.png>)
- [Persisting mobile navigation](</C:/Users/Admin/AppData/Local/Temp/tbgym-audit-mobile-menu-stuck-390x844.png>)

### Limitations

- The requested browser connector was unavailable, so the runtime review used the installed Chrome browser through its debugging interface.
- Figma was not used because this was a report-only audit. It will be useful when the shell and design-system tasks begin.
- Docker Desktop was unavailable. I ran the application against an isolated PostgreSQL 18 instance on port 5433.
- A synthetic client was created only in that temporary audit database. No production/customer data was used.
- Populated workout, program, and nutrition-plan execution could not all be produced economically from the empty development state. Those areas were supplemented with source and unit-test inspection.
- Valid email-confirmation and reset-password tokens were not available; their invalid/missing-token states were reviewed.
- No native screen reader, physical mobile device, slow-device profile, or production telemetry was available.
- The repository does not currently contain Playwright, axe, Lighthouse, or visual-regression tooling. I did not add dependencies for a report-only task.
- The PostgreSQL API integration suite stopped producing progress after nearly an hour and was interrupted after your direction not to spend further time on it. It is not reported as passing.

### Verification commands and outcomes

| Command | Outcome |
|---|---|
| `npm test` | Passed: 45 files, 473 tests |
| `npm run lint` | Passed |
| `npm run build` | Passed |
| `npm run build -- --stats-json` | Passed; initial bundle 439.96 kB raw / 116.69 kB transferred |
| `npm run format:check` | Failed only because the already-modified `angular.json` is not Prettier-clean |
| `npm audit --audit-level=high` | Passed; 0 vulnerabilities |
| `.\scripts\check.ps1 -SkipRestore` | Backend Release build passed with 0 warnings/errors; script then stopped at `docker info` because Docker was unavailable |
| `dotnet test TB.Gym.slnx --configuration Release --no-build` | Domain: 307 passed; architecture: 48 passed; API integration project did not complete |
| `git diff --check` | Exit 0; only existing LF→CRLF warnings |

The initial direct Angular attempts used system Node 22.17 and were rejected because the current Angular tooling requires at least Node 22.22.3. Running through the repository toolchain selected Node 24.19 and succeeded.

### Repository state

Beginning and ending `git status --short --branch` were identical. The audit did not add, edit, stage, or delete repository files.

<details>
<summary>Existing working-tree state preserved</summary>

```text
## main...origin/main
M  .env.example
M  .github/workflows/ci.yml
M  compose.yaml
MM docs/ARCHITECTURE.md
M  docs/CLOSED-BETA-READINESS.md
 M docs/DOMAIN-RULES.md
M  docs/LAUNCH-CHECKLIST.md
 M docs/ROADMAP.md
A  scripts/build-migration-bundle.ps1
 M src/backend/Modules/Training/TB.Gym.Modules.Training/TrainingContracts.cs
 M src/backend/Modules/Training/TB.Gym.Modules.Training/TrainingEndpoints.cs
 M src/backend/TB.Gym.Infrastructure/Application/InvitationApplicationService.cs
 M src/backend/TB.Gym.Infrastructure/Application/TrainingApplicationService.Client.cs
M  src/backend/TB.Gym.Infrastructure/Security/ReverseProxy.cs
 M src/web/angular.json
 M src/web/src/app/app.html
 M src/web/src/app/app.routes.ts
 M src/web/src/app/app.scss
 M src/web/src/app/app.spec.ts
 M src/web/src/app/core/api/api-client.ts
 M src/web/src/app/core/api/generated/index.ts
 M src/web/src/app/core/api/generated/types.gen.ts
 M src/web/src/app/features/clients/client-details.html
 M src/web/src/app/features/clients/client-details.ts
 M src/web/src/app/features/dashboard/dashboard.html
 M src/web/src/app/features/dashboard/dashboard.ts
 M src/web/src/app/features/invitations/accept-invitation.html
 M src/web/src/app/features/invitations/accept-invitation.spec.ts
 M src/web/src/app/features/invitations/accept-invitation.ts
 M src/web/src/app/features/invitations/invitations.html
 M src/web/src/app/features/messaging/messages.spec.ts
 M src/web/src/app/features/messaging/messages.ts
 M src/web/src/app/features/training/client-training.html
 M src/web/src/app/features/training/client-training.ts
 M src/web/src/app/features/training/today-training.html
 M src/web/src/app/features/training/today-training.interaction.spec.ts
 M src/web/src/app/features/training/today-training.scss
 M src/web/src/app/features/training/today-training.spec.ts
 M src/web/src/app/features/training/today-training.ts
 M src/web/src/styles.scss
M  tests/backend/TB.Gym.Api.IntegrationTests/ReverseProxyForwardedHeaderTests.cs
?? docs/CLOSED-BETA-SLICE-1.md
?? src/backend/TB.Gym.Infrastructure/Application/TrainingApplicationService.Reads.cs
?? src/web/public/fonts/
?? src/web/src/app/features/account/client-account.ts
?? src/web/src/app/features/clients/client-details.spec.ts
?? src/web/src/app/features/dashboard/client-today.html
?? src/web/src/app/features/dashboard/client-today.scss
?? src/web/src/app/features/dashboard/client-today.spec.ts
?? src/web/src/app/features/dashboard/client-today.ts
?? src/web/src/app/features/messaging/conversation-launch.ts
?? src/web/src/app/features/training/coach-workout.html
?? src/web/src/app/features/training/coach-workout.scss
?? src/web/src/app/features/training/coach-workout.spec.ts
?? src/web/src/app/features/training/coach-workout.ts
?? src/web/src/app/features/training/training-read.models.ts
?? tests/backend/TB.Gym.Api.IntegrationTests/ClosedBetaTrainingReadTests.cs
```

</details>

---

## 3. Scorecard

Scores are out of five.

| Area | Score | Assessment |
|---|---:|---|
| Information architecture | 2 | Flat coach navigation, hidden client nutrition, and an oversized client page |
| Visual coherence | 2 | Restrained foundation, but typography, tokens, controls, and feature styling diverge |
| Coach workflow | 2 | Broad capability, but dense editors and excessive page length slow routine work |
| Client workflow | 3 | Invitation, Today, locking, rest-day, and workout-save concepts are sound |
| Mobile usability | 2 | Basic reflow works; navigation persistence and extremely long pages do not |
| Accessibility | 2 | Reasonable native semantics in places, but validation, focus, headings, and naming need work |
| Frontend logic | 3 | Good Signals usage and newer stale-request protection; inconsistent across older screens |
| Maintainability | 2 | Large API client, feature-to-core imports, duplicated loading, fragmented CSS |
| Performance | 3 | Lazy routes and passing bundle budget, but near warning limit and expensive client detail |
| Test protection | 3 | Strong Vitest coverage, but no full-browser/a11y/visual regression layer |

Overall readiness: **2.4/5 — functional beta foundation, not yet release-polished.**

---

## 4. Current frontend map

### Signed-out and invitation flows

| Route | Purpose | Audit state |
|---|---|---|
| `/auth/sign-in` | Coach/client authentication | Empty-submit validation exercised |
| `/auth/register` | Coach registration | Empty-submit validation exercised |
| `/auth/forgot-password` | Password recovery request | Empty-submit validation exercised |
| `/auth/reset-password` | Password reset | Missing/invalid token only |
| `/auth/confirm-email` | Email confirmation | Missing/invalid token only |
| `/invite` | Inspect and accept invitation | Valid invitation/account creation exercised |

### Coach/owner workspace

| Route | Purpose |
|---|---|
| `/` | Role-sensitive dashboard |
| `/clients` | Client directory |
| `/clients/:clientId` | Combined client workspace |
| `/invitations` | Invite clients |
| `/products` | Products and offers |
| `/training/programs` | Program-template builder |
| `/training/exercises` | Exercise library |
| `/nutrition/library` | Foods, recipes, meal plans |
| `/checkins/forms` | Check-in form builder |
| `/checkins/clients` | Client check-in review |
| `/workspace` | Workspace settings and membership |

### Shared authenticated routes

| Route | Purpose |
|---|---|
| `/messages` | Conversations |
| `/notifications` | Notification inbox |
| `/notifications/settings` | Notification preferences |
| `/account/security` | Password/security settings |

### Client experience

| Route | Purpose |
|---|---|
| `/` | Client Today overview |
| `/profile` | Client profile |
| `/me` | Client account/home |
| `/progress` | Detailed observations |
| `/progress/dashboard` | Progress summaries/charts |
| `/training/today` | Workout execution |
| `/nutrition/today` | Current nutrition plan |
| `/checkins/me` | Client check-ins |

The wildcard redirects to `/`. Role guards redirect disallowed routes there without explaining why.

---

## 5. Research findings

Current coaching platforms converge on several patterns that fit TB Gym’s domain:

- Client navigation is deliberately small. Everfit presents four main client areas and makes Today adapt to workouts, food, tasks, steps, and notifications instead of exposing every backend module as a separate top-level destination. [Everfit client onboarding](https://help.everfit.io/en/articles/5555389-onboarding-walkthrough-for-clients)
- Coaching products connect training, nutrition, habits, messaging, and progress through a client-centered workspace rather than isolated administrative pages. [Trainerize overview](https://help.trainerize.com/hc/en-us/articles/208688876-What-is-ABC-Trainerize-A-Getting-Started-Overview), [TrueCoach features](https://truecoach.co/features/), [Hevy Coach features](https://hevycoach.com/features/)
- Reusable programming libraries should stay distinct from assigned client programming. TrainHeroic’s documented copying/program-library workflow supports TB Gym’s existing template/version/snapshot domain separation. [TrainHeroic program workflow](https://support.trainheroic.com/hc/en-us/articles/18156951622669-For-Coaches-Copying-a-Program)
- High-value coach dashboards emphasize current activity, adherence, and required action—not simply links to every module. [TrainHeroic Coach Home](https://support.trainheroic.com/hc/en-us/articles/18156740868493-Using-the-Coach-Home-Activity-Feed)

Relevant standards:

- Angular recommends explicit focus management when routing content changes. [Angular accessibility guidance](https://angular.dev/best-practices/a11y)
- Angular supports configured scroll restoration; TB Gym currently uses plain `provideRouter(routes)`. [Angular scrolling options](https://angular.dev/api/router/InMemoryScrollingOptions)
- Failed input must be identified and described, not represented only through an internal invalid class. [WCAG error identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification)
- A 24×24 CSS-pixel target is the WCAG 2.2 minimum; 44×44 remains the stronger enhanced target for frequent mobile interaction. [Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum), [Target Size Enhanced](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced)
- Browser tests can incorporate axe and screenshot comparison without replacing manual review. [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing), [Playwright snapshots](https://playwright.dev/docs/next/test-snapshots)

The recommendation is to adopt these interaction principles, not mimic another product’s visual identity.

---

## 6. Recommended visual direction

Use a calm, editorial operations workspace rather than a generic collection of bordered cards.

### Foundation

- One type family across coach and client surfaces, with verified Latin and Arabic coverage. The existing IBM Plex assets are a plausible option if licensing and language coverage are confirmed.
- Warm-neutral page background, white or subtly tinted working surfaces, dark ink text, one restrained teal accent, and dedicated semantic colors.
- A single spacing scale: 4, 8, 12, 16, 24, and 32 pixels.
- Six-pixel control radius, eight-pixel surface radius, ten-pixel dialog radius.
- Pills only for statuses, counts, and compact filters.
- One-pixel borders for separation; shadows reserved for overlays and sticky elements.
- Tabular numerals for weights, money, dates, repetitions, and metrics.
- A consistent icon set with visible text labels for important actions. Retire glyph buttons such as `↑`, `↓`, `⧉`, and `×` from core authoring workflows.

### Coach layout

- A grouped 224–240 pixel sidebar:
  - Clients
  - Programming
  - Nutrition
  - Check-ins
  - Commerce
  - Workspace utilities: messages, notifications, workspace, security
- Compact top utility bar for workspace switching, search/context actions, and account controls.
- Allow full-width operational tables/builders, while constraining prose and settings forms to approximately 720 pixels.

### Client layout

- Mobile tabs: **Today, Plan, Messages, Progress, Me**.
- Today aggregates due work: training, meals, check-ins, messages, and alerts.
- Plan contains Training, Nutrition, and Check-ins, eliminating the currently unreachable nutrition route.
- Use 16-pixel mobile gutters and 44–48 pixel frequent-action targets.
- Use sticky save/finish actions only where the user is actively recording data.

### Interaction patterns

- Every form gets visible field errors, an error summary when appropriate, focused feedback, and persistent server errors.
- Every data collection gets a defined loading, empty, locked, error, and populated state.
- Tables retain filters and pagination in the URL.
- Charts appear only when meaningful data or comparisons exist.
- Avoid gradients, glass effects, excessive shadows, oversized marketing cards, and decorative charts.

---

## 7. Prioritized findings

Severity: P1 = fix before broader beta use; P2 = high-priority quality/scale problem; P3 = later polish. No P0 was found.

### Design and UX consistency

**UX-01 — Fragmented visual system**  
*Design/UX · P2 · High confidence · All roles/routes*

- **Evidence:** Runtime screenshots and feature SCSS; two typography systems, token naming such as `--muted`, `--muted-text`, and undefined `--text-muted`, plus unrelated button/card treatments.
- **Impact:** The application feels assembled feature-by-feature and future changes remain expensive.
- **Root cause:** Feature-local styling grew faster than shared primitives.
- **Correction:** Establish typography, color, spacing, surface, control, status, table, form, dialog, and empty-state primitives.
- **Dependencies:** Agree on the visual direction before broad page redesign.

**IA-01 — Coach information architecture is flat**  
*Design/UX · P2 · High confidence · Coach/owner · authenticated shell*

- **Evidence:** Ten-plus equal-weight links in [app.html](</C:/Users/Admin/Desktop/TB gym/src/web/src/app/app.html:22>); nutrition is absent even though the route exists.
- **Impact:** Scanning becomes slow and the navigation cannot grow safely.
- **Root cause:** Routes were appended to a single horizontal list.
- **Correction:** Introduce grouped sidebar navigation and a compact utility area.
- **Dependencies:** Shell task and route naming agreement.

**STATE-01 — Empty, locked, error, and unavailable states are inconsistent**  
*Design/UX · P2 · High confidence · Both roles · multiple features*

- **Evidence:** Helpful training lock/rest states exist, while expected nutrition 403s become generic “could not be loaded” errors and messages shows two redundant empty prompts.
- **Impact:** Users cannot tell whether they lack access, lack assigned data, or encountered a failure.
- **Root cause:** Each feature defines its own state language.
- **Correction:** Create shared state semantics and feature-access presentation models.
- **Dependencies:** Shared UI primitives and access-aware view models.

### Page-specific problems

**PAGE-01 — Progress renders broken dates and 84 empty daily rows**  
*Page · P1 · High confidence · Client · `/progress`*

- **Evidence:** Runtime height 7,423 px desktop and 10,633 px mobile; dates such as `Sat, 0e27iu0DPMte`; [invalid DatePipe pattern](</C:/Users/Admin/Desktop/TB gym/src/web/src/app/features/progress/progress-view.html:100>).
- **Impact:** A core trust-sensitive health page appears corrupt and nearly unusable when empty.
- **Root cause:** `'EEE, mediumDate'` combines an alias inside a custom format; absent days are materialized individually.
- **Correction:** Use a valid localized format; summarize missing ranges; show only observed days or grouped weeks; add a useful empty state.
- **Dependencies:** Locale/date utility and progress-page redesign.

**PAGE-02 — Client detail is a 13,000–20,000 px mega-page**  
*Page · P1 · High confidence · Coach · `/clients/:clientId`*

- **Evidence:** 14 major sections, seven forms, 12 buttons; 13,222 px desktop and 19,792 px mobile; 22 load requests and three identical commercial-overview requests. Screenshot: [client detail](</C:/Users/Admin/AppData/Local/Temp/tbgym-audit-client-details-1440x900.png>).
- **Impact:** Routine work is hard to locate, mobile use is impractical, and independent features fail noisily together.
- **Root cause:** All client modules are composed sequentially with separate loaders and no shared client context.
- **Correction:** Add client child routes/tabs—Overview, Training, Nutrition, Progress, Check-ins, Commerce, Notes—and one shared cached client context.
- **Dependencies:** Router shell, access-state model, API decomposition.

**PAGE-03 — Client nutrition is undiscoverable**  
*Page/IA · P1 · High confidence · Client · `/nutrition/today`*

- **Evidence:** The route works, but no client `routerLink` targets it. The bottom navigation exposes Today, Check-ins, Messages, Progress, and Me.
- **Impact:** Clients cannot reach a paid core capability without manually entering a URL.
- **Root cause:** The route was added without integration into the client navigation model.
- **Correction:** Introduce a Plan destination or surface nutrition clearly from Today and Me.
- **Dependencies:** Client shell/IA decision.

**PAGE-04 — Authoring pages are too dense and implementation-oriented**  
*Page · P2 · High confidence · Coach · program/nutrition/product screens*

- **Evidence:** Long single-canvas builders, tiny glyph controls, automatic empty product editor, “1 weeks,” and a visible “PHASE 4” eyebrow.
- **Impact:** Authoring requires unnecessary reading and exposes implementation history to users.
- **Root cause:** Data-model structure is rendered directly rather than converted into task-focused steps.
- **Correction:** Use master/detail or staged editors, descriptive actions, grammar-aware copy, and persistent section navigation.
- **Dependencies:** Shared builder patterns.

### Frontend logic and state

**LOGIC-01 — Older screens can apply stale responses after a tenant switch**  
*Logic · P1 · High confidence · Coach/owner · dashboard, clients, invitations, products, workspace, profile, nutrition, check-ins, libraries*

- **Evidence:** Static inspection found async loads that capture `loadedTenantId` but assign returned state without validating that the tenant remains current. Newer messaging/training screens already use generation/context protection.
- **Impact:** A member of multiple workspaces can see Workspace A data after switching to B. This is a display-integrity problem, not evidence of a backend authorization bypass.
- **Root cause:** Tenant ownership patterns were introduced incrementally.
- **Correction:** Standardize a tenant-scoped async resource/generation guard and clear state immediately on context change.
- **Dependencies:** None; this should be the first implementation task.

**LOGIC-02 — Unsaved work has no navigation protection**  
*Logic · P1 · High confidence · Both roles · workout and multi-step editors*

- **Evidence:** Workout drafts are intentionally page-local; no `CanDeactivate` or `beforeunload` handling exists. Program, nutrition, and check-in editors have the same exposure.
- **Impact:** Navigation, workspace switching, or refresh can silently discard substantial work.
- **Root cause:** Draft state is modeled, but lifecycle ownership is not.
- **Correction:** Introduce a shared dirty-state contract, route guard, unload warning, and explicit discard/save behavior.
- **Dependencies:** Form/editor shell conventions.

**LOGIC-03 — Some calendar defaults use the browser’s UTC date**  
*Logic · P2 · High confidence · Coach · client training/invitations/intake*

- **Evidence:** [Client training defaults](</C:/Users/Admin/Desktop/TB gym/src/web/src/app/features/training/client-training.ts:79>) use `new Date().toISOString().slice(0, 10)`.
- **Impact:** Around local midnight, the default date can be one calendar day wrong for Beirut or another tenant zone.
- **Root cause:** UTC instants are being used for tenant calendar dates.
- **Correction:** Derive defaults from the backend-provided workspace current date/time zone.
- **Dependencies:** Reusable tenant-date service or contract.

**LOGIC-04 — Libraries silently stop at fixed result caps**  
*Logic · P2 · High confidence · Coach · exercises/nutrition/builders*

- **Evidence:** [Exercise search](</C:/Users/Admin/Desktop/TB gym/src/web/src/app/core/api/api-client.ts:421>) forces `skip: 0, take: 200`; nutrition lists take 100; affected views lack load-more/pagination despite totals.
- **Impact:** Larger libraries appear complete while hiding records.
- **Root cause:** Initial-load limits were not completed into pagination.
- **Correction:** Add server pagination, URL-preserved filters, visible totals, and incremental loading.
- **Dependencies:** Table/list primitive and API client decomposition.

### Accessibility

**A11Y-01 — Invalid forms frequently fail silently**  
*Accessibility · P1 · High confidence · Both roles · auth, invitations, account, workspace, products, intake*

- **Evidence:** Empty submissions produced no visible error or `aria-invalid` on sign-in, registration, password recovery, and invitation creation. Components call `markAllAsTouched()` but templates often render no corresponding messages.
- **Impact:** Keyboard, screen-reader, and sighted users cannot understand why submission did nothing. This conflicts with [WCAG error identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification).
- **Root cause:** Validation exists in form state but lacks a presentation contract.
- **Correction:** Add inline field errors, error summaries, described-by links, `aria-invalid`, and focused feedback. Reuse the better invitation-acceptance implementation.
- **Dependencies:** Shared field/control components.

**A11Y-02 — Route headings, focus, scroll, and current navigation are incomplete**  
*Accessibility · P2 · High confidence · Both roles · multiple routes*

- **Evidence:** Several routes have no `h1`; SPA navigation retained `scrollY=700` and focus on `BODY`; coach links lack `ariaCurrentWhenActive`; router configuration is only [plain `provideRouter(routes)`](</C:/Users/Admin/Desktop/TB gym/src/web/src/app/app.config.ts:11>).
- **Impact:** Page changes are poorly announced and keyboard users can arrive mid-page.
- **Root cause:** Routing was treated as visual replacement without document-navigation behavior.
- **Correction:** One clear `h1` per screen, main-content focus strategy, skip link, scroll restoration, and current-page state.
- **Dependencies:** Shell refactor.

**A11Y-03 — Product duration and currency controls lack individual accessible names**  
*Accessibility · P2 · High confidence · Coach · `/products`*

- **Evidence:** Runtime accessibility tree exposed an unnamed combobox and textbox because one wrapping label covers multiple controls.
- **Impact:** Screen-reader users cannot identify unit/currency inputs.
- **Root cause:** Group labels were used where each control needs an explicit label.
- **Correction:** Label each input/select and group them with `fieldset`/`legend` or an equivalent named group.
- **Dependencies:** None.

### Responsive behavior

**RESP-01 — Coach navigation overflows at desktop widths**  
*Responsive · P1 · High confidence · Coach/owner · authenticated shell*

- **Evidence:** At a 1,440 px viewport, document content was 1,481 px wide; at 1,024 px it remained 1,481 px while the hamburger breakpoint is only 960 px.
- **Impact:** Account/sign-out controls are clipped and horizontal scrolling appears on ordinary laptops.
- **Root cause:** A non-wrapping horizontal route list outgrew its breakpoint assumptions.
- **Correction:** Replace it with the grouped sidebar; until then, switch to compact navigation much earlier.
- **Dependencies:** Shell redesign.

**RESP-02 — Mobile navigation remains open after route changes**  
*Responsive/accessibility · P1 · High confidence · Coach · mobile shell*

- **Evidence:** A real RouterLink navigation retained `menuOpen=true`; Escape did not close it. Screenshot: [persisting menu](</C:/Users/Admin/AppData/Local/Temp/tbgym-audit-mobile-menu-stuck-390x844.png>).
- **Impact:** The menu continues covering the destination and traps the experience behind navigation.
- **Root cause:** Menu state is not bound to navigation completion or an accessible disclosure lifecycle.
- **Correction:** Close on `NavigationEnd`, Escape, link activation, and outside interaction; restore focus to the trigger.
- **Dependencies:** Shell task.

**RESP-03 — Large pages technically reflow but are not mobile-usable**  
*Responsive · P2 · High confidence · Both roles · client detail, progress, nutrition, builders*

- **Evidence:** Client detail reaches 19,792 px and empty progress 10,633 px on a 390×844 viewport.
- **Impact:** “No horizontal overflow” hides severe interaction cost and scroll fatigue.
- **Root cause:** Desktop section stacking is treated as the mobile layout.
- **Correction:** Route/tab decomposition, progressive disclosure, sticky contextual actions, and mobile-prioritized summaries.
- **Dependencies:** PAGE-01, PAGE-02, PAGE-04.

### Architecture, performance, testing, and completeness

**ARCH-01 — Core API client depends on feature-owned mapping code**  
*Architecture · P2 · High confidence · Development-wide*

- **Evidence:** The approximately 1,500-line `api-client.ts` imports feature view-model mappers into `core`, while handwritten models duplicate generated contracts.
- **Impact:** Core and features are coupled backwards; API changes have a broad blast radius.
- **Root cause:** One transport façade accumulated every module and transformation.
- **Correction:** Split transport clients by domain, keep generated DTOs at the boundary, and map to feature models inside each feature.
- **Dependencies:** Incremental migration; do not manually edit generated files.

**PERF-01 — Important routes do excessive work**  
*Performance · P2 · High confidence · Both roles · initial load/client detail*

- **Evidence:** Client detail triggered 22 application calls, including three identical commercial requests. The initial bundle is 439.96 kB, about 60 kB below the warning budget; SignalR is paid for in the initial bundle even on signed-out pages.
- **Impact:** Slower devices and real networks will magnify loading and failure fragmentation.
- **Root cause:** Independently composed child loaders and eager realtime infrastructure.
- **Correction:** Share client context/cache, load active tabs only, and lazily initialize messaging realtime after authenticated need.
- **Dependencies:** PAGE-02 and API decomposition.

**TEST-01 — Browser behavior is not protected**  
*Testing · P2 · High confidence · Development-wide*

- **Evidence:** 473 frontend unit tests pass, but there is no E2E, axe, viewport, visual-regression, or route-focus suite.
- **Impact:** The progress corruption, navigation overflow, persistent menu, and silent validation can all pass existing tests.
- **Root cause:** Testing stops at component/service level.
- **Correction:** Add a small Playwright suite for critical journeys, axe checks, mobile/desktop screenshots, and request-count assertions.
- **Dependencies:** Stabilize the shell and seed deterministic browser fixtures.

**COVER-01 — Some existing backend capabilities have no frontend surface**  
*Coverage · P2 · Medium confidence · Coach/client · multiple modules*

- **Evidence:** Generated contracts expose legal consent/current-document, estimated 1RM, nutrition versioning/cooking factors/macro override/cancellation, and client-access endpoints without equivalent owned UI/API flows.
- **Impact:** Some complete backend capabilities are unusable, while legal acceptance may remain a launch dependency.
- **Root cause:** Backend phases advanced faster than frontend product integration.
- **Correction:** Classify each as launch-required, later, or deliberately operator-only before implementation.
- **Dependencies:** User approval is required before starting deferred phase work; legal wording must not be invented.

**I18N-01 — Arabic/RTL readiness is incomplete**  
*Internationalization · P3 · High confidence · All routes*

- **Evidence:** Hard-coded `en-GB`/`en-LB`, English-only choices, mixed font strategy, and remaining physical `text-align:left`.
- **Impact:** Adding Arabic later will require feature-level cleanup.
- **Root cause:** Partial use of Angular i18n and logical CSS properties.
- **Correction:** Centralize locale/date/number formatting, verify Arabic font coverage, and complete logical-direction styling.
- **Dependencies:** Product decision on localization scope.

**SAFE-01 — Destructive actions use inconsistent confirmation patterns**  
*UX/safety · P3 · High confidence · Coach · invitations/media/archive actions*

- **Evidence:** Some high-impact operations request a reason or confirmation; invitation revocation and media deletion can execute immediately.
- **Impact:** Users cannot predict which actions are recoverable.
- **Root cause:** Each feature owns its confirmation behavior.
- **Correction:** Define action tiers: reversible direct action with undo, explicit confirmation, or reason-required workflow.
- **Dependencies:** Shared dialog/toast behavior.

### Previously suspected risks that are now resolved

- Client progress is discoverable from the bottom navigation.
- Coaches now have a visible “Message client” entry point, although its entitlement-aware disabled state remains inadequate.
- Workout finishing blocks dirty/saving sets and explains why.
- Rest day, no assignment, and no shared session are now distinguished.
- Per-set workout drafts are correctly keyed and a failed save does not erase another set’s dirty values.

---

## 8. Route-by-route UX review

| Route | Assessment | Main action |
|---|---|---|
| `/auth/sign-in` | Clean and focused, but invalid submission is silent | Add field errors and error-summary focus |
| `/auth/register` | Understandable form, same validation failure | Apply shared auth-form pattern |
| `/auth/forgot-password` | Simple flow, silent required error | Add visible email validation/status announcement |
| `/auth/reset-password` | Missing-token state is clear enough | Test valid, expired, reused, and mismatch states in-browser |
| `/auth/confirm-email` | Invalid state covered | Add browser tests for valid/already-confirmed cases |
| `/invite` | Strongest form-validation example; successful account path works | Use this validation approach elsewhere |
| `/` coach | Useful overview but functions partly as a route directory | Prioritize attention, adherence, overdue work, and exceptions |
| `/` client | Good Today concept with differentiated training states | Add nutrition and due check-ins consistently |
| `/clients` | Reasonable directory foundation | Persist search/filter state and improve mobile row actions |
| `/clients/:clientId` | Largest usability and request-composition problem | Split into child routes/tabs |
| `/invitations` | Core workflow works; invalid submission is silent | Inline errors and clearer invite lifecycle |
| `/products` | Empty editor is confusing; accessibility naming failure | Separate list from create/edit and label units |
| `/training/programs` | Capable but dense | Structured editor, section navigation, clearer actions |
| `/training/exercises` | Useful filters; silently capped at 200 | Paginate and show result count |
| `/nutrition/library` | Too many different resources in one long page | Tabs/master-detail and proper pagination |
| `/checkins/forms` | Functional builder without a clear page heading | Add page hierarchy, dirty-state protection |
| `/checkins/clients` | Useful review capability | Add heading, persistent filters, and explicit access states |
| `/messages` | Functionally adequate but visually raw | One empty state, proper heading, polished conversation layout |
| `/notifications` | Basic inbox works | Add heading, bulk/read affordances only if justified |
| `/notifications/settings` | Form-oriented and understandable | Apply shared validation/status behavior |
| `/account/security` | Appropriate scope | Visible validation and success announcement |
| `/profile` | Straightforward but date/locale conventions need consistency | Use tenant-aware date utilities |
| `/me` | Provides account destination | Make Plan/nutrition easier to discover |
| `/progress` | Currently broken and excessively long | Fix before broader beta |
| `/progress/dashboard` | Better summary direction, but lacks heading and empty-data restraint | Define meaningful summary hierarchy |
| `/training/today` | Strong draft isolation and finish protection | Add navigation/unload guard; validate populated mobile execution |
| `/nutrition/today` | Functional route but unreachable through navigation | Integrate into Today/Plan |
| `/checkins/me` | Useful client workflow but lacks page-level heading | Add hierarchy and due/complete state clarity |
| `/workspace` | Appropriate owner boundary | Improve validation and stale-tenant protection |
| Wrong-role/wildcard | Safely redirects, but silently | Explain unavailable destination where appropriate |

---

## 9. Frontend architecture review

### What is working well

- Routes are lazy-loaded and features are separated reasonably at the folder level.
- Angular Signals are used widely without introducing an unnecessary external state library.
- The backend remains authoritative for role, tenant, and commercial feature access.
- The selected tenant ID in local storage is not treated as a credential; server-side membership verification remains in place.
- HTTP-only same-origin cookie authentication and antiforgery behavior are preserved.
- Newer screens use context-generation checks to reject stale asynchronous work.
- Workout drafts are separate from API DTOs and keyed by set-performance ID.
- Training correctly distinguishes templates, assigned mesocycles, prescriptions, executions, and actuals.
- The production build currently remains within configured limits.
- Existing component tests cover a meaningful amount of frontend logic.

### Main structural debt

1. **Shell ownership:** Navigation, responsive behavior, route focus, and scroll restoration need to become deliberate shell responsibilities.
2. **Tenant state:** Every tenant-owned async resource needs a common ownership rule.
3. **API boundary:** Domain-specific transport services should replace the monolithic API client.
4. **Page composition:** Client detail and libraries need route-level composition, not a long list of independently loading components.
5. **Form system:** Validation state exists but lacks reusable accessible presentation.
6. **Feature access:** Locked/unavailable states should be based on explicit access models, not interpreted generic request failures.
7. **Date handling:** Calendar dates must come from tenant-date semantics, not browser UTC conversion.
8. **Query state:** Search, filters, pagination, and active sections should survive refresh and deep linking.
9. **CSS architecture:** Global tokens and feature styles need one naming contract and a small primitive layer.
10. **Browser protection:** Unit tests do not validate the app as a routed, responsive document.

No frontend-only business invariant or obvious cross-tenant backend bypass was found.

---

## 10. Recommended implementation sequence

### Task 1 — Make all tenant-scoped async state ownership-safe

- **Objective:** Prevent stale Workspace A responses from populating Workspace B screens.
- **Reason:** This is the highest trust and correctness risk.
- **Scope:** Create one reusable tenant-context/generation pattern; migrate dashboard, clients, invitations, products, workspace, profile, nutrition, check-in, and library loaders.
- **Likely files:** Tenant store/resources and affected feature `.ts` files.
- **Dependencies:** None.
- **Acceptance:** Switching tenant during any pending load clears old state; late responses are ignored; writes use the current verified tenant.
- **Tests/browser:** Deferred-promise Vitest tests for every migrated pattern plus rapid tenant-switch browser coverage.
- **Non-goals:** Backend tenancy redesign, caching across tenants.
- **Risk:** Broad mechanical migration can accidentally suppress legitimate refreshes.

### Task 2 — Establish the frontend design foundation

- **Objective:** Create approved tokens and reusable primitives before page redesign.
- **Reason:** Prevent each feature fix from producing another local visual dialect.
- **Scope:** Typography, spacing, colors, radii, borders, buttons, fields, status chips, cards, tables, empty/error/locked states, dialogs.
- **Likely files:** `styles.scss`, new shared UI folder, selected feature SCSS.
- **Dependencies:** Visual-direction approval; Figma is useful here.
- **Acceptance:** New primitives cover normal, hover, focus, disabled, busy, invalid, and mobile states; no undefined tokens.
- **Tests/browser:** Component tests, keyboard checks, representative visual snapshots.
- **Non-goals:** Redesigning every route in this task.
- **Risk:** An oversized component library would slow delivery; keep primitives small.

### Task 3 — Replace the authenticated shell

- **Objective:** Deliver grouped coach navigation and a coherent client navigation model.
- **Reason:** Fix desktop overflow, persistent mobile menu, hidden nutrition, current-page state, focus, and scroll together.
- **Scope:** Coach sidebar/top utility; client Today/Plan/Messages/Progress/Me; skip link; route focus; scroll restoration; mobile disclosure behavior.
- **Likely files:** `app.html`, `app.ts`, `app.scss`, `app.config.ts`, `app.routes.ts`.
- **Dependencies:** Task 2.
- **Acceptance:** No horizontal overflow at 320–1,600 px; menu closes on navigation/Escape; current route is announced; `/nutrition/today` is discoverable.
- **Tests/browser:** Keyboard route journey, 390/768/1024/1440 viewports, focus and scroll assertions.
- **Non-goals:** Feature-page redesign.
- **Risk:** Role-specific navigation regressions.

### Task 4 — Standardize accessible forms and dirty-state protection

- **Objective:** Make validation visible and prevent silent loss of work.
- **Reason:** Current invalid submissions and editor exits fail without adequate feedback.
- **Scope:** Shared field error and error-summary patterns; `aria-invalid`; status announcements; dirty-state contract; `CanDeactivate`; `beforeunload`.
- **Likely files:** Auth, invitations, account, workspace, products, intake, program, nutrition, check-in, workout components.
- **Dependencies:** Task 2; can partly run alongside Task 3.
- **Acceptance:** Every invalid submit explains and focuses the first problem; leaving dirty editors requires an explicit choice.
- **Tests/browser:** Keyboard-only invalid submissions, screen-reader tree checks, navigation/reload guard tests.
- **Non-goals:** Domain-validation changes.
- **Risk:** Over-warning on harmless navigation; dirty state must reset correctly after save.

### Task 5 — Split the coach client workspace

- **Objective:** Replace the mega-page with focused, deep-linkable client sections.
- **Reason:** It is the largest page, request, and mobile usability problem.
- **Scope:** Overview, Training, Nutrition, Progress, Check-ins, Commerce, Notes routes/tabs; shared client header/context; eligibility-aware actions.
- **Likely files:** `client-details.*`, routes, client feature components, API services.
- **Dependencies:** Tasks 1–3.
- **Acceptance:** Only active-section data loads; no duplicate commercial request; message action is hidden/disabled with explanation when unavailable.
- **Tests/browser:** Request-count tests, direct child-route loading, mobile navigation, wrong-access states.
- **Non-goals:** Changing commercial or training domain rules.
- **Risk:** Existing feature components may assume simultaneous page presence.

### Task 6 — Repair the client Today/Plan experience

- **Objective:** Create one clear daily workflow across training, nutrition, and check-ins.
- **Reason:** Client value depends on knowing what to do today.
- **Scope:** Today aggregation; Plan navigation; nutrition reachability; locked/rest/unassigned states; workout mobile ergonomics.
- **Likely files:** Client dashboard, client shell, today training/nutrition/check-in components.
- **Dependencies:** Tasks 2–4.
- **Acceptance:** Every entitled daily action is reachable in two interactions or fewer; locked states explain why and what happens next.
- **Tests/browser:** Client journeys for full, partial, expired, blocked, rest-day, empty, and populated access.
- **Non-goals:** New entitlement rules.
- **Risk:** Avoid duplicating backend coverage logic in Angular.

### Task 7 — Rebuild progress presentation

- **Objective:** Make progress accurate, compact, and useful with sparse data.
- **Reason:** The current page visibly corrupts dates and over-renders absence.
- **Scope:** Date fix, compact timeline, meaningful empty state, summaries, accessible charts/tables.
- **Likely files:** `features/progress/*`, date-format utilities.
- **Dependencies:** Tasks 2 and 3.
- **Acceptance:** Correct localized dates; no per-day empty spam; all chart values have textual equivalents.
- **Tests/browser:** Fixed-date reference tests, empty/sparse/dense data, 390/1440 screenshots.
- **Non-goals:** New health calculations or formulas.
- **Risk:** Charts can imply trends unsupported by sparse observations.

### Task 8 — Make builders and libraries scale

- **Objective:** Improve authoring density and remove silent result caps.
- **Reason:** Exercise, nutrition, and program workflows will deteriorate as real data grows.
- **Scope:** Pagination/load-more, URL filter state, master/detail authoring, descriptive reorder/duplicate/remove controls, tenant-aware date defaults.
- **Likely files:** Exercise library, nutrition library, program builder, products, API clients.
- **Dependencies:** Tasks 2 and API-service groundwork from Task 5.
- **Acceptance:** All totals are reachable; filter state survives refresh; keyboard users can perform all authoring actions.
- **Tests/browser:** >200 exercises, >100 nutrition records, mobile editing, timezone-boundary dates.
- **Non-goals:** New nutrition or progression domain capabilities.
- **Risk:** Builder refactors can affect snapshot payloads; preserve contracts exactly.

### Task 9 — Add browser quality gates

- **Objective:** Detect the classes of failure found in this audit before merge.
- **Reason:** Unit tests did not catch routed document and responsive failures.
- **Scope:** Playwright journeys, axe checks, desktop/mobile screenshots, route-focus tests, critical request-count assertions, bundle budget monitoring.
- **Likely files:** New E2E project/config, deterministic test fixtures, CI workflow.
- **Dependencies:** Start after shell stabilization; individual tests can be added during Tasks 3–8.
- **Acceptance:** CI covers signed-out, coach, client, invitation, tenant-switch, workout-draft, and progress journeys.
- **Tests/browser:** This task is the browser-test layer.
- **Non-goals:** Replacing Vitest or backend integration tests.
- **Risk:** Uncontrolled data/time creates flaky tests; fixtures and clocks must be deterministic.

---

## 11. Do now, later, and do not do

### Do now

- Fix stale tenant-response ownership.
- Fix progress dates and empty rendering.
- Make client nutrition reachable.
- Repair coach shell overflow and mobile-menu lifecycle.
- Add accessible validation to all launch-critical forms.
- Protect unsaved workout/editor state.
- Split the client mega-page.
- Add focused browser tests for these regressions.

### Do later

- Full Arabic/RTL delivery after scope and content are approved.
- Deeper dashboard analytics based on real usage data.
- Visual refinement of less-used settings screens.
- Operator dead-letter tooling.
- Broader backend capability surfaces such as nutrition version administration and estimated 1RM, once prioritized.
- Motion beyond basic state transitions.

### Do not do

- Do not begin deferred Phase 4 work without approval.
- Do not copy competitor visual designs.
- Do not introduce a large UI framework or state manager solely to solve these issues.
- Do not move commercial, tenant, progression, or training invariants into Angular.
- Do not make private media public or weaken current authorization.
- Do not edit generated API files manually.
- Do not create legal wording or seed unapproved consent documents.
- Do not use charts, gamification, AI, gradients, or motion to cover weak information architecture.
- Do not redesign every feature simultaneously; stabilize patterns and migrate incrementally.

---

## 12. Unanswered questions and blockers

1. Is legal-document acceptance required for closed beta, and are approved document versions available? The frontend should not invent them.
2. Should client navigation use the recommended combined **Plan** area, or should Training and Nutrition remain separate destinations?
3. Which coach dashboard decisions matter most daily: missed work, expiring access, unanswered messages, check-ins awaiting review, or programming due?
4. Is Arabic/RTL part of closed beta, near-term production, or a later market expansion?
5. Which currently backend-only nutrition and strength capabilities are truly launch-required?
6. Should invitation revocation and media deletion be recoverable/undoable, or require confirmation?
7. What production-scale targets should libraries support: hundreds, thousands, or tens of thousands of exercises/foods?
8. The PostgreSQL API integration runner needs a separate investigation if the full repository verification gate is expected to complete reliably.

## Five highest-leverage improvements

1. Standardize tenant-scoped async ownership so stale workspace responses cannot update current screens.
2. Replace the coach shell and client navigation, fixing overflow, mobile behavior, focus, and nutrition discoverability together.
3. Split `/clients/:clientId` into focused child routes with one cached client context.
4. Introduce an accessible form and dirty-state standard across auth, admin, and workout/editor workflows.
5. Repair progress presentation and add browser-level accessibility/responsive regression coverage.

**Recommended first implementation task:** Task 1, tenant-scoped async ownership. It is bounded, does not require visual decisions, and removes the most consequential frontend correctness risk before the UI is reorganized.

**Repository confirmation:** This was a report-only audit. No repository files were changed, staged, deleted, or created by the audit.

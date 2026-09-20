# TB Gym — Pre-Design Runtime Verification

**Purpose.** Establish what is actually broken in the existing frontend *before* any redesign, so that
the new design system cannot silently absorb existing defects. This is a runtime verification pass,
not a design review.

**Method.** The application was driven in a real Chrome instance through Chrome DevTools, as one
coach/owner journey and one client journey, at 1440x900, 1366x768, 1024x768 and 390x844. Findings
below were reproduced in the browser unless a row says otherwise.

**Baseline.** [FRONTEND-UX-AUDIT.md](FRONTEND-UX-AUDIT.md), 19 Sep 2026. Every one of its seven P1
areas was re-tested and is marked open, fixed, or partly fixed.

**Verified.** 20 Sep 2026, on commit `6d92e70`, working tree clean.

**Fix pass.** 20 Sep 2026, commit `9f5db3f`. The three findings Section 4 names as blocking —
NEW-01, PAGE-01 and LOGIC-03 — are fixed and re-verified in the browser. Every other finding's
status below is unchanged and still open. Two further defects were uncovered *by* those fixes and
are recorded as NEW-05 and NEW-06.

---

## 1. Headline

At verification time, two of the audit's seven P1 areas were fixed, five were unchanged, and one new
P1 was found that the audit did not report — the most consequential defect in this document. The fix
pass has since closed that new P1 and the progress-page dates; the table below reflects the state
after it.

| # | Audit P1 area | Status |
|---|---|---|
| 1 | Coach shell navigation at 1440 and 1024 | **Open at 1024/1366.** 1440 no longer overflows, but has zero headroom |
| 2 | Mobile menu lifecycle at 390 | **Open.** Unchanged |
| 3 | Client nutrition route reachability | **Open.** Unchanged |
| 4 | Form validation on launch-critical forms | **Open.** Unchanged on auth/account/invitation forms |
| 5 | Progress page dates and empty-row volume | **Dates FIXED** (PAGE-01). Empty-row volume open |
| 6 | Coach client detail page composition | **Open.** Larger than at audit time |
| 7 | Tenant/workspace stale response ownership | **FIXED.** Verified under network throttling |
| 8 | Unsaved workout/editor draft protection | **Open.** Unchanged |

**New P1 (not in the audit): the coach's selected workspace does not survive a page refresh.**
See NEW-01 — **now fixed.**

---

## 2. Findings

Severity follows the audit's scale. `Regression status` compares against the 19 Sep 2026 audit.

### NEW-01 — Refreshing the page silently switches the coach's active workspace — **FIXED**

| | |
|---|---|
| **Severity** | was **P1 — new, not reported in the audit** |
| **Route** | Every authenticated route; visible wherever tenant-scoped data is shown |
| **Role** | Any user who is a member of two or more workspaces |
| **Regression status** | **Fixed in `9f5db3f`** and re-verified in the browser |

**Repro**

1. Sign in as a coach who belongs to two workspaces (A and B, where B sorts first from `/api/tenants`).
2. Choose workspace A in the "Active workspace" picker. `localStorage['tb-gym.active-tenant']` correctly
   holds A's id; the picker and page data show A.
3. Press F5, or open any TB Gym URL in a new tab.
4. The app comes back in workspace **B**. `localStorage` has been rewritten to B.

**Evidence.** Instrumenting `Storage.prototype` from an init script, across one reload:

```
[initial] tb-gym.active-tenant = 01a0be63-...  (workspace A)        t=226ms
[remove ] tb-gym.active-tenant                                      t=1231ms
          at TenantStore.clear -> AuthStore.loadSession -> authGuard
[set    ] tb-gym.active-tenant = 00000000-...b2 (workspace B)       t=1418ms
          at TenantStore.select -> TenantStore.load -> AuthStore.loadSession
```

**Cause.** [auth.store.ts:65](../src/web/src/app/core/auth/auth.store.ts#L65):

```ts
if (this.userState()?.id !== user.id) this.tenants.clear();
```

The guard is meant to detect "a different user has signed in". On a cold page load `this.userState()`
is `null`, so `undefined !== user.id` is **always true** and `clear()` always runs.
[tenant.store.ts:75](../src/web/src/app/core/tenancy/tenant.store.ts#L75) deletes the persisted
selection, so the `load()` that follows has no candidate and falls through to
`memberships[0]?.tenantId` ([tenant.store.ts:47](../src/web/src/app/core/tenancy/tenant.store.ts#L47)).

**Why it was not caught.** With a single membership, `memberships[0]` happens to be the right
workspace, so the bug is invisible. It only appears from the second workspace onwards.

**Impact.** A coach can believe they are working in one workspace and be writing into another after
any refresh, tab restore, or app relaunch. Deep links into the previous workspace then fail: the API
correctly returns 404 and the UI shows only "The client profile could not be loaded.", with no
indication that the workspace changed and no way to switch back from that screen.

> Note: server-side tenancy is not affected. The API correctly scoped and refused cross-tenant reads
> throughout (404 on the other workspace's client). This is a client-side persistence defect.

**Fix.** [auth.store.ts:66](../src/web/src/app/core/auth/auth.store.ts#L66) now clears the persisted
workspace only when a *previous, different* user was already loaded:

```ts
const previous = this.userState();
if (previous !== null && previous.id !== user.id) this.tenants.clear();
```

A cold load has no previous user, so the stored selection survives. The `clear()` in the `catch`
block is deliberately unchanged: clearing after a failed session load is correct.
`TenantStore.load` still discards a stored id the user no longer belongs to and falls back to
`memberships[0]`, so losing access to a workspace cannot strand the app in a null tenant.

**Regression tests.**
[tenant-selection-persistence.spec.ts](../src/web/src/app/core/tenancy/tenant-selection-persistence.spec.ts)
drives the real `AuthStore` and `TenantStore` over four cases: cold load with a stored membership
(preserved), cold load with a stored id that is no longer a membership (falls back to
`memberships[0]`), a different user id arriving (still clears), and a failed session load (still
clears). The first and third failed against the previous code.

**Browser re-verification.** Two workspaces, "Alpha Strength" (which `/api/tenants` returns first,
ordered by name) and "Verify Gym". Selected Verify Gym, then reloaded with `Storage.prototype`
instrumented as above:

```
[initial] tb-gym.active-tenant = 01a0bf32-... (Verify Gym)
[set    ] tb-gym.active-tenant = 01a0bf32-... (Verify Gym)   t=315ms
          no [remove] — the previous pass logged one here
```

`X-Tenant-Id` on every subsequent request, and the SignalR negotiate, both carried Verify Gym.
Confirmed identically in a second tab. Switching workspaces still works, and seeding a stored id
for a workspace with no membership fell back to "Alpha Strength" rather than a null tenant.

---

### RESP-01 — Coach topbar overflows the page below ~1426px

| | |
|---|---|
| **Severity** | P1 |
| **Route** | Authenticated coach shell, all routes |
| **Regression status** | **Partly fixed.** 1440 no longer overflows (audit: 1481px content at a 1440px viewport). 1024 is unchanged |

**Repro.** Sign in as coach/owner, set viewport width, measure `documentElement.scrollWidth` vs
`clientWidth`.

| Viewport | Content width | Overflow | "Sign out" button |
|---|---:|---:|---|
| 1440 | 1440 | 0px | visible, right edge at x=1426 |
| 1366 | 1426 | **75px** | clipped (x=1341–1426) |
| 1024 | 1426 | **417px** | entirely off-screen |

**Evidence.** `ev-02-coach-nav-overflow-1024.png`, `ev-10-workspace-picker-collapsed-1440.png`

**1440 is not actually safe.** It fits with **0px headroom**, and only by degrading:

- "Check-in forms" and "Client check-ins" wrap onto three lines each;
- the "Active workspace" label wraps onto two lines;
- with a realistic workspace name ("Beirut Strength & Conditioning"), the workspace `<select>`
  shrinks to **24px** — a bare chevron with no visible workspace name at all, at 1440px.

Adding one more coach nav link — for example the nutrition link that PAGE-03 says is missing — would
push the shell back into overflow at 1440.

**Cause.** `.topbar` is a non-wrapping flex row with no `min-width: 0` on its children
([app.scss:6](../src/web/src/app/app.scss#L6)), and the hamburger breakpoint is still
`max-width: 960px` ([app.scss:157](../src/web/src/app/app.scss#L157)). Between 961px and ~1426px there
is no compact navigation and no room for the full navigation.

---

### RESP-02 — Mobile menu stays open after navigation, and Escape does not close it

| | |
|---|---|
| **Severity** | P1 |
| **Route** | Coach shell and client shell at ≤960px |
| **Regression status** | **Open. Unchanged.** |

**Repro (390x844).**

1. Tap the hamburger. `aria-expanded="true"`, panel is 722px tall.
2. Press `Escape` → `aria-expanded` is still `"true"`; the panel is still `display: flex`.
3. Tap "Clients" in the open menu. The router navigates to `/clients` — and the menu is still open,
   covering the destination (`nav.bottom = 780` vs `main.top = 58`).

**Evidence.** `ev-07-mobile-menu-stuck-after-nav-390.png` — the screenshot is of `/clients`, and the
entire viewport is the menu.

Reproduced identically on the client shell (menu still open after navigating to `/notifications`).

**Cause.** `menuOpen` is only reset inside `selectTenant()` and `logout()`
([app.ts:34](../src/web/src/app/app.ts#L34), [app.ts:41](../src/web/src/app/app.ts#L41)). There is no
`NavigationEnd` subscription, no `Escape` handler, no outside-click handler, and no focus return to
the trigger.

---

### PAGE-03 — Client nutrition is entitled, working, and unreachable

| | |
|---|---|
| **Severity** | P1 |
| **Route** | `/nutrition/today` |
| **Regression status** | **Open. Unchanged.** |

**Repro.** With a client who has a paid, active enrollment that **includes nutrition**, and an
assigned immutable meal-plan snapshot:

1. Visit every reachable client route and enumerate every `href` on each.
2. No link on any client route points at `/nutrition/*`.

```
/                   -> /, /notifications, /account/security, /checkins/me, /messages,
                       /progress/dashboard, /me, /training/today, /progress
/checkins/me        -> (same, minus training)
/messages           -> (same)
/progress/dashboard -> (same)
/me                 -> (same) + /profile, /notifications/settings, /progress
/progress           -> (same)
```

3. Typing `/nutrition/today` directly loads a complete, working page: daily target 2,673 kcal,
   macro split, meal slots, "Save meal", "Complete nutrition day".

**Evidence.** `ev-09-nutrition-today-unreachable-390.png`

The client Today page names "Training day" and offers Check-ins, Messages, Log weight and View
progress under "Also today". Nutrition is never mentioned. The client is paying for a feature they
cannot reach.

---

### A11Y-01 — Launch-critical forms still fail invalid submission silently

| | |
|---|---|
| **Severity** | P1 |
| **Route** | `/auth/sign-in`, `/auth/register`, `/auth/forgot-password`, `/invitations`, `/products`, `/account/security` |
| **Regression status** | **Open. Unchanged.** |

**Repro.** Submit each form empty and inspect the DOM.

| Route | Form | Visible error | `aria-invalid` | `role=alert` / live region |
|---|---|---|---|---|
| `/auth/sign-in` | Sign in | none | none | none |
| `/auth/register` | Create coach account | none | none | none |
| `/auth/forgot-password` | Send reset link | none | none | none |
| `/invitations` | New client invitation | none | none | none |
| `/products` | Create product | none | none | none |
| `/account/security` | Change password | none | none | none |

In every case the form carries `ng-invalid ng-touched ng-submitted` and each required control carries
`ng-invalid` — the state exists, nothing renders it.

**Evidence.** `ev-01-register-empty-submit-1440.png`

**Important nuance for the redesign.** *Server* errors are announced correctly. Signing in with a
wrong password produces `role="alert"` → "Email or password is incorrect." So users only get feedback
once a request is actually sent; the purely client-side rejection is the silent one. Focus is not
moved to the message in either case (`document.activeElement` stays `BODY`).

**Forms that already do this correctly** — reuse these, do not reinvent:

- `/invite` (client account creation): `aria-invalid="true"`,
  `aria-describedby="invitation-password-help invitation-password-error"`, and an inline
  `role="alert"` reading "Use a password with at least 12 characters."
- `/checkins/clients` (assign a check-in): a grouped error summary — "This check-in cannot be
  assigned yet: Choose a published version to assign. Choose a due date."

---

### PAGE-01 — `/progress` renders corrupted dates and 83 empty rows — **DATES FIXED**

| | |
|---|---|
| **Severity** | P1 |
| **Route** | `/progress` (client), and the same component on `/clients/:clientId` |
| **Regression status** | **Corrupted dates fixed in `9f5db3f`.** The empty-row volume is unchanged and still open — it belongs to the redesign's page-decomposition work |

**Repro.** Sign in as a client with one bodyweight observation and open `/progress`.

| Measurement | This pass | Audit |
|---|---:|---:|
| Page height at 1440x900 | 7,429px | 7,423px |
| Page height at 390x844 | 10,570px (12.5 screens) | 10,633px |
| "No observation" rows | 83 | 84 |
| `<time>` elements with corrupted text | 84 of 84 | — |

**Evidence.** `ev-08-progress-broken-dates-390.png`

```
datetime="2026-06-29"  rendered "Sun, 0e28iu0DPMte"
datetime="2026-06-30"  rendered "Mon, 0e29iu0DPMte"
datetime="2026-07-02"  rendered "Wed, 0e1iu0DPMte"
```

**Cause.** [progress-view.html:100](../src/web/src/app/features/progress/progress-view.html#L100) still
uses `date: 'EEE, mediumDate'`. `mediumDate` is a named alias and cannot be embedded inside a custom
pattern; its letters are interpreted as pattern characters.

**A second cause, not seen in the previous pass.** The `'UTC'` third argument was also wrong, on all
nine date pipes in the file. `DatePipe` parses a bare `YYYY-MM-DD` as *local* midnight — deliberately,
to avoid an offset — so asking it to then format in UTC reintroduces exactly that offset and moves the
rendered day backwards for every zone east of UTC. Under `Asia/Beirut` (UTC+3):

```
'2026-06-29' | date: 'EEE, mediumDate' : 'UTC'  ->  "Sun, 0e28iu0DPMte"
'2026-06-29' | date: 'mediumDate'      : 'UTC'  ->  "Jun 28, 2026"     <- one day early
'2026-06-29' | date: 'EEE, MMM d, y'            ->  "Mon, Jun 29, 2026"
```

2026-06-29 is a **Monday**. The previous pass read the weekday from the corrupted output and the date
from the `datetime` attribute, so the off-by-one went unrecorded; its claim that the weekly summary
cards "render correctly" was also wrong — they were a day early too, which put every week card on a
Sunday in a workspace whose week starts on Monday.

**Fix.** Line 100 uses the pattern the alias expands to, and all nine pipes drop the `'UTC'`
argument. Parsing and formatting in the same frame is what keeps the rendered day equal to the
stored one. A file-level comment records why.

**Regression test.**
[progress-view.dates.spec.ts](../src/web/src/app/features/progress/progress-view.dates.spec.ts)
renders the component and asserts the `<time>` text against a known date, that no `<time>` still
carries the alias-as-pattern noise, and that the weekly card and trend window name the days they
actually cover. All three failed against the previous template.

**Browser re-verification.** Client `/progress` with three observations: 84 day rows, **0 corrupted**
(previous pass: 84 of 84), and **0 rows** whose rendered text disagrees with their `datetime`
attribute, checked independently in the page. Observations rendered "Tue, Sep 15, 2026",
"Thu, Sep 17, 2026", "Fri, Sep 18, 2026". Weekly cards now land on Mondays (Aug 24, Aug 31, Sep 7,
Sep 14) rather than the Sundays before them.

**Still open on this page:** the 83 empty "No observation" rows, and the internal identifier shown to
the client, "Estimate strategy BodyweightTrendEwma v2.0". The latter needs a copy decision, not a
code decision.

---

### PAGE-02 / PERF-01 — Coach client detail is still one page holding the whole product

| | |
|---|---|
| **Severity** | P1 |
| **Route** | `/clients/:clientId` |
| **Regression status** | **Open. Worse than at audit time** (more data now present) |

**Repro.** Open a client with an active enrollment, an assigned mesocycle and an assigned meal plan.

| Measurement | This pass | Audit |
|---|---:|---:|
| Page height at 1440x900 | 12,978px → 13,636px once loaded | 13,222px |
| Page height at 390x844 | **21,097px (25 screens)** | 19,792px |
| `h2` sections | 14 | 14 |
| Forms | 8 | 7 |
| Inputs | 72 | — |
| API calls on one load | **23** | 22 |
| Duplicate `GET /api/commercial/clients/{id}` | **3** | 3 |

**Evidence.** `ev-05-client-detail-megapage-1440-full.jpeg`

Sections, in order: Training assignment · Strength max history · Client mesocycles · Exercise
performance history · Progress dashboard · Client weight trend · Client measurements · Service and
access · Assign a service · Enrollment history · Nutrition and meal planning · Client intake ·
Coach-only notes.

The triple commercial request is byte-identical, back to back, on every load (reqids 639, 650, 653 in
one capture). Nothing about this finding has moved.

---

### LOGIC-02 — Unsaved work is still discarded silently, on navigation and on refresh

| | |
|---|---|
| **Severity** | P1 |
| **Route** | `/training/today` (client), `/training/programs` (coach) |
| **Regression status** | **Open. Unchanged.** |

**Repro A — workout execution, navigate away.**

1. `/training/today`, tap "Start workout".
2. Enter Load `100`, Unit `kg`, Reps `5`, RPE `8`. Do **not** tap "Log set".
3. Tap the "Progress" tab in the client navigation.
4. No dialog, no guard. Navigation completes.
5. Browser Back → all four fields are empty.

**Repro B — workout execution, refresh.**

1. Re-enter Load `105`, Reps `5`, RPE `8.5`.
2. Press F5. No `beforeunload` prompt; the values are gone.
3. `localStorage` holds only `tb-gym.active-tenant`; `sessionStorage` is empty. Nothing was persisted.

**Repro C — program builder, navigate away.**

1. `/training/programs`, type a Program name and Description into the open editor.
2. Click "Clients" in the nav. No dialog. Browser Back → both fields empty.

Dispatching a cancelable `beforeunload` event returns `false` on both routes, confirming no handler is
registered.

**Partial mitigation that exists.** The workout page displays "Unsaved entries stay on this page only.
Save before closing or refreshing." That is honest, but it is a caption, not protection.

**Contrast — this one is done right.** "Finish workout" *does* confirm: "Finish workout? 1 of 1 sets
logged. You can't change this workout afterwards. [Confirm finish] [Keep training]". That is the
pattern the editors need.

---

### LOGIC-01 — Tenant-scoped stale responses — **FIXED**

| | |
|---|---|
| **Severity** | was P1 |
| **Regression status** | **Fixed and verified.** |

`TenantAsyncScope` ([tenant-async-scope.ts](../src/web/src/app/core/tenancy/tenant-async-scope.ts))
now provides per-lane generation/epoch ownership, and all 25 tenant-scoped feature components use
`scope.run(...)`.

**Browser verification.** Network throttled to Slow 3G, switching between a workspace with 1 client
and a workspace with 0 clients while the first load was still in flight, at three different race
timings:

| Switch delay | Final workspace | Client count shown |
|---:|---|---:|
| 600ms | Second Gym | 0 |
| 1,200ms | Second Gym | 0 |
| 2,000ms | Second Gym | 0 |

The in-flight response from the previous workspace never landed. This was the audit's recommended
Task 1 and it is complete.

> Caveat: this fixes *stale responses*. It does not fix *which workspace you are in* — see NEW-01.

---

### LOGIC-03 — Training date defaults use the browser's UTC date — **FIXED**

| | |
|---|---|
| **Severity** | P2 |
| **Route** | `/clients/:clientId` — training assignment, strength maxes, commercial and intake; `/profile` — client intake |
| **Regression status** | **Fixed in `9f5db3f`** and re-verified in the browser |

**Repro.** Workspace time zone Asia/Beirut. Clock pinned to `2026-09-20T22:00:00Z`, which is
**01:00 on 21 September** in Beirut. Open a client and read the date-input defaults:

| Control | Default | Correct tenant date | |
|---|---|---|---|
| Training assignment "Start date" | `2026-09-20` | `2026-09-21` | **wrong** |
| Progression "Effective date" | `2026-09-20` | `2026-09-21` | **wrong** |
| Mesocycle "Start" | `2026-09-20` | `2026-09-21` | **wrong** |
| Commercial "Start date" | `2026-09-21` | `2026-09-21` | correct |

Two sections of the *same page* disagree about what day it is.

**Cause.** [client-training.ts:81](../src/web/src/app/features/training/client-training.ts#L81),
`:91`, `:680`, `:685` use `new Date().toISOString().slice(0, 10)` — the browser's UTC calendar date.
`client-commercial.ts:427` and `client-intake-form.ts:166` subtract the local offset first, which is
why they are right here; neither derives the date from the tenant's time zone.

**Fix.** One shared source,
[`WorkspaceCalendar`](../src/web/src/app/core/tenancy/workspace-calendar.ts), reads `currentDate`
from `GET /api/workspace` — the tenant's calendar date, resolved server-side — and caches it per
active workspace, keyed on the tenant id and `TenantContext`'s epoch so a workspace change drops it.
Concurrent callers share one request. All six sites were migrated onto it and the local date
arithmetic deleted; `adultCutoff()` (the 18-years-ago bound on date of birth) was moved onto it too,
so every date bound in those files has one source.

`currentDate` is a snapshot taken at request time, so it goes stale if the app sits open across
midnight. That is accepted for form defaults and recorded in the class comment; nothing subscribes or
polls. When the workspace cannot be read the calendar falls back to the browser's *local* calendar
date, which is what these defaults used before — never worse than it was, and never a blank required
field.

`GET /api/workspace` requires `AuthorizationPolicies.TenantMember`, which includes `Client`, so no
server authorization was widened. Confirmed in the browser: a Client-role user on `/profile` gets
`200`.

Out of scope and unchanged: `dateTimeLocalInput()` in `client-commercial.ts`, which stamps the
wall-clock instant a manual payment was received rather than a calendar date.

**Regression tests.**
[workspace-calendar.spec.ts](../src/web/src/app/core/tenancy/workspace-calendar.spec.ts) covers the
service (workspace date wins over the browser, one shared request, cache dropped on workspace change,
fallback on failure).
[workspace-date-defaults.spec.ts](../src/web/src/app/features/workspace-date-defaults.spec.ts) pins
the clock to `2026-09-20T22:00:00Z` and asserts every default through its *rendered* control. It runs
against two workspace dates: `2026-09-21` (the Asia/Beirut repro) and `2026-09-23`, which no browser
anywhere can produce at that instant — so a default that merely computes locally and happens to agree
still fails. Nine assertions, all failing against the previous code, and green under `TZ` set to
`UTC`, `America/Los_Angeles`, `Asia/Beirut` and `Pacific/Kiritimati`.

**Browser re-verification.** Rather than faking a clock, the workspace time zone was moved to
`Pacific/Kiritimati` (UTC+14), which put the workspace on 2026-09-21 while the browser was on
2026-09-20 in both local and UTC terms. Every date default on `/clients/:clientId`:

| Control | Section | Default | Workspace date |
|---|---|---|---|
| Start date | Training assignment | `2026-09-21` | `2026-09-21` |
| Effective date | Strength max history | `2026-09-21` | `2026-09-21` |
| Start date | Assign a service | `2026-09-21` | `2026-09-21` |
| Measurement date | Client intake | `2026-09-21` | `2026-09-21` |
| Date of birth (`max`) | Client intake | `2008-09-21` | 18 years back |

Moving the workspace back to `Asia/Beirut` and reloading moved every one of them to `2026-09-20`,
so the value tracks the server rather than being frozen. The whole page made **one**
`GET /api/workspace`, shared across the training, commercial and intake components.

---

### STATE-01 — Expected authorization states render as generic failures

| | |
|---|---|
| **Severity** | P2 |
| **Regression status** | **Open. Unchanged, with a new instance.** |

| Situation | What the UI says | Problem |
|---|---|---|
| Coach opens a client with no nutrition entitlement (`403`) | "Client nutrition could not be loaded." | Reads as a bug, not as "not entitled" |
| Coach opens a client from another workspace (`404`) | "The client profile could not be loaded." | Does not say the workspace is wrong; no recovery path on the page |
| **Client whose relationship is blocked opens `/nutrition/today`** | **"No authorized nutrition plan was found for this date."** | **False.** The plan exists and is authorized; access was paused. The client is told they have no plan |

The third row is new. The same block is described correctly everywhere else:

- `/` and `/training/today`: "Training is not available — Your coach has paused your access."
- `/checkins/me`: "Your coach has paused your access to this workspace, so check-ins are closed."
- `/messages`: conversation marked "UNAVAILABLE"

Only nutrition conflates "blocked" with "nothing assigned".

---

### A11Y-02 — Route headings, focus, scroll and current-page state

| | |
|---|---|
| **Severity** | P2 |
| **Regression status** | **Open. Unchanged.** |

**Missing `h1`.** Swept all 20 reachable routes.

| Has `h1` | No `h1` at all |
|---|---|
| `/`, `/clients`, `/clients/:id`, `/training/programs`, `/training/exercises`, `/products`, `/invitations`, `/workspace`, `/account/security`, `/nutrition/library`, `/nutrition/today`, `/me`, `/training/today` | `/checkins/forms`, `/checkins/clients`, `/messages`, `/notifications`, `/notifications/settings`, `/progress`, `/progress/dashboard`, `/checkins/me` |

Eight routes have no `h1`. Each of them uses an `h2` as its visible page title.

**Focus after route change.** `document.activeElement` is `BODY` after **every** one of the 20
navigations, on both shells. `<main>` has no `tabindex`, and there is no skip link anywhere in the
application.

**Scroll.** [app.config.ts:11](../src/web/src/app/app.config.ts#L11) is still plain
`provideRouter(routes)`, with no `withInMemoryScrolling`.

- Forward: scrolled to 2,500px on the 13,636px client page, clicked "Exercises" → landed at
  `scrollY = 124`, that page's maximum. The user arrives at the bottom of the new route.
- Back: scrolled to 3,000px on the client page, navigated away, pressed Back → `scrollY = 0`. On a
  13,000px page, the coach's place is lost every time.

**Current page.** Coach nav links have no `aria-current` (client tabs correctly use
`ariaCurrentWhenActive="page"`). The `.active` background and the `:hover` background are the same
colour, `rgb(241, 243, 244)`, so the current page is visually ambiguous too.

**This one passes.** Focus indicators are present and strong everywhere tested: `outline: 2.4px solid
rgb(28, 27, 25)` on all nav links, buttons and inputs sampled.

---

### A11Y-03 — Controls without individual accessible names

| | |
|---|---|
| **Severity** | P2 |
| **Route** | `/products`, `/checkins/forms` |
| **Regression status** | **Open. Unchanged, plus a new instance.** |

Accessibility tree on `/products`:

```
spinbutton "Duration Weeks"   <- duration count
combobox   (no name)          <- duration unit     A11Y-03
StaticText "Price"
spinbutton "Price USD"        <- price amount
textbox    (no name)          <- currency code     A11Y-03
```

One wrapping `<label>` covers two controls in each pair, so neither is individually named.

**New instance.** On `/checkins/forms`, the question-type `<select>` (ShortText / LongText /
SingleChoice / MultipleChoice / NumericScale) has **no** wrapping label, `aria-label`, or `id`.

Chrome's issues panel reports **40 instances** of "A form field element should have an id or name
attribute" on the coach shell — the same root cause.

---

### SAFE-01 — Destructive actions use four different confirmation patterns

| | |
|---|---|
| **Severity** | P2 (raised from P3; "Sign out everywhere" is more consequential than the audit's examples) |
| **Regression status** | **Open. Unchanged.** |

| Action | Confirmation | Reversible |
|---|---|---|
| Invitation → "Revoke" | **none** — one click, immediately revoked | no |
| Check-in version → "Publish" | **none** — despite the page's own caption "Publishing freezes a version permanently" | no |
| Account → "Sign out everywhere" | **none** — [account-security.html:48](../src/web/src/app/features/account/account-security.html#L48) calls `revokeSessions()` directly | no |
| Client relationship → "Block access" | toggle → reason field → "Confirm block" | yes (Unblock) |
| Enrollment → "Cancel" | reason required | no |
| Workout → "Finish workout" | typed confirmation panel with a consequence sentence | no |

Users cannot predict which actions are safe to click.

---

### PAGE-04 — Authoring pages still expose implementation detail

| | |
|---|---|
| **Severity** | P2 |
| **Regression status** | **Open. Unchanged.** |

- `/nutrition/library` still renders a visible **"PHASE 4"** eyebrow above the page title.
  `ev-06-nutrition-library-phase4-eyebrow-1440.jpeg`
- Raw enum identifiers are shown to users as labels: `CoachAuthored`, `AsSold`, `ShortText`,
  `NumericScale`, `GlutenCereals`, `TreeNuts`, `SulphurDioxideAndSulphites`, `Bodyweight 80 Kilogram`.
- The empty-state editor still opens automatically, so `/products` and `/training/programs` show a
  "New …" button and a "Close" button simultaneously over an empty list.
  `ev-04-program-builder-empty-1440.png`
- Pluralisation is broken throughout: **"1 weeks"**, "1 exercises", "1 servings", "1 days", "1 slots",
  "1 conversations", "1 observed days", "80 from 1 days", "1 unread messages", "Showing 1 of 1
  check-ins". The client-facing Today page says "1 exercises".
- The nutrition enrollment `<select>` lists a raw GUID as its option label —
  [client-nutrition.html:206](../src/web/src/app/features/nutrition/client-nutrition.html#L206) binds
  `{{ id }}`. The training enrollment select on the same page correctly reads "Full Coaching /
  8-week block (2026-09-20 - 2026-11-14)".

The glyph buttons (`↑ ↓ ⧉ ×`) the audit criticised **do** carry correct `aria-label` and `title`
attributes and are 32x32 — above the WCAG 2.2 minimum of 24px, below the 44px enhanced target. That
is a legibility problem, not an accessibility failure.

---

### NEW-02 — "Add meal slot" does nothing and says nothing

| | |
|---|---|
| **Severity** | P2 — new |
| **Route** | `/nutrition/library` |
| **Regression status** | New |

**Repro.** With no *published* recipe in the workspace:

1. Fill in a meal-plan name.
2. Click "Add meal slot". The button is enabled. Nothing happens — no slot, no message, no request.
3. "Create plan draft" stays disabled, with no explanation (`aria-describedby` and `title` are both
   absent; it is only dimmed to `opacity: 0.58`).

The coach has no way to learn that a published recipe is the missing precondition.

**Cause.** [nutrition-library.ts:275](../src/web/src/app/features/nutrition/nutrition-library.ts#L275):

```ts
protected addMealSlot(): void {
  const recipe = this.recipes().find((item) => item.status === 'Published');
  if (!recipe) return;   // silent
  ...
}
```

Publishing a recipe first makes both controls work correctly, confirming the only defect is the
missing precondition feedback.

---

### NEW-03 — Raw UTC instant rendered to the coach

| | |
|---|---|
| **Severity** | P3 — new |
| **Route** | `/clients/:clientId` → Client mesocycles → lifecycle history |
| **Regression status** | New |

Rendered verbatim in the DOM:

```
Assigned 2026-09-20T10:43:38.637641+00:00 · Assigned from a published program template.
```

Directly above it the same card reads "2026-09-20 - 2026-09-27 · Asia/Beirut", so a
microsecond-precision UTC instant sits under a tenant-time label.

**Cause.** [client-training.html:286](../src/web/src/app/features/training/client-training.html#L286)
interpolates `{{ event.occurredAtUtc }}` with no `DatePipe`.

---

### NEW-04 — Inconsistent date formats within one view

| | |
|---|---|
| **Severity** | P3 — new (extends I18N-01) |
| **Route** | `/messages` |

The conversation list renders `9/20/26, 1:59 PM` (US `M/D/YY`) while the message thread beside it
renders `Sep 20, 2026, 1:59:44 PM`, in an `en-LB` workspace. Elsewhere the app uses `Sep 27, 2026`.
Three formats are in use.

---

### NEW-05 — The workspace picker named the first workspace whatever was active — **FIXED**

| | |
|---|---|
| **Severity** | P1 — new, found while fixing NEW-01 |
| **Route** | Authenticated coach shell, all routes |
| **Regression status** | **Fixed in `9f5db3f`** |

Uncovered by the NEW-01 fix, not caused by it. [app.html:79](../src/web/src/app/app.html#L79) bound
`value` on the `<select>` while the `<option>`s came from an `@for` *inside* it. Angular sets the
select's `value` before those options exist, and the browser resets `selectedIndex` to 0 when they
arrive — so the picker always named `memberships[0]`.

This was invisible for as long as NEW-01 existed, because the store also always ended up on
`memberships[0]`: the wrong label and the wrong workspace agreed. Fixing NEW-01 left the coach in the
right workspace and told them they were in the wrong one — `X-Tenant-Id`, the SignalR negotiate and
the page data all said "Verify Gym" while the picker said "Alpha Strength".

**Fix.** `selected` is bound per `<option>` instead, which is applied after that option exists and so
survives the `@for`.

**Why no test caught it.** [app.spec.ts](../src/web/src/app/app.spec.ts) only ever rendered a single
membership, for which option 0 is the right answer by accident. The spec now also renders two
workspaces with the *second* one active; that case failed against the previous template.

---

### NEW-06 — Calendar dates rendered a day early east of UTC — **FIXED**

| | |
|---|---|
| **Severity** | P1 — new, found while fixing PAGE-01 |
| **Route** | `/progress`, and the same component on `/clients/:clientId` |
| **Regression status** | **Fixed in `9f5db3f`** |

All nine `date:` pipes in `progress-view.html` passed `'UTC'` as the third argument on a bare
`YYYY-MM-DD`. `DatePipe` parses such a value as local midnight, so the `'UTC'` argument reintroduces
the offset it looks like it is avoiding, and the rendered day falls one behind the stored one for
every zone east of UTC — including the product's own `Asia/Beirut` market. See PAGE-01 for the
detail; fixed in the same change.

The previous pass recorded the weekly summary cards as rendering correctly. They did not: they were a
day early, which put every week card on a Sunday in a workspace whose week starts on Monday.

**Worth carrying into the redesign.** This is a whole class of defect, not one file. Any new date
control that formats a `DateOnly` value must not pass a time zone to `DatePipe`.

---

### Observations that are not defects

Recording these so the redesign does not "fix" something that is already correct.

- **Server-side tenancy holds.** Every cross-tenant read attempted during this pass was refused by
  the API (404 on another workspace's client). No frontend path was found that obtained data the
  backend should have withheld.
- **Focus indicators** are present and strong on every control sampled.
- **Console is otherwise clean.** Across both full journeys the only console output was the 40
  "form field element should have an id or name attribute" issues and Angular's dev-mode
  `NG0751` HMR notice. No uncaught exceptions, no framework errors.
- **`/auth/confirm-email` with a valid token works** — the audit could only test the invalid-token
  state. Registration returns a `DevelopmentActionUrl`, the link confirms the account, and sign-in
  then succeeds.
- **Messaging works end to end.** "Message Casey" on the client page opens the conversation, the
  message sends, and the client sees it with a correct unread badge over SignalR.
- **The commercial lifecycle behaves as documented.** Product → offer → enrollment ("Pending payment")
  → exact-amount manual receipt → "Active" with the five entitlements resolving. Partial access was
  correctly withheld until the full 400 USD was recorded.
- **The blocked-relationship state is scoped correctly** and is well explained on training, check-ins
  and messaging (see STATE-01 for the nutrition exception).
- **"Unblock" works.** An earlier suspicion that it was inert was wrong: it is a disclosure toggle,
  and "Confirm unblock" performs the action and restores access.

---

## 3. What could not be tested, and why

| Not tested | Why |
|---|---|
| `/auth/reset-password` with a **valid** token | By design, password recovery never dispatches inline in any environment and no token is persisted ([AccountActionMailService.cs:118](../src/backend/TB.Gym.Infrastructure/Application/AccountActionMailService.cs#L118)). Without a mail provider a valid reset token cannot be obtained. The audit's limitation stands. Only the missing/invalid-token state was seen |
| Real email delivery, webhooks, suppression, provider events | `Notifications:Email:Enabled=false`, adapter `None`. The captured-transport path was exercised instead |
| Screen-reader behaviour | No screen reader available. Accessibility findings come from the Chrome accessibility tree and DOM attributes, which is weaker evidence than a real NVDA/VoiceOver pass |
| Real mobile hardware and touch | 390x844 was emulated with `mobile,touch`. Tap ergonomics, soft-keyboard behaviour and momentum scrolling were not verified on a device |
| Library scale limits (LOGIC-04) | Confirmed only at source — `exercises` is still fixed at `skip=0&take=200` and nutrition lists at `take=100`, with no load-more in the affected views. Producing >200 exercises through the UI was not economical. Not reproduced in the browser |
| RTL / Arabic (I18N-01) | `ar-LB` is offered in workspace settings but no Arabic bundle is built; switching it was out of scope for a pre-design pass |
| Lighthouse / bundle budgets | Deliberately skipped. Performance scores taken before a redesign would not be a meaningful baseline for it, and the audit's bundle figures still hold |
| Photos, media upload, virus scanning | `Media:ScannerAdapter=Development`. Private-media authorization and the grant-cookie path were not exercised |
| Multi-workspace behaviour *through the product* | No UI exists to add a second membership. The second workspace for NEW-01 and LOGIC-01 was inserted directly into the throwaway database (`tenancy.Tenants` + `tenancy.Memberships`). The defect is in product code and is not an artefact of that insert, but the *path* to a second membership was synthetic |
| Concurrency and optimistic-concurrency conflict UI | Single-operator session; no concurrent editor to collide with |
| `./scripts/check.ps1` | Not run *in the verification pass*, which changed no product code. In the fix pass it aborts on this machine at its `docker info` probe ([check.ps1:70](../scripts/check.ps1#L70)): Docker Desktop is installed but not running, and under `$ErrorActionPreference = 'Stop'` PowerShell treats the native command's stderr as terminating, so the script exits before `dotnet restore`. The steps it runs were executed directly instead — see the Appendix |

---

## 4. Verdict — is it safe to start the redesign?

**Originally: yes for the shell and the design system, no for three things that must be fixed first,
because a redesign will hide them rather than reveal them. Those three are now fixed, so the answer
is yes.**

### Fix before the redesign starts — **DONE** (`9f5db3f`)

1. **NEW-01 — workspace selection lost on refresh.** One-line cause, high blast radius, and it is a
   *correctness* bug about which tenant's data a coach is editing. A new shell will not surface it;
   it will make it harder to notice, because the workspace picker is already unreadable at 1440
   (RESP-01) and will be redrawn. **Fixed.**
2. **PAGE-01 — `/progress` date formatting.** A one-token template fix. Leaving it means the new
   design ships a health page that renders `Sun, 0e28iu0DPMte` on day one. **Fixed** — and it was
   two defects, not one; see NEW-06.
3. **LOGIC-03 — tenant calendar dates.** Any new date control inherits the wrong default. Fixing the
   source of "today" once, before the controls are rebuilt, is much cheaper than after. **Fixed**,
   with `WorkspaceCalendar` as that single source.

These three were small, bounded, and required no visual decisions. Two further defects surfaced
while fixing them — NEW-05 and NEW-06 — and were fixed in the same change, because each one made the
fix it sat behind unverifiable. Both had been masked: NEW-05 agreed with NEW-01's wrong answer, and
NEW-06 was read as part of PAGE-01's corrupted output.

**The redesign can now start.** Everything remaining in this document is the shell and standards work
described below.

### Safe to fold into the redesign

- **RESP-01, RESP-02, A11Y-02, PAGE-03** are all shell problems. The audit's Task 3 (replace the
  authenticated shell) fixes overflow, menu lifecycle, route focus, scroll restoration, `h1`
  ownership, `aria-current` and nutrition discoverability together. Do not patch them separately.
- **A11Y-01, A11Y-03, SAFE-01** are the form/action standard. Build the accessible field, error
  summary and confirmation tiers as primitives (audit Tasks 2 and 4), then migrate. Two good
  implementations already exist to copy — `/invite` and `/checkins/clients`.
- **PAGE-02, PERF-01, LOGIC-02, PAGE-04, STATE-01, NEW-02, NEW-03, NEW-04** follow from page
  decomposition and shared state semantics (audit Tasks 4–8).

### One condition

Add the browser-level regression tests (audit Task 9) **as the shell lands, not after**. Every P1 in
this document survived a 473-test Vitest suite. A component test cannot see a 417px overflow, a menu
that stays open, focus parked on `BODY`, `0e28iu0DPMte`, or a workspace id being rewritten during
bootstrap. Without that layer, this same document will be writeable again after the redesign.

### Do not

- Do not treat "the audit is 90% still true" as a reason to redesign faster. Two of its seven P1 areas
  were fixed in a month, and the fix for LOGIC-01 (`TenantAsyncScope`) is genuinely good work. The
  remaining five are unfixed because they are *shell and standards* problems, which is exactly what
  the redesign is for.
- Do not start Phase 4 work. Nothing here requires it.

---

## Appendix A — fix-pass environment

| | |
|---|---|
| Commit | `9f5db3f` |
| Database | Throwaway `tbgym_fixverify` on native PostgreSQL 18 at `127.0.0.1:5432`, created by `MigrateAsync`, dropped afterwards. (The `5433` in `.env` is the Docker Compose PostgreSQL, which was not running) |
| API | `http://127.0.0.1:5211`, Development, `Database__ApplyMigrationsOnStartup=true`, `Seed__Enabled=false` |
| Web | `ng serve --host 127.0.0.1 --port 4260` with a scratch proxy targeting 5211, removed afterwards |
| `Application__PublicBaseUrl` | `http://127.0.0.1:4260` — identical to the driven origin |
| Browser | Chrome via Chrome DevTools MCP. Coach in one browser process throughout; the client in an isolated browser context, so both sessions stayed live |
| Test data | Coach `coach@verify.local` (owner of "Verify Gym"); client `casey@verify.local` with three bodyweight observations; one product/offer. "Alpha Strength" and its membership were inserted by SQL, as before — still no UI creates a second workspace |
| Time-zone method | No clock faking. The workspace was moved to `Pacific/Kiritimati` (UTC+14) to put it on a different calendar day from the browser, then moved back |
| Frontend verification | `npm test` (523 tests, 51 files) green under `TZ` set to `UTC`, `America/Los_Angeles`, `Asia/Beirut` and `Pacific/Kiritimati`; `npm run lint` clean; `npm run build` succeeds with lazy chunks intact; `git diff --check` clean |
| Backend verification | `dotnet build -c Release` clean (0 warnings, 0 errors); domain tests 307/307 and architecture tests 48/48 pass. The API integration suite was **not run to completion** — it was still running when the run was stopped, so it is unverified here. This change touches no backend file |
| `npm run format:check` | Fails on 13 files — **down from 15 at `6d92e70`**. All pre-existing (including `angular.json` and files this change never touched); no file was added to the list. Not fixed here: reformatting them is a large diff unrelated to these three findings |

---

## Appendix B — verification environment (original pass)

| | |
|---|---|
| Commit | `6d92e70`, working tree clean at start and end except this file |
| API | `http://127.0.0.1:5211`, Development, `Database__ApplyMigrationsOnStartup=true`, `Seed__Enabled=false` |
| Database | Throwaway `tbgym_predesign_verify` on native PostgreSQL 18 at `127.0.0.1:5432`, created by `MigrateAsync` |
| Web | `ng serve --host 127.0.0.1 --port 4260` with a scratch proxy config targeting 5211 |
| `Application__PublicBaseUrl` | `http://127.0.0.1:4260` — identical to the driven origin, so minted links stay in one cookie jar |
| Browser | Chrome via Chrome DevTools MCP. Coach and client each ran in one browser process for the whole journey; the client used an isolated browser context so both sessions stayed live |
| Viewports | 1440x900, 1366x768, 1024x768, 390x844 (`mobile,touch`) |
| Toolchain | `.tools/node` v24.19.0, `.tools/dotnet` 10.0.400 via `scripts/Toolchain.ps1` |
| Test data | Coach `coach@verify.local` (owner of "Verify Gym", renamed mid-pass to "Beirut Strength & Conditioning" for RESP-01); client `casey@verify.local`; one product/offer, one paid enrollment, two exercises, one published program template, one assigned mesocycle, one completed workout, one published meal plan, one assigned nutrition snapshot, one published check-in form and assignment, one conversation. "Second Gym" and its membership were inserted by SQL |
| Screenshots | `.tools/pre-design-verification/` (git-ignored, machine-local — this pass deliberately committed no binaries) |
| Product code changed | **None.** No product file was edited to make any test pass |

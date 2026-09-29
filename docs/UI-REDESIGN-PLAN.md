# TB Gym — UI/UX Redesign Plan

Status: **the only UI/UX plan.** Adopted 2026-09-28. It replaces `docs/FRONTEND-UX-AUDIT.md`,
`docs/PRE-DESIGN-VERIFICATION.md`, the Figma-driven redesign slices and every earlier frontend plan.
Those documents are deleted, and git history keeps them. If another document disagrees with this
one about how the product should look or behave on screen, this one wins.

What does **not** change: the backend, the database, security, tenancy, money rules and their tests.
`AGENTS.md` still applies to anything that touches data. This plan changes what people see and
touch.

---

## 0. How to use this plan: one line per chat

The owner starts every build chat with:

> Read docs/UI-REDESIGN-PLAN.md and do the next step.

What the chat does:

1. **Find the next step.** It is the first row below whose status is not **Done**. If that row is
   **Built, not committed**, ask the owner whether to commit it first.
2. **Stop at gates.** A 🚦 row needs the owner (and, where it says so, the partner). Ask, and don't
   skip ahead.
3. **Plan first** (see `AGENTS.md`, "How we work"). State in a few lines what you will build for this
   step and what you won't, then build. Read the sections the row points to; you don't need the
   whole plan.
4. **Stay inside the step.** Anything else goes in the follow-ups list at the end of this section.
5. **Finish properly.**
   - Meet the definition of done (§2).
   - Change the row's status to **Built, not committed** (or **Done · date · commit** once
     committed).
   - Add any follow-ups.
   - Report plainly, and include the 390 px and 1440 px screenshots so the owner can judge the look.
   - Commit only when the owner says so, with no co-author line.
6. **Too big for one session?** Split the row (for example R2.2a and R2.2b), finish the first part,
   and leave the rest as the next step.

The clickable prototype that R1 and R2 match is committed at
[`docs/design/prototype/tb-gym-prototype.html`](design/prototype/tb-gym-prototype.html) (open it in a
browser). The live copy is at https://claude.ai/artifact/RHKaDiQAVU8FBJBBTQMyn4.

### Status

| Step | What (sections) | Done when | Status |
| --- | --- | --- | --- |
| R0.1 | **Demo workspace generator** (§7). Development-only CLI next to `platform-admin grant`. Running it on production for sales demos is a later owner decision | One command fills an empty dev database with "Atlas Performance". Coach Today, Clients and client Today look real in screenshots | Done · 2026-09-29 · efbaaa0 |
| R0.2 | **Words pass** (§6). Text only, on the existing screens | No system word from §6 is left in visible template text; tests are updated | Done · 2026-09-29 |
| R1.1 | **Brand v2 tokens, theme-ready** (§3, §3.1). Brand, accent and light/dark as custom properties; legacy aliases kept for now | Lab and shells render in all 4 prototype brands, in light and dark, at AA contrast | Done · 2026-09-29 · a728fa8 |
| R1.2 | **Component kit v2 core** (§4): Card, StatTile, Avatar/Stack, StatusPill, Buttons, Sheet, Dialog, Toast, EmptyState, Skeleton, ProgressRing, Sparkline, SegmentedControl, Tabs | All of them are in the UI lab, pass axe, and work in RTL and dark | Built, not committed |
| R1.3 | **Three hero screens in the lab** on demo data: Coach Today, Client Today, Workout player, matching the prototype (GSAP moments included) | Side-by-side screenshots against the prototype at 390 and 1440 px | To do |
| R1.4 | 🚦 **Owner and partner approve the look** | The owner says go | Gate |
| R2.1 | **Client Today** (M1) for real, plus the personal light/dark setting (§3.1) | §2 definition of done | To do |
| R2.2 | **Workout player** (M2), with backend pre-fill from last time, the versioned PR rule and the finish summary | §2, plus backend tests | To do |
| R2.3 | **Progress** (M5) and the chart components | §2 | To do |
| R2.4 | **Nutrition day** (M4) and **Check-in** (M6) | §2 | To do |
| R2.5 | **Messages** (M7, shared chat), **Training** (M3), **Me** (M8), installable app | §2 | To do |
| R3.1 | **Backend reads:** attention and activity, and the client-list projection (§5 C1–C2) | Integration tests, including wrong-tenant and other-coach cases | To do |
| R3.2 | **Coach Today** (C1) | §2 | To do |
| R3.3 | **Clients** (C2) and the **client profile** overview and progress (C3) | §2 | To do |
| R3.4 | **Client profile** training timeline and Service & access (C3) | §2 | To do |
| R3.5 | **Coach Messages** (C6) and **coach brand settings** (§3.1), with backend setting and logo | §2, plus backend tests | To do |
| R3.6 | 🚦 **Demo to the founding coaches** (the owner's step) | The owner reports back | Gate |
| R4.1 | **Program builder** (C4), part 1: library panel, week grid, drag and drop | §2 | To do |
| R4.2 | **Program builder**, part 2: inline editing, autosave, unsaved-changes guard, publish preview | §2 | To do |
| R4.3 | **Check-in review** (C5) | §2 | To do |
| R4.4 | **Nutrition library and meal-plan builder** (C7) | §2 | To do |
| R5.1 | **Products** (C8), **Exercise library** (C10), notifications | §2 | To do |
| R5.2 | **Settings, Team, Billing** (C9) and the platform admin screen | §2 | To do |
| R5.3 | **Delete legacy CSS**, add the lint check, final words pass, close every §9 item | No legacy variables, no default buttons, §9 empty | To do |
| R6.1 | **Share cards** (M9), created only by the client, with consent each time | §2 | Optional |
| R6.2 | **Homepage** pre-render, GSAP scroll story, Jitter hero video (the owner makes the assets) | §2 | Optional |

**Feedback to apply:** the owner approved the prototype direction on 2026-09-28. The partner's
feedback is pending. Apply it to the prototype before R1.3.

### Follow-ups

*(Sessions add items here instead of building them.)*

- **Demo data gaps (from R0.1).** The demo has no meal plans (needed before R2.4), no progress photos
  or coach/exercise media (needed for R1.3 avatars and workout covers: use licensed images, never
  AI-made people), and no former client. Add each when the screen that shows it is built.
- **Demo freshness.** Dates are relative to the day the command runs, so the data ages. Rebuild it
  (drop the development database, run `.\scripts\demo-workspace.ps1`) before every screenshot review
  or demo.
- **Demo billing.** The demo workspace is backdated past its trial. If the Worker runs against the
  demo database it will invoice Atlas, and the workspace turns read-only after the grace days unless
  the platform admin records the payment.
- **Backend words (from R0.2).** Text written by the API still uses system words: notification
  titles and bodies ("Open your workspace…", `NotificationTemplates.cs`), stored history reasons
  ("Assigned from a published program template."), emails and problem messages such as the
  training-coverage refusal. They need a backend words pass with its own tests.
- **Assign program lists every version (from R0.2).** The coach's program picker shows each
  published version ("Full Body Reset · v1"), so "v2" is still visible there. Offer only each
  program's latest version when C3's Actions drawer replaces the form (R3.4).
- **Nutrition day refusals (from R0.2).** A day with no meal plan and a refused day share one
  message ("There is no meal plan for this day…"). Map each access reason, as check-ins do, when
  M4 is rebuilt (R2.4).
- **Translations.** `src/web/src/locale/messages.xlf` has not been regenerated since Phase 5, and
  R0.2 changed about 250 source strings. Run `npm run i18n:extract` before any translation work.

---

## 1. Verdict: why the product feels "meh"

This comes from running the app with seeded data on 2026-09-28 and screenshotting every main screen
at 1440 px and 390 px. It was then compared with the App Store screens of Hevy, Everfit, Future,
Ladder and Whoop, and with the coach dashboards of TrueCoach and Hevy Coach.

**The layout is not the problem.** Hevy Coach uses almost the same layout as TB Gym (dark
sidebar, white cards, a greeting) and looks alive. The difference is what is inside the layout.

1. **Two different products.** The website and sign-in page have a real brand: cream, deep forest
   green, Instrument Serif, a lime highlight and photography. Inside the app that brand
   disappears, replaced by generic teal, grey cards and a dark admin sidebar. A visitor goes from a
   premium homepage into a plain internal tool.
2. **Screens are shaped like the database, not like the job.** Most screens are forms that expose
   every stored field. The coach's training tab shows "Assign snapshot", "Load increment",
   "Rounding", "Duplicate and transform", "RPE per week" and a raw
   `2026-09-25T10:10:38.231992+00:00` timestamp. Clients see "Estimate strategy
   BodyweightTrendEwma v2.0", "No authorized nutrition plan was found for this date" and
   "Alternative averages are never logged as consumption". The engine is excellent, but the
   screens show the engine instead of hiding it.
3. **No people, no stories, no pictures.** There are no client photos, no activity feed and no
   charts beyond one line, so numbers appear without meaning. The coach home is two counters, a
   "0", and two buttons. The competitors that feel premium are full of faces, sentences such as
   "Kaiya just finished Push Day, 7,800 kg, 3 PRs", rings, trends and photography.
4. **The phone experience is a squeezed desktop.** The workout logger is 4,530 px tall. Every set
   has four fields, including a kg/lb dropdown repeated on every set, plus its own "Log set" button.
   The client progress page is **10,574 px** tall because it lists "No observation" for every
   single day. Dates use the browser's `dd-----yyyy` picker. Messages is a list with a "Refresh"
   button, not a chat.
5. **Empty by default.** There is no demo data, so anyone shown the app sees zeros, "Choose a
   conversation" and blank panels. **This alone is enough to get a "meh".**
6. **Half migrated.** Only about half of the 56 templates use the new design pieces, and the
   most-used screens are still old markup. Those include the workout logger, messages, the program
   builder, nutrition, check-ins, progress and the clients list. Several still show the browser's
   grey default buttons ("Refresh", "Remove", "Publish and lock").

**What this means for sales:** the people we are selling to are Lebanon's top coaches. They are
Instagram-first personal brands, some with hundreds of thousands of followers. They judge software
the way their clients judge them: on how it looks and feels in the first minute. The first minute
of TB Gym today is an empty admin panel.

---

## 2. The quality bar: ten rules every screen must pass

1. **Answer "what should I do now?" before anything else.** The first thing on a screen is the
   decision or action, not a form.
2. **Speak coach, never system.** No internal words appear on screen (see the glossary in §6).
3. **People first.** Every client appears with a face (photo or initials avatar) and a name, never
   as a row of IDs.
4. **Numbers always carry context:** compared with last week, compared with the target, and in
   which direction. A bare "71.5 kg" is not allowed; "71.5 kg ↓ 0.3 this week" is.
5. **One primary action per screen.** Secondary actions go into menus, sheets or drawers.
6. **Clients use phones.** Big targets, thumb reach, and at most one tap to log something done as
   prescribed.
7. **Show, don't list.** Trends are charts. History is collapsed by default. Never render a row per
   empty day.
8. **It must feel instant.** Skeletons instead of spinners, optimistic updates, live data with no
   "Refresh" buttons, and a native date picker never shown raw.
9. **Delight only at real moments:** a set done, a personal record, a week completed, a program
   finished. Nothing on ordinary taps.
10. **Empty states invite.** Every empty screen says what will appear there and offers the one
    action that fills it.

**Definition of done for a redesigned screen:** it passes all ten rules. It has been screenshotted
at 390 px and 1440 px on the demo workspace and compared side by side with the prototype (for the
screens it covers) and the reference board (§8), with no browser-default controls and no system
words left. If it looks plainer than the prototype, it is not done. It passes axe with 0 violations,
reflows at 200% text and shows no sideways scroll. Its Vitest and Playwright tests have been
updated.

---

## 3. Brand and visual system v2: one brand everywhere

The app adopts the brand the homepage already has. The Figma "Foundations" teal/grey palette is
retired.

| Role | Value | Use |
| --- | --- | --- |
| Ink | `#182d27` | Primary text |
| Forest | `#153d33` | Primary buttons, active navigation, coach sidebar |
| Deep | `#10302a` | Dark surfaces (workout player, dark theme) |
| Cream | `#fbfaf5` / soft `#f5f3ea` | App background |
| Lime | `#d9ed94` | **Signature:** achievement, active state, progress fill, highlights. Never body text. |
| Warm | `#f2b994` | Secondary accent: warnings, "ending soon" |
| Line | `#d9dfd1` | Borders and dividers |
| Muted | `#4f6057` | Secondary text |

Semantic success, warning, danger and info colours are re-tuned to sit on cream at AA contrast.

- **Typography.** IBM Plex Sans for the interface, with its Arabic sibling for RTL. Instrument
  Serif is kept for *moments* only: greetings, summaries, empty-state headlines. All metrics use
  tabular numerals. There is one type scale, with big confident display numbers for metrics
  (weights, streaks, compliance).
- **Shape and depth.** 12–16 px card radius, 10 px controls, two elevation levels and a 4 px
  spacing grid. Coach tables get a compact density.
- **Light and dark.** Every screen works in both. The workout player is always dark (gyms are dim,
  and it saves battery). Everything else follows each person's choice (§3.1).
- **Imagery.** Coach photos, client avatars, exercise media, and **cover photos on workouts and
  programs**: uploaded by the coach, or from a licensed library. Empty states get illustrations in
  one consistent style. Never AI-generated or stock "real" people presented as clients, coaches or
  testimonials.
- **Motion, in three layers:**
  - *Everyday UI:* Angular's native `animate.enter` / `animate.leave` for lists, cards, sheets and
    toasts, plus View Transitions between routes. Three durations (120 / 200 / 320 ms) and the
    homepage easing `cubic-bezier(0.22, 1, 0.36, 1)`. It costs no bundle size. Route transitions
    are turned **off** during a workspace switch or sign-out, so no previous-tenant snapshot flashes.
  - *Signature moments:* **GSAP**, lazy-loaded only on the routes that use it, for the moments
    people remember:
    - the workout card expanding into the player;
    - a set ticked, and the PR burst;
    - the rest timer;
    - the finish summary with count-ups and the share card;
    - chart draw-ins and number count-ups on Coach Today;
    - onboarding.
  - *Website:* GSAP ScrollTrigger for the homepage story, on the homepage only.
  - Everything respects reduced motion, and no animation blocks input.
- **Jitter** is a design tool, not app code. Use it for marketing motion: the homepage hero loop,
  Instagram reels coaches can post, and App Store preview videos. Export MP4/WebM. Pay for a month
  while making assets, then cancel.

### 3.1 Theme customization (coach brand + personal mode)

Tokens are theme-ready from R1, so this costs little later.

- **Coach brand (per workspace):**
  - The coach picks a logo, a **brand colour** (sidebar, hero cards, dark surfaces) and an
    **accent** (buttons, rings, achievements).
  - They choose from curated presets, or pick any colour. The app then derives the tones,
    guarantees AA contrast (for example, dark text on a light accent), and keeps success, warning
    and danger colours fixed so meaning never changes.
  - Their clients see this brand everywhere, share cards included. The TB Gym brand stays on the
    website, sign-in and the coach's own billing.
- **Personal mode (per person):** light, dark or system, for coaches and clients alike, remembered
  on the account.
- **Safety:**
  - Only validated colour values and a logo through the existing media pipeline (scanned,
    tenant-scoped). No custom CSS or fonts.
  - The brand is a workspace setting with the usual tenant rules and audit.
  - A preview shows the result before saving.
- **When:**
  - The tokens are built this way in R1.
  - Personal light/dark ships with the client app (R2).
  - The coach brand settings screen ships with the coach core (R3), so founding coaches see their
    own brand in the demo.
- **Prototype:** the live prototype (§8) already shows four coach brands, a custom colour picker,
  and light/dark.

---

## 4. Frontend foundation (senior engineering decisions)

- **Keep:** Angular 22, standalone components, Signals, lazy routes, SCSS with CSS custom
  properties, logical (RTL-safe) CSS, and the existing Playwright + axe + Vitest setup.
- **Add three packages:**
  - `@angular/cdk`, for overlays (menus, sheets, dialogs), drag-and-drop (program builder
    reordering), virtual scroll (long lists) and a11y utilities.
  - `@angular/aria`, stable in Angular 22: headless, accessible combobox, listbox, menu, tabs and
    toolbar. We style it and it handles keyboard and screen-reader behaviour.
  - `gsap` (free for commercial use, all plugins included), lazy-loaded per route for the
    signature moments in §3. About 25 KB compressed for the core. It is never in the initial
    bundle.
- **Rejected:**
  - Spartan/shadcn + Tailwind: a second styling system, a migration of all 56 templates, and the
    generic "shadcn look".
  - Angular Material / PrimeNG: heavy, and they look like every other admin panel.
  - Chart.js / ECharts: hard to brand, heavy, weak RTL control.
- **Charts:** a small in-house set of SVG chart components (sparkline, trend line with a weekly
  band, bars, progress ring, before/after slider). If the maths grows, use the tree-shakable
  `d3-scale` / `d3-shape` modules only. Every chart has a text or table equivalent for screen
  readers.
- **Component kit v2**, built once in `src/app/ui`, used everywhere, and shown in the lab:
  - Shell and navigation: `AppShell` (coach sidebar / client tab bar), `PageHeader`, `Tabs`,
    `SegmentedControl`.
  - Surfaces: `Card`, `StatTile` (value + delta + sparkline), `Sheet` (mobile bottom sheet),
    `Dialog`, `Drawer`, `Menu`, `Tooltip`, `Toast`.
  - Controls: `Button` set, `IconButton`, `Input`, `NumberStepper`, `Combobox`, `DatePicker` and
    `DayStrip` (never a raw `<input type="date">`), `Checkbox`, `Switch`, `FileDrop`.
  - People and status: `Avatar`, `AvatarStack`, `StatusPill`, `Badge`.
  - Data: `Table` (sortable, sticky header, turns into cards on phones), `ActivityFeed`,
    `Timeline`, `EmptyState`, `Skeleton`.
  - Charts: `ProgressRing`, `Sparkline`, `TrendChart`, `BarChart`, `PhotoCompare`.
  - Chat: `ChatThread`, `Composer`.
  - Workout: `SetRow`, `RestTimer`.
- **Retire:** the pre-foundation palette and globals in `styles.scss`, the `--accent/--surface`
  legacy variables, and every browser-default button. The migration is finished when a lint check
  finds no legacy variable and no unstyled `<button>`.
- **Budgets:** initial bundle under 520 kB. New libraries load only on the route that uses them.
  Images are AVIF/WebP, with no layout shift.
- **Installable app (R2):** a web app manifest, icons, a splash screen and an install prompt for
  clients, so TB Gym opens from the home screen without browser chrome. People see it as an app,
  not a website. Wrapping it for the App Store and Google Play with Capacitor is a later,
  separate decision.

---

## 5. Screen-by-screen specification

Each screen gets its **job**, what it **shows**, and what gets **removed**. Where new data is
needed, the backend work is named. It follows `AGENTS.md`: it is read-only, tenant-scoped, and
limited to the coach's assigned clients.

### Coach (desktop first, works on tablet and phone)

**C1. Coach Home, renamed "Today"**
- Job: "Who needs me right now?"
- Shows:
  - A greeting with the date.
  - An **attention queue** ranked by urgency, each row with a one-tap action: check-ins waiting
    for review, unread messages, renewal requests, plans ending within 14 days, weeks not shared,
    clients who missed two or more sessions, and new clients with no program.
  - An **activity feed** in human sentences, with face, time and PR badges.
  - A **this-week completion** bar chart.
  - Three stat tiles: active clients, completion this week, and plans ending soon.
- Removes: the "0" counters and the static "Build a training block" cards.
- Backend: an attention-and-activity read endpoint.

**C2. Clients**
- Job: "How is everyone doing, and who is slipping?"
- Shows:
  - Avatar, name and goal.
  - A status pill (On track / Needs attention / Paused / Ending soon).
  - Last activity ("Trained 2 h ago").
  - A 7-day completion sparkline and the plan end date.
  - Filter chips: Needs attention, Ending soon, Paused, New. Plus search.
  - Card layout on phones.
- Removes: the phone-number column, the "Onboarding: Not started" noise and the "Open profile"
  link column (the whole row is the link).
- Backend: a client-list projection (last activity, 7-day completion, plan end, attention flags).

**C3. Client profile**
- Job: "The whole story of this client in 10 seconds."
- Shows:
  - A header with photo, name, goal, plan pill with days left, and **Message** and **Actions**.
  - **Overview** reads as a story: this week, weight trend, strength PRs, latest check-in summary
    and coach notes.
  - **Training** is a visual program timeline (weeks as columns, sessions as cards). The current
    week is highlighted, and history shows done/missed markers. Assign, reschedule, complete and
    cancel live in an Actions menu and open focused drawers, not a permanent form dump.
  - **Progress** is charts and a photo compare.
  - **Service & access** holds the plan, payments, renew, change coach and release.
- Removes: raw ISO timestamps, always-visible admin forms, and "Cancellation reason" boxes shown
  by default.

**C4. Program builder (full rebuild): the coach's main tool**
- Job: "Build a great program fast."
- Shows:
  - An exercise library panel on the left, with search, filter chips and media thumbnails. Drag an
    exercise into a day.
  - A week × day grid in the centre.
  - Exercise rows with inline sets × reps × load / RPE editing and drag to reorder (CDK).
  - Duplicate week and copy session.
  - Autosaved drafts with an **unsaved-changes guard**, and a clear "Publish" step with a preview
    of what the client will see.
- Removes: the empty form at the top, the checkbox-per-row bulk actions and the `<select>` to add
  an exercise.

**C5. Check-in review**
- Job: "Review and reply in under two minutes."
- Shows: answers side by side with the previous check-in (changes highlighted), a photo compare,
  the weight trend, a reply composer with saved templates, and "Mark reviewed".

**C6. Messages**
- Job: "It's a chat."
- Shows: a conversation list with avatars, unread counts and last-message previews, a thread with
  bubbles and day separators, a composer, and live updates with no Refresh button. Voice notes and
  attachments come later.

**C7. Nutrition library and meal-plan builder**
- Recipe cards with macro bars and photos.
- A meal plan as a week grid with a daily macro target ring.
- Food search with clean results: name, brand, calories and macros. Database codes (FDC IDs, "SR
  Legacy") stay hidden behind a details toggle.

**C8. Products**
- The heading becomes "Plans you sell": cards with price, duration and icons for the included
  features, plus the number of clients on each plan.
- Removes: "Step 3B live check"-style internal descriptions from the seed.

**C9. Settings, Team, Billing**
- One settings layout with a sub-navigation.
- Team shows faces.
- Billing shows a clean invoice list.

**C10. Exercise library**
- A grid/list toggle with media thumbnails, filter chips instead of three dropdowns plus an
  "Apply" button, and a quick-add drawer.

### Client (phone first)

**M1. Today**
- A greeting with the coach's photo (the coach is present).
- A **hero workout card** with name, duration, exercise count and the coach's note, plus one big
  button.
- A **week strip** with completion rings.
- A nutrition macro ring, a check-in-due card and the coach's latest message.

**M2. Workout player (full rebuild of the logger)**
- One exercise at a time, with a swipe or Next.
- Set rows are **pre-filled with the target and last time's numbers**. **One tap ✓** logs a set as
  prescribed, and steppers adjust load and reps. The unit is chosen once per workout.
- A **rest timer ring** starts automatically, keeps time while the phone is locked, and keeps the
  screen awake (Wake Lock).
- Exercise demo media, a note to the coach, and a PR badge with a vibration on Android.
- A **finish summary**: duration, volume, PRs and completed sets, with a share card (§5 M9).
- Dark theme.
- Backend: last-performance per exercise for pre-fill, and the PR rule (named, versioned,
  server-side, per `AGENTS.md`).

**M3. Training**
- The program overview (week x of y, sessions done/missed) and history with PRs.

**M4. Nutrition day**
- A **day strip** instead of a date input.
- Macro rings, meals as cards, "Ate as planned" in one tap, swap to an alternative, and add a
  custom food.
- Friendly states, e.g. "Your coach hasn't set a meal plan yet". Never "No authorized nutrition
  plan".

**M5. Progress**
- A hero **weight trend chart** with a weekly-average band and a range switch (4 w / 12 w / All).
- A "Log weight" bottom sheet.
- Measurement deltas.
- A photo timeline with a before/after slider.
- A strength PR list.
- The full history sits behind "All entries" and never renders empty days. Estimation method names
  are never shown to clients.

**M6. Check-in**
- A step-by-step form (one question per screen, a progress bar), photo capture, and a
  confirmation.

**M7. Messages**
- The same chat components as C6.

**M8. Me**
- Profile, units, notifications, switching workspace and sign-out.

**M9. Share cards (R6)**
- A branded image of a PR, a finished program or a before/after. **Created only by the client,
  with explicit consent every time, and never automatic.** It markets the coach on Instagram, and
  it is how top Lebanese coaches get clients.

### Signed-out and website
- These are already the strongest part.
- Pre-render the homepage at build time for Google and link previews.
- Later: a real product video loop in the hero, and a GSAP scroll story on the tour section (on the
  homepage only).

---

## 6. Words: the glossary

The engine keeps its precise names in code. Screens use the words on the right.

| System word (code only) | Screen word |
| --- | --- |
| Mesocycle, primary mesocycle | Program block, or just Program |
| Assign snapshot | Assign program |
| Program template version | Program (v2 shown only in history) |
| Client enrollment | Plan |
| Product offer | Price option |
| Enrollment entitlement / coverage | What's included |
| Working max | Training max |
| Duplicate and transform | Build next block |
| Estimate strategy / EWMA | *(never shown to clients; coaches see "trend" with an info tip)* |
| Authorized / entitlement errors | "Not in your plan. Ask your coach." |
| Workspace | Your coaching space (owners), or the coach's name (clients) |
| Release client | End coaching |
| Published week (a mesocycle week) | Shared with client |
| Bodyweight observation | Weigh-in |
| BodyweightTrendEwma | Smoothed average *(coaches only)* |
| Canonical food | Food |

Built in R0.2 (2026-09-29): staff read "coaching space", clients read "your coach" where the
coach's name is not on screen, and history keeps its versions (check-in forms, price plans).

**Rules:**
- Sentences are short, active, and use you/your.
- Dates look like "Mon 28 Sep" or "in 13 days", never ISO.
- Errors say what happened and what to do next.
- Every template goes through this pass (§7, R5).

---

## 7. Build order and effort

"Session" means one Claude Code build session of the size used so far. This table is the overview;
the session-sized steps and their status are in §0.

| Phase | What | Sessions | Gate |
| --- | --- | --- | --- |
| **R0 Foundations** | The demo workspace generator (below), the reference board, the glossary pass on the existing screens | 1–2 | Demo data looks real |
| **R1 Brand + kit + direction** | Brand v2 tokens, the core of component kit v2, then **three hero screens on demo data**: Coach Today, Client Today and the Workout player | 2–3 | **Owner and partner approve the look** before any rollout |
| **R2 Client app** | M1–M8 (Today, Workout player, Progress, Nutrition day, Messages, Check-in, Training, Me), GSAP signature moments, personal light/dark, installable app | 3–4 | Screenshot review against the reference board |
| **R3 Coach core** | C1 Today (with the backend read), C2 Clients (with the projection), C3 Client profile, C6 Messages, coach brand settings (§3.1) | 4–5 | **Show the founding coaches from here** |
| **R4 Coach tools** | C4 Program builder, C5 Check-in review, C7 Nutrition builder | 4–5 | Unsaved-changes guard on every editor |
| **R5 Finish** | C8–C10, notifications, settings, billing and admin; delete the legacy CSS; the final words pass | 2–3 | No legacy variables, no default buttons |
| **R6 Premium** | Share cards, homepage pre-render, the GSAP scroll story and Jitter hero video | 2–3 | Optional before launch |

- **Total:** about 18–25 sessions.
- **Show the top coaches after R3 (about 10–14 sessions), not after everything.** The client app
  (R2) comes before the coach tools because it is what a coach shows off to their clients, and the
  "wow" moment of a demo.
- **Go-live:** the infrastructure from Phase C stays ready. Launch with the founding coaches
  after R3.

**Demo workspace generator (R0).** A development-only CLI command, next to `platform-admin grant`.
It creates "Atlas Performance" with 1 owner, 2 coaches and 12 clients, and 8–10 weeks of realistic
history:
- workouts done and missed, with PRs;
- weight trends;
- check-ins, some reviewed and some waiting;
- message threads;
- plans ending soon;
- a renewal request;
- initials avatars.

It is used for development, every screenshot review and every sales demo. The rule is to never
demo an empty workspace.

Built in R0.1 as `.\scripts\demo-workspace.ps1` (`demo-workspace` on the API, Development only). It
walks a clock through the past and does every step through the real application services, so the
data obeys every business rule. Sign-ins are `karim@` (owner), `lea@` and `omar@` (coaches) at
`atlas.example`, and clients as `first.last@mail.example`, all with the password `AtlasDemo-2026!`.
Maya Fakhoury is the client with a workout waiting today.

---

## 8. How we work so it never comes out "meh" again

- **Starting target.**
  - The **prototype** is committed at `docs/design/prototype/tb-gym-prototype.html`, with a live copy
    at https://claude.ai/artifact/RHKaDiQAVU8FBJBBTQMyn4. It is clickable and animated with GSAP. It covers the client Today, the workout player,
    the summary and share card, and Coach Today with a live feed, plus coach brands and
    light/dark.
  - `docs/design/concepts/` holds the still versions.
  - R1 starts from these. The owner and partner approve or redirect them before rollout.
- **Reference board.** It lives in [`docs/design/REFERENCES.md`](design/REFERENCES.md), with links
  and one line on what to learn from each. Third-party screenshots are not committed.
  - Hevy / Hevy Coach: feed sentences and the one-tap set log.
  - Future: coach presence and dark editorial style.
  - Ladder: bold numbers, week rings and photography.
  - Whoop: one hero number plus one sentence of meaning.
  - TrueCoach: needs attention, due soon and completion rates.
  - Everfit: macro ring, voice notes and exercise video in the logger.

  Every screen spec names the references it follows.
- **Design in code, on real data.** The approved look is built in the UI lab (`/dev/ui-lab`) on demo data
  and reviewed as screenshots. **The old Figma file is retired as the source of truth**, because it
  held accessible wireframes with no brand layer. If a designer is hired later, Figma returns as
  their tool, and code stays the source of truth.
- **Optional human designer review:** a 1–2 day critique of the R1 hero screens by a freelance
  product designer (roughly $500–1,500). It is the cheapest insurance on taste. A full engagement
  (about $1,500–4,000) is not needed if the R1 gate passes.
- **Each screen:** spec from §5, then build, then screenshots at 390 and 1440 px on demo data, then
  a side-by-side with the references, then fixes, then commit. Screens may be **restructured
  freely**. Keeping the old markup is not a goal; keeping backend behaviour is.
- **Retired process:** Figma node parity, per-slice Figma audits and fingerprint checks, and the
  frontend sections of the old audit docs.
- **Kept process:** axe, 200% text, RTL readiness, Vitest, Playwright, and every backend rule.

---

## 9. Open problems carried over from the retired audit documents

These must be fixed while the screen is rebuilt, and verified in the browser:

- **Unsaved work is discarded silently** on navigation and refresh in the editors. Add a guard to
  every editor (C4, C7, the exercise editor, the intake form). The exercise editor must never drop
  muscles, alternatives or linked media on save.
- **Invalid form submits can fail silently.** Every form shows field errors and focuses the first
  one.
- **Expected authorization states render as generic failures.** Map them to friendly states (§6).
- **Headings, focus and scroll on route change.** Each route sets its title, focuses the heading
  and restores scroll.
- **Coach topbar overflow below about 1426 px, and the mobile menu staying open after
  navigation.** Verify both are gone in the rebuilt shell.
- **Client nutrition reachability.** Verify the client can always reach their meal plan from Today
  and the tab bar.

---

## 10. Costs

- **Code and tools:** $0. That covers `@angular/cdk`, `@angular/aria`, GSAP, the in-house charts, native
  animations and View Transitions.
- **Optional:**
  - a designer critique, $500–1,500 once;
  - Jitter (about $16/month) for one month to make the homepage hero loop, reels and App Store
    previews.

  GSAP is free and already counted under code and tools.

  AI video (Higgsfield and similar) is only for marketing atmosphere, never for fake people.
- **Time:** about 18–25 build sessions, with coach demos after about 10–14.

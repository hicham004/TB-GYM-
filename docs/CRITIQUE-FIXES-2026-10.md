# Fixes from Toufic's critique, October 2026

Toufic, a personal trainer who coaches in the gym and online, tested the Render test copy of 15 October 2026
(3e27bd9) and wrote 48 points. `docs/CRITIQUE-TOUFIC-2026-10.md` answers each one, with the evidence and the
research. The owner chose what to build between 24 and 27 October 2026, on a decision page and in chat. This file is
the build plan: section 0 lists the rows in order with their status, section 1 says how a row is built, and section
2 says what each row builds. AGENTS.md, DOMAIN-RULES.md and UI-REDESIGN-PLAN.md (words, the kit, layout, the
definition of done) apply to every row.

## 0. Build status

One row is one session and one pull request, in this order. A session builds the first row that is not Done,
passing over rows marked "Open, not blocking", as section 2 describes it. The third column is the owner's word: an
item it leaves out is not built. 🚦 marks a step that waits for the owner. A status reads Open, Done · date · pull
request or commit, Built, not merged, or Blocked (with the question).

| Step | What | The owner's decisions and what is left out | Status |
| --- | --- | --- | --- |
| B1 | Words | Every rename on the word list except the Clients filter chips, which wait for the filters' rework (2026-10-27). One Reps box. "Workouts", not "sessions", on coach screens. | Open |
| B2a | Kit · The sheet's footer and menus | A footer outside the scroll, in the kit, for every sheet (not the one-line fix). Menus fixed in the kit, the meal plan's day menu included. | Open |
| B2b | Kit · Folds, the sidebar and the view switch | One fold look everywhere. Tighter sidebar rows on short windows, with a thin dark scrollbar only where still needed. Cards / List with an icon and the word. Before it starts, the dark mode switch still uncommitted in the owner's tree is committed or dropped, since it changes the coach shell too. | Open |
| B3a | Team | A Team row in the sidebar. The seats line and the invite's seat sentence (yes, 2026-10-27, once explained). A read-only Team page for coaches (yes, against the recommendation). A Coach filter on Clients. Chats stay private: the owner sees every client and their data, never a coach's chats (ADR 0026, confirmed 2026-10-27). | Open |
| B3b | Messages and check-ins | Saved replies at the top of Messages. One Unread filter with Mark as unread, as in WhatsApp, and Waiting for reply removed (2026-10-27). Check-ins opens on To review, with a line saying what a check-in is (the owner's note). | Open |
| B4a | The Clients table | The table the owner described (2026-10-27): age and goal; status joined with the last 7 days; the plan with what's included, its price and its end; last check-in; last activity. The filter chips wait. A plan's end keeps its own status. The overdue check-in signal. | Open |
| B4b | Today | The layout the owner chose (2026-10-27): This month (money received, active clients, and the owner's coaches), plans ending soon with Renew and Message, ended plans with Renew and Release, the feed. Client workouts this week is removed. B10c adds the sessions number. | Open |
| B5a | Meal options | Pick one of N, with the average calories and macros (the owner's note). Choose one for the client. The coach's option order kept. Left out: meals of several recipes (later). | Open |
| B5b | Adding without dragging | Press +, then Add here, in both builders. | Open |
| B5c | Days, targets and the drafts filter | Nothing shifts (2026-10-27): no Delete day in the middle, no Insert or Duplicate day, whole-week tools instead; no empty day in a published plan. Fill in fat and carbs, the targets sheet's two blocks, the Drafts filter. | Open |
| B5d | Recipe working drafts | Unfinished drafts, saved as you type and private until published. | Open |
| B6 | Progress and profile | The blocked-client sentence. Age. A starting weight of its own: the first start and each comeback, with the change since the first start from weekly averages (2026-10-27). | Open |
| B7a | Strength · The grid, whose max, refusals | A line per set when sets differ. The training-max sentences. Refusals with a way out, 20-rep sets staying possible. The chart's % on chart sets. A warning only when a % set is impossible by the chart (2026-10-27). | Open |
| B7b | Strength · A max from a set they did | Up to 10 reps; the training max at 90 % by default. | Open |
| B8a | Energy v2 · The server | Version 2 of the table with its words, workouts a week, four kinds of work, the coach's own multiplier, the steps line. Built switched off: new calculations stay on version 1 until B8c (2026-10-27). | Open |
| B8b | Energy v2 · Screens and demo | The sheet's words and the breakdown, built and tested with version 2 switched on in development. | Open |
| B8c | 🚦 Energy v2 · Switched on | After Toufic and a dietitian review the table and its words (the owner arranges it): version 2 becomes the default, shifted as a whole by up to 0.05 if they ask; the review is recorded in ADR 0008. | Open, not blocking: waits for the review |
| B9 | The exercise library | The archived view. The full list of seven types with their meanings, Other asking for the coach's own name (2026-10-27). The Tag filter. The video tile opening the video. | Open |
| B10a | Sessions · The client's plan page | Before the packs. | Open |
| B10b | Sessions · Session packs | A sixth coaching feature. Every pack ends (90 days, 30 for one session, changeable per price). A no-show or late cancel can be charged, with a reason. A lapsed pack is never extended. A pause stops access only. A pack-only client is billable as today. Toufic's answers (section 1) change only the defaults. | Open |
| B10c | Sessions · For clients and on Today | The client's balance and notices; Today's sessions number; the client-row chip. | Open |
| B10d | Sessions · This month | A coach sees their own; the owner sees each coach and the total; per currency. | Open |

Later, not rows: a one-tap "Nice work" from Today's feed (the roadmap, later); saved replies shared by the team
(deferred); meals of several recipes eaten together (later); the weight-trend check (a roadmap row after go-live);
the Clients filter chips (later, the owner's note).

## 1. How a row is built

**Where.** In a Claude Code session on the web (claude.ai/code, on this repository) or in a local chat
(`.\scripts\plan-runner.ps1 -Plan critique`, or by hand). One row at a time, in order: merge a row's pull request
before the next row starts, since most rows build on the one before. A cloud session starts with "Read
docs/CRITIQUE-FIXES-2026-10.md and do the next step."

**Branch and pull request.** A cloud session works on its own branch, commits as it goes and pushes, so a reclaimed
machine loses nothing. It opens one pull request into main through `gh api` (REST; `gh pr` is refused there), or
leaves the Create PR button to the owner. The same pull request sets the row's status: "Done · date · PR #n" once
every check below has passed, or "Built, not merged" with what is left. Locally the plan runner commits on the
current branch, as it did for the audit.

**Checks**, as AGENTS.md asks, in proportion to what changed:

- Web code: `npm ci`, `format:check`, `lint`, the production build and Vitest, under Node 24.19.0 and npm 11.17.0
  (npm 10.9 crashes on this repository).
- Backend code: the build and the area's tests. The full suite runs in CI on every pull request against
  PostgreSQL 18; read it with `gh api repos/hicham004/TB-GYM-/commits/<sha>/check-runs`. A row is Done only when CI
  is green. Long commands, the suite's 35 minutes included, run in the background with a timeout of up to two
  hours.
- Always `git diff --check`.
- Every new or changed screen is opened in a real browser at 1440 × 900 and 390 × 844 (kit and sidebar rows also at
  1366 × 633 and 1093 × 489), light and dark, axe clean and with no sideways scroll; the report names the 1440 and
  390 screenshots. A live pass where the API and PostgreSQL run, the mocked Playwright suite otherwise.

**The cloud machine** (the owner sets it up once on claude.ai/code, then checks it with a throwaway session:
`dotnet --version`, `node --version`, `npm --version`, and the database below starting). It has Docker, git and
`gh`, but no .NET SDK and no browser, and the default network cannot reach their downloads.

- Network: Custom, keeping the default list, plus `dot.net`, `builds.dotnet.microsoft.com`,
  `dotnetcli.azureedge.net`, `cdn.playwright.dev` and `playwright.download.prss.microsoft.com`.
- Environment variable: `BASH_DEFAULT_TIMEOUT_MS=2400000`.
- Setup script:

  ```bash
  set -euo pipefail
  curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
  bash /tmp/dotnet-install.sh --channel 10.0 --install-dir /usr/share/dotnet
  ln -sf /usr/share/dotnet/dotnet /usr/local/bin/dotnet
  curl -fsSL https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1
  npm install --global npm@11.17.0
  ```

- In a session: `npx playwright install --with-deps chromium` in `src/web` after `npm ci`; and the database the
  way CI starts it:

  ```bash
  docker run -d --name tbgym-test-pg -p 5433:5432 -e POSTGRES_DB=postgres -e POSTGRES_USER=tbgym \
    -e POSTGRES_HOST_AUTH_METHOD=trust postgres:18.4-alpine
  export ConnectionStrings__Database='Host=localhost;Port=5433;Database=postgres;Username=tbgym'
  export TB_GYM_TEST_ADMIN_CONNECTION='Host=localhost;Port=5433;Database=postgres;Username=tbgym;Pooling=false'
  export TB_GYM_REQUIRE_POSTGRES_TESTS=true
  ```

**Cost.** A cloud session uses the same plan limits as a local chat; past the weekly limit it needs extra usage (the
owner's credits) switched on at claude.ai. The machine itself costs nothing. A green CI run takes about 38 minutes
(backend 30, containers 5, web 3), so a row with two or three runs uses 80 to 120 of the private repository's 2,000
free minutes a month.

**Rules every row keeps.** A rule changes in a few lines of DOMAIN-RULES, an ADR or ARCHITECTURE (B10b writes ADR
0038). The generated API client is never edited by hand. Commits and pull requests carry no co-author or "Generated
with" lines; `.claude/settings.json` turns Claude Code's off. A technical question is the session's to decide; a
business question, a money rule or legal wording this file does not settle is left out and written into the row's
status with a recommendation. The report says what changed for coaches and clients, the test results, what was not
done or not verified, the screenshots, and the next row.

**The owner's own steps.**

- Before B2b: commit or drop the dark mode switch in the owner's tree, which changes the coach shell too.
- Before B8c: Toufic and a dietitian review energy v2's table and its words.
- Before B10b: ask Toufic how long his packs stay valid, his no-show and late-cancel rule, whether single sessions
  are paid in cash on the day, and whether one pack ever mixes kinds of session; and whether the macro PDF on his
  page 8 is the owner's own plan document.
- Before the next reviewer: the test copy's three fixes in section 6 of the critique.

## 2. What each row builds

### B1 · Words (web)

- Set type "Normal" becomes "Working", with the help "Top, back-off, drop and failure sets are working sets too;
  a warm-up never counts in the summary or the records". The client's app already says "Working set". The stored
  value stays.
- "% training max" becomes "% of training max", with the help "Of this client's training max, set when you assign
  the program."
- Plan sheets: "What clients get" becomes "Description (optional)", hint "What you'll do for them and what you
  expect, as you'd tell a new client. The ticks are what the app opens for them.", with "What's included" above it.
  "Option name" becomes "Name for this price (optional)", hint "Left empty it's called by its length, “12 weeks”.
  Name it when the length isn't the point, like “Student rate”."; on a first plan it hides behind "Name this price
  option".
- "Save as draft" becomes "Save as draft (complete, not published)" until B5d.
- When the server has no USDA key: "USDA search isn't set up on this server." When it has no media storage:
  "Uploads aren't set up on this server. Video links work." A real outage keeps its own words.
- "Workouts", never "sessions", for workouts on coach screens, with a glossary line, so that "session" can mean a
  paid hour in B10.
- One Reps box that takes "10" or "8-12" (hyphen, en dash or "to"), stored as the same two numbers as today: a single
  number is saved as minimum = maximum, and old prescriptions with only a maximum keep reading "up to 10". The same
  box in Edit weeks.
- Left as they are: the Clients filter chips (Maxes to review, Paused, Ending soon) wait for the filters' rework.

### B2a · Kit: the sheet's footer and menus (web)

- The kit's modal surface gets a footer region outside the scrolling body: a `flex: none` sibling after the body,
  the surface colour and a top hairline, the safe-area padding moved to it, the submit button tied to the form by
  the `form` attribute, and a soft shadow while the body can still scroll. Move the four sheets whose bar covers the
  last line first (plan-sheets, program-assign, program-maxes-update, program-next-block), then the eight that work
  around it (food-editor among them) and the kit's own entry actions, deleting their sticky rules, negative margins
  and 5 rem `scroll-margin` workarounds. Short dialogs take the same footer. Size the sheet by the overlay
  container, not `100vw`.
- `app-menu` keeps its API, keys and focus behaviour and draws its list in a CDK connected overlay anchored on the
  trigger: below-end, below-start, above-end, above-start, an 8 px margin, push as the last resort, reposition on
  scroll, close on an outside pointer and on Esc, right-to-left aware, dark mode copied to the pane. Leave the CDK's
  popover hosting on, so the list sits in the top layer, above an open sheet, and no ancestor can clip it; delete
  `keepOnScreen()`. This one change fixes all twelve screens, the meal plan's day menu included (cut on its left
  edge in the review).
- Verify scrolled to the end at 1440 × 900, 390 × 844, 1366 × 633 and 1093 × 489 with classic scrollbars: the last
  line whole above the footer, the scrollbar ending above it, the kit select and the date picker opening cleanly.
  Menus: the exercise card in Cards and List, and Day 1's menu in the meal plan builder at 1440 and on a phone.
  Vitest for the position fallbacks and the outside click.

### B2b · Kit: folds, the sidebar and the view switch (web)

- One kit disclosure on native `<details>`/`<summary>`: the title, an optional hint and count, the kit's chevron at
  the end turning 180° when open (200 ms, none under reduced motion), the native marker hidden in every browser, a
  hover fill, the focus ring, a 44 px row, the content made on first open. Use it for every fold, from a fresh grep
  (thirty today), the ones with no marker first (Entries and corrections, Load settings, the maxes panel). Add it to
  the UI plan's kit list.
- The sidebar under about 700 px of window height: group gap 28 → 16 px, rows 40 → 36, label gap 8 → 4, padding
  24 → 16, the space's name on one line; under about 640 px the group labels are hidden visually only (screen
  readers keep them). Where it must still scroll: `color-scheme: dark` on the sidebar, a thin scrollbar with a light
  thumb at 3:1 contrast, `scrollbar-gutter: stable`. Target: nine rows (Team included) at 1366 × 633 with no bar.
- Cards / List becomes the kit's segmented control with an icon and the word (new grid and list glyphs), never a
  chip; the choice stays in the address.

### B3a · Team

- A Team row in the sidebar for the owner only (Business: Products · Team · Settings), at the same address, out of
  the Settings column.
- Three lines on the page say how a team works: one coach per client, given from the client's profile;
  you see every client and all their data, and a coach only their own; chats stay between a client and their
  coach, even from you; a leaving coach's clients come back to you and are told.
- Seats: "You and 2 coaches · 3 seats this month", the count from the owner's billing read (PBL-002 for the current
  month; add the read if Billing has none), and in Invite a coach: "Each coach you invite counts as a seat on your
  TB Gym bill." Amounts stay on Billing.
- Coaches get a read-only Team page: names, roles and since when. No emails, invitations or client counts.
- A Coach filter on the owner's Clients list (every row already carries its coach).

### B3b · Messages and check-ins

- A "Saved replies" button in the inbox header (coaches) opens the saved replies sheet to manage them: list,
  search, Edit, New, Delete. The composer's button stays.
- One Unread filter: "Waiting for reply" goes. A chat gets "Mark as unread" (in its menu and the list row's menu),
  as in WhatsApp: a flag on that participant, cleared when they next read the chat, counted in Unread and the
  badge. The rule goes in MSG-022; the API's AwaitingReply filter goes if nothing else uses it.
- Check-ins opens on "To review": one row per sent, unreviewed check-in of the clients the caller coaches, oldest
  first, with the client's face, the form and "Sent Mon 19 Oct · 1 day late", each opening its review; a name
  search; when empty, "Nothing to review from clients with a plan". Forms becomes the second tab. A line at the top
  says what a check-in is: "A check-in is a short form your clients fill in on a schedule: their weight, photos and
  your questions. Sent ones wait here for your review."

### B4a · The Clients table

- The columns: **Client** (name, age from the date of birth, goal); **Status · last 7 days** (reason tags with
  counts in one warning tone, each a link to what it names: the review, the chat, Training, Service; the plan pills
  On track, Plan paused, Plan ends soon, No active plan; the 7-day strip with a legend, "✓ done · × missed · –
  still due", and "n of m"); **Plan** (what's included, the length, the price and currency, and its end date or
  "Paused until …"); **Last check-in** (when the last one was sent); **Last activity** ("Trained Lower A · 2 days
  ago"). A chevron ends each row. On a phone each client is a card with the same lines.
- The filter chips stay as they are.
- A "How these statuses work" sheet beside the chips and under Today's Needs you. The lede says "12 clients · 9
  need attention · 1 plan ends soon". The 14-day boundary is fixed on one side.
- A plan's end keeps its own status, outside Needs attention.
- Overdue check-in: due two or more days ago and not sent, while check-ins are in the plan; ranked after missed
  workouts; cleared when sent or after 14 days; worked out from the missing submission only. "Remind" opens the
  chat only when messaging is in the plan. A CLI-018 line and domain tests.
- Server: the overview rows gain the date of birth, the plan's summary (features, length, price, currency, paused
  until) and the last check-in's sent time, through narrow contracts from Subscriptions and CheckIns, each client
  checked by `CoachClientScope`.

### B4b · Today

- From the top: **Needs you**, as now. **This month**: money received (per currency, by the day it arrived,
  SUB-007; a coach sees payments for their own clients, the owner everyone's), active clients, and for the owner
  the coaches with each one's client count. B10c adds 1-on-1 sessions held. **Plans ending soon**: name, plan, end
  date, Renew (the renew sheet) and Message (when messaging is in the plan). **Ended, not renewed** (ended in the last
  30 days, no later plan, not released): Renew and Release (ADR 0027's release, asked first). **What your clients
  did · last 7 days**: five rows, then Show all; on a phone it sits under Needs you, folded with its count.
- "Client workouts this week" goes.
- A payment counts for the coach the client had on the day it was received, from the append-only assignment
  history. Money is never added across currencies, and never called profit or earnings.

### B5a · Meal options

- The coach's meal card says "Pick one of 3", numbers the options, and ends with "≈ 526 kcal · protein 32 g ·
  carbs 60 g · fat 18 g, the average of 3 options".
- The drop toast says where it went: "Added as option 2 of Breakfast: the client picks one."
- The client's meal with options says "Choose one", lists each option as a row with the first selected, has "I ate
  this", and "Swap or adjust" becomes "Change servings".
- An order on the published plan's choices (`MealPlanChoice` and `ClientNutritionPlanChoice`), so the coach's
  option 1 is what the client sees first; the migration keeps today's order.

### B5b · Adding without dragging

- A "+" on every library row (recipes in the meal plan builder, exercises in the program builder) selects it and
  turns every place it can go into an "Add here" button; Esc or a second press cancels. It works on a phone.
- Dragging stays, with a grab cursor, a lift on hover and louder drop targets. The panel says both ways: "Drag a
  recipe onto a meal, or press + to add it." One first-use hint, closed by the first add and reachable again from
  "How adding works". Nothing loops, and nothing moves under reduced motion.

### B5c · Days, targets and the drafts filter

- Nothing shifts. The day menu holds Copy this day to… (pick days; their meals are replaced), Replace with a copy
  of… and Clear meals ("Keeps the day, empties it"). Delete day appears only on the plan's last day. Duplicate day
  and Insert a day go, since both move later days. The week header holds Duplicate week and Delete week, which move
  later weeks by whole weeks, so weekdays stay in line. Add day and Add week stay at the end. Undo says what changed
  ("Day 33 cleared."). A published plan still needs a meal on every day (NUT-013), and Publish's refusal offers
  "Copy a day here".
- The Daily target's "Fill in fat and carbs", with 20 / 25 / 30 / 35 % picks, runs through the server's NUT-008
  strategy so the grams keep their provenance. It warns below 20 % fat and under 0.5 g of fat per kg. "Start from a
  client's targets" lists the coach's own clients only.
- The targets sheet's two blocks: the box first and the picks under it (protein 1.6 · 1.8 · 2.0 · 2.2 g per kg;
  fat 20 · 25 · 30 · 35 % of calories), and "Carbs: the rest" once Work out has answered.
- Recipes get an "All · Published · Drafts (n)" filter, applied on the server.

### B5d · Recipe working drafts

- A `RecipeDraft` per person and recipe, the ADR 0033 way: saved as you type, values unchecked, private, never in a
  meal plan; it carries an AI suggestion's pending review when the recipe began as one (ADR 0035). Publish runs
  every rule and makes the next version. Listed as "In progress" beside the shared, complete "Draft", which stays.
  ADR 0033 gets a few lines.

### B6 · Progress and profile

- A blocked client's Progress says "Elie's access is blocked, so their progress isn't shown. Unblock them on
  Service & access." with a link, and hides the entry fold; the weight, measurement and photo sheets refuse with the
  same sentence. "Try again" stays for real outages.
- Age beside the date of birth on About and My profile, "Dec 24, 1983 (42)", for the workspace's today (CLI-005).
- A starting weight of its own, apart from the daily weigh-ins. The intake's "Where you start" writes it, and the
  first weigh-in as today. Existing profiles are filled in from their first weigh-in. A returning client's new
  profile gets its own. The coach sees "Started at 97.4 kg · Thu 15 Oct 2025" from the person's first profile in
  this workspace, "Came back at 99.0 kg · Tue 3 Mar 2026" for each later one, and "Since start −5.3 kg (−5.4 %)",
  on the Overview's Weight panel and the Progress hero. The coach can correct a start, with a reason; corrections
  are append-only and keep the old value.
- "Since start" is the latest weekly mean minus the mean of the week holding the first start (PRG-005, approved by
  the owner), a named summary version with reference tests; only the start shows while no later weekly mean exists.
  A PRG line covers the start record and the read across a returning client's profiles.

### B7a · Strength: the grid, whose max, refusals

- The grid row shows equal sets once, as sets × reps ("2 × 10 · 70 % of training max · RPE 7" is two sets of ten);
  when sets differ, one line per set. This changes R6.3's one line per exercise.
- The builder's header: "Needs a training max for: Back Squat, Overhead Press · set when you assign the program",
  from the rule Assign program uses. The publish preview repeats it and ends with "Weights are worked out when you
  assign the program, from this client's training max."
- Refusals offer the way out; the caps stay. Past 12 reps on a chart or Epley set: "Use % of training max", "Type a
  weight" or "Let the client pick the weight", saying "the formulas stop at 12 reps". Sets of 20 reps stay possible:
  % of training max and a typed weight take 1 to 100 reps today. RPE 5 to 6 on a chart set: "Use the Epley curve
  for this set" or "Type a weight", saying why.
- Chart sets show the chart's percentage ("5 · RPE 8 · 81 % of training max"). The web gets a pinned copy of
  RpeChart v1, with a test that it matches the server's cells.
- A % set warns only when the chart says it is impossible: "85 % × 10 reps is heavier than the chart allows for 10
  reps (74 %). Most lifters can't do it." Nothing else links % and RPE: the % sets the weight, and an RPE on a %
  set is only a target for how hard it should feel.
- Assign program: each max row says why it is listed ("3 sets use % of training max in weeks 1 to 4"), the training
  maxes come before Load settings, and filled rows fold to one line. One sentence each on Record a max, Assign
  program and the Strength history, including the max carried from the last program (STR-014).

### B7b · A max from a set they did

- Record a max offers three kinds: Training max ("the number a program's percentages use; 5/3/1-style programs set
  it at 85 to 90 % of the best single, others use the single itself"), Tested 1RM ("the heaviest single they
  actually lifted, on that day") and From a set they did: weight × reps, up to 10 reps, estimated with Epley v1
  through the unused estimate endpoint (INV-9).
- Saving records an Estimated 1RM observation whose source is the calculation (STR-001), and "Also set their
  training max at 90 %" as a named, versioned step whose record keeps the estimate's numbers. Both append-only.

### B8a · Energy model version 2: the server

- `OccupationStepsPal` v2 takes the kind of work (Seated "a desk, driving"; Mixed "up and about for part of the
  day"; On their feet "teaching, retail, nursing, serving"; Heavy manual "building, farm, moving loads"), steps a day
  in five bands, and workouts a week (0 to 7, filled in from the program; the server keeps what was sent):

  | Steps a day | Seated | Mixed | On their feet | Heavy manual |
  |---|---|---|---|---|
  | Under 5,000 | 1.45 | 1.55 | 1.65 | 1.90 |
  | 5,000 to 7,499 | 1.50 | 1.60 | 1.70 | 1.95 |
  | 7,500 to 9,999 | 1.55 | 1.65 | 1.75 | 2.00 |
  | 10,000 to 12,499 | 1.60 | 1.70 | 1.80 | 2.05 |
  | 12,500 and over | 1.65 | 1.75 | 1.85 | 2.10 |

  plus 0.02 for each workout a week, 0.14 at most, inside the 1.40 to 2.40 guard. Version 1 stays for every
  calculation made with it. Every cell gets a reference test.
- `CoachChosenPal` v1: "Or choose the multiplier yourself", 1.40 to 2.40, in plain words or typed, with an
  optional reason, kept append-only like the macro override.
- The words beside the multiplier come from the server: "Counts as low active: × 1.68 (mixed work with 5,000 steps
  a day × 1.60, plus 4 workouts a week + 0.08)".
- `WalkingCost` v1, shown and never stored or added: "Their 5,000 steps are inside that, worth about 180 calories a
  day at 97 kg." (0.5 kcal × kg × km at 0.75 m a step, rounded to ten.)
- Warnings, never refusals: a target under the resting estimate, or under 1,200 (women) or 1,500 (men) kcal a day.
- Goal picks say their rate and share ("−500 a day ≈ 0.5 kg a week, 84 % of what they burn"); the rate is a named
  rule.
- Docs: DOMAIN-RULES' "TdeeMultiplication v1" aligned with the code's `BmrTimesPal`; ADR 0008 amended (the anchors,
  the override, the reviewers).
- Version 2 is built switched off: version 1 stays the default for new calculations until B8c. A development
  setting turns version 2 on, so B8b can build and test its screens.

### B8b · Energy model version 2: screens and demo

- The targets sheet groups "How active they are" (kind of work, steps a day, workouts a week) with the live line
  under it; "How this was worked out" uses the same words; the steps help says "From their phone or watch on a
  normal day, work included. Walking is counted inside the multiplier, never added on top."
- The Harris-Benedict hint: "Older; less often within 10 % of a measured value than Mifflin-St Jeor, and runs higher
  for heavier clients."
- The demo is rebuilt so no example shows 1.80 or Harris-Benedict.

### B9 · The exercise library

- "Your exercises" and "Archived (n)" replace "Archived too". The archived view says "Archived exercises are left
  out of your pickers and of programs you build from now on. Programs already built keep them. Open one to restore
  it." The API's `includeArchived` becomes active, archived or both. The rule is one LIB line, and MED-002 notes that
  a client's library grant leaves archived exercises out.
- Seven types, each with a line of meaning under the select: Strength ("a lift loaded for reps; feeds maxes and the
  RPE chart"), Power, Conditioning, Mobility and flexibility, Balance and coordination, Warm-up and activation, and
  Other. General becomes Other, a data migration and the wire value. Other asks for an optional name of the coach's
  own (for example "Rehab", up to 40 characters), shown as the exercise's type and listed in the Type filter; it
  behaves as Other (no maxes, no chart).
- Tags become a filter chip with counts.
- The video tile reads "Watch on YouTube · opens in a new tab" under the video's own title, and the card's menu
  has the same item. The server gives the watch address and the provider's title (MED-015 amended); the link keeps
  `rel="noopener noreferrer"`.

### B10a · The client's plan page

- A page where the client reads their plan: its name, what's included, the dates and the coach's description; the
  sessions left once B10b ships. One new client read, through `CurrentFor`.

### B10b · Session packs

- Sessions are a sixth coaching feature (`CoachingFeature.Sessions`) whose offers set `AllowsConcurrentCoverage`,
  so access, renewals, the client list and platform billing keep working; a pack-only client counts on TB Gym's
  bill like any covered client (PBL-002 as it stands).
- A plan is a coaching plan or a session pack. A pack's price option carries a count (1 to 100) and a validity:
  90 days by default, 30 for a single session, changeable per price. One active option per count, length and
  currency (ADR 0034). Every pack ends.
- Selling is an enrollment as today: waiting for payment until the exact price is received.
- An append-only ledger per pack: Issued, Held (the day, the coach, a note), Charged (a no-show or late cancel,
  with a reason the client reads), Voided (a correction pointing at the row it undoes), Lapsed (what is left at the
  end). Balance = issued − held − charged + voided. Triggers refuse update and delete. A session counts when it
  happens, never at booking; when several packs run, the one ending first is used. Idempotency keys as for every
  commercial command.
- "Record a session" from the client's page, with a receipt in the same sheet when the client paid cash that day.
  Refused in words: no sessions left, a day outside the pack, a pack waiting for payment, a released client, another
  coach's client.
- A lapsed pack is never extended (a free one-session pack is the goodwill tool). A pause stops access, not the
  pack's dates.
- Coach: a "1-on-1 sessions" section on Service & access ("7 of 10 left · until 9 Jan · last held Tue 20 Oct",
  Record a session, Sell sessions, the ledger). A new ADR (0038) and DOMAIN-RULES lines. Not in v1: booking, a
  calendar, self-booking, reminders, automatic no-show charging, several kinds of session, pay rates.

### B10c · Sessions for clients and on Today

- The client sees "7 of 10 sessions with Karim left, until 9 January" and the dates held; the ending-soon notice
  works as it does for plans.
- The coach sees a "2 sessions left" chip on the client row, 1-on-1 sessions held in Today's This month, and Today
  items for packs running out.

### B10d · This month

- A page: money received, sessions held, plans and packs sold, clients started and ended, this month and last, in
  the workspace's calendar. A coach sees their own; the owner sees each coach and the total. Per currency, never
  added across currencies, never called profit.

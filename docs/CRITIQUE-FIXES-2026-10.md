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
request or commit, Built, not merged, or Blocked (with the question). A choice a row made that its spec did not
settle, and an item it left out, wait for the owner in section 3.

| Step | What | The owner's decisions and what is left out | Status |
| --- | --- | --- | --- |
| B1 | Words | Every rename on the word list except the Clients filter chips, which wait for the filters' rework (2026-10-27). One Reps box. "Workouts", not "sessions", on coach screens. | Done · 2026-10-27 · PR #1 |
| B2a | Kit · The sheet's footer and menus | A footer outside the scroll, in the kit, for every sheet (not the one-line fix). Menus fixed in the kit, the meal plan's day menu included. | Done · 2026-10-28 · PR #4 |
| B2b | Kit · Folds, the sidebar and the view switch | One fold look everywhere. Tighter sidebar rows on short windows, with a thin dark scrollbar only where still needed. Cards / List with an icon and the word. Before it starts, the dark mode switch still uncommitted in the owner's tree is committed or dropped, since it changes the coach shell too. | Done · 2026-10-28 · fad8ef7 (built locally, committed to main on the owner's word); the short-window spacing starts under 760 px, since nine rows need about 741 |
| B3a | Team | A Team row in the sidebar. The seats line and the invite's seat sentence (yes, 2026-10-27, once explained). A read-only Team page for coaches (yes, against the recommendation). A Coach filter on Clients. Chats stay private: the owner sees every client and their data, never a coach's chats (ADR 0026, confirmed 2026-10-27). | Done · 2026-10-28 · eb35800 (built locally, committed to main on the owner's word); a coach opens the read-only Team from their Settings, after their own pages (the owner's choice of 2026-10-28), and the Clients chips count the chosen coach's clients |
| B3b | Messages and check-ins | Saved replies at the top of Messages. One Unread filter with Mark as unread, as in WhatsApp, and Waiting for reply removed (2026-10-27). Check-ins opens on To review, with a line saying what a check-in is (the owner's note). | Done · 2026-10-29 · 6b2d82b and 7626501 (built locally in two slices, committed to main on the owner's word); the owner's To review lists every client's, a team coach's client marked "Coached by …", and a coach's only their own (the owner's choice of 2026-10-28); the client's face is their initials, as the kit's avatar draws them |
| B4a | The Clients table | The table the owner described (2026-10-27): age and goal; status joined with the last 7 days; the plan with what's included, its price and its end; last check-in; last activity. The filter chips wait. A plan's end keeps its own status. The overdue check-in signal. | Done · 2026-10-29 · c44f365 (built overnight, committed to main on the owner's word); a paused plan says "Paused since … · ends …", since a pause has no end date (the owner's choice of 2026-10-29). Decided overnight and confirmed by the owner on 2026-10-29: the Plan column sums up the plan whose end it shows, with "+1 more plan"; an unsent check-in (a draft too) is overdue from 2 through 13 days after its due day; Remind only for the client's own coach with messaging in today's plan, See check-ins otherwise; ending soon at 13 days or fewer on every screen (the client page's prompt starts a day later); the table's overdue tag opens the client's check-ins; "On track" is the plan's pill and can sit beside a reason. The plan's name, left out overnight, is shown after all (the owner, 2026-10-29): B4c |
| B4b | Today | The layout the owner chose (2026-10-27): This month (money received, active clients, and the owner's coaches), plans ending soon with Renew and Message, ended plans with Renew and Release, the feed. Client workouts this week is removed. B10c adds the sessions number. | Done · 2026-10-29 · 62ae0ff (built overnight on the branch b4b, since it counts money, and merged into main on the owner's word of 2026-10-29). Decided overnight and confirmed by the owner on 2026-10-29: receipts only, each on the workspace day it arrived, for the coach the client had at that moment (SUB-016); a coach sees their own totals per currency, the owner the workspace's; active means a plan running today; the staff list is the owner's alone; Needs you stays as it was, so plan endings show twice; a cancelled plan is not "ended"; End coaching is the owner's; Record payment replaces Renew while a renewal waits for payment; a never-paid plan whose dates passed is listed as ended; Needs you with This month beside it, the plan lists side by side, the feed last; all three number tiles removed, not only the workouts tile |
| B4c | The plan's name on Clients | The owner's change to B4a (2026-10-29): the Plan column shows the plan's name. | Done · 2026-10-29 · cc462c0 (built and committed by the plan runner's chat, on the owner's word); the name sits in a `<bdi>`, so a name in another script reads in its own direction while its line keeps the cell's alignment, as the plan's name on Today does. No line added to section 3. Fixed first, in its own commit (d0d138b): the mocked Clients e2e's 200% text check, which B4a's reason links had made ambiguous |
| B5a | Meal options | Pick one of N, with the average calories and macros (the owner's note). Choose one for the client. The coach's option order kept. Left out: meals of several recipes (later). | Done · 2026-10-29 · 57e1df9 (built and committed by the plan runner's chat, on the owner's word); the options already published keep the order they were read in, their stored order, which had reshuffled 8 of the demo's 14 two-option meals; a recipe dropped under a day says "Added as a new meal, Snack, on day 2." too. Fixed in the row, since its Change servings and a second pick go through it: changing a meal the client had logged answered 409 with EF Core's "severed" message (found in audit A14a). Three lines added to section 3 (another option first, the button on a meal of one recipe, the words the row did not give) |
| B5b | Adding without dragging | Press +, then Add here, in both builders. | Done · 2026-10-29 · 9e1722f (built and committed by the plan runner's chat, on the owner's word); one Add here ends the choice, a phone or a narrow window chooses in a Recipes or Exercises sheet, a bar at the foot of the grid says what is being added, with Cancel, and saved workouts have the + too. Six lines added to section 3 (what ends a choice, on a phone, the first-use hint, the rows, Edit weeks left out, the words the row did not give) |
| B5c1 | Days and the targets sheet's blocks | Nothing shifts (2026-10-27): no Delete day in the middle, no Insert or Duplicate day, whole-week tools instead; no empty day in a published plan. The targets sheet's two blocks. The plan runner's chat split B5c on 2026-10-29, as it was too big for one chat: this part is web only. | Done · 2026-10-29 · b92280f (built and committed by the plan runner's chat, on the owner's word); a day's meals are copied to days picked, replaced by another day's or cleared where the day stands, Delete day is on the last day only, and a week's menu beside its name duplicates or deletes whole weeks, each with an Undo saying what changed; Publish's refusal of an empty day offers Copy a day here; the targets sheet's protein and fat are each a box with one row of picks under it, and "Carbs: the rest" gives the server's figures once Work out has answered for those numbers. Six lines added to section 3 (Use for every day, the week's menu and a short week, the copy sheets, the refusal's words, when "Carbs: the rest" shows figures, the words the row did not give) |
| B5c2 | Fill in fat and carbs and the drafts filter | The rest of B5c (2026-10-27): Fill in fat and carbs through the server's NUT-008 strategy, with its warnings and "Start from a client's targets"; the Drafts filter. | Done · 2026-10-29 · e461f6a (built and committed by the plan runner's chat, on the owner's word); Fill in fat and carbs is a sheet from the Daily target (the calories, the protein and the fat box with its 20 · 25 · 30 · 35 picks) whose server split leaves the card one sentence of arithmetic, the warnings in words and an Undo, and a published plan names its share, Nut008MacroSplit and 1.0 while its grams are the split's; fat under 20 % or under 0.5 g a kilogram is flagged, never refused; Start from a client's targets lists a coach's own clients with Nutrition (the owner's every one, "Coached by …") and puts their latest four targets in, the client's weight kept on the page for the fill's per-kilogram warning; the boxes show the server's numbers whole until a target is typed; Recipes filter All · Published · Drafts (n) on the server, kept in the address; the server's empty-day refusal says the builder's words. Seven lines added to section 3 (where the fill lives, the fat warnings in a client's targets too, whose clients the owner starts from, what a client's targets fill, typing after a fill, Drafts and Changes not published, the words the row did not give) |
| B5d | Recipe working drafts | Unfinished drafts, saved as you type and private until published. | Done · 2026-10-29 · 541b2d6 (built and committed by the plan runner's chat, on the owner's word); a coach's recipe is kept as they type in their own draft on the server, nobody else's to see (the owner included) until Publish, or Save as draft, makes its next version, checked by every rule; a refresh or another device reopens it, a new one through its address; "In progress" sits beside the recipe's status in the editor and on Recipes, where new ones lead under All and Drafts and count in Drafts (n); a version saved since the changes began is said and asked about at Publish, a tab behind another is told to reload, and Discard changes brings back the recipe as last saved; a new recipe's draft carries its AI suggestion and approves it once; a draft keeps its photo past the unused-photo sweep. The full backend suite passed in parts, as the laptop slept mid-run and then ran on battery (every test passed in at least one run on this code). Five lines added to section 3 (where In progress shows, Save as draft, a draft's photo, an AI suggestion in a draft, the words the row did not give) |
| B6 | Progress and profile | The blocked-client sentence. Age. A starting weight of its own: the first start and each comeback, with the change since the first start from weekly averages (2026-10-27). | Done · 2026-10-30 · 059ebee (built and committed by the plan runner's chat, on the owner's word); a blocked client's Progress says "Elie’s access is blocked, so their progress isn’t shown. Unblock them on Service & access." with Open Service & access, reads nothing and hides the entries fold, and the weight, measurement and photo sheets refuse a coach's save in the same words; About and My profile read "11 Jul 1997 (29)" for the workspace's today; the starting weight is a record of its own (PRG-014): "Where you start" writes it beside the first weigh-in, profiles from before it start from their first active weigh-in, and a returning client's new profile has its own; the coach reads "Started at 68.4 kg · Thu 27 Aug 2026", "Came back at …" for each later profile and "Since start −3.9 kg (−5.6%)" (the latest weekly mean minus the first start's week, BodyweightSinceStartWeeklyMean 1.0) on the Overview's Weight card and the Progress hero, and corrects a start from Progress with a reason, the old value kept; the client sees none of it. Fixed first, in its own commit (3850629): the realtime chat tests, whose fixed start day stopped covering today on 2026-10-30. Seven lines added to section 3 (the client's own Progress, a client weighed before setup, where Correct start lives, a start week with no weigh-in, a returning client's since start on the day they come back, the hero's single-day pill left out, the words the row did not give) |
| B7a | Strength · The grid, whose max, refusals | A line per set when sets differ. The training-max sentences. Refusals with a way out, 20-rep sets staying possible. The chart's % on chart sets. A warning only when a % set is impossible by the chart (2026-10-27). | Open |
| B7b | Strength · A max from a set they did | Up to 10 reps; the training max at 90 % by default. | Open |
| B8a | Energy v2 · The server | Version 2 of the table with its words, workouts a week, four kinds of work, the coach's own multiplier, the steps line. Built switched off: new calculations stay on version 1 until B8c (2026-10-27). | Open |
| B8b | Energy v2 · Screens and demo | The sheet's words and the breakdown, built and tested with version 2 switched on in development. | Open |
| B8c | 🚦 Energy v2 · Switched on | After Toufic and a dietitian review the table and its words (the owner arranges it): version 2 becomes the default, shifted as a whole by up to 0.05 if they ask; the review is recorded in ADR 0008. | Open, not blocking: waits for the review |
| B9 | The exercise library | The archived view. The full list of seven types with their meanings, Other asking for the coach's own name (2026-10-27). The Tag filter. The video tile opening the video. | Open |
| B10a | Sessions · The client's plan page | Before the packs. | Open |
| B10b | Sessions · Session packs | A sixth coaching feature. Every pack ends (90 days, 30 for one session, changeable per price). A no-show or late cancel can be charged, with a reason. A lapsed pack is never extended. A pause stops access only. A pack-only client is billable as today. Toufic's answers (section 1) change only the defaults, so the row is built with the defaults above without waiting for them (the owner, 2026-10-29). | Open |
| B10c | Sessions · For clients and on Today | The client's balance and notices; Today's sessions number; the client-row chip. | Open |
| B10d | Sessions · This month | A coach sees their own; the owner sees each coach and the total; per currency. | Open |
| B11 | Leftovers | Added on the owner's word (2026-10-29): the mocked Playwright suite run once and fixed, its stale screenshots included; "14 sessions a week" in DOMAIN-RULES; a blocked client's row on Clients; the check-in card and the overdue tag agreeing on when a check-in is late. | Open |

Later, not rows: a one-tap "Nice work" from Today's feed (the roadmap, later); saved replies shared by the team
(deferred); meals of several recipes eaten together (later); the weight-trend check (a roadmap row after go-live);
the Clients filter chips (later, the owner's note).

## 1. How a row is built

**Where.** In a Claude Code session on the web (claude.ai/code, on this repository) or in a local chat
(`.\scripts\plan-runner.ps1 -Plan critique`, or by hand). One row at a time, in order: merge a row's pull request
before the next row starts, since most rows build on the one before. A cloud session starts with "Read
docs/CRITIQUE-FIXES-2026-10.md and do the next step."

**No waiting for CI** (the owner, 2026-10-27). A session runs the checks below, opens its pull request and reports;
it does not wait for CI. The owner merges once CI is green. A session first looks at the open pull requests of
earlier rows: one with red CI is fixed first, on its own branch, and one still waiting to be merged is named in the
report; either way the session builds no new row on top of an unmerged one.

**Branch and pull request.** A cloud session works on its own branch, commits as it goes and pushes, so a reclaimed
machine loses nothing. It opens one pull request into main with the session's GitHub tools, or leaves the Create PR
button to the owner. The same pull request sets the row's status: "Done · date · PR #n" once the session's checks
below have passed (it reaches main only when the owner merges it, after CI), or "Built, not merged" with what is
left. Locally the plan runner commits on the current branch, as it did for the audit.

**The local runner** (the owner, 2026-10-29). `.\scripts\start-plan-runner.ps1 -Plan critique` builds the rest
of the plan one fresh chat per row, with nobody watching. A chat that changed server code runs the full backend suite
on the laptop before it commits, and fixes first, in its own commit, a failure an earlier row left. It commits on
main and never pushes; the runner pushes each row that ends Done, while the repository is private and GitHub has
nothing main lacks. A choice the row's spec does not settle is made the way closest to the owner's earlier choices,
built and listed in section 3; a new money rule, legal wording or work outside the row is left out and listed there
with a recommendation. No chat stops the run for a decision. A used-up weekly usage limit pauses the runner until it
resets, and the run carries on.

**Checks**, as AGENTS.md asks, in proportion to what changed:

- Web code: `npm ci`, `format:check`, `lint`, the production build and Vitest, under Node 24.19.0 and npm 11.17.0
  (npm 10.9 crashes on this repository).
- Backend code: the build and the area's tests. CI runs the full suite against PostgreSQL 18 on every pull request
  that changes more than the web app, docs or Markdown (45 to 70 minutes on 2026-10-27); one that changes only
  those runs the domain and architecture tests and leaves the integration suite out. A pull request is merged only
  once CI is green. Long commands run in the background with a timeout of up to two hours.
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
  # The image puts its own Node 22 first on PATH (/etc/profile.d/nodejs.sh); 24.19.0 goes in front of it.
  printf 'export PATH=/usr/local/bin:$PATH\n' >> /etc/profile.d/nodejs.sh
  export PATH=/usr/local/bin:$PATH
  npm install --global npm@11.17.0
  ```

  Where `builds.dotnet.microsoft.com` is blocked, a session can copy the SDK out of `mcr.microsoft.com/dotnet/sdk:10.0`
  instead (`docker create`, then `docker cp <id>:/usr/share/dotnet /usr/share/`).

- In a session: Playwright's Chromium (the cloud image has it in `/opt/pw-browsers`; elsewhere
  `npx playwright install --with-deps chromium` in `src/web` after `npm ci`); Docker's daemon, which a session
  starts without (`dockerd > /tmp/dockerd.log 2>&1 &` when `docker info` fails); and the database the way CI starts
  it:

  ```bash
  docker run -d --name tbgym-test-pg -p 5433:5432 -e POSTGRES_DB=postgres -e POSTGRES_USER=tbgym \
    -e POSTGRES_HOST_AUTH_METHOD=trust postgres:18.4-alpine
  export ConnectionStrings__Database='Host=localhost;Port=5433;Database=postgres;Username=tbgym'
  export TB_GYM_TEST_ADMIN_CONNECTION='Host=localhost;Port=5433;Database=postgres;Username=tbgym;Pooling=false'
  export TB_GYM_REQUIRE_POSTGRES_TESTS=true
  ```

**Cost.** A cloud session uses the same plan limits as a local chat; past the weekly limit it needs extra usage (the
owner's credits) switched on at claude.ai. The machine itself costs nothing. A full CI run took 50 to 80 minutes on
2026-10-27 (the integration suite alone 45 to 70); a pull request of web, docs or Markdown only skips that suite
and takes about 20. Every job counts against the private repository's 2,000 free minutes a month.

**Rules every row keeps.** A rule changes in a few lines of DOMAIN-RULES, an ADR or ARCHITECTURE (B10b writes ADR
0038). The generated API client is never edited by hand. Commits and pull requests carry no co-author or "Generated
with" lines; `.claude/settings.json` turns Claude Code's off. A technical question is the session's to decide; a
business question, a money rule or legal wording this file does not settle is left out and written into the row's
status with a recommendation. The report says what changed for coaches and clients, the test results, what was not
done or not verified, the screenshots, and the next row.

**The owner's own steps.**

- Before B2b: commit or drop the dark mode switch in the owner's tree, which changes the coach shell too
  (done 2026-10-28: committed, a1c189b).
- Before B8c: Toufic and a dietitian review energy v2's table and its words.
- Ask Toufic how long his packs stay valid, his no-show and late-cancel rule, whether single sessions are paid in
  cash on the day, and whether one pack ever mixes kinds of session; and whether the macro PDF on his page 8 is the
  owner's own plan document. B10b does not wait for his answers (the owner, 2026-10-29): it is built with the
  plan's defaults, which his answers can change later.
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
  "Paused since … · ends …", since a pause has no end date, the owner's choice of 2026-10-29); **Last check-in**
  (when the last one was sent); **Last activity** ("Trained Lower A · 2 days
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

### B4c · The plan's name on Clients

- The owner's change to B4a (2026-10-29): the Plan column's first line, in the table and on a phone's card, is the
  plan's name as it was booked (`ClientPlanSummary.Name`, which the server already sends), in its own writing
  direction; then what's included, the length and price, and the end, as now. Web only: `planCell` in
  `clients.models.ts`, its specs and the mocked Clients e2e.

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

### B5c1 · Days and the targets sheet's blocks (web)

- Nothing shifts. The day menu holds Copy this day to… (pick days; their meals are replaced), Replace with a copy
  of… and Clear meals ("Keeps the day, empties it"). Delete day appears only on the plan's last day. Duplicate day
  and Insert a day go, since both move later days. The week header holds Duplicate week and Delete week, which move
  later weeks by whole weeks, so weekdays stay in line. Add day and Add week stay at the end. Undo says what changed
  ("Day 33 cleared."). A published plan still needs a meal on every day (NUT-013), and Publish's refusal offers
  "Copy a day here".
- The targets sheet's two blocks: the box first and the picks under it (protein 1.6 · 1.8 · 2.0 · 2.2 g per kg;
  fat 20 · 25 · 30 · 35 % of calories), and "Carbs: the rest" once Work out has answered.

### B5c2 · Fill in fat and carbs and the drafts filter

- The Daily target's "Fill in fat and carbs", with 20 / 25 / 30 / 35 % picks, runs through the server's NUT-008
  strategy so the grams keep their provenance. It warns below 20 % fat and under 0.5 g of fat per kg. "Start from a
  client's targets" lists the coach's own clients only.
- Recipes get an "All · Published · Drafts (n)" filter, applied on the server.
- Left from B5c1, server words: Publish's refusal of an empty day on the server still says "Add one, or remove the
  day."; it takes the builder's words ("Add a meal, or copy a day here.").

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

### B11 · Leftovers

- The mocked Playwright suite, run once in Chromium: what the critique rows broke is fixed (selectors, the sidebar's
  rows, words), and the stale screenshot baselines are recorded again after looking at each one (the UI lab's eight
  among them). The docs/design pictures a run rewrites are restored, and e2e/private's five known failures stay.
- DOMAIN-RULES says "14 workouts a week" where it still says "14 sessions a week" (B1's words).
- A blocked client's row on Clients no longer shows their plan beside "No active plan" (older than B4a): it says
  their access is blocked.
- The client page's Check-in card and the overdue tag agree on when an unsent check-in is late: from the second day
  after its due day (CHK-015).

## 3. Waiting for the owner

A chat that meets an item adds one line here: the row, the question, what it built (or that it left the item out),
the other way, and its recommendation. The owner answers in chat; the answer goes into the row's status and the
line is removed, and a changed answer becomes a new row.

On 2026-10-29 the owner confirmed B4a's and B4b's overnight picks, except the plan's name, which B4c adds.

- B5a · How a coach makes another option first. Built: options keep the order they were added in (a drop or "Add
  another option" adds the last), so another option becomes option 1 only by removing and adding again. Other way:
  "Make it option 1" or Move up in the meal sheet. Recommendation: wait until a coach asks; the order only decides
  which option the client sees first and chosen.
- B5a · The button on a meal of one recipe. Built: "Ate as planned", as before, since there is nothing to pick;
  "I ate this" under a meal's options; "Change servings" on both. Other way: "I ate this" everywhere.
  Recommendation: keep as built.
- B5a · Words the row did not give. Built: the meal sheet labels its cards "Option 1", "Option 2" and says "The
  client picks one of them, and sees option 1 first. With more than one, the day counts their average."; a recipe
  dropped on a meal whose options were all removed says "Added to Breakfast."; each of the client's option rows has
  a "Recipe" button. Other way: the sheet's "or" between options, as before. Recommendation: keep, so the card and
  the sheet number options alike.
- B5b · What ends a choice. Built: one Add here adds the row once and ends the choice, as a drop does; Escape, a
  second press of + or the bar's Cancel end it without adding. Other way: the choice stays for more places (the same
  recipe on several days) until Escape or Cancel. Recommendation: keep; a day's meals are copied from its menu.
- B5b · On a phone. Built: where the library has no room beside the grid (a phone, a narrow window), a "Recipes" or
  "Exercises" button opens it in a sheet; the row chosen there closes it and the grid offers Add here. A bar at the
  foot of the grid, at every width, says "Adding Oat bowl: press Add here where it goes." with Cancel (a phone has no
  Escape). Other way: the library above the grid on a phone. Recommendation: keep.
- B5b · The first-use hint. Built: the kit's fold "How adding works" above the first row, open on a coach's first
  visit to each builder (kept in the browser), folded by Got it, by its own row or by the first add, and opened
  again from that row. Other way: a callout floating by the first row, as the critique sketched it.
  Recommendation: keep: it covers no row and folds into the same row it is opened from.
- B5b · The rows. Built: the + on saved workouts too, which land on any day as a copy (they are rows of the same
  panel), and the grip moved to the row's start, as the grid's cards have it, so the + ends the row. Other way:
  exercises only, the grip beside the +. Recommendation: keep.
- B5b · Edit weeks, left out: the row names the two builders, so a client's program in Edit weeks keeps dragging
  and its add sheets, with the same panel and no +. Recommendation: give it the same + and Add here in a small row,
  since its panel and grid are the builder's.
- B5b · Words the row did not give. Built: "Drag an exercise into a workout, or press + to add it." and "Drag a
  saved workout onto a day, or press + to add it."; the tips ("Drop a recipe on a meal for another option, or under
  a day for a new meal. Without dragging, press + on a recipe, then Add here." and the program's); "Already in this
  meal" on a meal that offers the recipe; "Add here · Day 2" on a folded week; "Back Squat added to Lower A.",
  "… added: a new workout on week 2, day 3." and "Full body added on week 1, day 1."; the sheets' "Choose a recipe,
  then press Add here where it goes.". Recommendation: keep.
- B5c1 · Use for every day. Built: gone from the day menu, which holds only the row's items; the "Copy this day
  to…" sheet starts with Every day and The same day of each week (each Friday, when day 1 is a Monday), then None.
  Other way: keep "Use for every day" in the menu too. Recommendation: keep as built.
- B5c1 · The week's menu. Built: beside the week's name, which shows once a plan has two weeks (one week has Add
  week, the same copy at the end); Duplicate week only on a full week of 7 days ("Only a full week of 7 days can be
  duplicated."), since a short last week's copy would not make a week of its own; Delete week on any week, a short
  last one included. Other way: a short last week's days copied to the end. Recommendation: keep.
- B5c1 · The copy sheets. Built: the plan's days as numbered round chips in their weeks (a dashed chip for a day
  with no meals, the day itself ringed and never picked), with "Day 12 has meals now; copying replaces them." before
  the copy; "Replace with a copy of…" cannot pick a day with no meals (Clear meals empties a day) and says the
  picked day's meals and calories. Other way: a list of days with their meals. Recommendation: keep: a year of days
  fits a phone.
- B5c1 · Publish's refusal of an empty day. Built: "Day 5 has no meals yet. Add a meal, or copy a day here." with
  Copy a day here; on the last day "…, copy a day here, or delete the day."; and with no meal on any day "Add a meal
  to it." without the button. Recommendation: keep.
- B5c1 · "Carbs: the rest" in the targets sheet. Built: the line gives the server's grams and share ("Carbs: the
  rest, 264 g (49%).") and the fat help its grams only while every number in the sheet is one the last targets were
  worked out from (the sheet opened again); otherwise "Carbs: the rest of the calories, after protein and fat."
  After Work out the result shows every figure, as before. Other way: a live figure from a preview call as the coach
  types. Recommendation: keep; no figure is ever worked out in the browser.
- B5c1 · Words the row did not give. Built: the hints "Pick the days; their meals are replaced", "Another day's
  meals, in place of these", "A copy right after it; later weeks move on a week" and "Later weeks move up a week";
  the Undo lines "Day 5's meals copied to days 6, 12 and 19.", "Day 9 now has day 2's meals.", "Week 2 duplicated as
  week 3. The weeks after it moved on a week." and "Week 2 deleted. The weeks after it moved up a week."; the
  captions "g per kg" and "% of calories"; the protein help without a weight "Type the grams. With their weight
  above, you can pick grams for each kilogram." Recommendation: keep.
- B5c2 · Where Fill in fat and carbs lives. Built: a button under the Daily target's boxes, beside "Start from a
  client's targets", opening a sheet with the calories, the protein and the fat box with the 20 · 25 · 30 · 35
  picks under it (the targets sheet's block); the card then says the arithmetic in one sentence, with the
  warnings and an Undo. Other way: the picks in the card itself, each filling at once. Recommendation: keep: the
  card stays four boxes on a phone, and a share under 20 % can be typed.
- B5c2 · The fat warnings elsewhere. Built: they are NUT-008's own (beside the protein range), so a client's
  targets (Work out, and their Nutrition tab's latest) warn the same way under 20 % fat or 0.5 g a kilogram.
  Other way: the builder's fill only. Recommendation: keep: one rule, one set of warnings.
- B5c2 · Whose clients the owner starts from. Built: every current client with Nutrition and targets, as ADR 0026
  gives the owner every client and as To review lists them (B3b), a team coach's marked "Coached by …"; a coach
  sees their own only. Other way: the clients assigned to the owner only. Recommendation: keep.
- B5c2 · What a client's targets fill. Built: all four targets, with the share when the split made them; the
  client's weight stays on the page, never in the plan (which every coach of the workspace reads), for the
  fill's per-kilogram warning. Other way: their calories and protein only. Recommendation: keep.
- B5c2 · Typing after a fill. Built: the boxes show the server's numbers whole, and the first typed target keeps
  all four as shown and drops the share and its sentence; Undo brings back what the fill replaced. Other way:
  keep the share and work fat and carbs out again whenever calories or protein change. Recommendation: keep: a
  fill is an action, not a binding.
- B5c2 · Drafts and "Changes not published". Built: Drafts are the recipes never published (the "Draft" pill
  and the lede's "still drafts"); a published recipe with changes waiting stays under Published, which meal
  plans may use, with its "Changes not published" pill. Other way: list it under Drafts too. Recommendation:
  keep until B5d's "In progress".
- B5c2 · Words the row did not give. Built: "Fat takes the share of the calories you pick, and carbs what protein
  and fat leave."; "Fat is 25% of the calories, 56 g, and carbs are the rest, 225 g."; "From Maya Fakhoury's
  targets, worked out Mon 26 Oct." (": your macros, set …" for a coach's own); "The warnings use Maya Fakhoury's
  weight, 62 kg."; the toasts "Fat and carbs filled in, fat at 25% of the calories." and "Maya Fakhoury's
  targets are the daily target now."; "Fat is 15% of the calories, under the usual 20%. This is a flag for you to
  look at, not a rule." and its per-kilogram twin; "None of your clients with Nutrition in their plan has
  targets yet. Work them out on a client's Nutrition tab."; "No drafts: every recipe is published.", "No
  published recipes yet. Publish one to use it in your meal plans." and "No drafts match “oat”.".
  Recommendation: keep.
- B5d · Where "In progress" shows on Recipes. Built: a coach's new recipes in progress lead the list
  under All and Drafts and count in Drafts (n), and the lede adds ", 1 in progress"; a saved recipe they
  are changing keeps its card, with "In progress" beside its own status, under its own filter; nobody
  else sees either, the owner included. Other way: a fourth chip, "In progress (n)", or a strip of work
  in progress above the cards. Recommendation: keep: the owner chose three chips (B5c2), and a recipe
  never published is a draft to its coach either way.
- B5d · Save as draft. Built: "Save as draft", hinted "Your team sees it; meal plans don’t" (B1's
  "(complete, not published)" was until B5d), making the next version from the coach's draft, checked
  like Publish, and saying "Saved as a draft. Your team sees it; meal plans don’t until you publish
  it."; with nothing changed it says "No changes to save." as before. Other way: keep B1's words, or
  "Share with my team". Recommendation: keep.
- B5d · A draft's photo. Built: the unused-photo sweep counts a working draft's photo as named (MED-014
  amended), so a photo added to a recipe in progress stays as long as the draft does. Other way: the 48
  hours apply to it too, and the coach adds the photo again. Recommendation: keep: a draft kept for a
  week would otherwise lose its photo without a word.
- B5d · An AI suggestion in a draft. Built: a new recipe's draft carries the suggestion it began from
  and its first version approves it; one turned down since (Remove the suggestions left) leaves the
  recipe the coach's own lines; Discard leaves a carried suggestion awaiting review, as leaving the
  editor did before. Other way: Discard turns it down too. Recommendation: keep: the suggestion was
  paid for when it was made, and its review only says whether a recipe came of it.
- B5d · Words the row did not give. Built: the "In progress" pill in the kit's blue (info), beside
  Published, Draft or Changes not published; "Only you see it until you publish it." and "Only you see
  these changes. Meal plans use the published version until you publish them." (or "… Not in meal
  plans until you publish it."); before the first pause "New recipe" and "Your changes save as you type.
  Publish it to use it in meal plans."; the builders' save line ("Saved at 19:49, not published yet",
  "Saving…", "Not saved yet. Trying again…", "Not saved") and Discard changes ("Discard your changes?",
  "Discard this recipe?", "Changes discarded.", "Recipe discarded."); "Version 2 of this recipe was saved
  after you started these changes. Publishing yours makes it the newest version." and at Publish "… Make
  yours the newest version? Version 2 stays in the recipe’s history." with "Publish mine as the newest"
  (or "Save mine as the newest") and "Discard mine"; "This recipe was changed in another tab or on
  another device. Reload to continue with the latest changes." with Reload recipe; the cards' "Only you
  see it until you publish it. Changed Thu 29 Oct.", "Untitled recipe", "1 ingredient" and "No
  ingredients yet". Recommendation: keep: they are the meal-plan builder's words wherever it has them.
- B6 · The client's own Progress. Built: the start lines and "Since start" on coach screens only, as the
  row says ("The coach sees"); a returning client never sees an older profile (CLI-016). Other way: the
  client also sees their own current start and the change since it on their Progress. Recommendation:
  keep for now; showing the client their current profile's start later is one line, if you want it.
- B6 · A client weighed before setup is finished. Built: no start until "Where you start" writes it (the
  intake asks for that first weigh-in's day and weight, as before); every profile from before B6 was filled
  in from its first weigh-in, setup finished or not. Other way: a coach's first weigh-in for a client
  with no start becomes the start. Recommendation: keep: the start is part of setting up, and the About
  card already says when setup is not finished.
- B6 · Where Correct start lives. Built: a text button "Correct start" under the start lines on the
  Progress hero, for the profile read's own start and never a former client's, opening a sheet with the
  weight and its unit, the day, "What was wrong?" (Typed the wrong number · Weighed on another day ·
  Something else) and the earlier starts with who changed them; the Overview's Weight card shows the
  lines without the button. Other way: the button on the Overview too, or inside "Entries and
  corrections". Recommendation: keep: corrections live on Progress.
- B6 · A start week with no weigh-in. Built: no "Since start", the start alone, when the week holding the
  first start has no current weigh-in (its first weigh-in voided, or the start corrected into an empty
  week), since PRG-005 compares weekly means, never a single day. Other way: the start's own value as
  that week's mean. Recommendation: keep.
- B6 · A returning client's "Since start" on the day they come back. Built: their comeback weigh-in is
  the latest weekly mean, so from that day the coach reads "Since start +2.5 kg (+3.5%)" against the
  first start's week (seen live: Hadi, 70.42 kg over 5 days in August, then 72.9 kg). Other way: wait
  until the new profile has a second week. Recommendation: keep: it is the rule you approved.
- B6 · The Progress hero's pill, left out (outside the row). The pill beside the weight ("↓ 4 kg since 27
  Aug") still compares the first and last single days of the chart's range, so beside "Since start −3.9
  kg (−5.6%)", worked out from weekly means, it can read as a second, different change (seen live on
  Maya). Recommendation: a small row to give the pill weekly means too, or to drop it while the start
  shows.
- B6 · Words the row did not give. Built: "24 Dec 1983 (42)" in the app's day-month-year (audit COACH-6)
  where the row wrote "Dec 24, 1983 (42)"; "(−5.4%)" without the row's space before %, as the app writes
  shares; "No change since start"; the blocked tab's heading "Access blocked" and its button "Open Service
  & access" (the Overview's), and "This client’s access is blocked, …" when no first name is known; the
  entry sheets' refusal in the tab's sentence, on each measurement or photo refused; "Correct start",
  "Correct the starting weight", "Starting weight", "Day it was weighed", "Weighed on another day", "The
  earlier start stays in its history. Weigh-ins are not changed.", "Earlier starts", "Changed by Lea
  Khoury, Fri 30 Oct 2026", "That is the start already saved. Change the weight or the day, or close
  this.", "The start could not be saved. Try again." and the toast "Starting weight corrected. The earlier
  one stays in its history." Recommendation: keep.
- B7a · The grid's runs of sets. Built: equal neighbours once ("3 × 5 · 75% of training max"), and a set
  unlike its neighbours on a line of its own written "1 × 3 · RPE 8 · 86% of training max" (the client's
  session sheet's rule, with "1 ×" so every line reads sets × reps); warm-ups stay out. In a narrow day the
  exercise's name keeps its width and the lines wrap under it, breaking only between their parts. Other
  way: one line per set whenever any differ. Recommendation: keep: a top set and three back-offs read two
  lines, not four.
- B7a · Whole percents. Built: the chart's share in whole percents on the grid, the set's line, the
  publish preview and the week copies ("81%"), as the row writes it; the RPE box's help gives the cell
  itself ("RTS chart: 5 reps at RPE 8 is 81.1% of the training max."); the % flag compares in whole
  percents too, so 74% × 10 is not flagged against the chart's 73.9%. Other way: one decimal everywhere,
  as the server's explanation writes it. Recommendation: keep.
- B7a · When a % set is flagged. Built: by its fewest reps, so a range that can be done at its low end is
  not flagged (85% × 5–12); past 12 reps by the chart's 12-rep cell ("70% × 15 reps is heavier than the
  chart allows even for 12 reps (68%)."); an older "up to 10" set from one rep, so only past 100%. The flag
  sits under the set's line in the set editor, open or closed, and not on the grid. Other way: the top
  reps, no flag past 12, or a mark on the grid row too. Recommendation: keep.
- B7a · Ways out the row did not list. Built: an Epley set past 12 (reps plus RIR) that the RTS chart
  covers is offered "Use the RTS chart for this set" first; a chart set too far from failure whose reps
  plus RIR the Epley curve cannot take either gets "Type a weight" and "Let the client pick the weight" in
  place of the Epley button. A way out keeps the reps and the effort and puts the cursor in the box to
  fill next. Other way: exactly the row's buttons. Recommendation: keep: no button leads to another
  refusal.
- B7a · Assign program's rows. Built: every max row is the kit's fold, its line the lift and the number it
  starts from ("Back Squat · 100 kg") with the reason under it; a row with no number, or whose last
  program's logged sets suggest a new max, starts open, and a refused one opens at Assign; the box keeps
  the lift's name for a screen reader. Other way: plain boxes for the empty rows. Recommendation: keep:
  one look for every row, and a suggestion is never folded away.
- B7a · Epley sets, left out (outside the row). An Epley set's line still shows its effort only ("3 × 5 ·
  RPE 8"), as before, since the row names chart sets, so it can read like a set with no load.
  Recommendation: a small row showing the Epley curve's share the same way, from a pinned copy of
  WorkingMaxLoad v2's curve with its test.
- B7a · Words the row did not give. Built: the refusals "the RTS chart starts at RPE 6.5 (RIR 3.5): four
  or more reps from failure, its percentages no longer hold.", "the formulas stop at 12 reps, so the RTS
  chart has no weight for 20 reps." and "the formulas stop at 12 reps, and the Epley curve counts the reps
  left in reserve too: 10 + 4 = 14."; "outside the RTS chart" on such a set's line; the buttons' group
  "Ways to keep this set"; the reasons "6 sets use % of training max and 1 set uses the RTS chart in weeks
  1 and 2", "1 set uses the Epley curve in week 3", "weeks 1 to 4" and "weeks 1, 3 and 5"; Assign
  program's "This program works its weights out from these and keeps them as its own; you update them
  from its Training maxes. Each starts where Maya’s last program left the lift, or from a max you recorded
  since." (with no last program "… Each starts from the max you recorded, when there is one."); Record a
  max's "Programs don’t read it directly: each keeps its own training maxes, set when you assign it and
  updated from there." and the Strength history's "Programs don’t read the maxes you record directly: …",
  the critique's sentence; the preview's "Weights are worked out …" only when a lift needs a max.
  Recommendation: keep.

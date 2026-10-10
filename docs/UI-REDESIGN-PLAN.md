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
| R1.2 | **Component kit v2 core** (§4): Card, StatTile, Avatar/Stack, StatusPill, Buttons, Sheet, Dialog, Toast, EmptyState, Skeleton, ProgressRing, Sparkline, SegmentedControl, Tabs | All of them are in the UI lab, pass axe, and work in RTL and dark | Done · 2026-09-29 · 7668dd9 |
| R1.3 | **Three hero screens in the lab** on demo data: Coach Today, Client Today, Workout player, matching the prototype (GSAP moments included) | Side-by-side screenshots against the prototype at 390 and 1440 px | Done · 2026-09-29 · 6dfb5af |
| R1.4 | 🚦 **Owner and partner approve the look** | The owner says go | Done · approved 2026-09-29 · f3e3e96 |
| R2.1 | **Client Today** (M1) for real, plus the personal light/dark setting (§3.1) | §2 definition of done | Done · 2026-09-30 · 3124581 |
| R2.2 | **Workout player** (M2), with backend pre-fill from last time, the versioned PR rule and the finish summary | §2, plus backend tests | Done · 2026-09-30 · 3124581 |
| R2.3 | **Progress** (M5) and the chart components | §2 | Done · 2026-09-30 · 3124581 |
| R2.4a | **Nutrition day** (M4): day strip, macro rings, meal cards, planned and alternative logging, and client-entered extra food | Web/API and PostgreSQL tests, axe, reflow, 390/1440 screenshots | Done · 2026-09-30 · 181df23 |
| R2.4b | **Nutrition demo data:** assigned meal plan for Atlas plus screenshot review on that workspace; correction for mistaken extra-food entries | §2 on the demo workspace | Done · 2026-09-30 · 9634bc4 |
| R2.4c | **Check-in** (M6): one question per screen, optional progress photos, review and a sent moment; Today opens the check-in due | §2 | Done · 2026-10-01 · b184eca |
| R2.5a | **Messages** (M7, the shared chat C6 reuses): inbox with faces and counts, a thread of bubbles by day with a "New messages" line, a pinned composer, live updates with no Refresh | §2 | Done · 2026-10-01 |
| R2.5b | **Training** (M3): the program overview (week x of y, sessions done and missed) and history with PRs | §2 | Done · 2026-10-01 · 9218e29 |
| R2.5c | **Me** (M8) and the **installable app** (manifest, icons, splash, install prompt) | §2 | Done · 2026-10-01 · 9218e29 |
| R3.1 | **Backend reads:** attention and activity, and the client-list projection (§5 C1–C2) | Integration tests, including wrong-tenant and other-coach cases | Done · 2026-10-03 · 971482d |
| R3.2 | **Coach Today** (C1) | §2 | Done · 2026-10-03 · 428346f |
| R3.3a | **Clients** (C2): the list with status, last activity, the last 7 days, filter chips and search | §2 | Done · 2026-10-03 · b702cfc |
| R3.3b | **Client profile** header, overview and progress (C3), with a coach read of the client's personal records | §2, plus backend tests | Done · 2026-10-03 · 214f8b1 |
| R3.4a | **Client profile Training** (C3): the program as a timeline, with Assign, Reschedule, Complete, Cancel, Build next block and a session sheet | §2, plus backend tests | Done · 2026-10-03 · 80f7b9e |
| R3.4b | **Client profile Service & access** (C3): plan, payments, renew, change coach and release | §2 | Done · 2026-10-04 · 9c1468f |
| R3.5a | **Coach brand settings** (§3.1): a look or own colours and a logo, with the backend setting and logo upload, drawn for the coach's staff and clients | §2, plus backend tests | Done · 2026-10-04 · a37645d |
| R3.5b | **Coach Messages** (C6): search and filters (unread, waiting for a reply) over every conversation, the client's plan and last workout beside the thread | §2, plus backend tests | Done · 2026-10-04 · fe6aa5e |
| R3.5c | **Saved replies** (C6): a coach's own short replies, kept on the server and dropped into the composer | §2, plus backend tests | Done · 2026-10-04 · 039e121 |
| R3.6 | 🚦 **Demo to the founding coaches** (the owner's step) | The owner reports back | Open, not blocking · 2026-10-05: the owner will demo later and said to carry on with R4 |
| R4.1 | **Program builder** (C4), part 1: library panel, week grid, drag and drop | §2 | Done · 2026-10-05 |
| R4.2a | **Program builder**, part 2a: autosave to the coach's own draft on the server, and the unsaved-changes guard (Save draft goes; Publish makes the version) | §2, plus backend tests | Done · 2026-10-05 · e51143f |
| R4.2b | **Program builder**, part 2b: inline sets × reps × load / RPE editing on the grid, and the publish preview | §2 | Done · 2026-10-05 · e51143f |
| R4.3 | **Check-in review** (C5) | §2 | Done · 2026-10-05 |
| P1 | **Progression, builder** (owner-approved 2026-10-05, ADR 0036): "Duplicate with progression" on a week's menu (1 to 12 copies; RPE, reps, % and weight steps; the new weeks are shown before they are added), the RTS RPE chart as a load formula, and the program's formula choice | §2, plus domain reference tests (the chart, the steps) and API tests | Done · 2026-10-06 · 3538285 |
| P2 | **Progression, training maxes** (ADR 0036): a "Training maxes" panel at the top right of a client's program (each lift, value, source, date); "Update maxes for the coming weeks" with a preview of every changed weight; name or rename the program; weights from week 1's weight | §2, plus backend tests (superseding snapshot, stale preview, retry, other coach, released client) | Done · 2026-10-06 · a94b973 |
| P3a | **Progression, next block** (ADR 0036): Build next block takes the builder's four steps (RPE, reps, % of the max, weight) and each set's own formula, and shows the new weeks with their weights before adding them | §2, plus backend tests (each step and formula, limits, stale preview, coverage, race, other coach, released client) | Done · 2026-10-07 · f0f0bb9 |
| P3b | **Progression, editing** (ADR 0036): a client's future weeks are edited in the builder's grid through the coverage policy, with an audit record; started and finished sessions stay locked | §2, plus backend tests | Done · 2026-10-07 · f0f0bb9 |
| P4a | **Session extras** (ADR 0036): an exercise video button in the builder, the session sheet and the client's workout player; coach and client notes visible both ways | §2 | Done · 2026-10-07 · f0f0bb9 |
| R4.4a | **Meal plans** (C7, part 1): the plans as cards, and the meal-plan builder: days side by side with each day's total against the daily target, recipes dragged into meals, options per meal, the coach's server draft (NUT-013) and Publish | §2, plus backend tests | Done · 2026-10-07 · 4556bd2 |
| R4.4b | **Recipes** (C7, part 2): recipe cards with macro bars, the recipe editor (ingredients from a food search, totals per serving as they are typed, publish), the AI suggestion inside New recipe, and recipe photos | §2, plus backend tests | Done · 2026-10-07 · b71d004 |
| R4.4c | **Foods** (C7, part 3): one clean search over the coach's own foods and USDA (database codes behind a details toggle), adding your own food, and the calculation defaults moved to Settings; the older Recipes and foods page goes. Its first follow-ups were closed in the same step: archive and restore, a recipe line offered its food's new numbers, USDA names in sentence case, USDA carbs just below zero counted as 0 g, and the food sheet asking before it closes | §2, plus backend tests | Done · 2026-10-07 · fd42b34 |
| R4.4d | **Recipes for clients** (M4 and C7, decided 2026-10-07): assigning a plan copies each recipe's ingredients, method, prep and cook time and cover photo into the client's snapshot (NUT-006), and the client's day opens a recipe in a sheet; the recipe editor gains prep and cook time; the meal-plan builder offers "Use the newest version" for a recipe republished since; recipe photos no version names are removed 48 hours after upload (MED-014). Its first follow-ups were closed in the same step: the ingredients scaled to the client's portion, the recipe photo on the meal cards, and Print recipe | §2, plus backend tests (the snapshot, the client's read, the photo only for the client's own plan, another client, a released client, the 48-hour sweep) | Done · 2026-10-08 · 810f642 |
| P4b | **Adjusting next week from logged performance** (ADR 0036, decided 2026-10-07): the Training maxes panel suggests a new max from the best logged set of the week (1 to 8 reps at RPE 7 to 10), and the coach applies it through the existing preview; never automatic | §2, plus domain reference tests (which sets count, the estimate) and API tests (other coach, released client, kg and lb kept apart) | Done · 2026-10-08 · d9835b2 |
| P4c | **Suggested maxes, P4b's follow-ups** (owner, 2026-10-08: "do the last session's not-done work"; decided by Claude after comparing competitors, ADR 0036): **Keep this max** on a suggestion (STR-013), Coach Today names the lifts whose logged sets suggest a new max (CLI-018 v2), a newer set during review says so, and demo clients hit their numbers. Its own follow-ups were closed in the same step: a new program starts where the last one ended, with the last program's suggestion one tap away in Assign program and on Coach Today's No program item (STR-014), and the client list has a Maxes to review chip | §2, plus domain tests (the keep, the attention rule, the carried max) and API tests (keep, retry, newer set, other coach, other workspace, released client, Coach Today, append-only, carry from the latest program only, the same client only) | Done · 2026-10-08 · cac5874 |
| P4d | **P4c's last two follow-ups** (owner, 2026-10-08: "the last session's not-done work"; decided by Claude after comparing competitors, ADR 0036): the client's **Training max history** lists every program's training maxes beside the recorded ones, named with the program and the week they apply from (STR-015, each fact stored once), and Coach Today keeps a number and its unit on one line at 390 px | §2, plus API tests (asked for or not, order, pages, lift filter, other coach, other workspace) | Done · 2026-10-08 · 7b6218b |
| R5.1a | **Plans you sell** (C8): each plan a card with its price options (shortest first), what they include and the coach's clients on each, now and starting (SUB-015); New plan, Add price option, Change price and Edit name and description in sheets; Stop selling and Sell again with Undo; old price options and plans no longer sold behind a closed disclosure | §2, plus API tests (counts per option and plan, each client once, cancelled and released left out, a Coach's own clients, another workspace) | Done · 2026-10-08 · 7d758d8 |
| R5.1b | **Exercise library** (C10): the coach's exercises as cards with their first picture or video (or a lettered tile), or as a list; a search and four filter chips (muscle, pattern, type, equipment) plus Archived too, all in the address; New exercise as a quick add (name, a YouTube or Vimeo link, what it trains) with More details (how to do it, other muscles, tags, swaps, pictures and videos, uploads) in one sheet that Edit opens too; Archive with Undo. Two server bugs found on the way were fixed: a video link added twice answered 500 (MED-015), and editing an exercise to add a muscle or a second video answered a conflict (LIB-002) | §2, plus API tests (the same link twice, by a colleague, after removal, at the same moment, another workspace, a client refused; an edit adding and dropping every kind of row) | Done · 2026-10-09 · 01b6118 |
| R5.1c | **Notifications**, including the client's training notices (ADR 0036: a new program, a week shared, a shared week changed, a coach's workout note; in-app only). The inbox for coaches and clients in days (Today, Yesterday, the weekday, the date), All and Unread, Mark all as read, and each notice opening what it is about (a week or a finished workout in Training, a session on a client's Training, a client's plan); no Refresh button, the badge reads itself again. The client hears only what they can see now (NOT-035), and the coach hears of a client's note on a workout (decided by Claude, ADR 0036). Notification settings rebuilt in cards, with the leave warning (§9). The demo delivers its notices as it is built | §2, plus domain tests (the week wording, the kinds) and API tests (each notice, only what the client can open, a note both ways without its text, a notice no longer true left unsaid, unread filter, mark all only the reader's own, another workspace, signed out) | Done · 2026-10-09 · 89291d9 |
| R5.2a | **Settings, Team, Billing** (C9): one Settings layout for staff, the coaching space's pages (the owner's: Name and region, Brand, Nutrition, Team, Billing) and the person's own (Notifications, Appearance, Password and security), a column on a wide page and a row that scrolls on a phone; Name and region rebuilt (the time zone from a searchable sheet, the week's first day, the currency new plans start in, the leave warning); Team with faces, Invite a coach in a sheet and each row's actions in a menu; Billing with what is owed first, how to pay with copy buttons, this month so far and a clean list of invoices that open in a sheet; Password and security rebuilt for staff and clients, Sign out everywhere asked first, leaving in a kit dialog | §2 | Done · 2026-10-09 · 2e0497a |
| R5.2b | **The platform admin screen** (ADR 0028): every coaching space in the order that needs the admin first, with what it owes, when it falls due and when it locks; a page for each space (invoices, this month, discounts); sheets to record a payment dated the day the money arrived, void with or without a corrected invoice, grant and revoke a discount, and publish a price plan version after seeing what changes; and the kit's new date field instead of the browser's date inputs | §2, plus API tests (a payment's date in the service and the database, the list's due and lock days) | Done · 2026-10-10 · cb30bd1 |
| R5.3a | **Invitations** (C2): who is waiting to join first with what happens next, Invite a client in a sheet (a name and an email, an optional phone and a birth date typed in three boxes), Send again, and Cancel after asking, Invite again when a link ran out or was cancelled, everyone earlier behind a closed disclosure; the kit's typed date input | §2, plus Vitest (the invitation tenant-ownership tests moved to the sheet) | Done · 2026-10-10 · ad46000 |
| R5.3b | **My profile and the intake form** (M8, C3): the client's first-run questions as five short steps, each saved as they go and resumed where they stopped, then their answers as cards with an Edit sheet on each; the coach's view of the same answers with the same sheets, what a client still needs, and Finish setting up for the starting weight; the typed birth date; and the unsaved-changes guard on the steps and the sheets (§9) | §2, plus Vitest (steps, resume, validation in words, refusals, the guard, a late answer after a workspace switch) | Done · 2026-10-10 · a865fce |
| R5.3c | **Weigh-ins, photos and measurements** (M5): the client's logging pages on the kit | §2 | To do |
| R5.3d | **The coach's client nutrition and training tools** (C3, C7): the targets calculator and the max history | §2 | To do |
| R5.3e | **The leftovers**: check-in forms and assignment buttons, the coach's workout page, the empty and status styles on Training, the plan dialogs' notes, the top bar's sign-out | §2 | To do |
| R5.3f | **Delete the legacy CSS** (the global rules and variables in `styles.scss`), add the lint check, final words pass, close every §9 item | No legacy variables, no default buttons, §9 empty | To do |
| R6.1 | **Share cards** (M9), created only by the client, with consent each time | §2 | Optional |
| R6.2 | **Homepage** pre-render, GSAP scroll story, Jitter hero video (the owner makes the assets) | §2 | Optional |

**Design approval:** the owner approved the prototype direction on 2026-09-28. The partner saw
and approved the saved artifact design, as the owner confirmed on 2026-09-29. R1.4 is the review
of the implemented R1.3 screens before production rollout.

### Follow-ups

*(Sessions add items here instead of building them.)*

- **Demo data gaps (from R0.1).** The demo has no progress photos
  or coach/exercise media (the real M1 uses coach initials until a profile photo source exists; use
  licensed images, never AI-made people), and no former client. Add each when its screen is built.
- **Planned workout duration (from R2.1).** Training sessions do not store one, so the Today hero
  shows exercise and set counts. Add a real planned duration to the training contract before showing
  an estimate; do not infer minutes from set count.
- **Demo freshness.** Dates are relative to the day the command runs, so the data ages. Rebuild it
  before every screenshot review or demo. Since 2026-10-04 (owner's decision for R3.6) the demo has its
  own database, `tbgym_demo` in the Docker PostgreSQL, because the development database `tbgym` holds
  the owner's own accounts: never drop `tbgym`. Set `$env:POSTGRES_DB = 'tbgym_demo'` in the terminal
  before `.\scripts\demo-workspace.ps1` and `.\scripts\run-api.ps1`; to rebuild, first run
  `docker compose exec postgres dropdb -U tbgym --force --if-exists tbgym_demo`.
- **Progress photo demo assets (R2.3).** The protected photo timeline and comparison work with
  granted thumbnails; the Atlas demo still needs two consented, licensed photos of the same pose
  before that section can be photographed with real demo data.
- **Demo billing.** The demo workspace is backdated past its trial. If the Worker runs against the
  demo database it will invoice Atlas, and the workspace turns read-only after the grace days unless
  the platform admin records the payment.
- **Backend words (from R0.2).** Text written by the API still uses system words: notification
  titles and bodies ("Open your workspace…", `NotificationTemplates.cs`), stored history reasons
  ("Assigned from a published program template."), emails and problem messages such as the
  training-coverage refusal. They need a backend words pass with its own tests.
- **Reading live messages (from R2.5a).** A message that arrives while its thread is open shows at
  once but stays unread until the thread is next opened: the screen moves the read cursor only when
  it loads a thread, and a test pins "never advances read state from a realtime event" (ADR 0020
  keeps delivery apart from reading). So the Messages badge can count a message already on screen.
  Advancing the cursor for a message shown while the page is visible would fix it; it changes a
  documented read rule, so it needs an owner decision.
- **Coach chat extras (R3.5b, R3.5c).** R3.5b built search, the filters and the client beside the
  thread; R3.5c saved replies. The owner said "continue" without choosing between each coach's own
  replies and replies shared with the team, so R3.5c built Claude's recommendation: each coach's own
  (MSG-023). Sharing a reply with the team would be a later, separate choice. C5's "reply with saved
  templates" can use the same ones. They stay plain text the coach edits before sending: MSG-004
  allows no template that fills itself in, so "{first name}" is not offered.
  Removing your own message stays immediate, as it always was, now behind the message's options; an
  undo would need care because removal is one way (MSG-008).
- **Searching message text (from R3.5b).** The inbox search reads names only (MSG-022); searching
  what was said is deferred by the roadmap (Phase 6B) and would need its own index and access rules.
- **The client beside the chat is read when a thread opens (from R3.5b).** A workout the client
  finishes while the coach has the thread open shows the next time it is opened, like the plan.
- **Nutrition day refusals (from R0.2).** A day with no meal plan and a refused day share one
  message ("There is no meal plan for this day…"). Map each access reason, as check-ins do, when
  M4 is rebuilt (R2.4).
- **Translations.** `src/web/src/locale/messages.xlf` has not been regenerated since Phase 5, and
  R0.2 changed about 250 source strings. Run `npm run i18n:extract` before any translation work.
- **Check-in photos (from R2.4c).** The check-in's photo step saves ordinary progress photos dated
  today; nothing links them to the check-in record, because ADR 0016 defers check-in file uploads.
  Since R4.3 the review shows the client's progress photos by the day they were taken, up to the day
  the check-in was sent. Attaching photos to a check-in, or letting a coach turn the photo step off
  per form, needs an owner decision and backend work.
- **Client "today" (from R2.4c).** The check-ins page shows plain due dates ("Due Sun 4 Oct"), not
  "Due today" or "Overdue", because only the training API returns the workspace's date to a client.
  A small own-workspace date read would allow relative wording without trusting the phone's clock.
- **Client dark mode (seen in R2.4c).** Today, Nutrition, Progress and Check-in use brand tokens but
  none is marked `REDESIGNED`, so all stay light in dark mode. Mark them together after one dark
  screenshot pass. (R2.5c marked Me, since dark mode is chosen there.)
- **Scale answers in other languages (from R2.4c).** "8 out of 10" formats the number with plain
  digits, as the coach's comparison view already did. Use locale number formatting with the
  translation work.
- **E2E writes into docs (seen in R2.4c).** `nutrition-day.e2e.ts` and `workout-progress.e2e.ts`
  save their screenshots into `docs/design/`, so every full e2e run rewrites committed images. Point
  them at `test-results/` as `checkin.e2e.ts` does.
- **Prototype fidelity pass (owner, 2026-10-01).** The owner felt the built screens have the
  prototype's feel but not its look, and will test the app and list changes per screen. Claude
  recommended doing that after R2.5c, before the coach side. Gaps found against the prototype:
  - **Motion.** GSAP runs only in the dev lab (`hero-lab`). The client screens have no motion: no
    card opening into the player, set tick, PR burst, rest ring or count-ups (§3 signature moments).
  - **Rest timer.** It works (starts after a ticked set, keeps time while the phone is locked,
    +15 s, Skip, screen kept awake), but at zero it just disappears; the prototype buzzes and says
    "Rest is over".
  - **Workout player.** The kg/lb choice is a browser `<select>` (forbidden by §2), the client tabs
    show inside the player, and the prototype's set table with a "previous" column and the pill
    tools (Watch demo, Note, Swap) are not there.
  - **Type and accent.** Today, Check-in and other pages use small italic serif titles; the
    prototype uses bold sans headings, lime for done days, ticked sets and the active tab, and a
    coach pill with a face. R2.5b's Training page follows the prototype, so it can serve as the
    comparison.
- **Doing a missed session later (from R2.5b).** The API lets a client start a past session while
  its block is active, but no screen offers it: the Training page marks it missed. Offering it is an
  owner decision (TRN-020).
- **A finished workout from an earlier day (from R2.5b).** History rows show sets, volume, time and
  records but open nothing; the player opens only today's and unfinished workouts.
- **Weight unit in the workout player (from R2.5c).** Me's saved unit reaches weigh-ins and
  Progress but not the player: TRN-016 says a set with no prescribed unit asks rather than assumes,
  so a client who chose lb on Me is still asked there. Pre-selecting the saved unit in the draft (the
  client could still change it) would fix that. It changes TRN-016, so it needs an owner decision;
  Claude recommends yes.
- **The coach's brand and the installed app (from R2.5c).** The manifest, icon and launch colours
  are TB Gym's own and static, so a coach's brand (R3.5a) does not colour the home-screen icon or the
  phone's launch screen. Per-coach manifests would need the server to render them; not planned.
- **Old screens behind Me (from R2.5c).** My profile (the intake form, which the coach's client page
  reuses), Password and security and Notification settings are still the old screens. Rebuild each
  with its unsaved-changes guard (§9): the intake form with R3.3, notifications with R5.1 and
  security with R5.2. Notifications was rebuilt in R5.1c, Password and security in R5.2a and My profile
  (with the intake form and its leave guard) in R5.3b.
- **The brand hero (from R2.5c).** Training and Me each carry their own copy of the hero's gradient,
  glow and dots. Move it into one shared style when a third screen needs it.
- **Coach Today extras (from R3.1).** The prototype's "+3 this month", "↑ 6% vs this point last
  week" and "$240 at stake" are not returned: the deltas need agreed definitions, and plan prices in
  different currencies cannot be added up. The feed has no nutrition line ("logged every meal" needs
  a definition of a complete day) and no client messages (their text stays in the chat). Weigh-ins
  are not feed lines either: on the Atlas demo, daily weigh-ins filled 14 of the 20, so they only
  count as last activity. A weekly line ("82.4 kg, down 0.6 kg") would need the honest-trend rules of
  ADR 0013. The "Live"
  dot needs a push channel; until then the screen reloads.
- **The Owner's Today in a gym (from R3.1).** The Owner's queue covers every coach's clients
  (CLI-013), each item naming its coach. An owner with several coaches may want "Mine / Everyone";
  R3.2 can filter on the coach id without backend work. The same holds for the Clients list
  (R3.3a), where a coach chip could sit beside the others.
- **Coach Today, not built in R3.2.**
  - The sidebar has no Today count. It would need the queue read on every page.
  - No GSAP count-ups or chart draw-in yet, only a CSS bar growth. This belongs with the
    prototype fidelity pass.
  - Queue actions open the place to act; nothing is resolved in place. "Missed sessions" opens
    the client's training rather than a message, because Today does not know whether messaging
    is in that client's plan.
  - The coach's brand logo in the sidebar came with R3.5a.
- **Missed-session rule (from R3.1).** The owner asked Claude to choose: TRN-021 counts misses since
  the client's last workout, 14 days back. Revisit after the founding coaches use it (R3.6).
- **Initial bundle budget.** The initial bundle is 539.2 kB against the 520 kB warning (530.1 kB
  before R2.4c, which added only three icon glyphs; R2.5a's shell changes added about 1 kB, R2.5b
  0.2 kB, its mapping kept in the lazy Training chunk, R2.5c 3.9 kB: the install service, four
  icon glyphs and the saved-unit code, R3.2 0.3 kB, Coach Today itself being lazy, and R3.3a 0.2 kB,
  the search glyph in the shared icon set, which brought it to 536.2 kB). R3.3b put the client page's
  two reads in `ApiClient` and measured 536.1 kB. R3.4a kept its read in a feature-local
  `ClientProgramApi` and measured 534.7 kB; its stylesheet, `client-program.scss`, is 7.2 kB against
  the 5 kB component-style warning (8 kB is an error), like the Today, Messages and Progress ones.
  R3.5a measured 537.9 kB: `WorkspaceBrandStore` and the sidebar's space name and logo (+3.1 kB). The
  colour derivation it needs (`brand-theme.ts`, `color.ts`, about 2.5 kB) is a lazy chunk the store
  fetches at start-up, so the first frame still wears the coach's colours. R3.5b measured 538.3 kB
  (+0.4 kB, the list's filter and search parameters in `ApiClient`); `messages.scss` is 7.5 kB, the
  client column's own styles living in its component. R3.5c measured 538.3 kB, and the Angular 22.2.1
  upgrade (2026-10-04, which cleared the router and `piscina` audit advisories) 539.2 kB: +0.9 kB of
  framework code. R4.1 measured 541.3 kB (+2.1 kB): two icon glyphs, the drag preview rule, and CDK
  helpers that drag and drop shares with the overlay code already loaded at start-up (about 1.6 kB
  in the shared chunk). The builder, drag and drop included, is a lazy chunk; its week stylesheet,
  `program-week.scss`, is 6.8 kB against the 5 kB warning. R4.2a measured 541.7 kB (+0.4 kB):
  `UnsavedWork`, which the workspace switch and sign-out ask before acting; the drafts, autosave and
  the confirmation dialog stay in the builder's lazy chunk. R4.2b keeps the initial bundle at
  541.7 kB; inline editing and preview stay lazy, with `program-week.scss` now 7.3 kB. R4.3 keeps it
  at 541.7 kB too: the check-in list and review are lazy (the review's chunk is about 39 kB, saved
  replies included), and both stylesheets stay under the 5 kB warning. P1 and P2 were not measured; the
  build at their commit reads 542.13 kB, and P3a keeps it there (the sheet and its models stay in the
  lazy client-program chunk, and its inline styles are under the 5 kB warning). P3b keeps it at 542.13 kB:
  Edit weeks is its own lazy chunk (about 62 kB with the builder's grid pieces it reuses), and its own
  stylesheet is under the 5 kB warning. P4a measured 542.33 kB (+0.2 kB, the `play` glyph in the shared
  icon set); `ExerciseDemo` loads with the lazy pages that use it. R4.4a keeps it at 542.33 kB: the meal-plan
  builder is its own lazy chunk (about 82 kB), and its two stylesheets warn as the program builder's do
  (`meal-plan-builder.scss` 5.6 kB, `meal-plan-days.scss` 7.4 kB; the error is at 8 kB). R4.4b measures
  542.23 kB: the recipe pages are lazy chunks (the editor about 50 kB), the old library page shrank, and
  `recipe-editor.scss` warns at 6.3 kB. R4.4c measures 540.42 kB: Foods is a lazy chunk (about 47 kB
  with its two sheets), and the older library page and the food calls `ApiClient` carried are gone.
  R5.2a measures 542.60 kB: every Settings page and `SettingsFrame` load lazily with their routes, and only
  the route guards, the sidebar's Settings addresses and a menu word changed at start-up; `billing.scss`
  warns at 5.85 kB (the error is at 8 kB).
- **"Need you" and "Needs attention" count differently (seen in R3.3a).** On the Atlas demo, Today
  says "10 clients need you" and Clients "8 need attention": a plan ending soon puts a client in
  Today's queue but gives them the Ending soon status, not Needs attention (CLI-018). Both are
  right, but a coach may read them as a mismatch. Rewording Today's line ("8 need attention, 2 plans
  ending") or linking Today's tiles to `/clients?show=attention` and `?show=ending` would join them
  up; R3.2's files, so not changed here.
- **A very large client list (from R3.3a).** Clients draws every row; fine for founding coaches (10
  to 80 clients). A gym with several hundred would want CDK virtual scroll or paging on the
  server. The search text is not kept in the address, so typing never navigates.
- **Entry and correction tools (from R3.3b).** Recording a weigh-in, measurement or photo for a
  client, and correcting or re-dating one, are still the older forms (browser selects and date
  inputs) behind "Entries and corrections", in a light scope inside a dark page. Rebuild them as
  sheets with the unsaved-changes guard (§9); the client's own `/progress` page opens the same
  screen.
- **Client Progress in dark (from R3.3b).** The weight, bar and photo-compare pieces now draw with
  `--tb-accent-ink` and `--tb-chart-band`, and the dashboard's own colours are tokens, so the
  client's Progress can be marked `REDESIGNED` after one dark screenshot pass (see "Client dark
  mode"). Its "Personal records" list shows all 12 at once; the coach's does too, and both could
  show five with "Show all".
- **An unsaved coach note (from R3.3b).** A refresh or closed tab asks first, but moving to another
  section discards a note being edited. R4.2a built the kit's leave confirmation for C4 (`UiConfirm`
  in a Dialog, the `confirmBeforeLeaving` route guard and `UnsavedWork` for a workspace switch or
  sign-out); the coach note, C7 (§9) and the Brand page (R3.5a), which also only asks before a refresh
  or a closed tab, can use it. The intake form uses it since R5.3b.
- **Numbers in right-to-left (from R3.3b).** With English text in an RTL layout "60 kg × 5" and
  "2 of 5" reorder their pieces, as they already do on Today and Clients. Settle it with the
  translation work (locale number formatting, isolating each figure).
- **Older training tools (from R3.4a).** Training max history (with the form to record one) and an
  exercise's history are still the older forms, behind "More training tools" in a light scope inside
  a dark page. Rebuild them as a sheet and a chart with the unsaved-changes guard (§9).
- **Sheets on a wide screen (from R3.4a).** Every sheet opens from the bottom, centred, 40 rem wide,
  at every width. A side drawer from about 960 px would suit the long ones, Assign program and Build
  next block.
- **Closing a program with a missed session (from R3.4a; decided and built 2026-10-03).** The owner
  left both R3.4a questions to Claude. Once a block's last day has passed the coach may close it as
  finished (TRN-013): Manage program's **Close program** says the missed sessions stay on record, and
  the client can no longer start them late (the API used to allow it). Before the last day it is still
  Cancel or Reschedule. Other coaching apps simply end a program on its date with the misses kept. An
  automatic close on the last day is possible later; it would need a scheduled job.
- **Training before a booked plan begins (from R3.4a; decided and built 2026-10-03).** The coach's
  program, workout and records reads open before a booked plan begins (TRN-023): a new client, or the
  gap before a renewal, since the coach may already assign and change programs on those dates. The
  program's header says "Maya sees it from Mon 12 Oct, when the plan starts". The client's own reads
  still follow today.
- **Engine sentences (from R3.4a).** The sheets rewrite the refusals the server is known to send
  (overlap, coverage, a stale version, a started program) into coach words in `programWriteError`, and
  show a generic line for anything else that still names the engine. The backend words pass above is
  the real fix.
- **Correcting a payment (from R3.4b, needs an owner decision).** Receipts are append-only (SUB-007), so
  a coach who records the wrong amount or method has no way to correct it on screen; reversals and
  corrections are reserved as new linked operations but not designed. Until then a wrong receipt stays,
  and an overpayment is refused.
- **Older dialogs inside Service & access (from R3.4b).** Reassign coach and End coaching keep their
  native `<dialog>` forms, now inside the new page's rows; move them to the kit Dialog with the rest.
- **The legacy `label > span` rule (seen in R3.4b).** `styles.scss` still gives any span straight
  inside a label a fixed colour (`#344149`), size, weight and margin, which is wrong on dark and on the
  new sheets; R3.4b's price cards restate each property. R4.3 found it in the kit's `PhotoCompare`
  too: its two date labels failed contrast on dark until the kit restated them. Remove the rule once
  the last legacy form is gone.
- **The brand outside the app (from R3.5a).** Sign-in, accepting an invitation, emails and notifications
  are still TB Gym's: a person signs in before any workspace is known. Branding the invitation page and
  emails would need the workspace on those requests; not planned.
- **A logo on its tile (from R3.5a).** Every logo sits on a white tile, so a dark logo on a clear
  background stays visible on the dark sidebar; a white logo on a clear background would vanish. A
  per-logo backing choice could come later if a founding coach has one.
- **Logo uploads never saved (from R3.5a).** A logo previewed but never saved stays in storage, counted
  in the allowance, until the next brand save tombstones it. A sweep for unsaved logos older than a day
  would reclaim them sooner.
- **Header extras (from R3.3b).** The header shows initials until there is a profile photo source,
  and the owner sees "Coached by …" only for a team member's client. A "Last active" line beside the
  plan is possible: the new overview read already returns it.
- **Program builder, left for later (from R4.1).**
  - Approved swaps offer the exercise's alternatives from the library plus any approved before. The
    old screen's multi-select could approve any exercise; an "approve another" picker would bring
    that back.
  - "Add to saved sessions" copies the session from a saved version, so since R4.2a it waits for
    Publish ("Publish the program first").
  - With five or more training days beside the library, a week scrolls sideways; "Hide exercises"
    gives the grid the page.
  - On a phone, a session moves to another week only through a wide screen (there is no "Move to
    week" in its menu).
  - The Atlas demo has no exercise pictures, so its library shows initials (see "Demo data gaps").
  - `ui/menu.ts` (`UiMenu`) is the kit's menu now. The client page's `ClientActions` could move to
    it.
- **Program drafts, left for later (from R4.2a).**
  - Programs' summary line ("4 programs, 4 ready to assign") counts saved programs only, not the
    coach's new drafts listed above them.
  - A card keeps the program's published name while the coach's draft renames it; the draft's name
    shows once it is published.
  - Drafts of a coach who left a workspace stay with their ended membership, unseen. A sweep could
    remove them, and new-program drafts untouched for months, if storage ever matters.
  - The leave confirmation (`UiConfirm`, `confirmBeforeLeaving`, `UnsavedWork`) is ready for the other
    editors that still lose work on navigation: the coach note, Brand and C7 (the intake since R5.3b).
- **Check-in review, left for later (from R4.3).**
  - Assigning a check-in still happens on the older Client check-ins screen (`/checkins/clients`),
    which also keeps its older way to read and compare. An Assign sheet on the client's Check-ins
    would let that screen go; C5 never specified assigning.
  - After Mark reviewed the coach goes back by hand. A "next check-in to review" step, from Today's
    queue, would make a Monday of reviews faster.
  - The reply in the chat carries no link back to the check-in it answers.
  - An owner's reply goes into the owner's own chat with the client, as the header's Message does:
    a conversation belongs to one coach and one client.
  - Comparing more than two check-ins, or one question over time, stays deferred (roadmap 6A), and
    would need a decision about what a series of answers may imply (CHK-012).
- **Progress photo compare order (seen in R4.3).** On Progress the slider's "before" side shows the
  newest photo and "after" the oldest: the dashboard sends its previews oldest first and
  `progress-dashboard.ts` takes them the other way round. The labels carry the right dates, so nothing
  is misreported, but the sides are swapped. A one-line fix in that file.
- **Progression when duplicating a week (decided 2026-10-05).** The owner approved it: steps P1 to P4
  above and ADR 0036. The first built is the builder's "Duplicate with progression" (P1). Left for
  later from P1: the weeks a coach adds are plain numbers, so weights from a max are worked out when
  a program is assigned (P2 shows them, with their explanation); the RTS chart stops at RPE 6.5, so an
  RPE 6 set needs a typed weight or the Epley curve, and covering RPE 5 to 6 would need a new chart
  version and the owner's decision.
- **Training maxes (from P2, built 2026-10-06; screenshots `docs/design/p2-*.png`).** The panel sits
  beside the program's header from 64 rem of page width and under it on a phone; the sheet that
  updates the maxes shows every changed weight first (ADR 0036). Left for later: (1) choosing the load
  formula again at assignment (decision 2 of ADR 0036 asks for it; today the formula is chosen in the
  builder, then the program is assigned); (2) on a wide page the header is shorter than the panel, so
  there is a gap under it, which a later step could fill (for example with the next sessions); (3) the
  per-client sequence "Meso 1" of TRN-002 was never built, so programs are told apart by name and date.
- **Build next block (from P3a, built 2026-10-06; screenshots `docs/design/p3a-*.png`).** The sheet takes
  the builder's four steps (TRN-027); each step says how many of the chosen weeks' sets it would move,
  the preview marks the sets that moved against the week each copy builds on, and one line names the
  formula the weights follow. Left for later: (1) choosing the formula again for the new block (each set
  keeps the one it has, as decision 1 of ADR 0036 says the coach picks it per program in the builder);
  (2) the new weeks are shared as their source week is, as before, so a coach who wants them private
  unshares them on the timeline; (3) a client is not told when a shared week changes, here or in the
  session swap: decided 2026-10-07, it came with R5.1c's training notices (ADR 0036, NOT-035); (4) the old RPE-only wording
  moved warm-up sets too, the builder's rule does not (TRN-025), so warm-ups now stay as they are;
  (5) a program only grows inside the plan it was assigned under (TRN-011), so on the Atlas demo, where
  every program ends with its plan, the sheet says "run past the end of the plan" for all but Sara
  Mansour (two spare weeks). It now says what to do next: fewer copies, or renew the plan and assign the
  next program; (6) the builder's "Duplicate with progression" panel gives its step fields `inputmode`
  "numeric" or "decimal", and a phone's numeric keypads have no minus key, so a negative step is hard to
  type there; this sheet leaves `inputmode` off its step fields for that reason (not changed in the builder).
- **Edit weeks (from P3b, built 2026-10-07; screenshots `docs/design/p3b-*.png`).** Manage program's **Edit
  weeks** opens `/clients/:clientId/training/:mesocycleId/edit`: the builder's grid with real dates, the
  sessions that started, finished or passed drawn locked with their state, days already gone closed, and the
  weeks holding them kept in place (TRN-028). Review changes shows the server's preview (what is new,
  changed, moved or removed, every new weight, a new end date, and what stops it, such as running past the
  plan); Apply changes carries out exactly that. The owner left "draft or one sitting" to Claude: one
  sitting (ADR 0036), with the leave confirmation, the workspace-switch question and the browser's warning
  before a reload. Left for later: (1) the grid template is a copy of the builder's, adapted for locked
  sessions; both share the models, sheets and stylesheets, and a shared grid component would remove the
  copy; (2) the library's "Add to saved sessions" and "Duplicate with progression" are not offered here
  (Build next block does the progression); (3) a client is still not told when a shared week changes, as
  in P3a (R5.1); (4) week labels that carry a number ("Week 4 · Heavy") are not renumbered when weeks move, as in
  the builder; (5) a phone moves a session to another week only on a wide screen, as in the builder.
- **Session extras (from P4a, built 2026-10-07; screenshots `docs/design/p4-*.png`).** Watch demo
  (`ExerciseDemo`, a new `play` icon) sits on the builder's and Edit weeks' exercise rows (the library's
  media) and beside each exercise of a client's session sheet (the snapshot the client was given, now on
  the coach's program read); it opens the picture or video in a sheet through the usual grant. The session
  sheet's workout view takes the coach's note ("Note for Maya on this workout"), and the client's finished
  workouts list every note ("You", "Your coach"). The player already had both. The kit's modal title bar
  is no longer a `<header>`, so two stacked modals no longer make two page banners (axe). Left for later:
  (1) the Atlas demo has no exercise media, so playback was checked with mocks and the grant test, not a
  real video; (2) a client is not notified of a coach's workout note (closed in R5.1c, ADR
  0036); (3) the coach's workout view keeps its older look (plain "Target:"/"Actual:" lines and
  hand-built units); (4) the client sees notes on finished workouts in Training, not on Today after the day.
- **Meal plans, left for later (from R4.4a, built 2026-10-07; screenshots `docs/design/r44a-*.png`).**
  (1) A meal's recipes are equal options the client chooses between (NUT-005): a version stores no order
  for them, so after Publish they come back in the order the server returns, and a day counts each meal's
  options at their average ("≈ 1,792 kcal"). A "main option" would need an order column and an owner
  decision. (2) Days are numbered, not weekdays: a plan runs from the day the coach picks when assigning
  it, as many days as it holds, so a month is four weeks (Add week copies the last seven days). (3)
  Assigning a plan stays in the client's older Nutrition section, which reads the same plans. (4) Publish
  has no preview sheet: the grid with every day's total is the preview, and the checks run first, taking
  the coach to the name, the targets, the day or the meal at fault. (5) A plan cannot be archived or
  deleted, as before. (6) The recipe panel lists published recipes only; Manage opens the older Recipes
  and foods page until R4.4b. (7) The old library's meal-plan form is gone; a version it saved as a draft
  stays in the plan's Versions and is published from the builder as the next version (ADR 0033). (8) A
  recipe dragged over the meals of a day leaves a thin line, not a slot, where it would land: a full slot
  opening in each meal it passed pushed the strip under the day out from under the pointer (found in the
  live pass). (9) The Atlas demo has one meal plan; a second (a cut, say) would show the list better.
- **Recipes, left for later (from R4.4b, built 2026-10-07; screenshots `docs/design/r44b-*.png`).**
  Decided by Claude for the owner after looking at Everfit, Trainerize, That Clean Life and
  MyFitnessPal: a recipe is saved as a draft or published (Everfit's model, and ours already), only a
  published one goes into meal plans, and a photo is one cover per recipe. Open for the owner: (1)
  **clients do not see a recipe's ingredients, method or photo** (their day shows the name and
  numbers only); Everfit and That Clean Life show the whole recipe. It needs the assignment snapshot
  (NUT-006) to copy them, a client read and MED-014 widened to the snapshot; recommended as its own
  step before R5. (2) A meal plan keeps the recipe version it was published with: after a recipe is
  republished, the meal-plan builder could offer "Use the newest version" per recipe (today the coach
  drags it in again). (3) Recipe photos no version names (uploaded, then not saved) are kept and
  counted in the storage allowance until a retention rule is decided (MED-014). (4) No prep or cook
  time, meal categories, tags or step photos (Everfit has them); no household units (cups,
  tablespoons, pieces), since amounts are only in the food's own unit (ADR 0008, no implicit unit
  conversion). (5) No Versions list in the editor (the server keeps every version). (6) USDA search
  needs the server's data.gov key; without it the ingredient search lists the coach's own foods and
  says USDA is not available. (7) The demo's recipes have no photos (none are licensed for it).
  **Decided by Claude for the owner on 2026-10-07 (R4.4c session), after looking again at Everfit,
  Trainerize, That Clean Life, Cronometer and Discourse:** (1) yes, as its own step R4.4d right after
  R4.4c and before P4b: Everfit's meal detail shows the instructions and macros, Trainerize's the
  ingredients, instructions and macros, That Clean Life's the ingredient list, directions, prep time
  and photo. Clients get the copy made when the plan was assigned, as Everfit's client copies are
  independent of the library. (2) yes, in the builder, built with R4.4d; it changes the coach's draft
  only, never a published plan or a client's. (3) an upload no version names is removed 48 hours after
  it was uploaded (Discourse's default grace for orphan uploads), built with R4.4d. (4) prep and cook
  time join R4.4d, since the client's recipe shows them; categories and tags wait until a library
  outgrows search (a plan's meal names already say breakfast or lunch); household units come after R5
  through the food's own portion weights from USDA, which keeps ADR 0008's no implicit conversion. (5)
  not planned.
- **Foods, left for later (from R4.4c, built 2026-10-07; screenshots `docs/design/r44c-*.png`).**
  Decided by Claude for the owner: only the owner changes the nutrition settings, as on every Settings
  page; TB Gym caps each workspace's AI allowance (ADR 0035 amended: TB Gym pays the provider, and
  Everfit and Trainerize sell AI inside their plans); USDA lists basic foods first and packaged products
  on request (a plain USDA search for "chicken breast" returned only US brand-name products, out of
  21,661 matches); a USDA food is changed only as a copy of the coach's own (Cronometer's "Edit a
  copy"). **Closed in the same step on 2026-10-07, decided by Claude for the owner after looking at
  Cronometer, Everfit, FSANZ and the US and EU labelling rules:** (1) a food is archived, never deleted:
  Cronometer offers "Retire" (kept in history, gone from the list) beside a "Delete" that also wipes
  every diary entry, and Everfit's Remove says nothing of what uses the ingredient; here recipes and
  client plans name the versions, so archive it is, with Undo, a list of archived foods and Restore,
  and adding an archived USDA food again restores it. (2) A recipe line offers its food's new numbers
  ("Use its new numbers", or for all lines at once); the recipe changes only when saved, and the amount
  is kept only in the same unit. (4) USDA's capitals read in sentence case ("Greek yogurt"), like its
  basic foods' names. (6) USDA's carbs between -0.5 g and 0 per 100 g count as 0 g and the food keeps
  USDA's figure (the four raw chicken cuts with skin are -0.17 to -0.48 g; FSANZ explains these as
  measurement error in low-carb foods; EU labels may declare 0.5 g/100 g or less as 0 g, US labels
  under 0.5 g a serving); lower is refused and left out of the search (NUT-003, ADR 0008). (7) The food
  sheet asks before it closes with something typed. Imports now also keep Foundation foods' Atwater
  energy as USDA's calories, as the search showed. Left: (3) A USDA copy cannot be renamed without
  copying it. (5) No screen for a food's label photo or for raw-to-cooked factors. (8) A ceiling per TB
  Gym plan, or one the platform admin sets per workspace, would replace the one server setting. (9) A
  line made through cooking factors is not offered new numbers (none can be made on the new screens).
  (10) A meal plan keeps the recipe version it was published with, so a food's new numbers reach a plan
  only through the recipe (R4.4d's "Use the newest version"). (11) No count of the recipes that use a
  food before it is archived, and no archiving several at once.

- **Recipes for clients, R4.4d's follow-ups (built 2026-10-08; screenshots `docs/design/r44d-*.png`).
  Decided by Claude for the owner on 2026-10-08**, after looking at Everfit (changing a portion
  rescales the recipe's ingredients and macros for the client, help article "Adjust recipe portion
  size"), ABC Trainerize (the same in its meal planner), That Clean Life (the client portal shows recipe
  photos; clients export a plan or a recipe as a PDF only when the practitioner turns on "Allow
  exports") and Nutrium (a recipe's "Print Out" prints it or saves a PDF). Built in R4.4d: (1) the sheet
  lists the ingredients for the client's portion (amount × their servings ÷ the recipe's), with "Whole
  recipe" one tap away because the method is written for it; (2) each meal card shows its recipe's
  photo, every option's asked for in one batch grant (MED-014 unchanged: only the client's own active
  plan); (3) **Print recipe** opens the browser's print dialog, which also saves a PDF; the sheet prints
  alone and always light. Not built, on purpose: (4) no share link or coach "allow exports" switch. A
  recipe is the coach's work; the client already sees every word, so a switch would protect nothing,
  and a public link would be a new kind of access for the owner to decide. (5) No "Use the newest
  version" for a food on its own: a food edit reaches a plan in two deliberate steps (the recipe's "Use
  its new numbers" and Publish, then the builder's "Use the newest version"), which keeps every recipe
  version and plan snapshot what it was (NUT-006); a shortcut in the builder would publish recipe
  versions from the meal-plan screen. Still open: (6) a client's copy keeps no allergens of its own; the
  plan's allergen review happens at assignment, as before.

- **Suggested maxes, P4b's follow-ups (built 2026-10-08; screenshots `docs/design/p4b-*.png`, from a live
  Atlas pass).** Each lift of the Training maxes panel says what the client's logged sets suggest ("Logged
  sets suggest 70.9 kg, up from 62.5 kg", naming the set), and **Review the new weights** opens the update
  sheet on that estimate, already worked out; the sheet also offers it as a third choice beside a typed
  max and week 1's weight (STR-012). Decided by Claude for the owner on 2026-10-08 (ADR 0036, "As built"):
  the latest week with a finished workout speaks; only sets logged after the max in use count; the server
  accepts only the set the rule picks now. Left: (1) **demo data**: the generator logs weights below the
  prescription, so most demo suggestions point down (Jad's squat 120 to 101.7 kg); make demo clients hit
  their numbers before showing P4b to founding coaches. (2) No "keep this max" on a suggestion: it stays
  until the coach changes that max or newer sets replace it; add one if coaches find it noisy. (3) A newer
  best set logged between the preview and Update answers with the general "This program changed since you
  opened this" message; a code of its own could name the new set. (4) Coach Today does not mention
  suggestions. **All four were built in P4c (2026-10-08; screenshots `docs/design/p4c-*.png`):** the demo
  logs honest RPEs and its only suggestion is Maya's deadlift, 77.5 to 80.75 kg; **Keep 77.5 kg** sits beside
  Review the new weights; a newer set answers `training_max_suggestion_changed` and the sheet reads the new
  estimate; Coach Today, the client's page and the client list show "Maxes to review", last, without
  making the client Needs attention, and **Review maxes** opens Training with the suggestion in view.
  Left: (5) a client between programs (the last one ended) has no Coach Today item, because only running
  or coming blocks are read; the ended program's own panel still suggests, for Build next block. (6) The
  suggestion is not sent to the coach as a notice; notifications come with R5.1. (7) The client list's
  "Needs attention" filter does not offer "Maxes to review" as a filter of its own. **All three were
  closed in P4c on 2026-10-08, decided by Claude for the owner after comparing competitors (ADR 0036,
  STR-014; screenshots `docs/design/p4c-next-*.png`):** (5) the next program starts where the last one
  ended. Everfit, TrainHeroic and TrueCoach keep one max per client, so the next program uses it; here
  Assign program fills each lift from the latest program's max in use and offers its suggestion ("Use
  80.75 kg"), and Coach Today's No program item names it and opens Assign program, rather than a Maxes to
  review item for a program that can no longer be updated. (6) No notice for a suggestion: never urgent,
  frequent, and already on Coach Today; TrainingPeaks emails its equivalent only when a coach switches it
  on per athlete. It can come back as an opt-in if founding coaches ask. (7) A **Maxes to review** chip,
  shown only while some client has one, so coaches who never program from maxes see no empty chip. Not
  built: (8) a max raised during a program is not written back to the client's recorded maxes (More
  training tools); Assign program reads the latest program instead, so nothing is lost, and the history
  stays the coach's own entries. (9) At 390 px Coach Today's suggestion line can break between a number and
  its unit ("67.82 / kg"); a no-break space in `suggestedMaxDetail`, as Assign program now uses, fixes it.
  **Both were closed in P4d on 2026-10-08** (screenshots `docs/design/p4d-*.png`). (8) was decided by Claude
  for the owner after looking at Everfit (one 1RM per lift, its history on the client's profile, set by the
  coach or raised by the app) and TrainHeroic (one working max per athlete): the history now lists every
  program's training maxes beside the recorded ones ("Lean & Strong · Phase 2, from week 1, typed"), each
  fact stored once (STR-015, ADR 0036); copying them into the recorded maxes would have stored them twice and
  offered them to Assign program as saved maxes. Recorded rows say "Recorded by a coach", "Tested" or
  "Estimated (Epley)" instead of a method code, and the column is "Where from". (9) is the no-break space.
  The history itself is still the older form (see "Older training tools").

- **Plans you sell, R5.1a (built 2026-10-08; screenshots `docs/design/r51a-*.png`). Decided by Claude for
  the owner on 2026-10-08**, after looking at Everfit (a teammate manages only the clients they are added
  to; packages are set up once and sold many times) and ADR 0026: (1) **a Coach's counts are their own
  clients**, the Owner's every client still coached here, never a released one, so the page agrees with
  each person's client list (SUB-015). (2) **On a plan** means a plan neither cancelled nor expired that
  has not ended: "now" when it runs today, "starting" when booked for later, each client once, so a booked
  renewal does not count twice. (3) **Stop selling has Undo and no confirmation**: it never touches a
  client already on the plan (SUB-002), as archiving a food does. (4) Words follow §6: a product is a plan
  you sell, an offer a price option; the sidebar keeps "Products". (5) What a plan includes is shown once
  when all its options for sale agree, else per option. Not built: (a) money per plan (what it brought in
  this month) needs a payment read of its own; (b) the counts are not yet links to the client list filtered
  by plan; (c) a length in days (the server accepts it; the sheets offer weeks, as the old page did);
  (d) choosing per feature whether two plans may overlap (`allowsConcurrentCoverage`) stays off screen, as
  before; (e) a plan's cover photo, a public page or a checkout link would be a new way to sell, an owner
  decision.

- **Exercise library, R5.1b (built 2026-10-09; screenshots `docs/design/r51b-*.png`). Decided by Claude for
  the owner on 2026-10-09**, after looking at TrueCoach (Add New Exercise asks for a name and a video URL or
  an upload, then Save) and Everfit (its library filters by modality, muscle group and movement pattern;
  equipment sits under advanced settings): (1) **quick add asks for the name and a video link first**, then
  type, main muscle, pattern and equipment, starting from the filters in use; everything else is under More
  details. (2) **Four filter chips** (muscle, pattern, type, equipment) and Archived too, applied at once and
  kept in the address, replace the three selects and Apply. (3) **A video link added twice is one asset**
  (MED-015): coaches reuse one demo across variations, and the server answered 500 before. (4) **Archive has
  Undo, no confirmation**: programs already built keep the exercise, as before. (5) **No YouTube or Vimeo
  pictures** on cards: the app's pages allow images from TB Gym only (nginx `img-src 'self'`), and loading
  them would send every coach's library view to Google; a link shows a play tile. Not built: (a) the demo
  still has no exercise media (licensed footage only, see "Demo data gaps"), so its cards are lettered
  tiles; (b) exercise pictures have no thumbnail of their own (only progress and recipe photos do), so a
  card loads the full picture; (c) choosing the order of an exercise's media (the first is its card's); (d)
  "Show more" pages by 48; a library of thousands would want a count per chip.
- **Notifications, R5.1c (built 2026-10-09; screenshots `docs/design/r51c-*.png`). Decided by Claude for
  the owner on 2026-10-09**, after looking at Trainerize (clients are told only when a program is added;
  its users ask for phase and workout notices, and complain that a coach's reply to a comment sends no
  alert), Everfit (a Notification Center with categories and an "Only show unread" toggle), TrueCoach and
  QuickCoach (the coach is notified of a client's workout comment): (1) **the coach hears of a client's
  note on a workout**, by the client's name, opening that session; not of finished workouts, check-ins or
  weigh-ins, which Coach Today already lists. (2) **A notice says only what the client can see now**: a
  week shared before its day says nothing, and a change to weeks still hidden says nothing. (3) **The note
  notice gives no day** (NOT-006 keeps dates out of wording; it opens the workout instead). (4) **All and
  Unread, no categories**: TB Gym makes a handful of kinds, so Everfit's category menu would be empty
  rooms. (5) **One notice per change**, not merged: changes are deliberate applies, never autosaves. Not
  built: (a) push or email for training notices (in-app only, ADR 0036; a phone push needs a service
  worker and consent, a later decision); (b) no notice when a coach cancels or completes a program; (c) a
  client's plan notices (payment, ending soon) open nothing, as there is no client plan page yet, and
  their wording still says "workspace" (see "Backend words"); (d) a coach's note on a workout still in
  progress opens Training without marking it, as only finished workouts are listed there; (e) the badge
  is read on a timer, not pushed: the notification Worker has no realtime hub; (f) on the live demo every
  coach note reads the same in the client's inbox ("Your coach left a note on a workout"): Claude recommends
  naming the session ("on Upper B"), an owner decision because NOT-006 keeps typed text out of wording.
  The demo now delivers its notices as it is built and has everyone read them three days before today, so
  only recent ones are new; checked live with the Worker running (a coach's note and a shared week each
  reached the client in seconds and opened the right place).

- **Settings, Team, Billing, R5.2a (built 2026-10-09; screenshots `docs/design/r52a-*.png`). Decided by Claude
  for the owner on 2026-10-09**, after looking at Everfit (personal settings, timezone included, for everyone
  from the avatar; Team settings with the team's name, timezone, billing and teammates for owners and admins
  only; an invitation can be resent or revoked while pending), TrueCoach (a coach's invoices are PDFs carrying
  the issuer's details and an invoice number, offered in four countries only) and Lebanon's tax rules (a
  VAT-registered issuer's tax number belongs on every invoice): (1) **one Settings for all staff**, the coaching
  space's pages for the owner alone as their APIs are, and Your account for every coach; TB Gym has no admin
  role (ADR 0026). (2) **No printable or PDF invoice yet**: a formal invoice needs TB Gym's legal name, address
  and Ministry of Finance number, which are not set, and wording TB Gym does not invent; the page shows each
  invoice's reference, month, lines, total and payment, and copies the Whish number and the reference. (3)
  **New plans are priced in US dollars or Lebanese pounds first, any ISO code under Another**: services in
  Lebanon are billed more and more in dollars, the pound has held near 89,500 to the dollar since mid-2023, and
  a coach with Gulf clients may sell in AED. (4) **The language is not offered**: emails and invitations exist
  in English only (`NotificationTemplateCatalog`), so an Arabic choice would change nothing; the stored value is
  kept on save. (5) **Sign out everywhere asks first**, since it signs this device out too. (6) **Faces are
  initials**: no profile photo exists yet. Not built: (a) a profile photo for staff (Everfit and Trainerize
  coaches have one, shown to clients; it needs the media pipeline and a consent line); (b) an admin role between
  owner and coach (Everfit's Admin manages every client and all settings): an authorization change for the
  owner to decide; (c) the server accepts any three letters as a currency, the screen checks the browser's ISO
  list; (d) an invitation whose link ran out can only be cancelled (the server refuses a resend), so the owner
  invites again; (e) the platform admin screen is R5.2b.

- **Platform billing, R5.2b (built 2026-10-10; screenshots `docs/design/r52b-*.png`). Decided by Claude for the
  owner on 2026-10-10**, after looking at Chargebee (Record payment takes a reference number, a comment and a
  date that may be in the past; its amount may be partial), Stripe (an invoice list filtered by chips with a
  "Past due" badge and an accounts-receivable aging report; only an open or uncollectible invoice can be voided,
  and a voided one keeps its paper trail), TrueCoach and FITR (a coach's client keeps access when a payment
  fails; FITR waits 7 days) and the W3C and GOV.UK guidance on date fields: (1) **the list is triage, not a
  table**: read-only first, then overdue, owing, a trial ending within 7 days, paid up, other trials, each with
  what it owes and what happens next ("Was due Oct 5, read-only from Oct 12"), four tiles above it, and a
  search and chips in the address. The list read gained each space's earliest due day and read-only day. (2) **A
  payment is dated the day the money arrived** (default today; from the invoice's day to today, UTC days, PBL-007),
  as Chargebee's date: a Whish transfer is often recorded a day later and an append-only record can never be
  corrected afterwards. The amount is shown, not typed, because partial payments stay unsupported (ADR 0028).
  (3) **Voiding offers a corrected invoice by default** and says first what it does: it counts again as of today
  at the voided invoice's plan, is due after the plan's payment days, and is emailed to the owner. A paid invoice
  has no Void. (4) **Discounts have no preset offers**: the old form started at "30%, Founding coach", an offer
  the owner has deferred; the sheet offers only lengths (3 months, 6 months, a year) and says, before asking the
  server, when a discount would overlap one in force. (5) **A price plan version is published after the list of
  what changes** ("Price per seat $15.00 → $20.00"); a new trial length is said to apply only to spaces created
  after it. (6) **The kit gained its date field** (`ui/date-field.ts`, with `ui/calendar.ts`): a button that says
  the day in words and opens a month calendar in the flow of the page, so a sheet can never clip it; the W3C date
  picker's keys (arrows, Home and End, Page Up and Down, with Shift a year, Escape closes the calendar before the
  sheet); days outside the range greyed; right-to-left arrows. A typed day, which GOV.UK prefers for dates a
  person knows by heart such as a birth date, came in R5.3a as the kit's `DateInput`. Not built: partial
  payments, refunds and credit (they need a ledger design), a trial extension, MRR figures, CSV export, an
  invoice PDF (no legal details yet), a reminder to chase an owner. Seen, not fixed: seven other screens still
  use the browser's date input (check-in clients, progress, Start a plan and Record payment for a client,
  Assign program, program block dialogs, client nutrition); swapping each for the kit's date field is its own
  step.
  The initial bundle is 543.08 kB (R5.2a: 542.60; two routes and two icons) and `platform-space.scss` is 5.45 kB, 453
  bytes over its 5 kB warning budget. Checked with `/ui-review`: touch-action, a hover on Today and Clear, the
  textareas' autocomplete, a scroll margin so the sheet's sticky bar never covers a field, and the owner's email
  left untranslated were fixed; the spaces list is not virtualized (fine below about 200 spaces).

- **Invitations, R5.3a (built 2026-10-10; screenshots `docs/design/r53a-*.png`). Decided by Claude for the owner
  on 2026-10-10**, after looking at TrueCoach (an invitation email goes out at once; a coach can copy the invite
  link to send it by hand, or resend), Everfit (Invite sends the email at once; the link can be copied and sent
  by text; a Resend Invitation icon sits beside a client who has not set up yet; also a public invite link and
  adding several clients at once) and the GOV.UK date input (three labelled boxes in one group for a date a
  person knows by heart, such as a birth date): (1) **the page is a to-do list**: Waiting to join first, each
  row with what is true now and what happens next ("Sent once · the newest link works until Oct 16") and Send
  again and Cancel one press away; everyone else sits behind a closed "Earlier invitations (n)" with the plain
  words Joined, Link ran out and Cancelled, and Invite again fills in the same name and email. The old page was
  a table of every invitation ever, with "Sent 2 time(s)" and the server's status words. (2) **Send again says
  what it did, not what it might do**: a new link replaces every earlier one, so the press carries the version
  the coach was shown (a stale list conflicts instead of killing a link they did not know about) and the answer
  reads "A new link was sent to … The earlier link no longer works." Cancel asks first. (3) **The birth date is
  typed in three boxes** (day, month, year), refused in words before anything is sent when it is not a real day,
  under 18 or over 120 years ago; the server still decides who is an adult. (4) **The phone number no longer
  promises more than is true**: "So you can reach them. Only your coaching space's staff see it." (5) **A refusal
  stays in the sheet in the server's own words** with what was typed kept, and is scrolled into view above the
  Send bar (found in the live pass: on a short phone it sat below the bar, out of sight). Not built: (a) **Copy
  invite link**, which TrueCoach and Everfit both offer and which WhatsApp, the main channel in Lebanon, would
  use: the API never gives the link out except by email (and to the development build), so it needs a
  server-side "show the link once to staff, and record it" rule, which Claude recommends and the owner decides;
  (b) inviting several clients at once and a public invite link (Everfit); the second needs a consent and
  abuse design first; (c) whether the email arrived: the page says "We will email … shortly" and shows no
  delivery result, as the invitation read holds none. The sticky Send bar of this sheet and of the platform
  billing sheets now sits flush with the sheet's foot (`inset-block-end: -1.5rem`), as the Plans you sell,
  exercise and food sheets already did: with `0` the next field showed through a 24 px strip beneath it. Still
  `0` in four older sheets (the client's plan sheets, Assign program, Update maxes, Build next block): to check
  in R5.3f whether the strip shows there too.

- **My profile and the intake, R5.3b (built 2026-10-10; screenshots `docs/design/r53b-*.png`). Decided by Claude
  for the owner on 2026-10-10**, after looking at Trainerize (its intake form is meant to take a client at most
  10 minutes, and holds goals, injury history and a PAR-Q-style health screen), Everfit (a form is a task in the
  client's own app, and the coach opens the submission), W3C's guidance on multi-page forms (say how many steps
  there are, show progress on every step, group by meaning, make optional steps easy to pass) and the server's
  own rules (ADR 0004): (1) **Five short steps instead of one long form**: About you, Your goal, Your day and
  food, Your health, Where you start. Each Continue saves that step's answers only, so closing the tab loses
  nothing already passed, and a returning client starts at the first step not done. (2) **What finishes setting
  up has not changed** (ADR 0004): an adult's date of birth, a height, a goal and a starting weight. Everything
  else is optional, and the health step says so. (3) **The health step names who can read it**: "Only you, your
  coach and the owner of {coaching space} can see these answers", which is true while ADR 0004 and ADR 0026
  hold (a coach reads only their own clients) and must change with them. (4) **The starting weight** begins in
  the unit the client chose in Me and is dated today in the coaching space, never the browser's; it is written
  once, and later weigh-ins belong to Progress. (5) **A finished profile is cards of answers with an Edit on
  each** (a sheet holding that group's boxes), the same for the client and for the coach. A coach filling in
  what they know of a client who is still setting up may leave the required answers empty (CLI-004); a finished
  profile keeps its date of birth, height and goal. The coach's Finish setting up (the starting weight) opens
  only once those three are there. (6) The date of birth is typed in three boxes, and the adult cut-off now
  follows the server around 29 February: a client born on 29 February is an adult on 28 February of a common
  year. Not built: (a) a **PAR-Q-style health screen and consent**, which Trainerize's intake includes and
  insurers often ask for. It needs wording and a consent record that the owner approves (CLI-008, legal), so
  Claude recommends it as the next intake step, with the owner's or a lawyer's text; (b) changing the sign-in
  email (ADR 0004 needs a re-verification workflow); (c) a profile photo; (d) the "sex used by the formula"
  answer (CLI-006) has no field in the contract yet; (e) a reminder to a client who stopped half way (no notice
  kind exists for it). Found by the tests and the live pass, and fixed here and in R5.3a: Not now in a sheet
  skipped the question the close button asks (the invite sheet had the same hole), and a refusal could be
  brought up behind a phone's tab bar. Checked live on the real API as a new client: invited, accepted,
  answered the steps with a reload half way that resumed at step 3, finished, changed a group in a sheet, and
  the coach read and corrected the same answers.
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
  - Built in R3.5a: Settings › Brand (`/workspace/brand`, owner only) with the four looks or the
    coach's own two colours (a swatch opens the device's picker, a field takes a typed colour), a logo
    (PNG or JPEG up to 5 MB, shown on a white tile), a preview of the sidebar and a client's Today in
    light or dark, and a note when a colour is adjusted to stay readable. Saved, the brand paints the
    whole app for staff and clients from the first frame; the logo replaces the space's initials in
    the sidebar and the coach's initials on the client's Today. Billing keeps TB Gym's colours.
    Screenshots: `docs/design/r35a-*.png`.
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
- Built in R5.2b: `DateField` (the `DatePicker` above, `ui/date-field.ts`) with its calendar maths in `ui/calendar.ts`
  (a day is a `YYYY-MM-DD` string, every step in UTC). Its value is a calendar day, never an instant. `today`,
  `min`, `max` and `firstDay` are inputs; messages come through `errors` as `app-field` takes them.
- Built in R5.3a: `DateInput` (`ui/date-input.ts`), the typed date for a day a person knows by heart (a birth
  date): three labelled boxes in one `fieldset` (day, month, year; GOV.UK's pattern), numeric keypad, all three
  marked invalid with the message in words (the screen's submit then focuses the first). Its `value` is `''` or a real
  `YYYY-MM-DD`; `status` says `empty`, `incomplete`, `invalid` or `valid` so the screen decides what to do with
  a half-typed date. The browser's date input stays off every redesigned screen.
- **Retire:** the pre-foundation palette and globals in `styles.scss`, the `--accent/--surface`
  legacy variables, and every browser-default button. The migration is finished when a lint check
  finds no legacy variable and no unstyled `<button>`.
- **Budgets:** initial bundle under 520 kB. New libraries load only on the route that uses them.
  Images are AVIF/WebP, with no layout shift.
- **Installable app (R2):** a web app manifest, icons, a splash screen and an install prompt for
  clients, so TB Gym opens from the home screen without browser chrome. People see it as an app,
  not a website. Wrapping it for the App Store and Google Play with Capacitor is a later,
  separate decision.
- Built in R2.5c: `manifest.webmanifest` (standalone, starts at sign-in, cream launch colours), the
  "TB." icons (standard, maskable and iPhone) and a branded favicon, all made by
  `scripts/make-app-icons.mjs`. An installed app draws a launch screen from `index.html` until the
  script arrives, and the app draws the same one until the session answers, instead of a bar saying
  "Checking session". `InstallPrompt` is created at start-up, because Chrome announces an installable
  page once and only to a listener already there. It feeds an install card on Me and a dismissible
  banner on Today (gone for a month after "Not now"): an Install button where Chrome offers one,
  Share-menu steps on an iPhone or iPad, nothing inside the installed app.
- **No service worker, on purpose.** Chromium reports the page installable without one (checked with
  its own installability errors), and nothing is cached, so a client's health data and a coach's
  client list never sit in an offline cache. Not built: iPhone startup images (iOS shows its own
  launch screen until the page paints; not tested without a device), push and offline use.

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
- Built in R3.1 as `GET /api/coach-today` (CLI-018, TRN-021): the ranked queue, each item with its
  client, coach and what its action needs (the check-in's assignment, the conversation, the
  enrollment, the program block); the newest 20 finished workouts with their PRs and sent check-ins
  of the last 7 days; this week's sessions done and scheduled per day; and the counts for the tiles.
  Numbers come as counts with dates, so the screen phrases "26 of 49 so far" itself.
- Built in R3.2 at `/` for staff (the sidebar's first entry is now "Today"):
  - The greeting, by the workspace's hour and date, says how many clients need the coach. "Find a
    client" and "Invite client" sit beside it.
  - Three tiles: Clients (with the faces waiting), sessions done this week ("10 of 27", "15 were due
    by today") and plans ending in 14 days.
  - The queue keeps the server's order, one row per item: face, sentence, tag and one action. Only
    the first action is filled. Review opens the client's check-ins, Reply opens that conversation
    (`/messages?conversation=`), Renew plan opens Service with `?renew=` and the rest open the
    client's training. An Owner sees "Coached by …" on a team member's client.
  - The feed shows the newest six with "Show all".
  - The week is drawn as bars, with a hidden table for screen readers.
  - An empty workspace gets one "Invite your first client" card instead of zeros.
  - Coach Today follows dark mode (`REDESIGNED_FOR_STAFF`); the client's Today at the same route
    stays light until its own dark pass.
  - Screenshots on the Atlas demo: `docs/design/r32-coach-today-*.png`.

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
- Built in R3.1 as `GET /api/clients/overview`: per client the status (the four pills plus "No
  active plan" for an ended, unpaid, not started or blocked plan), the plan's state and last day,
  goal, join date and "new", the attention kinds, last activity (workout, check-in or weigh-in) and
  sessions done and scheduled for each of the last 7 days (null when training is not in the plan).
- Built in R3.3a at `/clients`, from that read alone:
  - One row per client in the server's order: face, name, goal, the status pill with why ("Check-in
    to review · Week not shared"), last activity ("Trained 2 hours ago"), a 7-day strip with "3 of 4"
    (or "Training not in plan") and the plan line ("Plan ends in 9 days" in the warm colour within
    14 days). The name's link covers the row, so a tap anywhere opens the client.
  - Columns from 960 px of content width, cards below. An Owner sees "Coached by …" on a team
    member's client.
  - Chips All, Needs attention, Ending soon (also a client whose plan ends soon but who needs
    attention for something else), Paused (the plan) and New, with counts; the chip is kept in
    `?show=`. Search covers names and goals, ignoring case and accents.
  - Former clients (`/clients/former`, Owner) use the same rows: how and when coaching ended, and why.
  - Both lists follow dark mode. Screenshots on the Atlas demo: `docs/design/r33a-clients-*.png`.
- Built in R5.3a at `/invitations` (follows dark mode): **Waiting to join** with a count, then one row per
  person (face, name and email, the status pill, "Sent once · the newest link works until Oct 16", Send again
  and Cancel); **Earlier invitations (n)** closed, newest first, each Joined, Link ran out or Cancelled, the last
  two with Invite again. **Invite a client** is a sheet (first and last name, email, an optional phone number
  and a birth date typed in three boxes) that says what happens, keeps a refusal on screen in the server's
  words, and asks before it closes with typed work in it. Cancel asks first; Send again states that the earlier
  link no longer works. An empty page offers Invite your first client. In the development build a waiting
  invitation also shows "Open local link". Screenshots: `docs/design/r53a-*.png`, and `r53a-live-*.png` from the
  real API on the Atlas demo.

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
- Built in R3.3b (header, Overview and Progress; Training and Service & access are R3.4). Two coach
  reads: `GET /api/clients/{clientId}/overview`, one client's slice of what Today and Clients already
  work out (status, what needs the coach with each action's target, last activity, the workspace
  week's sessions), so the page can never disagree with the list; and `GET
  /api/training/clients/{clientProfileId}/personal-records`, the client's own list by the same rule
  (TRN-019).
  - Header: face (initials), name, goal, a plan pill with the days left ("Active · 41 days left", warm
    in the last 14), the plan line, and "Coached by …" for an owner on a team member's client.
    Message is the one filled button (hidden, with a plain line, when the plan lacks messaging).
    Actions holds Assign program, Plan and payments (Renew plan in the last 14 days) and Edit intake;
    each opens the section where the work happens until R3.4's drawers.
  - Overview, in the order a coach asks: **Needs you** (the server's items, one action each, the
    first filled; "Nothing needs you right now" when empty), **This week** (seven day marks, "2 of 4
    sessions done", the program and its week, last activity, days logged), **Weight** (latest weekly
    average, change on last week, a line), **Strength records** (the newest four), **Check-in** (the
    latest sent with its state, and the next one due or overdue; workflow facts only, CHK-012) and
    **Coach notes** (edited in place; a refresh asks before losing an unsaved note). A closed feature
    says why ("Elie's plan has ended, so their training isn't shown", "Check-ins aren't part of Karl's
    plan") instead of "could not be loaded", and a blocked client reads nothing and says so.
  - Progress: the weight trend with a range switch, measurements, photos, strength records, training
    and nutrition logging, in coach words (no "Your…", no self-service links). The older entry,
    correction and photo tools sit behind one collapsed "Entries and corrections", loaded only when
    opened, and list only days with a weigh-in. The page is about 2,600 px; it was 10,400.
  - Both follow dark mode; the other sections stay light. Screenshots on the Atlas demo:
    `docs/design/r33b-profile-*.png` and `r33b-progress-*.png`.
- Built in R3.4a (Training; Service & access is R3.4b). One new coach read, `GET
  /api/training/clients/{clientProfileId}/program` (TRN-022): every program block with its weeks,
  shared or not, and the state of each session by the rule the client's own Training page uses, so the
  two never disagree about what was missed. A client whose plan has lapsed, is paused or is blocked
  gets the reason instead of blocks; before a booked plan begins the coach sees them (TRN-023).
  - Top: the running program's name, "Week 4 of 6", its dates, "11 of 24 sessions done", "1 missed",
    and one segment per week showing how much of it is done. **Manage program** holds what a coach can
    do about it (the client's own Actions stays in the page header). A finished program with nothing
    lined up shows one filled Assign program instead.
  - Timeline: weeks side by side on a wide page (the strip scrolls, and the current week comes into
    view tinted), one week under a row of week numbers on a phone. A week says its dates and how far
    it got, and has one box, "Shared with Maya", with "opens Sat 10 Oct" while it is shared but still
    locked. A session is a card: day, name, "4 exercises · 12 sets" and Done, Missed, Today, In
    progress, Upcoming, Not shared or Cancelled, each in words. A week that was never shared, or a
    cancelled program, has no Missed.
  - A session opens a sheet: what it prescribes (equal sets told once, "3 × 8–10 reps · 60 kg · RPE
    8"), what the client did when they started it (the coach's workout view, set by set against the
    target) and, for one still to come, a swap for one of the coach's saved sessions.
  - Manage program: Assign program, Build next block, Edit weeks (P3b), Reschedule, Open every shared week now (or
    Open weeks as they start), Close program and Cancel program. What cannot be done stays in the list
    with its reason: a started program cannot move, Close program waits for every session to be done
    or for the last day to pass (the misses stay on record), and a workout in progress blocks Close and
    Cancel. Assign program is a sheet: a plan (asked only when there
    are several), a program (each at its newest version), a start date with "Runs Mon 12 Oct – Sun 22
    Nov", the training maxes the program needs (starting from the recorded ones; kilograms and pounds
    are never converted) and the load settings on one collapsed line. Build next block previews the
    new weeks before anything is added. Cancel asks why. The header's Assign program, Today's "No
    program yet" and the Overview's all open the same sheet (`?action=assign`).
  - Other programs: the ones running or coming and the earlier ones, each opening on a tap (a program
    past its last day that never closed reads "Ended"). Training max history and an exercise's history
    are the older forms behind one collapsed "More training tools".
  - Follows dark mode. Screenshots on the Atlas demo: `docs/design/r34a-*.png`.
- Built in R3.4b (Service & access), on the existing plan, payment and access endpoints; no backend
  change.
  - Top: the plan in front (the one running, else the next, else the latest), "Current plan",
    "Starts Tue 13 Oct" or "Ended Tue 29 Sep", its name with a pill ("Active · 41 days left", warm in
    the last 14, "Waiting for payment", "Paused", "Access blocked"), its dates, length and price, how
    much is paid ("USD 150 of 330 paid", "Not paid yet", "Paid in full", "Free"), a pause or
    cancellation reason, and **What's included**. "Maya asked to renew on Thu 1 Oct" sits beside the
    plan that ran out, until a plan follows it.
  - One filled button for what needs the coach, in this order: Record payment (a plan that can still
    take one), Resume plan, Renew plan (in the last 14 days with nothing after it, over with nothing
    after it, or the plan the client asked about); Start a plan when there is none. **Manage plan**
    holds the rest (Record payment, Renew plan, Pause or Resume plan, Cancel plan, Start another plan),
    and what is not possible stays with its reason ("Possible once it is paid", "None of this plan's
    price options is offered now").
  - Payments: a paid bar and every receipt (day, method and reference, amount). Other plans: the ones
    running or coming and the earlier ones, each opening on a tap.
  - Sheets: Start or renew a plan (price options as cards, the first day with "Runs Tue 13 Oct – Mon 4
    Jan", a warning before a clash with a running plan, and when the client can use it), Record payment
    (starts at what is left, says what a part payment leaves, in the plan's own currency). Dialogs ask
    why for Pause (it still ends on its last day), Cancel plan and Block access.
  - Coach and access: the coach with Reassign coach (owner, in a team), Access with Block or Unblock,
    and End coaching (owner). A former client's record shows the same plans and payments with nothing
    to change.
  - Follows dark mode. Screenshots on the Atlas demo: `docs/design/r34b-*.png`.
- Built in R5.3b: **Intake** (`/clients/:clientId/intake`, from the header's Edit or View intake; follows dark
  mode): what a client answered as four cards (About, Goal, Day and food, Health), each with an Edit that opens
  that group in a sheet (the date of birth typed in three boxes, a refusal shown in the server's words, a
  question before a half-typed sheet closes). A client who has not finished gets a banner saying what is still
  needed, and Finish setting up (the starting weight) once the date of birth, height and a goal are there. A
  former client's answers are read and not edited. The client's side is **My profile** (M8, `/profile`): a new
  client's five steps (a progress bar and "Step 2 of 5", the step's name focused after each Continue, Back, each
  Continue saved), then "You're all set" with Go to Today, and afterwards the same cards with Edit. Half-typed
  work is asked about before the router, a workspace switch or a sign-out drops it. Screenshots:
  `docs/design/r53b-*.png`, and `r53b-live-*.png` from the real API on the Atlas demo.

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
- Built in R4.1:
  - `/training/programs` lists the programs as cards ("Ready to assign" or "Draft", weeks, last
    change) with New program. `/training/programs/:templateId` (or `new`) is the builder. One small
    read, `GET /api/training/templates/{templateId}`, reopens a program with its versions and the
    token its next save carries.
  - Beside the grid sits the exercise library: search, movement chips, the first picture of each
    exercise (initials otherwise) and the coach's saved sessions.
  - Each week is a row of seven days with a name, "Shared with client" and a menu (duplicate, move,
    delete with Undo). A rest day is a narrow dashed column.
  - Drags (CDK, lists connected by id): exercises from the library or another session into a
    session; a session to another day or week; a saved session onto a day; an exercise onto a rest
    day starts a session there.
  - The keyboard and phone way: + on a rest day or a session opens an add sheet, and each card's
    menu offers Edit, Copy (to the next free day), Add to saved sessions and Delete.
  - Sets × reps × load initially used the session sheet; R4.2b adds editing on the grid.
  - Save draft and Publish make a new version; Versions opens earlier ones. A save that lost a race
    says so and offers the newest version.
  - A phone shows one week at a time behind week chips.
  - Follows dark mode. Screenshots on the Atlas demo: `docs/design/r41-*.png`.
- Built in R4.2a (the owner chose a draft on the server and no Save draft; ADR 0033, TRN-024):
  - Changes keep themselves: a moment after the coach stops typing or dragging (at most 8 seconds
    behind), the program goes to their own draft on the server, which follows them to any device and
    nobody else sees. The line beside Publish says "Saving…", then "Saved at 14:32, not published
    yet" ("Saved on Sun 4 Oct, …" for an older one); "Not saved yet. Trying again…" and "Not saved"
    are the warm cases. A screen reader hears only a failure and the save that ends it.
  - Opening a program with a draft opens the draft, saying so when a version was published since.
    Publish stores anything unsent, then turns the draft into the next version; when someone published
    in between it asks first ("Publish mine as the newest" or "Discard mine"). Discard changes asks,
    then brings back the program as last published. Opening another version from Versions asks before
    discarding.
  - A new program is a draft at `/training/programs/new?draft=…` from its first change, and Programs
    lists it first as "Draft · Only you can see it until you publish it"; a program with the coach's
    changes says "Your changes are not published yet".
  - Leaving sends what is unsent first and asks only when that fails ("Leave without saving?", the kit's
    new `UiConfirm` in a Dialog that stays open on Back). A refresh or closed tab gets the browser's
    warning, a hidden tab sends at once, and a workspace switch or sign-out asks the open editor first
    (`UnsavedWork`). Another tab that saved later is named, and Reload shows its version.
  - Screenshots on the Atlas demo: `docs/design/r42a-*.png`.
- Built in R4.2b:
  - Each exercise's prescription opens inline on the grid. Sets keep their individual reps, load,
    unit, RPE/RIR, rest, tempo and notes; Add a set copies the last one, up to 20. The same editor
    and kit menus serve the session sheet. Invalid fields explain the rule, and Publish opens and
    focuses the first correction. Every edit uses the existing private-draft autosave.
  - Publish first opens a read-only week preview with every set and client note. Unshared weeks
    hide their content; the internal description stays private. Dates and calculated client loads
    wait for assignment. Only the confirmation publishes an immutable version; Back to editing
    keeps the draft, and clients already assigned keep their snapshots.
  - Screenshots on the Atlas demo: `docs/design/r42b-inline-{390,1440}.png` and
    `docs/design/r42b-preview-{390,1440}.png`.

**C5. Check-in review**
- Job: "Review and reply in under two minutes."
- Shows: answers side by side with the previous check-in (changes highlighted), a photo compare,
  the weight trend, a reply composer with saved templates, and "Mark reviewed".
- Built in R4.3, web only, on the existing check-in, progress and messaging endpoints:
  - A client's **Check-ins** section lists what needs review first, then what is not sent yet ("Due
    Tue 6 Oct", Overdue, Started), then what was reviewed ("Sent Wed 23 Sep · 1 day late · reviewed
    Thu 24 Sep"). A sent check-in opens its review; an unsent one has nothing to read (CHK-013). Assign
    a check-in still opens the older check-in screen.
  - The review (`/clients/:clientId/checkins/:assignmentId`) keeps the client's header. Today's
    Review, the Overview's Check-in card, Needs you and the feed open it straight away when they name
    one check-in.
  - Top: the form's name, "Sent Mon 5 Oct · Due Sun 4 Oct · 1 day late", and Needs review or
    "Reviewed Mon 5 Oct by you".
  - The answers sit beside the same form's previous check-in (the server's comparison, CHK-010):
    "This time" and that day, a scale as "8 out of 10" with a meter, and a plain **Changed** on the
    ones that differ, under "5 answers are different from Sun 27 Sep". The mark is equality only: no
    arrows, amounts or good and bad colours (CHK-012). A re-worded question shows last time's wording,
    a new one says New question, and one not asked this time says so. Compare with another reads it
    beside an older one; the first check-in of a form stands alone.
  - Beside them: the weight in the 12 weeks to the day it was sent (the latest weekly average, the
    change on the week before, a line) and that period's progress photos by pose, the newest against
    the newest up to the earlier check-in, in the before/after slider. Each photo is labelled by the
    day it was taken and never called the check-in's (ADR 0016).
  - The reply goes into the coach's chat with the client, with Saved replies; a check-in has no
    comments of its own (the roadmap defers them). One filled button: Mark reviewed, which becomes
    Send and mark reviewed once a reply is written (the reply goes first, and a failed send marks
    nothing), with Send only beside it; after review it is Send reply. The header's Message is
    outlined on this page. A plan without messaging gets a line instead of the box. An unsent reply is
    asked about before leaving, a workspace switch or a sign-out (R4.2a's `UiConfirm`).
  - Closed check-ins say why and read nothing (CHK-011); a missing one says it isn't here.
  - A phone shows the cards in reading order: answers, weight, photos, reply. Both screens follow dark
    mode. Screenshots on the Atlas demo: `docs/design/r43-*.png`. The demo has no progress photos,
    so the slider is shown by the mocked Playwright run, with placeholder pictures:
    `docs/design/r43-photos-mocked-1440.png`.

**C6. Messages**
- Job: "It's a chat."
- Shows: a conversation list with avatars, unread counts and last-message previews, a thread with
  bubbles and day separators, a composer, and live updates with no Refresh button. Voice notes and
  attachments come later.
- R2.5a built the shared screen for both sides (see M7); R3.5b adds the coach-only parts.
- Built in R3.5b, on the same list endpoint with `filter` and `search` (MSG-022), and the client
  page's read (now with the plan's name and the last workout):
  - Above the inbox: a search box (names, ignoring case and accents, over every conversation, not
    just the loaded page) and chips All, Unread and Waiting for reply with the server's counts; the
    chip is kept in `?show=`. A narrowed list that comes back empty says why ("Nobody is waiting for
    a reply", "No conversation matches …") with the one way back. A thread whose client spoke last
    carries a warm "Waiting" mark; answering takes it off, and the open thread stays open when it
    leaves the filtered list.
  - Beside the thread, when the screen has room for three columns: the client's standing ("On
    track", "Trained yesterday"), the plan with its end, the last workout with its duration and
    records, this week's sessions, what else needs the coach (messages left out: the coach is in
    them) and Open profile. Narrower, Client details in the thread header opens the same panel as a
    sheet. A client sees none of this.
  - Messages now follows dark mode, for coaches and clients. Screenshots on the Atlas demo:
    `docs/design/r35b-*.png`.
- Built in R3.5c: Saved replies under the coach's message box opens a sheet with the coach's own
  replies by title, a search over titles and text, and one tap to drop a reply into the message after
  what is already written; nothing is sent from the sheet. New saved reply (or Save what you wrote,
  which starts from the message being written), Edit and Delete (asked first) live in the same sheet;
  at 100 the sheet says to delete one first. A client sees none of it. Screenshots on the Atlas demo:
  `docs/design/r35c-*.png`.

**C7. Nutrition library and meal-plan builder**
- Recipe cards with macro bars and photos.
- A meal plan as a week grid with a daily macro target ring.
- Food search with clean results: name, brand, calories and macros. Database codes (FDC IDs, "SR
  Legacy") stay hidden behind a details toggle.
- Built in R4.4a: Nutrition opens on **Meal plans** (`/nutrition/plans`), cards with the plan's days,
  meals a day, calorie target and a protein/carbs/fat bar, the coach's new plans first; Recipes and foods
  (the older page) is the section's second link. The builder (`/nutrition/plans/:planId`, `new`) has the
  daily target (calories and grams, their shares of the calories, and a note when the grams add up to
  more or less than 5% off the calories), the published recipes beside the grid (per serving, with a macro
  bar), and the days in weeks of seven: each day with a ring and its calories against the target ("308 kcal
  under", "On target" within 5%), its meals as cards (name, each option and its servings, the meal's
  calories) and a strip under it that adds a meal. A recipe dragged onto a meal becomes another option,
  under a day a new meal (named after the day's next usual meal); meals move between days by their grip;
  every drag has a button path (the meal sheet, the recipe sheet, each card's menu). A day's menu
  duplicates it, uses it for every day, clears it or deletes it, each with Undo. A phone shows one day at
  a time from a row of day chips. Changes keep themselves as the coach's draft (NUT-013, as the program
  builder's do); Publish makes the next version; Versions lists them.
- Built in R4.4b: **Recipes** (`/nutrition/recipes`) shows the recipes as cards (a row each on a
  phone): the cover photo's thumbnail or the recipe's initials, one serving's calories, a
  protein/carbs/fat bar with the grams, the servings, the allergens its foods declare, and "Draft" or
  "Changes not published"; a server search over every recipe. The editor (`/nutrition/recipes/:id`,
  `new`) has the name, servings, ingredient lines (each line's food, source, macros, amount in the
  food's own unit and calories), a search that lists the coach's foods and then USDA's (a USDA pick is
  copied into the foods first; database codes stay hidden), the method, a cover photo, and a "One
  serving" card that adds up as amounts are typed, with the whole recipe and the allergens "as
  declared on its foods". Publish is the action (Publish changes on a published recipe, disabled
  when nothing changed); Save as draft sits in the menu beside it. A save from an editor opened
  before someone else's save is refused with Reload recipe. New recipe can start from a description
  (AI, ADR 0035): the suggestion fills the name and lines that each wait for a food, suggested grams
  carry over, and a failure is said and focused beside the button. Leaving with changes asks first.
  On a phone a bar keeps one serving's numbers in sight once its card scrolls away. The older page
  is now **Foods**, without its recipe form or AI section.
- Built in R4.4c: **Foods** (`/nutrition/foods`; the old address leads there) has one search over the
  workspace's foods and USDA's. Your foods come first, each row with its source, raw or cooked, the
  amount its numbers are for, calories, a protein/carbs/fat bar and grams, allergens, and a flag when the
  label's calories disagree with the macros or USDA left a nutrient out. From USDA follows once three
  letters are typed: basic foods, or packaged products with their brand, each with USDA's calories and
  macros per 100 g and an Add button that copies it into the foods ("In your foods" after); database
  codes show only behind the Database details switch. A food opens in a sheet with its nutrients, the
  label's or USDA's calories, what USDA left out and its allergens; the coach's own food has Edit food
  (the next version, which may rename it), a USDA food Edit a copy. New food opens the same sheet: name,
  the amount and unit the numbers are for, raw, cooked, as sold or prepared, protein, carbs and fat, then
  fibre, sugar alcohols, alcohol and label calories behind a disclosure, and allergens; the calories add
  up as they are typed, under the workspace's policy, and every check is said beside its box. The
  calculation defaults moved to **Settings › Nutrition** (owner only): how calories are counted (4/4/9,
  or as on EU labels), the label check, and the AI allowance within TB Gym's ceiling. The recipe
  ingredient search lists USDA's basic foods with their calories per 100 g. A food's sheet has Archive
  food (a toast with Undo); Archived foods, beside the list's heading, lists them on their own (no USDA
  panel), and an archived food's sheet says when it was archived and has Restore food. Closing the food
  sheet with something typed (its close button, Escape, the backdrop or Cancel) asks "Close without
  saving?" first; the kit's sheet and dialog take a `canClose` for this. In the recipe editor a line
  whose food was edited since says so with "Use its new numbers", and two or more such lines get "Use
  all the new numbers" above the list. USDA's names in capitals read in sentence case, and a USDA food
  whose carbs USDA lists just below zero shows 0 g with a line saying what USDA listed.
- Built in R4.4d: the recipe editor's Method card has **Prep time** and **Cook time** in minutes
  (optional; 0 cook reads "No cooking" to the client). The meal-plan builder says when a recipe in the
  plan was published again since ("Overnight oats was published again: 420 kcal a serving, 400 kcal
  before") and **Use the newest version** moves that recipe's options in this draft only, with Undo.

**C8. Products**
- The heading becomes "Plans you sell": cards with price, duration and icons for the included
  features, plus the number of clients on each plan.
- Removes: "Step 3B live check"-style internal descriptions from the seed.
- Built in R5.1a: each plan is a card with its clients ("9 clients", "6 clients · 1 starting"), its
  description, what it includes and its price options shortest first, each with its own clients and a
  menu (Change price, Stop selling). New plan opens a sheet with the first price option (an option left
  unnamed is called by its length); Add price option, Change price and Edit name and description open
  sheets too, and closing one with something typed asks first. Old price options and plans no longer sold
  wait behind a closed disclosure. The route follows dark mode. The demo's descriptions were already
  plain words.

**C9. Settings, Team, Billing**
- One settings layout with a sub-navigation.
- Team shows faces.
- Billing shows a clean invoice list.
- Built in R5.2a: `SettingsFrame` (`features/settings`) puts each Settings page's own heading beside one
  navigation in two groups: Coaching space (the owner's: Name and region `/workspace`, Brand, Nutrition, Team,
  Billing) and Your account (every member of staff: Notifications, Appearance, Password and security). From
  50 rem of page it is a sticky column; on a phone a row under the heading that scrolls sideways with the open
  page in view. A client gets no Settings section: their account pages open from Me and keep their way back.
  Every address stays as it was (emails and the billing banner link to them), and the sidebar's Settings is
  marked on all of them. **Name and region**: the name; the time zone shown as "Beirut, Asia · GMT+3 · 8:03 PM"
  with Change opening a sheet that searches every zone by city or region (the device's zone offered first); the
  week's first day and the currency new plans start in as segmented choices (US dollar, Lebanese pound, Another
  with a code checked against the browser's ISO list); the stored language is kept and not offered (see
  follow-ups); Save changes, Undo changes and the leave warning. **Team**: the owner first, then each coach with
  initials for a face, the role, clients and when they joined; Invite a coach opens a sheet; who is still to
  accept sits under Waiting to join with how long the link works; Send a new link, Cancel the invitation and
  Remove from the team wait in each row's menu, removal asked first. **Billing**: where the bill stands and what
  is owed, then How to pay as three steps with Copy beside the Whish number and each reference, this month so
  far line by line, and the invoices one row each (month, reference and what happens next, total, status) that
  open a sheet with the invoice's own prices line by line, the payment, and a link between a voided invoice and
  its reissue. **Password and security**, for staff and clients: field errors in words with focus on the first,
  Sign out everywhere asked first, and leaving the coaching space in a kit dialog. Appearance and Notification
  settings sit in the same layout. All of it follows dark mode; Billing keeps TB Gym's colours.
- Built in R5.2b: the platform admin's two screens, outside any workspace (a platform admin needs none), in TB
  Gym's colours and the person's mode. **Platform billing** (`/admin/billing`): four tiles (what is owed and by how
  many spaces, read-only now, overdue, trials ending within 7 days), then the coaching spaces as faces with their
  owner, seats and clients, a status and the sentence for what happens next, what they owe and a chevron, ordered
  worst first; search by space, owner or email and the chips All, Needs payment, On trial and Paid up (`?show=`);
  then the Price plan with each term on its own line, Earlier versions closed, and Publish a new version, a sheet
  of eight terms with a "What changes" list. "Issue last month's invoices" asks first (it emails each owner).
  **A coaching space** (`/admin/billing/:tenantId`): where it stands and what it owes, its invoices (reference,
  total, when due or what became of it, what it counted; Record payment and Void on an unpaid one, the payment's
  reference and note on a paid one, a voided one struck through and linked to its replacement), this month so far
  line by line, and its discounts (running, starts later, ended, revoked) with Grant a discount and Revoke after
  asking. Closing a sheet that holds typed work asks first.

**C10. Exercise library**
- A grid/list toggle with media thumbnails, filter chips instead of three dropdowns plus an
  "Apply" button, and a quick-add drawer.
- Built in R5.1b: Exercises (`/training/exercises`, follows dark mode) shows cards with each exercise's
  first media: a picture through one batch grant per 32 cards, a play tile for a video or a link (read
  from the coach's media list, no grant needed), else a lettered tile tinted by what the pattern trains.
  On a phone the cards go two a row. The search and the chips apply at once and live in the address
  (`?q=&muscle=&pattern=&type=&equipment=&archived=1&view=list`). New exercise and Edit open one sheet;
  the legacy inline editor, its media panel and the archive dialog are gone. The kit's menu gained a
  `chip` look, a marked current choice, a scrolling list and opening from its other edge when it would
  leave the screen.

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
- Built in R2.5b at `/training/program` (the Training tab; the player stays at `/training/today`):
  a brand hero with "Week 3 of 8", sessions done and missed, the end date, one segment per week and
  the one action (start or continue today's workout, else the next session). This week's sessions
  follow with Done, Missed, Today or In progress; other weeks sit behind disclosures, and a week the
  client cannot see yet says when it opens. Finished workouts list sets, volume, time and their PRs,
  four at first. States and records come from the server (TRN-019, TRN-020).

**M4. Nutrition day**
- A **day strip** instead of a date input.
- Macro rings, meals as cards, "Ate as planned" in one tap, swap to an alternative, and add a
  custom food.
- Friendly states, e.g. "Your coach hasn't set a meal plan yet". Never "No authorized nutrition
  plan".
- Built in R4.4d: a meal's recipe name opens the **recipe sheet**: the cover photo, prep and cook time
  and the yield as chips, "Your plan: 1 serving · 432 kcal" with its grams, the ingredients for the
  client's portion with "Amounts for: Your portion | Whole recipe" when the two differ (raw or cooked
  said beside the amount) and the method as numbered steps, then **Print recipe**. Swap or adjust has
  "See the recipe" for the option chosen. It reads the client's own copy (NUT-006). Raw or cooked is said
  after an amount ("170 g cooked") unless the food's name says it. A meal card leads with its recipe's
  photo when it has one. The day now follows the person's light or dark setting (checked in dark), so it
  and its sheet always share one mode; paper is always light.

**M5. Progress**
- A hero **weight trend chart** with a weekly-average band and a range switch (4 w / 12 w / All).
- A "Log weight" bottom sheet; its button sits in the range row. With fewer than three weigh-ins the
  chart shows the readings, the change and "Log 1 more weigh-in" instead of a trend line, and the
  weekly average is a darker dashed line (after the R2.5a audit).
- Measurement deltas.
- A photo timeline with a before/after slider.
- A strength PR list.
- The full history sits behind "All entries" and never renders empty days. Estimation method names
  are never shown to clients.

**M6. Check-in**
- A step-by-step form (one question per screen, a progress bar), photo capture, and a
  confirmation.
- Built in R2.4c: the check-ins page leads with the check-in due first (coach's face and note,
  question count, Start or Continue) and keeps sent ones collapsed. The flow saves as it goes,
  resumes where it was left, holds a required question until it is answered, and ends on a review
  with Edit on every answer. The photo step is optional and saves progress photos (see follow-ups).
  The review pins Back and Send above the tab bar with a count of answers (not on a short landscape
  window), and Edit is a touch-size button (after the R2.5a audit).

**M7. Messages**
- The same chat components as C6.
- Built in R2.5a: a client with one coach lands straight in that thread; a second (a former
  coach's, read-only) brings the inbox back. Messages are grouped by day ("Today", "Mon 28 Sep"),
  quick messages from one side join into a run, and a "New messages" line marks where the unread
  began and stays for the visit. Edit and remove wait behind each message's options. Enter sends
  on a desktop keyboard (Shift+Enter is a new line); on a phone the round send button does. A working
  live channel shows nothing; only reconnecting or offline earns a line, and offline offers a check.
  Phones show the inbox or a thread with the composer pinned above the tabs; wide screens show both.
  On a phone the thread header (back, face, name) sticks to the top, below the coach's top bar
  (`--tb-topbar-block-size`, published by `CoachShell`).
  The pieces (`ConversationList`, `ChatBubble`, `ChatComposer`, `chat-timeline.ts`) live in
  `features/messaging`, the one screen that uses them.

**M8. Me**
- Profile, units, notifications, switching workspace and sign-out.
- Built in R2.5c at `/me`, reached from the avatar on Today (Me is not a tab). A brand card holds the
  client's initials, name and email, and their coach as a pill with a face that opens the chat (plain
  text when messaging is not in the plan, left out when the coach cannot be read). Rows lead to My
  profile, Notifications (rebuilt in R5.1c) and Password and security; the first and last are still
  the old screens. Appearance
  (Device, Light, Dark) and Body weight (kg, lb) are inline and save as they are chosen, one at a
  time, on the account (CLI-017), so they follow the client to a new phone or the installed app; a
  refused save puts the control back and says so. Body weight is the starting unit of weigh-ins and
  the Progress screens only: stored weights stay kilograms (ADR 0009) and the workout player still
  asks for its own unit (TRN-016). With more than one coach, "Your coaches" switches between them.
  Me follows dark mode (marked `REDESIGNED`), and the install card sits above Sign out.

**Notifications (coach and client, R5.1c)**
- Reached from the bell in the coach's top bar and on the client's Today. One screen for both, in
  the person's mode: notices in days, newest first, each with a small picture of what it is about,
  its title, one line of detail and the time; unread ones tinted with a dot and "unread" for screen
  readers. All and Unread (the server filters), Mark all as read while anything is unread, Settings
  top right, and "Show earlier notifications" for the next 25. A notice with somewhere to go is a
  link that marks it read on the way; one with nowhere better (a plan reminder) is a button that
  marks it read. Coming back to the tab reads the first page again, and the badge reads its count
  again then and once a minute while shown. Settings is one card per channel (in the app, always
  on; email; quiet hours, whose times appear once switched on) with Save and the leave warning.

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
R2.4c: the client's check-in screens drop the form version ("v2"), because the due or sent date
already tells two check-ins apart; the coach's check-in screens keep it.

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
  every editor (C4, C7, the exercise editor, the intake form: done in R5.3b). The exercise editor must never drop
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

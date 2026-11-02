# Motion and play for the demo of 2 November 2026

On the night of 1 November 2026 the owner asked for "animation or visible interactive things", so that a friend who
tries the app the next afternoon is amazed: "make the app a little more interactive or fun to use". The friend lifts,
coaches and knows software; he uses an Android phone as a client, then the laptop as the coach, in the same room. The
owner gave the night and the morning, until 16:00, and the research, the plan and the run to Claude ("go, and good
luck"). This file is the build plan: section 0 lists the rows in order with their status, section 1 says how a row is
built and what the owner does on the day, section 2 says what each row builds, section 3 collects the choices the rows
made, and section 4 is the arc the friend walks. The research behind it is in this file's commit message and in the
rows' own evidence lines. AGENTS.md, DOMAIN-RULES.md and UI-REDESIGN-PLAN.md apply to every row; section 1 says where
the UI plan's rule 9 is loosened.

## 0. Build status

One row is one chat, in this order; the runner starts the next once a row is Done, and starts none after 14:00 on
2 November, so that the last chat ends by 16:00. A chat builds the first row that is not Done, passing over rows marked "Open, not
blocking". The third column is the owner's word as the research shaped it; an item it leaves out is not built. A
status reads Open, Done · date · commit, Open, not blocking (with why), or Built, not committed (with what failed).
What a row left out or chose on its own waits for the owner in section 3.

| Step | What | What it builds, and what is left out | Status |
| --- | --- | --- | --- |
| W1 | Foundations | `core/motion`: the reduced-motion read with a `?motion=off` switch, the four moves with the prototype's numbers on the Web Animations API (no GSAP in the app), a fake for tests; the everyday layer (a 120 ms press on the kit's buttons and tappable cards, a 200 ms fade when a page changes inside the client and coach frames); mocked Playwright runs with reduced motion by default; rule 9 loosened in the UI plan. Left out: GSAP (it stays on the homepage), route view transitions, `animate.leave`, any change to the theme switch. | Done · 2026-11-02 · f3f44a7 |
| W2 | Demo day | `scripts/demo-day.ps1`: one command that rebuilds the demo into `tbgym_demo`, starts the API and the web app over HTTPS on the laptop's own address, opens the firewall once, and prints the address, the sign-ins and a QR code; `crypto.randomUUID` guarded so a plain http address works too; second, `-HeroName`, which gives Maya the friend's first name in the demo database only. Left out: Render, the test copy, email. | Done · 2026-11-02 · 6294bc9 |
| W3 | The set tick and the record burst | A logged set springs into its done form and its tick draws, the exercise's segment fills; a record pops its chip and bursts 16 dots from it, with the buzz Android gives, and its sentence becomes a pinned pill that never shifts the sets; a second record in the same workout gets the small form. Left out: sound, anything before the server's answer. | Done · 2026-11-02 · c3dc42d |
| W4 | The finish | The finish summary rises and its four numbers count up to the server's own strings, the records list follows and the share card lands with a spring. Left out: a new share card design, a hold-to-finish button. | Done · 2026-11-02 · ff5b195 |
| W5 | The rest timer | The rest card slides in and out, its ring drains in one continuous sweep instead of stepping, it pulses in the last three seconds, and it keeps time while the phone is locked. Left out: a flick to skip, the end tone's words. | Done · 2026-11-02 · 78e06e1 |
| W6 | Coach Today hears the phone | While the tab is in view Coach Today re-reads quietly every 4 seconds, and a workout finished on the phone lands as a strip under the greeting and slides into the feed with its record and a highlight that fades; a message bumps a re-read at once; a resolved row leaves. Left out: a server event (the live finish frame, "Later"), set-by-set progress, count-ups. | Done · 2026-11-02 · a04f6f5 |
| W7 | The card opens into the player | On Today, Start or Open workout grows the card into the dark player (a clip-path reveal, 500 ms) and the player's parts rise in once the workout has loaded; the training chunks preload on idle. Left out: the way back (the leave guard); the row is left out whole if the reveal cannot be kept smooth and the console clean. | Done · 2026-11-02 · c2359ee |
| W8 | Messages that move | A sent bubble rises from the composer, a received one slides in from its side, the thread list's row rises when a message lands, and Today's coach card rises with a pulse when the coach's reply arrives, on the phone and the laptop; the unread pill ticks. Left out: typing indicators, optimistic sends. | Done · 2026-11-02 · 7ed6cac |
| W9 | Rings that sweep, and back to Today | Every progress ring in the app (nutrition, meal plan days, the week) sweeps to its new value instead of jumping, the player's exercise bars grow as sets are logged, and Today's sections rise in on first draw; second, if time allows, after a finish Today fills the day's ring, ticks it and settles the card into its done state. Left out: a finished week's flare (the demo cannot reach one), anything on Today's pixel snapshots beyond their final state. | Done · 2026-11-02 · f94361a |
| W10 | The share card in the hand | On the finish summary the share card follows a finger or the mouse: it tilts in 3D, a sheen slides across it, and it springs back when let go, before Share. Left out: a new card design, a sticker export. | Open |
| W11 | The barbell | In the player, a Plates tool (and a tap on the target weight) opens a sheet that loads a barbell, plate by plate, for the target in the client's unit, with steppers and the nearest loadable weight. Left out: a drag along the bar, a per-gym plate set (a workspace setting, "Later"). | Open |
| W12 | Coach Today builds itself | On the first view per app load, Coach Today's panels and rows rise in turn, once. Left out: count-ups (its figures are built strings and a plural), a chart (there is none to draw). | Open |
| W13 | Progress draws itself | The trend line draws in and the bars rise on the Progress page's first draw, the big number counts up, and a finger or the arrow keys scrub the line to read any weigh-in, for the client and for the coach on the client's page. Left out: progress photos, a before-and-after slider (no photos in the demo). | Open |
| W14 | Coach polish | Ctrl+K on the coach's laptop: a palette that jumps to any page or any client by name, no animation; Clients' filter chips crossfade the rows; a hover card on a client's row after 700 ms with their last 7 days and plan. Left out: more shortcuts, a `?` sheet. | Open |

**Later, not rows.** The live finish frame (a third content-free hub frame after a workout's commit to the client's
coach and the owners, about 100 lines of server code plus tests and the full suite, 3 hours; W6's re-read then becomes
a fallback); "Maya is training now: 7 of 18 sets" (a read of workouts in progress); a finished week that flares and a
finished program's confetti and seal (the demo reaches neither on the day: no client closes a week on a Monday and
Maya's program runs to day +20); a rep-max dial on a record from the pinned Epley curve; a per-gym plate set; a muscle
map of the week and a body to tap in the exercise library (the workout data carries no muscle, so the map is a server
row); pull-to-refresh with a bending bar; a punch card for a session pack; ghost arcs on the nutrition rings while a
meal is being chosen; sheets that follow a finger (a kit change behind every guarded modal, 2.5 hours; the smallest
safe version is a 180 ms exit on × for unguarded sheets); a hold-to-finish button (it would skip the one screen that
says a finish cannot be changed); exercises that slide like pages in the player, with a swipe; digits that roll like
an odometer wherever a number changes; lists that rearrange themselves (FLIP) on Clients and in the library; route
view transitions once Angular's feature leaves developer preview; GSAP in the app, if the Web Animations API ever
falls short of a moment; the six small changes section 3 of
docs/CRITIQUE-FIXES-2026-10.md still recommends; a sound for a record, kept ambient and off by default.

## 1. How a row is built

**Where.** On this laptop, by the plan runner: `.\scripts\start-plan-runner.ps1 -Plan motion`, one fresh chat per row
on Fable 5.1 at max effort (Opus 5.5 takes over after a usage limit), in section 0's order. A chat builds the first
row that is not Done, passing over rows marked "Open, not blocking". It commits on main once its checks are green,
and the runner pushes each row that ends Done. Nobody watches: the owner is asleep and reads the reports, the
screenshots and the videos in the morning.

**The clock is the first rule.** Each row is sized for about an hour of chat time, and no row may run past two hours:
the runner ends a chat at two hours and the run stops there, so a chat that has not committed by then loses the run
for everyone after it. After 75 minutes a chat adds nothing more: it finishes the checks on what is complete, leaves
the rest out with a line in section 3, and commits; by 100 minutes it is committing. Where a row names a first and a
second part, the second is built only if the first is complete with time to spare. A moment is either complete and smooth or absent: no half-built
motion is ever committed. If nothing is complete in time, the chat reverts its own changes (checks out the files it
touched and deletes the files it added, nothing else), sets the row to "Open, not blocking: ran out of time at HH:MM,
<what was tried>", commits only this file, and ends with RUNNER-RESULT: done. The run then carries on to the next row.

**What every row keeps.**

- The rules of AGENTS.md and docs/UI-REDESIGN-PLAN.md: the kit, the words, the definition of done, the three motion
  layers of its section 3. Rule 9 of its section 2 is loosened by the owner's ask of 2026-11-01: a press, a tick, a
  ring that fills or a number that rolls may answer an ordinary tap, as long as it is under 300 ms, never blocks input
  and never repeats on its own. A celebration (a burst, a chord, a landing card) stays for a real moment only: a
  personal record, a finished workout, a finished week or program. W1 writes that sentence into the UI plan.
- Nothing grows the first download beyond what W1 adds. Every row measures the production build's initial size
  before and after, names both numbers in its report, and loads anything heavier than a few hundred bytes lazily
  through `core/motion` (W1), never from `app.ts`, `shell/**` or `ui/**`.
- Only transform, opacity, clip-path and colour animate. No width, height, top or left. No `transition: all`.
  Durations follow the tokens (`--tb-duration-fast` 120 ms, `--tb-duration` 200 ms, `--tb-duration-slow` 320 ms,
  `--tb-ease`), with longer runs only for the signature moments section 2 names, and nothing everyday over 300 ms.
- Every moment has a reduced-motion form that a chat proves: with `prefers-reduced-motion: reduce` the final state
  appears at once, or crossfades; zooms and parallax are removed, not shortened. Nothing flashes more than three
  times a second, and nothing loops without a stop.
- Numbers that move are real: a count-up ends on the server's own string, tabular digits, and nothing is invented or
  rounded for effect. Money is never worked out in the browser.
- Screen readers hear the words, never the motion: live regions keep their one sentence, and a moving element keeps
  its name and its focus. Keyboard and 200% text still work. axe stays clean.
- The server is the source of truth. A set is done when the server says so; an optimistic tick must undo itself on a
  failed save. No new money rule, legal wording, points, levels or ranks.
- jsdom has neither `matchMedia` nor `Element.animate` and nothing stubs them, so every helper guards both and lands
  on its final state in Vitest. The mocked Playwright suite runs with reduced motion from W1 on, so a motion spec opts
  back in. A finish cannot be undone, so a row that films the finish restores its scratch demo between attempts.
- Where a row changes a rule or a layer of motion, it updates docs/UI-REDESIGN-PLAN.md in a few lines. No new docs.

**Checks**, in proportion to what changed (AGENTS.md): web rows run `format:check`, `lint`, the production build,
Vitest and `git diff --check`, under Node 24.19.0 and npm 11.17.0 (`npm ci` only when the lock file changed). Only a
row that changes server code builds the backend and runs the full suite with `scripts/TestPostgres.ps1` and a container
name of its own, about 1 h 30 on this laptop. Mocked Playwright: the specs of the screens the row changed, not the
whole suite. Then the live pass.

**The live pass films the motion.** A still cannot show whether a moment is smooth, so every row records each moment
it built with Playwright's `recordVideo` (390 x 844 for a client moment, 1440 x 900 for a coach moment), at least once
with motion on and once with `reducedMotion: 'reduce'`, into `artifacts/motion/<row>/` (git-ignored) as `.webm`, with
1440 and 390 stills in light and dark, axe clean and no sideways scroll. The videos are for the owner; a chat cannot
watch them, so it checks each moment itself with a filmstrip: pause `document.getAnimations()`, set their
`currentTime` to 0, 80, 160, 320 and 600 ms and screenshot each; the settled screen with motion on matches the
reduced-motion screen; `getAnimations()` is empty and no spark node remains two seconds after the moment; and no
long frame shows under 4x CPU throttling. The report names the files. The live pass runs
against a fresh demo in a throwaway database of the chat's own (`ConnectionStrings__Database` pointed at it, built with
the `demo-workspace` command), never against the owner's API (port 5134), web (port 4200) or the `tbgym` and
`tbgym_demo` databases; the chat drops only the database it created and stops only the servers it started.

**The demo data.** Maya Fakhoury (`maya.fakhoury@mail.example`, coach Lea, `AtlasDemo-2026!`) is the client the friend
uses: on a demo built on a Monday after 09:00 Beirut she has Lower A unstarted (Back Squat, leg press, split squat,
leg curl, 3 sets each), and her first logged set at the coach's numbers is a personal record (her squat max rose from
60 to 62.5 kg for this block, `DemoWorkspaceGenerator.Clients.cs:849`, so set 1 opens at 52.5 kg x 5 against last
week's 50 x 5; a chat confirms the numbers live before filming). Lea's message from 55 minutes before the build asks
her to add 2.5 kg on the last set, which makes set 3 at 55 kg a second record. Lea (`lea@atlas.example`) is the coach
on the laptop; Lea's feed holds Maya's week-3 workouts. Sara (Karim's client) and Jad (Omar's) have the same workout
unstarted and a record waiting: a chat rehearses on them, films on a fresh copy, and never assumes the data is fresher
than the build it made.

**Choices.** A technical question is the chat's (AGENTS.md). A product choice the row and the docs do not settle
(a duration, an easing, where a thing sits, the words) is built the way closest to the prototype at
`docs/design/prototype/tb-gym-prototype.html` and the owner's earlier choices, and listed in section 3 with the other
way and a recommendation. Work outside the row is left out and listed there. No chat stops the run for a decision.

**The report** says what changed for coaches and clients, the test results, the first download before and after, what
was not done or not verified, where the videos and screenshots are, and the next row. It ends with
`RUNNER-RESULT: done <row> <hash>` or `RUNNER-RESULT: stopped <reason>`.

**The owner's own steps on the day** (Monday 2026-11-02; nothing before):

1. Pull nothing: the runner pushed every finished row, and main on this laptop is what runs.
2. `.\scripts\demo-day.ps1` (W2) with the laptop on the same Wi-Fi as the phone: it rebuilds the demo into
   `tbgym_demo`, starts the API and the web app over HTTPS on the laptop's address, and prints the address, a QR code
   for the phone and the sign-ins. Run it after 09:00 and again after the last row lands, since the demo's data ages.
3. On the phone, open the QR link once, accept the certificate warning, sign in as Maya, and keep the tab open, with
   auto-lock off and Android's "Remove animations" off. On the laptop, sign in as Lea on Coach Today with display
   sleep off. Try the arc in section 4 once on Sara, with Karim on the laptop, never on Maya: a finish cannot be undone.
   If the phone cannot reach the laptop, Maya runs in a narrow second window on the laptop.
4. If a moment looks wrong, open the app once with `?motion=off` on that device (`?motion=on` brings it back), or
   switch single rows off with `tb-motion-off = W3,W7` in the browser's local storage; Windows' "Animation effects"
   and Android's "Remove animations" do the same for everything; `git revert <the row's hash>` takes a row out for
   good, since each row keeps its moment in its own file.
5. If the room's Wi-Fi keeps the phone and the laptop apart (guest networks often do), turn on the laptop's Mobile
   hotspot (Settings > Network > Mobile hotspot), join the phone to it and run the script again, which prints the
   new address; or run Maya in a narrow second window on the laptop.

## 2. What each row builds

Paths are under `src/web/src/app/` unless said otherwise. The prototype is `docs/design/prototype/tb-gym-prototype.html`
(its script from line 598); its numbers are the defaults below, shortened where the research says so (nothing everyday
over 300 ms, a card open at 500 ms rather than 700, nothing from scale 0). Easings are named as the prototype names
them (GSAP's `power2.out`, `back.out(2.5)`, `elastic.out(1, .6)`); a row renders each as a cubic-bezier or a `linear()`
curve of the same shape, since the app runs on the Web Animations API, not GSAP.

### W1 · Foundations

The gap this run closes is written at `docs/UI-REDESIGN-PLAN.md:345`: the signature moments of its section 3 were never
built, `animate.enter` is used nowhere, and GSAP 3.15 runs only on the homepage (`features/home/home-motion.ts:19-37` is
the loader pattern) and in the dev lab.

- **`core/motion/motion.ts`.** A root `Motion` service with no dependency and no GSAP: the app's moments run on the
  Web Animations API and `requestAnimationFrame`, so nothing downloads at a moment, a chat can pause and scrub them
  through `document.getAnimations()` to check itself, and the module stays tiny enough for `ui/**` to import. `allowed(moment?)`
  reads `prefers-reduced-motion` at call time, is false on the server and where `matchMedia` or
  `Element.prototype.animate` is missing (jsdom has neither, and nothing stubs them: `vitest.config.ts` has no setup
  file), as `shell/theme-switch.ts:91-95` guards, and is false while the kill switch is on: `?motion=off` in the
  address writes `tb-motion = off` to `localStorage` (try/catch, `?motion=on` clears it), and `tb-motion-off = W3,W7`
  switches single rows off, read per call, no rebuild. The moves, each writing the DOM directly (no change detection
  per frame) and returning a function that ends it: `countUp(el, to, format)` 1.1 s ease-out, which captures the
  element's final text first and ends on exactly that string; `ring(circle, from, to)` 1.1 s on
  `stroke-dashoffset`; `drawLine(path)` 1.4 s ease-in-out; `rise(elements, { stagger: 50, from: 14 })` 450 ms ease-out,
  capped at 6 elements; `pop(el)` from scale .5 with overshoot. Overshoots and springs are `linear()` easings worked
  out once (about 300 bytes), never a library. With motion off every move sets the final state at once. A fake
  provider in `src/testing` for Vitest. Each row keeps its moment in a file of its own behind a one-line hook, so a
  row can be reverted alone.
- **The everyday layer, in `src/styles/_ui.scss`** under `@media (prefers-reduced-motion: no-preference)`, keyframes
  inside the same block (`rest-timer.ts:138-146` shows why): a press, `transform: scale(.97)` over `--tb-duration-fast`
  on `:active` for `.tb-button`, `.tb-icon-button` and `.chip` only, with the `:not(:disabled, [aria-disabled='true'])`
  guard of `_ui.scss:216-230`, never on inputs, row links or list rows (iOS sets `:active` at the start of every scroll,
  so lists would flicker, and a 0.97 scale pulls a 1440 px row's edges in by 20 px); a page fade, opacity 0 to 1 over
  `--tb-duration` with `--tb-ease` and `animation-fill-mode: backwards` (never `both`, or a finished fade stays in
  effect on every page host) on the routed component inside the client and coach frames
  (`.client-main:not(.full-screen) > router-outlet + *` and the coach's twin; `.full-screen` sits on the same `<main>`,
  `app.html:79-80`; opacity only, since a routed host is inline), so the player (W7) owns its entrance. The global
  pieces later rows need and component styles cannot hold: `::view-transition { pointer-events: none }` and the
  `@property --progress` registration (W7 and W9). About 0.4 kB on the first download, the only growth this plan
  allows; measured and named in the report.
- **Tests.** `src/web/playwright.config.ts` gets `use: { contextOptions: { reducedMotion: 'reduce' } }` so the mocked suite,
  its pixel snapshots and axe never meet motion; a motion spec opts in with `page.emulateMedia({ reducedMotion:
  'no-preference' })`. 18 specs freeze the clock with `page.clock.setFixedTime` (for example `e2e/coach-today.e2e.ts:36`), and a
  count-up driven by `performance.now` or a tween on `Date.now` would never advance there. Rerun `home`, `hero-lab`, `client-today`,
  `coach-today` and `workout-progress`; a baseline changes only where a `reduce` block changes a final look.
  `playwright.live.config.ts` gets the same default. ESLint `no-restricted-imports`: `gsap` is banned outside
  `features/home/**`; `core/motion` imports nothing but Angular.
- **The UI plan.** In section 2, rule 9 gains: "Small, quick feedback may answer an ordinary tap (a press, a tick, a
  ring, a rolling number; under 300 ms, never blocking, never repeating on its own); a celebration stays for a real
  moment (the owner, 2026-11-01)." In section 3, Motion, a line that W1 to W14 build the layers, that the Web
  Animations API carries the app's signature moments while GSAP stays on the homepage, and where `core/motion` lives. Section 0's table gains no row: this plan is its own file.
- **Done means:** in the live pass, a change of page in the client frame and in the coach frame fades in, a button
  press scales, and with reduced motion neither happens; the first download before and after; the five reruns green.

### W2 · Demo day

The phone and the laptop sit in one room, so the app runs on the laptop and the phone reaches it over Wi-Fi. A plain
http address is not a secure context: `crypto.randomUUID` (`features/messaging/command-keys.ts:41`,
`conversation-starter.ts:34`, `client-checkin-review.ts:598`, `invitations.ts:199`, `team.ts:328`,
`notification-preferences.ts:126-428`) throws there, and the wake lock and Share are absent. The dev server serves
HTTPS only with a certificate and key (`@angular/build/src/builders/dev-server/vite/server.js:94-103`: `--ssl` alone
serves http). Git's `openssl` (3.5.4) is on this laptop. The Wi-Fi "Cudy-5G" is on Windows' Public profile, where the
firewall drops inbound connections.

- **`scripts/demo-day.ps1`**, ASCII, following `scripts/Toolchain.ps1` and `scripts/demo-workspace.ps1`: starts Docker's
  PostgreSQL (`docker compose up --detach postgres`), drops and rebuilds `tbgym_demo` with the `demo-workspace` command
  (never `tbgym`, which holds the owner's accounts; `-KeepDemo` skips the rebuild), starts the API on 5134 with
  `POSTGRES_DB=tbgym_demo` as `run-api.ps1` does, makes a self-signed certificate once into `artifacts/demo-day/` with
  SANs for `localhost` and every IPv4 address of the laptop, starts `ng serve --host 0.0.0.0 --ssl --ssl-cert --ssl-key
  --proxy-config proxy.conf.json`, adds an inbound firewall rule for the toolchain's `node.exe` on the Private and
  Public profiles if none exists (elevating once, a UAC prompt, and saying so), and prints `https://<ip>:4200`, the
  demo sign-ins (Maya and Lea, `AtlasDemo-2026!`) and a QR code of the address in the terminal, if one can be drawn
  without a new dependency; otherwise the address alone. Ctrl+C stops what it started. The script says, in two lines,
  that the phone accepts the certificate warning once.
- **`randomUUID` guarded**: one `newIdempotencyKey()` in `core/` falling back to `crypto.getRandomValues` where
  `randomUUID` is missing, used at the sites above, with a Vitest.
- **Second, if time allows, `-HeroName <first name>`:** after the rebuild, Maya's first name becomes the friend's,
  in `tbgym_demo` only (through the API where a profile edit exists, else one update on the demo database), so the
  strip, the share card and the coach's screens carry his name. Her sign-in and everything else stay the same.
- **Done means:** the chat proves it from a second origin on this laptop: Playwright with `ignoreHTTPSErrors` opens
  `https://<ip>:4200`, reads `window.isSecureContext === true`, signs in as Maya, logs a set, sends a message, and a
  second context signed in as Lea sees it land; plus the script run end to end once, with its printout in the report.
  The owner's steps in section 1 name the script.

### W3 · The set tick and the record burst

A set is saved by `today-training.ts:303-469` after a CSRF refresh, and the server's answer says whether it is a
personal record (`TB.Gym.Infrastructure/Application/TrainingApplicationService.Client.cs:377`): the browser cannot know
before the answer. Today the answer adds `New personal record!`, a `PR` chip and a buzz (`:406-417`), and the sentence
shifts the page as it appears (`today-training.scss:301-307`). The rest card starts right after (`:519`).

- **The tick** (`today-training.html:358-371`): the visible tick lands on the server's answer, not on the tap
  (`done-tick` renders on the server's `isCompleted`, `html:267-269`, and the row's done look comes from `collapsed()`,
  `ts:536-542`, which needs a clean draft too), so the `:active` press is the tap's own answer and the rest keeps
  waiting for the answer (`:519`). On the answer the row springs from scale .96 to 1 (450 ms, `back.out(2.5)`) as it
  collapses into its done form, the tick draws (scale .4 and rotate -30 to rest, 500 ms, `back.out(3)`), and the
  exercise's segment bar fills with `scaleX` (500 ms, `power2.out`; never `width`). Nothing is inserted: every set row
  is already rendered (`@for`, `html:227`). A 25 ms buzz where `navigator.vibrate` exists. Web Animations, no GSAP, so
  the tick costs nothing to load. A reload shows the ticks standing still, with no replay.
- **The record**, on an answer whose `isPersonalRecord` is true (it is optional in the type, `types.gen.ts:4496-4510`;
  false or missing gives the tick alone): the chip pops from scale .5 to 1 (550 ms, `back.out(4)`; never from 0) and 16 dots
  burst from its centre (every third in white, 34 to 68 px out, to scale .3 and opacity 0, 0.8 to 1.1 s, `power2.out`,
  24 DOM nodes at most, in an `aria-hidden` layer, removed when done); the buzz `[30, 50, 80]` the app already sends.
  The existing `role="status"` line (`today-training.html:38-40`) is styled as the pill on a record ("New personal
  record · Back squat 52.5 kg × 5"), fixed under the player's header with `pointer-events: none`, never covering the
  Edit set button that focus returns to (`restoreSetFocus`, `ts:520`), so the sets never move and no second text
  element is added. A burst fires only when a set goes from not a record to a record (checked against `prSetIds` before
  the update, `ts:406-414`, so a set edited and saved again never bursts twice), and since any first-time rep count is
  a record (TRN-019, a tap on − or + on reps would make nearly every set one), the first record of the workout gets
  the full burst and every later one the chip with eight dots. The whole burst is under 1.2 s and never blocks the
  next tap.
- Reduced motion: the tick and the chip appear at once, the colour change carries the moment, no dots.
- The record the arc relies on is worked out from the generator, not read from a number in the code: the chat
  confirms on its fresh demo that Maya's set 1 at the coach's numbers answers `isPersonalRecord`, writes the result
  into section 3, and if it is not a record says which rep count makes one (any count never logged is, TRN-019).
- **Done means:** 390 videos of a plain tick and of Maya's first set (52.5 kg x 5, a record), light and dark, and the
  reduced form; `today-training.interaction.spec.ts`, `workout-set-drafts.spec.ts`, `e2e/workout-progress.e2e.ts` and
  the live `workout-logging.e2e.ts` green; `today-training`'s compiled styles stay under 8 kB (5.31 kB today), with the
  new rules in a new layer file (`today-training.ts:119`).

### W4 · The finish and the rest

The finish summary receives everything at once (`today-training.html:41-84`, `today-training.ts:966-1017`): duration,
sets done and total, volume per unit, the records, an optional finished program. It is static. The share teaser already
enters with a 900 ms overshoot after 350 ms (`features/share-cards/share-teaser.ts:65`). The rest timer's ring steps
once a second (`features/training/rest-timer.ts:171`) and slides in over 200 ms (`:138-148`).

- **The finish, first:** `finishSummary` is set from the complete answer (`today-training.ts:1006`; its fields are
  number or string, `types.gen.ts:4466-4473`, so `Number()` them) and replaces the workout in the same render, so the
  count starts in `afterNextRender`. The panel rises (y 30, 500 ms, `power3.out`), its children follow (y 18, 500 ms,
  stagger 0.06, delay 150 ms); the four numbers count up with `countUp` (time 0.9 s, volume 1.3 s, sets 0.9 s, records
  0.9 s), tabular digits with each stat's width locked first so the two-column grid never jumps, each ending on the
  exact string the page shows today: `today-training.interaction.spec.ts:1653-1656` reads `.summary-stats strong` and
  expects "2,187.5", so each `<strong>` keeps one text node and the count runs through that node's data; the sets
  figure is one node with two interpolations (`html:52`), so only the first number moves inside it; volume goes through
  `DecimalPipe` `'1.0-1'` (`html:61`), so the count formats with `formatNumber(v, LOCALE_ID, '1.0-1')`. No `aria-busy`:
  the status line already says "Workout completed." (`ts:1013`). Back to Today (`html:83`) and Share work from the
  first frame; only the numbers and the card move. The records list rises. The share teaser's own encapsulated styles
  hold its entrance (`share-teaser.ts:58-82`), so line 65 becomes `animation-delay: var(--tb-share-delay, 350ms)` and
  the summary sets the variable for the prototype's landing (rotate -10 and y 40 to rotate -2, 0.9 s,
  `elastic.out(1, .6)`, delay 500 ms): one entrance, not two.
- Reduced motion: the summary and its numbers appear at once.
- A finish cannot be undone, so each live attempt needs a fresh workout: the chat restores its scratch demo between
  attempts (a template copy, as `scripts/TestPostgres.ps1` keeps one) rather than rebuilding four minutes each time.
- **Done means:** 390 videos of Finish, light and dark, and the reduced form; `today-training.interaction.spec.ts`
  (`:269`, `:304`, `:1653`), `share-teaser.spec.ts` and the live `workout-logging.e2e.ts:474` green.

### W5 · The rest timer drains smoothly

The rest timer's ring steps once a second (`features/training/rest-timer.ts:171`, from whole seconds) and slides in
over 200 ms (`:138-148`); the friend meets it after every set, and Strong's reviews praise the rest timer above all.

- The card slides in from y 140 (500 ms, `power3.out`) and out (350 ms, `power2.in`; the leaving card gets
  `pointer-events: none` so Skip cannot take a second tap); the ring runs in one continuous sweep to the end time (one
  Web Animations run of `stroke-dashoffset` from the current fraction over the remaining milliseconds, which overrides
  the `[attr.stroke-dashoffset]` binding at `:43`; the binding stays as the jsdom and reduced path; restarted from the
  current fraction in `add()`, cancelled in `stop()` and `clearTimers`), so it no longer steps. The clock at `:200-246`
  stays the source of truth: the ring resyncs from `Date.now` when the page becomes visible again and whenever it
  drifts past 250 ms, since the document timeline stops while a phone is locked and the plan promises the timer keeps
  time (`UI-REDESIGN-PLAN.md:347`). In the last three seconds the card pulses gently; at zero it turns lime and says
  "Rest is over" as today, with the buzz and the tone.
- The running and over states stay separate elements, `role="timer"` only while running (`rest-timer.spec.ts:96,190`
  expect it gone after Skip and finish), the polite `<p>` (`:32`) stays the accessible channel, the scroll padding
  (`:180`) stays.
- Reduced motion: the card appears in place and its ring steps as today.
- **Done means:** a 390 video of a rest from a logged set to zero (a short rest, so the pulse and the end show), light
  and dark, and the reduced form; `rest-timer.spec.ts` green (+15 s restarts, Skip cancels, the over state still
  announces and dismisses); `e2e/workout-progress.e2e.ts:397` green.

### W6 · Coach Today hears the phone

Coach Today reads once on load (`features/dashboard/coach-today.ts:136-141`) and shows ready strings; its feed
(`coach-today.html:394`, `coach-today.models.ts:678-685`) lists finished workouts and sent check-ins, 20 rows over 7
days, with records worked out on read (`CoachOverviewReader.cs:1071`). Nothing on the server announces a finished
workout; messages reach the browser through the chat hub and `listRefreshRequests`
(`core/messaging/messaging-realtime.service.ts:172`), which Coach Today does not use. `load()` already refreshes
without a flash (`coach-today.html:40,54`). On a phone the feed is folded (`coach-today.html:150-164`).

- **Alive:** while the tab is visible, a quiet re-read every 4 seconds (one that never clears `today()` or sets
  `failed()` while a view is shown, unlike `load()` at `coach-today.ts:138-139`; `document.visibilityState`, paused when
  hidden, 60 s after fifteen minutes without input or a realtime bump, since this is the heaviest overview read and
  will poll all day once coaches are live, 15 s after a failed read, resumed on `visibilitychange`; GETs are unlimited,
  `TB.Gym.Api/Program.cs:152` covers writes), and at once on `listRefreshRequests`. The feed sits near y 1130 at
  1440 × 900, below the fold, so a workout that arrives also lands as a strip under the greeting ("Just now: Maya
  Fakhoury finished Lower A in 42 min · 1 record", a lime ring pulsing twice around her initials), sliding in (grid
  rows 0fr to 1fr, 500 ms, `power3.out`; never `height`) and staying until it is clicked (it opens her page), dismissed
  or 60 s have passed, since the friend will still be looking at the phone when it lands; the same row slides into the feed
  with a lime highlight fading over 2 s and its record badge popping (scale .5 to 1); a Needs-you row that was resolved
  leaves (x 30, 250 ms, `power2.in`, then collapses). A small live dot beside the feed's heading pulses every 2 s only
  while reads succeed and the tab is in view, not with reduced motion.
- The strip is raised only for a `WorkoutCompleted` key that is new against the previous full activity list, never
  the five-row preview, never on the first read or a reload, and only when its `occurredAtUtc`
  (`coach-today.models.ts:682-683`) is within about two minutes, so a client newly assigned to the coach (ADR 0026)
  never brings older workouts in as "Just now". The remembered keys and the interval reset on the workspace reset
  (`scope.onReset`, `coach-today.ts:119`; CoachToday stays mounted across a switch) and on destroy. The realtime
  service bumps only for conversation changes, so the re-read is the one path a finished workout has; the server push
  is the follow-up in "Later".
- Reduced motion: the re-read stays, rows appear in place with the highlight only.
- Tests: `coach-today.spec.ts` with fake timers around the poll (no strip on the first read, a new key raises it once,
  a failed poll keeps the view, a hidden tab stops polling, destroy clears the interval); `e2e/coach-today.e2e.ts:36`
  uses `page.clock.setFixedTime`, which keeps timers running, so the poll fires against the mock there: harmless, and
  nothing in that spec may assert on it.
- **Done means:** a 1440 video of two contexts, Maya finishing Lower A on a 390 context while Lea's Coach Today shows
  the strip and the feed row arrive within eight seconds with her record, nothing touched on Lea's side; a reload and a
  first read animate nothing; a hidden tab stops reading; the reduced form; `coach-today.spec.ts` and
  `e2e/coach-today.e2e.ts` green; the `coach-today*` compiled styles under 5 kB each or in a new layer file.

### W7 · The card opens into the player

The player is a lazy, full-screen route (`features/training/training.routes.ts:41-51`), not a sheet, and its first
render is a skeleton (`today-training.html:85`), so a shared-element morph has no target. The approved animation is a
reveal: the prototype grows the player from the card's rectangle (`:749-762`, `clip-path` to `inset(0)`, `power3.inOut`),
then rises its parts in.

- On Today the three links to the player (`features/dashboard/client-today.html:165-173`, `:231-238`, `:284-290`) are
  `RouterLink` anchors, whose own listener navigates, so a second click handler would navigate twice: a capture-phase
  listener on `.today-card` takes the plain left click (no modifier, no middle button) and stops it there only when
  `document.startViewTransition` exists and motion is allowed, rebuilding the link's URL with its `sessionId`; every
  other click reaches `RouterLink` untouched. It navigates inside `startViewTransition` and animates
  `::view-transition-new(root)` from `inset(<the card's rect> round 26px)` to `inset(0)` over 500 ms, copying
  `shell/theme-switch.ts:85-121` under a class of its own (not `tb-theme-reveal`), with the CSS in W1's global sheet,
  since component styles cannot reach `::view-transition-*` on `<html>`. The update callback (navigation, the client
  guard, the lazy chunks, the first render) is capped at 300 ms: past it `transition.skipTransition()` gives the plain
  cut, so the screen never freezes on a slow load.
- Both chunks, `training.routes` and `today-training`, preload on idle once Today's own reads have settled, or on the
  card's first `pointerdown`, never in competition with Today's reads, so the tap never waits for a download.
- Once the workout read has filled the player, its top bar, segment bars and exercise panel rise in (`rise`, from
  y 14, 0.45 s, stagger 0.04); the skeleton does not animate.
- Reduced motion: a plain navigation and the page as it is today. Safari 18 is needed for the reveal; older browsers
  get the cut.
- This is the row most likely to fail its checks (view transitions, a first-frame freeze, a console error the mocked
  suite's `consoleGuard` catches): a chat that cannot keep the console clean and the reveal smooth leaves the row out
  rather than committing half of it.
- **Done means:** a 390 video of the tap, the reveal and the rise on Maya's Lower A, with taps accepted during the
  reveal; the reduced form and the modifier click untouched; Today's pixel snapshots (`e2e/client-today.e2e.ts:370-400`)
  unchanged; `client-today.spec.ts` and `today-training.interaction.spec.ts` green; no console error in the mocked run.

### W8 · Messages that move

Messages reach the other screen live already (the hub, `messaging-realtime.service.ts:340-343`, about 2 s), and the
bubbles do not move (`features/messaging/messages.ts:497,957`, `messages.html:239`). Today's coach card already
re-reads quietly on every realtime bump (`features/dashboard/today-coach-message.ts:79-87,114-128`).

- A sent bubble rises from the composer (y 12, 200 ms, `--tb-ease`), a received one slides in from its side (x -12,
  200 ms), only for messages merged in live after the thread's first render and never for the first page, a "Show
  earlier messages" page (`messages.html:221`) or a reconnect's catch-up: the rows are `@for (entry of day.entries;
  track entry.message.id)` (`messages.html:239`) and `animate.enter` fires on every insertion, so the enter class binds
  to a set of live-merged ids, kept per conversation and reset when the conversation or the workspace changes
  (`messages.ts:432-448`). `messages.ts:138` has a singular `styleUrl` and `messages.scss` is 10,808 source bytes, so the
  rules go in a second, small sheet through `styleUrls`. The thread list's row rises when a message lands, and the
  unread pill's number rolls. When the coach card's quiet read (`today-coach-message.ts:115-129`) returns a newest
  message whose `messageId` (`messaging.models.ts:33-42`) differs from the one shown and is not from the caller, the
  card rises 8 px with a fade over 320 ms and its dot pulses twice, so Lea's reply lands on the phone with nobody
  touching it; the first read, a failed quiet read and a workspace switch (`scope.onReset`, `:74`, clears the
  remembered id) add nothing.
- Reduced motion: in place.
- **Done means:** a two-context video, Maya sending from a 390 context and Lea's 1440 thread receiving;
  `messages.spec.ts`, `messaging-realtime.service.spec.ts` and `e2e/messages.e2e.ts` green; `messages`' compiled styles
  stay under 8 kB (7.80 kB today: the new rules go in a new layer file).

### W9 · Rings that sweep, and back to Today

Today is rebuilt per visit and the finish's link is a plain `/` (`today-training.html:83`), so Today cannot know what
just changed. Its rings read `days[{ date, scheduled, completed }]` and jump through `--progress`
(`client-today.scss:199-206`). `ui/progress-ring.ts:22-28` has no transition, so one change sweeps every ring in the app
(nutrition's rings update in place after a save, `features/nutrition/today-nutrition.ts:311-349`).

- **First, the rings:** `ui/progress-ring.ts` as below, the player's exercise bars, and Today's first draw.
- **Second, if time allows, the hand-off:** the finish's Back to Today link navigates with router `info`
  (`{ finishedOn: <the day's localDate> }`), which history never keeps, so a reload never replays it; Today reads it once from
  `router.lastSuccessfulNavigation()` (not `currentNavigation()`: ClientToday is a child of the routed Dashboard,
  `app.routes.ts:55-63`, and is built after the router has cleared the current one), and when the week read answers
  with that day completed and `coreDrawn()` is true (`html:58`), draws the day as still planned, runs `--progress`
  from its previous value to full (0.8 s, `power2.out`, delay 200 ms; `@property --progress` registered in W1's sheet,
  since an animation overrides the inline style), then swaps it to `.is-done` (a solid accent disc with a check,
  `client-today.scss:199-216`, which a one-session day otherwise jumps to) and pops the check, while "n of 4 sessions
  done" ticks up and the hero card settles into its done state (scale .97 to 1, 600 ms, `back.out(2)`). Without the
  hand-off, nothing moves. The ring is first drawn at its final value under `coreDrawn` (`client-today.ts:146-152`), so
  this needs a two-step render, which is why it is second.
- `ui/progress-ring.ts`: the offset bound as a custom property instead of the attribute, a 600 ms `--tb-ease`
  transition on `stroke-dashoffset` under `no-preference`, and an empty-ring `@starting-style` after it, so a ring
  draws in on first paint and sweeps on every change: nutrition's rings after a meal, the meal plan's day rings, the
  week's rings. The player's exercise bars grow the same way as sets are logged.
- Today's first draw: the greeting, the week, the card and the tiles rise in (`rise`, stagger 50 ms, 6 at most), once
  per visit, never on a re-read.
- Reduced motion: final states at once.
- **Done means:** a 390 video of Finish, Back to Today and the ring filling, and one of a meal logged on Nutrition;
  `client-today.spec.ts`, `today.models.spec.ts`, `today-nutrition.spec.ts` green; Today's pixel snapshots unchanged
  (they run with reduced motion since W1).

### W10 · The share card in the hand

The share teaser (`features/share-cards/share-teaser.ts:31-46`, drawn only with a record or a finished program,
`today-training.html:80`) is the ending of the phone part, and the ending is what a person keeps (the peak-end rule).

- An inner layer inside the teaser's `.card` (the outer keeps its entrance and its `rotate(-2deg)`, so the two
  transforms never fight) follows the pointer: under `(hover: hover) and (pointer: fine)` the mouse's position tilts it
  up to ±12° (`--rx`, `--ry` written per frame, `perspective` on the parent) and a sheen gradient slides across by
  transform; on touch, `pointerdown` with `setPointerCapture` and `touch-action: pan-y` lets a finger drag it, turning
  and shifting it with rubber-band resistance (`f(x) = c·d·x / (c·x + d)`, c = 0.55), and on release a Web Animations
  spring returns it to its tilt. The card stops its touch events from reaching the player `<section>`, whose swipe
  handler (`today-training.html:4-5`, `today-training.ts:596-606`) would change the exercise behind the summary at
  70 px. Safari flattens `preserve-3d` under the `.mark`'s `overflow: hidden` (`share-teaser.ts:100-111`), so the tilt
  layer sits outside it. The rules live in the teaser's inline styles, inside its 5 kB. No signals, no change detection
  per frame. Share and Save keep their buttons and their words; the tilt is decorative, and the friend is told to grab
  it.
- Reduced motion: no tilt, the card as it is today.
- **Done means:** a 390 video of the drag and release and a 1440 video of the hover; `share-teaser.spec.ts` and
  `e2e/share-cards.e2e.ts:146` green; axe clean.

### W11 · The barbell

A lifter reads a target weight and works out the plates in his head; the app can show them. No domain data describes a
gym's plates, so this is presentation on a fixed set: a 20 kg bar with 25, 20, 15, 10, 5, 2.5 and 1.25 kg plates in
competition colours (red, blue, yellow, green, white, and the small ones in their own colours), and a 45 lb bar with
45, 35, 25, 10, 5 and 2.5 lb plates, in the unit the client's program uses.

- One **Plates** toggle per exercise, in its tools row beside Watch demo (a set row, `today-training.html:275-330`,
  already holds four steppers, an input and Log set, and a second control there breaks 390 px at 200% text), reading
  the active editable set's draft weight (logged rows are text only); it opens a sheet (the kit's) drawing the bar
  from the side, one sleeve, in the client's own unit from `workoutUnit()` (their kg or lb choice, never
  `set.prescribedLoadUnit`, and never a conversion: TRN-019), loading the plates
  one by one from the collar out (60 ms stagger, each sliding on from the right, `back.out(1.5)`), the biggest first,
  with the per-side list in words under it ("Per side: 20, 10, 1.25"). Steppers change the weight by the smallest plate
  and reload the bar (a plate that leaves slides off before the new one slides on); a target that no plate set makes
  says the nearest loadable weight below and above, as Hevy's "Closest possible weight" does; one tap switches to the
  15 kg (35 lb) bar. The sheet changes nothing in the set or the coach's numbers: it is a reading of the draft's
  weight, and a guide, which it says ("Standard plates 25 to 1.25 kg on a 20 kg bar; your gym's may differ"). The
  split is a named, versioned strategy, `plates-greedy-v1` (biggest plate first, per side), a pure function with fixed
  reference tests: 100 kg is 20 and 20 per side; 82.5 kg is 20, 10 and 1.25; 135 lb is 45 per side; 21 kg is not
  loadable and says 20 and 22.5; 15 kg is lighter than the bar. Plates entering and leaving are the everyday layer
  (200 ms), not a celebration.
- Words: "Plates" and "Per side" in the glossary; the bar's weight shown ("20 kg bar"); under the bar's weight,
  "Lighter than the bar". No server, no setting. The component keeps every style of its own
  (`today-training-sets.scss` is at its budget line).
- Reduced motion: the plates appear at once, and the text line says what changed.
- **Done means:** a 390 video of opening the sheet on Maya's squat and stepping the weight; light and dark; axe clean;
  the Vitest; the player's styles budget held.

### W12 · Coach Today builds itself

Coach Today's figures are built strings or sit inside an ICU plural whose `=1` case is the literal "1 client"
(`coach-today.html:23-28`, `coach-today.models.ts:223-227`), so there is nothing worth counting up: rolling 0 to 3 is
no wow, and splitting the plural changes the i18n messages. The first view's build is the rise alone.

- On the first successful read per app load only (a flag in the lazy Dashboard chunk, set when `today()` first turns
  non-null, skeleton to content at `coach-today.html:54` and `:372-389`; re-reads and W6's refreshes keep the `@if`
  view and never replay it, and a workspace reset within the same app load does not either), the panels and the first
  rows rise in turn (Web Animations, transform and opacity only, 320 ms, 40 ms stagger, 6 at most), leaving the
  greeting's `afterNextRender` focus (`coach-today.ts:122`) untouched. Nothing counts: money and This month's figures
  never move.
- Reduced motion: the page as it is today.
- **Done means:** a 1440 video of a fresh load as Lea; going to Clients and back replays nothing; `coach-today.spec.ts`
  and `e2e/coach-today.e2e.ts` green.

### W13 · Progress draws itself

The Progress page has all its data before drawing (`features/progress/progress-dashboard.html:136,316`), re-reads with
a skeleton on a range tap (`progress-dashboard.ts:210-214,253`), and its charts have no motion (`ui/trend-chart.ts`,
`ui/bar-chart.ts`; the dashed segment at `trend-chart.ts:175` needs care). The demo gives Maya about 54 weigh-ins over 63
days, falling 0.45 kg a week.

- **First draw:** the trend line draws in (`drawLine`, 1.4 s) and its area fades in after it, the bars rise (`scaleY`
  from the baseline, 0.8 s, `power3.out`, stagger 60 ms), the big number counts up; a range tap afterwards crossfades
  the chart over 200 ms with no second draw (a repeat is tiresome).
- **The scrub:** a finger or the mouse moved along the line (`pointerdown` and `setPointerCapture`, `touch-action:
  pan-y`, deciding after 8 px; `clientX` mapped through `getBoundingClientRect` onto the plot's 720-unit width) shows
  a dot on the nearest point and swaps the readings' "last" reading (`trend-chart.ts:39-58`) to that day ("Tue 14 Oct ·
  71.2 kg", or the trend's estimate marked as such, with the change since the first weigh-in as the header gives it
  today, so the reading keeps its context under rule 4), in the sparse branch (`:66-67`) as in the full one; release
  returns to the latest. The plot becomes `role="slider"` with an accessible name and `aria-valuetext` (the date and the
  weight, or "trend"), driven by Arrow, Home and End, with no separate live region (it would announce everything
  twice); the SVG keeps `role="img"` (`:60-64`) and its `aria-label`. The plot is `preserveAspectRatio="none"` (`:64`),
  so the dot is an absolutely positioned HTML element over `.plot` (left and top in %), never an SVG circle, the guide
  line takes `vector-effect: non-scaling-stroke`, and the pointer maps in the SVG's drawn orientation in RTL. Line
  `:175` is the weekly-average band's dash style, not a segment of the line. The coach gets the same on the client's
  page, which draws the same dashboard (`features/clients/client-workspace-sections.ts:69`). Nothing is worked out in
  the browser beyond picking a point.
- Reduced motion: the chart appears drawn; the scrub works without motion.
- **Done means:** 390 and 1440 videos of the first draw and a scrub; `progress-dashboard.spec.ts`, `trend-chart.spec.ts`
  and `bar-chart.spec.ts` green; axe clean.

### W14 · Coach polish

The coach has no palette, no shortcuts beyond Escape and Enter, and no hover previews (`coach-today.html:42` is a
link). Clients' filter chips swap the rows instantly (`features/clients/clients.html:108-125`, `clients.ts:150,237`).
`CoachShell` is eager (`app.ts:23`), so the listener stays tiny and the palette is a dynamic import.

- **Ctrl+K (and Cmd+K)** in the coach shell opens a palette (a CDK overlay as `ui/menu.ts:113`): the pages (Today,
  Clients, Programs, Nutrition, Check-ins, Messages, Team, This month, Settings) and, after two letters, clients by name
  from `features/clients/client-list-api.ts`; arrow keys loop, Enter opens, Escape closes, no animation at all (a tool
  used many times a day). On a phone it does not exist.
- **Clients' chips:** `setFilter` runs inside `startViewTransition` when available and allowed, so the rows crossfade
  (200 ms) instead of swapping; scoped as W7.
- **A hover card** on a client's row after 700 ms (closing after 300 ms), under `(hover: hover) and (pointer: fine)`:
  the client's last 7 days and their plan line, from the row's own data, no new read.
- **Done means:** a 1440 video of Ctrl+K, "may", Enter opening Maya's page, of the chips, and of the hover card;
  `clients.spec.ts`, `e2e/clients.e2e.ts` and a palette spec green; axe clean; the first download unchanged (the
  listener only).

## 3. Waiting for the owner

A chat that meets a choice adds one line here: the row, the question, what it built (or that it left the item out),
the other way, and its recommendation. The owner answers in chat; the answer goes into the row's status and the line
is removed, and a changed answer becomes a new row.

- **W1 · The press on tappable cards.** The row's third column names tappable cards; section 2 limits the
  press to the kit's buttons, icon buttons and the chips that are a button, a link or a filter's label, and keeps it off
  row links and list rows (iOS sets :active at the start of every scroll). Built section 2's list: cards and rows do not
  dip. The other way: a class a card opts into. Recommendation: keep as built; W7 gives the workout card its own motion.
- **W2 · The QR code's colours.** The code is drawn with block characters, a light module bright and a dark one as the
  console's background, which reads right on a dark console (Windows PowerShell's blue, Windows Terminal's black) and
  inverted on a light one; the address is printed above it either way. The other way: always dark on light, with the
  quiet zone drawn in white blocks. Recommendation: keep as built; phone cameras read an inverted code.
- **W2 · `-HeroName` and the messages.** Built as two updates on the demo database (the client profile the coach's
  screens read, the account's display name her own greeting reads), so Today, Coach Today, Clients and the thread list
  carry the friend's name; the demo's message bodies ("Hi Maya! Lower A today...", "Welcome to Atlas, Maya!") keep
  "Maya", since the generator wrote them and messages are append-only. The other way: a `--hero-name` option in the
  demo generator (server code, the full suite). Recommendation: the generator option after the demo if the name should
  reach the messages too; on the day, say Lea wrote her note before the rename.
- **W3 · The pinned pill for every sentence, at the top.** Section 2 pins the record's sentence under the header;
  built: while a workout is open the status line is a pill pinned at the top of the screen, over the header's band,
  for every sentence ("Workout started.", "Set saved.", the record's), fading after 4.5 s and staying in the live
  region for screen readers. Every sentence, because "Workout started." and "Set saved." sat in the flow above the
  sets, so the record's sentence leaving the flow alone would have shifted the sets by a line at the very moment;
  at the top, because under the header the pill would cover the segment that fills. The other way: the record's
  sentence alone, with the line's space always reserved under the header. Recommendation: keep as built.
- **W3 · A record after a reload.** The page knows a record only from its own saves (`prSetIds` starts empty on a
  load, as before), so a reload drops the PR chips and the next record on that page gets the full burst again; in
  one page, as on the day, the second record gets the small form (proven in Vitest; the live films show the full
  burst on three pages). The other way: the day's read says which logged sets were records (server code, the full
  suite). Recommendation: later, with the "Later, not rows" list.
- **W3 · The buzz.** Section 2 names `[30, 50, 80]` as the pattern the app already sends; the app sends
  `[80, 40, 80]` on a record, which is kept, and a plain tick now buzzes 25 ms. The other way: the prototype's
  `[30, 50, 80]`. Recommendation: keep the app's; nobody can tell them apart in a video.
- **W3 · The record, confirmed.** On the fresh demo built at 02:36 on Monday 2 November, Maya's set 1 at the
  coach's 52.5 kg × 5 answered a record ("New personal record · Back Squat 52.5 kg × 5"), set 2 at the same numbers
  was a plain "Set saved.", and set 3 at 55 kg × 5 a second record; Sara's set 1 at 40 × 8 and Jad's at 100 × 5
  were records too, and leg press set 1 at the coach's 85 kg was not.

- **W4 · The counts start with the panel.** The four numbers start counting on the first frame, while the stats block
  is still rising in (it shows from 330 ms, where the prototype's stagger puts it), so the eye catches each count in
  flight. The other way: start the counts once the stats block has landed. Recommendation: keep as built; the
  prototype does the same.
- **W4 · The records rise one by one.** Section 2 says the records list rises; built: each record's row takes its own
  turn in the stagger, 60 ms after the last, rather than the list as one block. The other way: the list as one part.
  Recommendation: keep as built.
- **W4 · The share card's spring in older browsers.** The landing is the prototype's `elastic.out(1, .6)` where the
  browser draws `linear()` easings (Chrome 113, Safari 17.2 and Firefox 112 and later); an older browser keeps the
  earlier back-out curve. The other way: the back-out everywhere. Recommendation: keep as built.
- **W4 · The summary shown from its top.** The summary replaces the player where the page was scrolled (at the Finish
  button, near the bottom), so before W4 a finished workout showed the middle of its summary; built: the finish
  scrolls the page to the top first, with or without motion, as the prototype opens its summary, so the rise and the
  counts play in view. The other way: leave the scroll where it was. Recommendation: keep as built.

- **W5 · The over card leaves as the running card does.** Section 2 slides the rest card in and out; built: the
  running card slides out on Skip, and the "Rest is over" card slides out too, on Dismiss and after its six seconds,
  so no card vanishes in a cut; at zero the running card is replaced in place by the over card with its 200 ms rise,
  as before. The other way: the over card vanishing at once, as before. Recommendation: keep as built.
- **W5 · The pulse.** Section 2 says the card pulses gently through the last three seconds and the prototype has no
  pulse; built: three beats of one second from three seconds left, the card 2.5 % larger at the middle of each, added
  over any slide still running, with no colour or ring change. The other way: the ring or the digits brightening once
  a second. Recommendation: keep as built.
- **W5 · A set logged during a rest.** A rest that starts while the card is still up (the next set logged early) does
  not slide the card in again: the card stays and its ring sweeps afresh from full; a rest that starts while "Rest is
  over" shows slides a new card in, and the over card goes at once. The other way: a slide every time. Recommendation:
  keep as built.
- **W5 · The status pill mid-fade fails axe's contrast for half a second.** Seen at 1440 light with the rest card up:
  W3's pinned pill ("New personal record · ...") between 4.0 and 4.5 s after a set, while its fade runs (contrast 1.3
  through the fading opacity); clean before and after, and nothing in W5 (the rest card itself is clean at 390 and
  1440 in light and dark). Not built here (W3's file). The other way: hide the pill (`visibility: hidden`) from the
  fade's start rather than its end. Recommendation: a one-line W3 follow-up in a later row.

- **W6 · A second workout within the minute.** Section 2 has the strip stay until it is clicked, dismissed
  or a minute has passed; built: a workout that lands while the strip is up takes the strip over (its words,
  its ring's pulse) and starts its minute again, and slides into the feed as its own row. The other way: one
  strip per workout, stacked. Recommendation: keep as built; on the day one client finishes.
- **W6 · The live dot.** Built: drawn beside the feed's heading only while reads succeed and the tab is in
  view (gone, not grey, after a failed read or while the tab is hidden), green as the prototype's, its 2 s
  pulse resting with reduced motion and under `?motion=off`; the pulse is a stylesheet rule, so
  `tb-motion-off = W6` stops the strip, the row and the ring but not the dot. The other way: a dot always
  drawn, grey when reads fail. Recommendation: keep as built.
- **W6 · The highlight with reduced motion and the switch.** Section 2 keeps the row's lime highlight with
  reduced motion; built: it fades over 2 s there and under `?motion=off` too, since it is colour and not
  movement, while the strip and the row are in place at once. The other way: no highlight under the switch.
  Recommendation: keep as built.
- **W6 · The strip's words.** Built: "Just now:" in bold, then the feed row's own sentence ("Maya Fakhoury
  finished Lower A in 42 min"; without the minutes when the workout took under one, as the feed phrases
  it) and "· 1 record" counting the records; the same words reach screen readers through a status region
  that is always on the page. The other way: the client's first name alone. Recommendation: keep as built.
- **W6 · The beat's idle rule.** Section 2 slows the re-read to a minute after fifteen minutes without input
  or a realtime bump; built: input is a pointer press or a key anywhere on the page, a bump is the chat
  hub's conversation change, and a tab brought back into view counts too; any of them brings the 4 s beat
  back from the next read. The other way: pointer movement as input too. Recommendation: keep as built.

- **W6 · Which read lets a row leave.** Built: a Needs-you row leaves with its slide only when the quiet
  re-read finds it resolved; a full read (Try again, or after End coaching) replaces the list at once, as
  before, and the feed row of a workout older than two minutes appears without the strip or the slide. The
  other way: the slide on every read. Recommendation: keep as built.

- **W7 · The top bar's title rises; the × and the clock stay.** Section 2 rises "its top bar"; built: the
  title block (the eyebrow and the workout's name) rises when the read lands, while the × and the clock
  stay put, so a tap on × during the reveal lands at once (proven live). The other way: the whole top bar.
  Recommendation: keep as built.
- **W7 · The exercise panel rises as one, and the actions row with it.** The prototype rises the panel's
  children one by one; built, in reading order and six parts at most (W1's cap): the title block, the
  workout picker, the segment bars, the workout's blocks above the exercise (the intro and Start, or the
  unit choice and its note), the exercise panel as one block and the actions row under it, so nothing
  below is left standing while a part above moves. The other way: the panel's children one by one, which
  the cap would cut after the heading. Recommendation: keep as built.
- **W7 · The rise plays on every fill from the skeleton.** Built: the parts rise whenever the player's
  skeleton is replaced by a read (the first open, a reload of the player's address, a change of
  workspace or of the page of workouts), never on the quiet re-read after a set is saved. The other way:
  only when the player was opened through the card's reveal. Recommendation: keep as built; the entrance
  is the player's wherever it comes from, as W1 left it.
- **W7 · The card's corners and a card under the fold.** Built: the reveal starts from the card's own
  corner radius (read from its style, 16 px today) and from the visible part of the card when it is partly
  under the fold or past the side. The other way: the prototype's 26 px. Recommendation: keep as built.
- **W7 · The first download grew by 0.38 kB.** Section 1 lets no row grow it beyond W1's; section 2 puts the
  reveal's rules in W1's global sheet, since component styles cannot reach `::view-transition-*` on
  `<html>`: 512.20 kB before, 512.58 kB after, against the 520 kB error budget. The other way: none, there
  is no other place for them. Recommendation: accept.
- **W7 · Under 4x CPU the tap waits on the navigation's own frames.** Measured live with the CPU throttled
  four times: with W7 on the old page is held for 95 to 160 ms (the navigation and the player's first
  render, one frame of 184 to 227 ms, inside the 300 ms cap) and the reveal then runs on the compositor;
  with W7 off the same work shows as two frames of 86 and 110 ms, so the moment adds no work, it only
  gathers it before the reveal. Unthrottled the hold is 16 to 28 ms. The other way: a longer cap, or none.
  Recommendation: keep the 300 ms cap.
- **W7 · Nothing else was left out.** The way back (the leave guard) stays out as the row says: × and
  Back to Today are a plain navigation with W1's page fade on Today.
- **W8 · The pill ticks rather than rolls.** Section 0 says the unread pill ticks and section 2 says its number
  rolls; built: the shells draw the count afresh for each number and it ticks (320 ms, from 60 % and 0.35 em
  below, overshooting to 112 %) through one rule in W1's global sheet, since the shells are in the first
  download and must not pull the moves in; a digit that rolls like an odometer is in the Later list. The other
  way: the old digit out and the new one in. Recommendation: keep as built.
- **W8 · The pill's tick and the switches.** The tick is the stylesheet's, so it rests with reduced motion and
  `?motion=off` like W1's layer; `tb-motion-off = W8` rests it too through a class the shells leave off, read
  when the shell is made (a change needs a reload there, where the moves read it per call). Recommendation: keep.
- **W8 · The first download grew by 0.80 kB.** Section 1 lets no row grow it beyond W1's; built: 512.58 kB
  before, 513.38 kB after (main +0.56 kB for the shells' count drawn afresh and the switch read, styles
  +0.23 kB for the tick's rule), against the 520 kB error budget. The other way: no tick on the pills.
  Recommendation: accept.
- **W8 · The inbox row rises for the sender too, once per message.** Section 2 rises the row "when a message
  lands"; built: a row rises when its last line changes, whether the open thread's own frame, the coach's send
  or the list's refresh brought the message first (live, the open thread's frame lands about a second before
  the list's refresh, which then sees no change), once per message. The other way: only for a message
  received. Recommendation: keep as built.
- **W8 · Which messages count as live.** Built: the realtime service tells the thread's sink whether an event
  came as a socket frame or from a catch-up page (the first after a thread opens, a gap's, a reconnect's), and
  only a frame after the thread's first page has rendered moves a bubble. The other way: a time window on the
  message's sent time, which would move a short reconnect's catch-up. Recommendation: keep as built.
- **W8 · The coach card's dot.** Section 2 pulses "its dot"; built: the Unread label's dot (the status label's
  marker) scales to 1.6 and back twice (500 ms each) after the card's 320 ms rise; a card showing nothing unread
  rises without a pulse. The other way: a dot of the card's own. Recommendation: keep as built.
- **W8 · Nothing else was left out.** Typing indicators and optimistic sends stay out as the row says. Seen on
  the way: the composer's Send button keeps a 120 ms background transition of its own under reduced motion
  (`chat-composer.scss`, colour only, before this plan).
- **W9 · The hand-off is left out.** Section 2's second part (the finish's Back to Today navigating with
  router `info`, Today drawing the day as still planned and sweeping its ring to full, then the check popping
  and the card settling) was not built: the first part filled the hour. Built: Back to Today rebuilds Today,
  which rises as on any visit, with the day's ring drawn done at once and "n of 4 sessions done" as the server
  says. The other way: a row of its own (about an hour: the router info, a two-step render under `coreDrawn`,
  the sweep, the pop and the settle, a template database to film the finish again). Recommendation: a W9b row
  after W14 if the runner has time before 14:00, else the Later list.
- **W9 · The week's ring read a percentage against W1's number.** Seen on the way: Today bound `--progress`
  as a percentage ("50%") while W1 registered it as a `<number>`, so since W1 a planned day with part of its
  sessions done drew no progress (the demo's one-session days never showed it). Built: the day's share is
  bound as a number (`--done`, 0 to 100) and the gradient reads `calc(var(--progress) * 1%)`, which is also
  what lets the ring sweep. Recommendation: none needed; noted so the fix is known.
- **W9 · The sweeps are the stylesheet's.** The rings and the bars sweep through CSS transitions (600 ms,
  `--tb-ease`, `@starting-style` for the first paint), so they rest with reduced motion and `?motion=off`
  (through `data-tb-motion` on `<html>`), while `tb-motion-off = W9` stops only Today's rise, as W6's dot.
  The other way: a class each ring reads at construction, as W8's pills. Recommendation: keep as built.
- **W9 · The bars are clipped, not sized, and W3's scaleX on them is gone.** Section 1 animates no width;
  built: the bar is full width and `clip-path: inset()` shows its share (mirrored in right-to-left), and
  W3's own scaleX on the segment (which grew the bar from its old width) is removed, since the two together
  doubled the growth and would have shrunk the bar first on a second set. The other way: keep W3's scaleX
  and no transition. Recommendation: keep as built.
- **W9 · The meal plan's day rings at 600 ms.** They had a 200 ms transition on the attribute; built: the
  same 600 ms sweep and draw-in as every other ring, so one change sweeps every ring in the app.
  Recommendation: keep as built.
- **W9 · The tiles rise beside the week when both land in one frame.** The week and the card rise in one
  stagger and the tiles in another; live both land within the same frame, so Also today starts with the
  week and the coach's card with the day's card, 50 ms later, rather than all four in one run. The other
  way: one rise over both steps when they land together. Recommendation: keep as built; the difference is
  100 ms.
- **W9 · The first download: 513.38 kB before and after.** The ring's transition and the bars' clip
  are component styles, Today's moment is in the dashboard chunk, and `_ui.scss` is untouched; the 520 kB
  error budget holds; Today's component styles now pass the 5 kB warning by 106 bytes (5.11 kB, under the
  8 kB limit, as nine other pages' styles already did). Recommendation: accept.
- **W9 · Nothing else was left out.** A finished week's flare stays out as the row says, and Today's pixel
  snapshots are unchanged (they run with reduced motion). An unstarted workout's bars are empty, so the
  player's first paint draws nothing until a set is logged; a workout reopened with sets logged draws its
  bars in.
- **W10 · Pressed where the pointer is.** Section 2 tilts the face up to 12° under the mouse; built: the
  edge under the pointer goes away from the viewer, as a card pressed on a table does, and a drag keeps
  the same reading against where the finger has pulled, so a long pull tilts the card toward it. The other
  way: the face leaning toward the pointer, its near edge lifting. Recommendation: keep as built.
- **W10 · The numbers.** The row gives the tilt (±12°) and the band (c = 0.55); built around them: a
  perspective of 56 rem, the band's limit at 120 px (a 100 px pull moves the card 38 px, 150 px moves it
  49, 400 px 78), a turn of up to 6° with the pull, the spring back over 650 ms on the teaser's own landing
  curve (W4's `elastic.out(1, .6)` as a `linear()` easing), and a 150 ms approach when a gesture starts, so
  the face comes to the pointer from wherever a spring left it rather than snapping. The other way: a stiffer
  band (c = 0.4) or a shorter spring (450 ms). Recommendation: keep as built; the videos show the feel.
- **W10 · A mouse can drag too.** Section 2 gives the finger the drag and the mouse the tilt; built: a press
  with any pointer grabs the card (the laptop's trackpad included) and the hover tilt stays the mouse's, so
  the same card answers on both devices. The other way: the mouse only hovers. Recommendation: keep as built.
- **W10 · The sheen shows in the hand only.** Built: the band of light sits under the pointer and fades in
  over 200 ms when the card is taken, out when it is let go; at rest the card is as it was. The other way:
  a sheen always on, sliding with the hover alone. Recommendation: keep as built.
- **W10 · The face carries the card's surface, and the card listens.** Section 2 puts an inner layer in the
  `.card`; built: the inner `.face` carries the background, the padding and the shadow, so the whole card
  tilts and its shadow turns with it, while the `.card` keeps W4's landing, the 2° rest and the perspective;
  the sheen is the face's `::after`, clipped by its corners. The card, which never tilts, is what listens
  and what the pointer is read against: on the face itself a pressed edge moves inward on the screen, the
  pointer near it falls off, and the card lets go and takes again in a flicker (seen live at 1440 and
  fixed). The other way: a transformed layer over a flat surface. Recommendation: keep as built.
- **W10 · While the card is pulled past the phone's edge the page can scroll sideways for a moment.** A
  face pulled 49 px right at 390 reaches past the viewport, so the document is briefly scrollable sideways
  while the finger holds it (nothing moves; the finger is the card's) and rests put once let go; the
  stills and the settled screen show no sideways scroll. Built: left as is, since a clip on the player
  would cut W3's burst at 1440 and a clip on the summary would cut the card 16 px from the phone's edge.
  The other way: `overflow-x: clip` on `.player` if a narrow laptop window ever flashes a scrollbar.
  Recommendation: keep as built.
- **W10 · The first download: 513.38 kB before and after.** The moment and its rules live in the
  share-cards chunk (the teaser's inline styles stay under the 5 kB warning, the spring's `linear()`
  curve worked out in code at run time rather than written into the stylesheet) and `_ui.scss` is
  untouched; the 520 kB error budget holds. Recommendation: accept.
- **W10 · Nothing else was left out.** A new card design and a sticker export stay out as the row says.
  Share keeps its button and its words; the mocked `share-cards` spec runs under reduced motion and never
  meets the tilt, so the live videos are the proof. Section 2's line that the player's swipe would change
  the exercise behind the summary at 70 px: the card stops its touch events at the card either way.


## 4. The arc on the day

Ten minutes, three peaks, the strongest last; between them only quiet speed. Before he arrives: the demo rebuilt
after 09:00 and after the last row (section 1), the laptop signed in as Lea with Coach Today open and display sleep
off, the phone signed in as Maya on Today with auto-lock off and "Remove animations" off, both on the laptop's
address; the owner has tried the arc once on Sara (Karim's client, Karim on the laptop) and never on Maya, whose
finish cannot be undone.

1. **0:00, laptop.** Reload Coach Today in front of him: the panels and rows rise in turn (W12). "This is the coach's
   screen. Leave it open."
2. **0:20, phone, as Maya.** "You're Maya, a client, and tonight is leg day." Every press dips and each page fades in
   (W1). Point at Lea's note on the coach card: "add 2.5 kg on the last set".
3. **0:45.** Tap Open workout: the card grows into the dark player (W7). Tap Plates beside 52.5 kg: the bar loads
   15 + 1.25 a side; + and − reload it (W11).
4. **1:45, the sets.** Log set 1 at the coach's numbers: the spring, the tick, the buzz, the record burst and the pill
   (W3). The rest card slides in and its ring runs; Skip (W5). Set 2: the tick alone. "Your coach said add 2.5 kg on
   the last set": + to 55 kg, Log set, the smaller burst. Next exercise, the leg press, three sets.
5. **4:30, the finish.** Finish workout, Confirm: the numbers count up, the records line up, the share card lands (W4)
   and he tilts it in his hand (W10). "Now look at the laptop."
6. **4:45, laptop, untouched.** The strip slides in under the greeting, Maya finished Lower A with her record, and the
   row opens at the top of the feed in lime (W6).
7. **5:30, phone.** Back to Today: the day's ring fills and ticks, 1 of 4 (W9). Progress: the line draws and he scrubs
   it (W13). Lay the phone face up on the table.
8. **6:15, laptop, as Lea.** Click the strip to open Maya's page. Ctrl+K, "may", Enter (W14). Open Messages, Maya's
   thread, type "Huge squat PR!" and send.
9. **7:00, the phone on the table.** Today's coach card swaps to his words with a rise and a pulse, nobody touching it
   (W8).
10. **To 10:00.** Let him wander as the coach: Clients, Maya's Progress, Training. Close with: one server, two
    screens, real data, none of it a recording.

If time ran out before a row, the arc skips its moment and loses nothing else. If the phone cannot reach the laptop,
Maya runs in a narrow second window on the laptop and both two-screen moments still work. If Maya's workout was
started by mistake, Sara takes her place with Karim on the laptop.

## 5. The evidence, in short

Seven readers worked for an hour on the night of 1 November: two mapped the client's and the coach's journeys in the
code, one audited the foundations, and four read what the best apps, the best tools, the web platform and the craft
of motion say. What shaped the rows:

- **Where the moments are.** A record is known only in the server's answer to a saved set
  (`TrainingApplicationService.Client.cs:377`); the finish summary receives everything at once; Today is rebuilt per
  visit and cannot know what just changed; Coach Today reads once and nothing on the server announces a finished
  workout, while messages already reach the other screen in about 2 s through the chat hub. On a demo built on a Monday
  after 09:00 Beirut, Maya's first set at the coach's numbers is a record; no client closes a week or a program that
  day, so those celebrations are not in this plan.
- **What people react to.** Hevy's reviewers name the vibration on a record and the tone when rest ends
  (https://www.hevyapp.com/features/live-pr/, the App Store reviews); Apple's ring show is the animation people
  search for years later; Strong's reviews praise the rest timer most; Hevy and Fitbod built whole screens on a
  muscle map; Hevy's plate calculator says "Closest possible weight is 135 kg"
  (https://www.hevyapp.com/features/weight-plate-calculator/). Meteor's two-browser demos drew "jaws dropped"
  (https://forums.meteor.com/t/most-impressive-features-of-meteor-to-show-in-demos/1910): an action on one device
  landing on another within about a second is the fastest way to make a stranger feel a tool is alive.
- **The numbers.** Press 0.97 over 100 to 160 ms; entrances 200 to 300 ms from scale .95, ease-out; nothing everyday
  over 300 ms ("at 500 ms, animations start to feel like a real drag", https://www.nngroup.com/articles/animation-duration/);
  staggers of 30 to 80 ms over at most about six items; celebrations 0.8 to 1.2 s that never block input; "the second
  viewing is tiresome, and the third is downright annoying" (https://www.nngroup.com/articles/animation-usability/),
  so a burst is for a real record and a repeat gets the small form; the peak-end rule (r = 0.58 across 174 effect
  sizes) says to design three peaks and the ending, so section 4 has three. Sources: Emil Kowalski's tips, Apple's
  motion and haptics guidelines, Material 3 Expressive's spring tokens, Vercel's and Rauno Freiberg's writing.
- **What the platform allows.** View transitions from Safari 18 and Chrome 111; Angular's `withViewTransitions` is
  still developer preview, so this plan uses one manual transition (the theme switch's own pattern) and a CSS fade
  elsewhere; `animate.enter` is stable but off in TestBed; Web Animations cost nothing and stay smooth on the
  compositor; GSAP core is 27.8 kB gzipped and already lazy on the homepage; hand-written particles beat
  canvas-confetti (its worker breaks the CSP); Lottie and Rive need designer files and wasm, so they are out;
  `navigator.vibrate` works on Android and nowhere on an iPhone; Web Audio is muted by an iPhone's silent switch, so
  sound stays out; the Screen Wake Lock and Share need a secure context, hence W2's HTTPS.
- **What could break.** Mocked Playwright freezes the clock in 18 specs and GSAP's clock is `Date.now`, so the mocked
  suite runs with reduced motion by default (W1); Today has pixel snapshots; the first download has 9 kB left before
  the build fails; `today-training`'s and `messages`' styles are near their budgets, so new rules go in layer files;
  a `view-transition-name` used twice aborts a transition; the overlay swallows taps unless `pointer-events: none`.

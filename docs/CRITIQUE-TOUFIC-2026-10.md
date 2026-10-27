# Toufic's critique: what he got right, what is already fixed, and what to build

Written 2026-10-24. Toufic is a personal trainer who coaches in the gym and online (strength and hypertrophy). On
2026-10-23 he went through the test copy at https://tb-gym-test.onrender.com/ as the Atlas demo's owner and wrote
24 pages of comments beside screenshots (`Toufic critique.pdf`, in Lebanese Arabizi; the owner confirmed every
reading). The test copy runs origin/main 3e27bd9 of 2026-10-15, so he saw the app **before any audit fix batch**
(A1 to A16b, 2026-10-18 to 2026-10-23); main is eb9d46f. His 48 points are numbered T1 to T48 below. The owner
chose what to build on 2026-10-24 to 27; the build plan is `docs/CRITIQUE-FIXES-2026-10.md`.

**How this was checked.** Twelve code reviews compared the build he saw with main, file by file, each re-checked by
a second reader; nine research tracks covered the science (RPE and 1RM prediction, protein and fat ranges, energy
expenditure, prepaid packages and attendance) and what Trainerize, TrueCoach, Everfit, PT Distinction, CoachRx,
Hevy Coach, TrainHeroic, Fitr, MyPTHub, Kahunas, Mindbody, Glofox, TeamUp and the help desks (Intercom, Help Scout,
Front) do, each with a skeptic re-checking every claim against its source; and main was run live in Chrome at
laptop sizes (1366 × 660 and 1366 × 540) to settle the visual complaints. Full notes with file lines and URLs are in
the session's scratchpad (`critique/notes/`); this document keeps the conclusions.

**The short version.** He is right or partly right on 40 of the 48 points. The defects he found that are still on
main: the clipped menus (T8, T26), the sheet footer that covers the last line (T39 to T41, T44), the fold without
an arrow (T37), the sidebar that does not fit a laptop window (T1), the first-set summary line (T30), the drafts
that demand completeness (T12), the quick picks that wrap (T45), the Progress tab that never says a client is
blocked (T36) and the activity table that reads high and that nobody can see (T46). Already fixed by the audit
before he could see it: the old check-ins page where the review opened unnoticed (T15; the better page already
existed on his build, behind the client's record) and the video link that opened nothing (T27, in part). The test
copy's configuration, not the product: USDA (T14), media storage (T25), and the "could not be
saved" errors on a client he had blocked himself (T36's cause). Six are misreadings of designs the screens never
explained (Activity versus Needs you, Unread versus Waiting, the "OR" options, the curve and the maxes, the drag
targets): those are wording defects on our side, not his. His biggest product point stands in full: **there is
nothing for in-person 1-on-1 sessions**, and a gym coach cannot sell what he actually sells. His sharpest technical
catch is the activity multiplier: a nine-cell table that nobody can see or question.

---

## 0. The answers, point by point

Verdict: **Right**, **Partly** (right about the symptom, wrong about the cause or the fix), **Not quite** (a
misreading, usually because the screen never said), **Praise**. On main: **Open** (still as he saw it), **Fixed**
(by an audit batch), **Partly fixed**, **By design** (a documented decision; may still deserve a change),
**Environment** (the Render copy's configuration), **Not a bug**. Batch = the build batch in section 4.

| # | Page | His point | Verdict | On main | Answer to Toufic | What we do | Batch |
|---|---|---|---|---|---|---|---|
| T1 | 1 | The sidebar's scrollbar looks wrong (shows on his machine, not the owner's) | Right | Open | On a window shorter than about 675 px the menu list scrolls and Windows draws its light scrollbar over the dark green; your laptop window is shorter than the owner's, which is why only you see it. | Make the sidebar fit short windows (tighter spacing under a height query), and when it must scroll, a thin dark-scheme bar with a stable gutter, never hidden. | B2 |
| T2 | 1 | Activity panel: same as Needs you, wastes space | Not quite | By design | Not the same list: Needs you is what waits for you; Activity is what clients did (finished workouts with records, check-ins sent) and needs nothing from you. It looked like a duplicate because the demo had been frozen for a week. Every coaching dashboard has this feed. | Rename it "What your clients did", show five rows then "Show all", and later let you react from it ("Nice work" as a message). | B4 |
| T3 | 1 | "Sessions done this week": which sessions? remove it | Partly | By design | They are your clients' programmed workouts, done versus scheduled this calendar week, the number TrueCoach and CoachRx also put on their dashboards. "0 of 24" was a dead week of demo data. "Sessions" was the wrong word for a gym coach. | Rename to "Client workouts this week", add "3 missed · last week 18 of 26", link it to the missed-sessions filter. | B4 |
| T4 | 1 | In-person 1-on-1 sessions should be a thing: sessions left, one place for them | Right | Open | Right: there is nothing for in-person sessions, and it is the biggest gap for a gym coach. Trainerize's users asked for exactly this (212 votes) before it was built there. | Session packs with an append-only balance both sides see, before any calendar (section 3.2). | B10 |
| T5 | 1-2 | Packs of 10 or single sessions, the coach decides what is included; a view of the month and his profit | Right | Open | Right on packs and singles; a plan already chooses what it includes, the count and the ledger are missing. "Profit" the app cannot know (it has no costs); it will show money received, sessions held, plans sold, this month and last, you for yours, the owner for every coach. | Session packs plus a "This month" view (section 3.2). | B10 |
| T6 | 2 | "Maxes to review", "Paused", "Ending soon" are unclear; ending soon could sit inside Needs attention | Right (labels), Partly (merge) | Open (words) | Right: those are engine words. "Maxes to review" becomes "New max suggested", "Paused" becomes "Plan paused", "Ending soon" becomes "Plan ends soon". A plan ending soon stays its own status, as TrueCoach and Everfit do, so a renewal never hides under check-ins; the rule gets written on screen. | Reword the chips and pills; a "How these statuses work" sheet. | B1, B4 |
| T7 | 2-4 | The 7-point dashboard spec | Partly | Partly | Most of it exists: the reasons are printed under the status, every chip has a count, the row shows the goal, last activity and plan end, and the whole row opens the client. What we take: reasons as the loud element with a tap each, a legend for the 7-day strip, reason filters as a second row, the rules written on screen. What we do not: a percent ("2 of 4" is more honest than "50%" with 1 to 5 sessions a week), and an "overdue check-in" signal, which needs a new rule. | Clients list v2 (section 3.1). | B4 |
| T8 | 4 | The day's "..." menu is clipped | Right | Open | A real bug, still on main: the menu is drawn inside the scrolling week grid, which cuts it. | Kit menus move to a top layer and flip to stay on screen. | B2 |
| T9 | 7 | Drag-and-drop is undiscoverable; wants a permanent hint | Partly | Open | Right that it is easy to miss. A permanent animation is not the fix: people learn to ignore it and it must be off under reduced motion. | A visible "+ Add to..." on every recipe row, stronger grab handles, louder drop targets, one hint the first time. | B5 |
| T10 | 7 | Deleting a day shifts the plan; weeks should be fixed 7 days | Partly | By design | Right that deleting day 5 of week 6 must not quietly shift everything. Days stay numbered from the start date (a 10-day plan is allowed, every competitor's weeks are display units too). A day with no meals cannot be published by rule, so "clear it for good" stays impossible. | "Delete week", "Insert a day", Delete day says "days after it move up" and offers "Clear meals instead". | B5 |
| T11 | 7 | Drops landed "as it pleased"; the client must be told to pick ONE | Not quite (drops), Right (wording) | Open (words) | Not random: dropped on a meal, a recipe becomes another option the client picks from; dropped under the day, it starts a new meal. But you are right that nobody is told: the card shows "OR" in small capitals and nothing else, and the client's app hides the alternatives behind "Swap or adjust". | The card says "Pick one of 3" with numbered options; the drop toast says what happened; the client's meal says "Choose one" and lists them. | B5 |
| T12 | 8 | A Drafts filter; drafts saveable without every detail | Right | Open | Right on both: there is no filter, and "Save as draft" demands everything Publish demands, so the word promises something it does not do. | A three-way filter "All · Published · Drafts (n)"; recipe working drafts on the server, as programs and meal plans already have. | B5 |
| T13 | 8 | Suggest carbs and fat from calories and protein | Right | Open | Right, and the formula you describe (protein first, fat as a share of calories, carbs from what is left) is exactly what the app already uses for a client's targets. The plan builder never offered it. The PDF you mean is probably the owner's own macro document, which this formula came from; we will confirm it with you. | "Fill in fat and carbs" with the same 20 / 25 / 30 / 35 % picks in the builder's Daily target card, the arithmetic said in one sentence. | B5 |
| T14 | 5 | USDA search unavailable: why? | Not quite | Environment | Not a bug: the test copy has no USDA key. One setting in Render's dashboard turns it on. | Set `TB_GYM_USDA_API_KEY` on Render; make the screen say "not set up here" rather than "not available right now". | B1 |
| T15 | 5-6 | Which check-in is finished and why; the review opened below unnoticed; auto-scroll; a client search | Right | Fixed (A14b), one residue | Right about that page. Your build already had the better one, under the client's record: the Check-ins tab groups "To review", "Not sent yet", "Reviewed" with "Sent Sun 11 Oct · 1 day late · reviewed Mon 12 Oct", and a sent check-in opens as its own page with the cursor on it. The sidebar's Check-ins sent you to the old two-pane page instead; it was removed on 22 Oct. No auto-scroll is needed. Your other point stands: the Check-ins menu still lands on the forms library. | Make the Check-ins section land on "To review" across clients, with a name search. | B3 |
| T16 | 6 | Unread and Waiting for reply are the same | Not quite | By design | Not the same: Unread is what is new since you looked; Waiting is every chat where the client spoke last, even ones you read and did not answer. Your own screenshot shows it (2 unread, 4 waiting). Every help desk keeps both. You are right that nothing on screen says so. | Keep both; rename the second "Needs your reply"; say the difference in the empty state. | B1 |
| T17 | 9 | "What clients get" should be a product description | Partly | Open | It already is the description (up to 2,000 characters); the label and the "one or two sentences" hint undersell it. And no client reads it anywhere today, so the label's promise is false. | Label it "Description"; put "What's included" above it; give it a reader, a client-side plan page. | B1, B10 |
| T18 | 9 | "Option name" means little; could it be "part 1 of SBD"? | Right (label), Not quite (use) | Open | Right that the label says nothing: it is only the name of that price option, called "12 weeks" if you leave it empty. A program phase belongs to the program's name when you assign it, and block 2 is "Build next block" or a renewal, not another price. | "Name for this price (optional)" with a help line; hidden on a first plan behind "Name this price option". | B1 |
| T19 | 9 | He liked selling plans | Praise | By design | Glad. Selling sessions is the next thing that page will do. | Nothing beyond T17 and T18. | - |
| T20 | 10 | Saved replies should be reachable from the top of Messages | Right | Open | Agreed: a Saved replies button at the top of Messages to add, edit and delete without opening a chat (WhatsApp Business and Intercom work that way); the one under the message box stays. | A manage entry in the inbox header opening the same sheet. | B3 |
| T21 | 10 | As owner, no sidebar section for the coaches | Right (placement) | By design | Right that nothing in the sidebar says Team. It exists under Settings › Team: invite a coach by email, see each coach's clients, remove them and their clients come back to you. On your screen even the Settings row was below the sidebar's fold. | A Team row in the sidebar for the owner (Products · Team · Settings), Team out of the Settings column, and the sidebar fitting short windows (T1). | B3 |
| T22 | 11 | Cards / List should be icons | Partly | Open | Right that it reads like one more filter: it is drawn exactly like the filter chips. Icons alone would need a hover to be understood, which your own point 7 forbids. | A segmented control with a grid icon and a list icon, the word kept beside the icon. | B2 |
| T23 | 11 | "Archived too": should show only archived; a main view without them; what do clients see? | Partly | By design | The chip adds archived items to the list, which is the odd design; it becomes "Your exercises" / "Archived (n)" like Foods. Archived exercises are coach-only: clients never browse the library, they only meet exercises inside their program, and a program keeps an exercise that was archived later. | An archived-only view with a sentence saying what archiving does; the rule written down. | B9 |
| T24 | 12 | Merge Strength and Conditioning; let AI name the types; add Other | Partly | Open | Keep Strength and Conditioning apart: every taxonomy does (ACSM, Everfit, Google Fit, Strava), and "strength and conditioning" names your profession, not an exercise. "General" becomes "Other", Power and a few more join, each with a one-line meaning; your own labels are tags, which get a filter. A list is decided and written down, not generated. | Extend and explain the Type list; a Tag filter chip. | B9 |
| T25 | 12 | Media storage unavailable | Not quite | Environment | Not a bug: the test copy has no media storage and no scanner. Video links work; uploads need the production storage (R2 and ClamAV). | Say "not set up on this server" before the upload button, not after a failed try. | B1 |
| T26 | 13 | The card's "..." menu is cut at the bottom | Right | Open | Right, still on main: the menu runs past the card's edge, and in List view "Archive" is hidden entirely, so it cannot be clicked with a mouse. | Same fix as T8. | B2 |
| T27 | 13 | The "Video link" tile cannot be opened | Right | Partly fixed (A1) | Right. Since 20 Oct a link opens on YouTube or Vimeo in a new tab from the client's workout and the coach's demo sheet; the library card's tile still does nothing. | The tile and the card menu open the video; the tile shows the video's title and "Opens on YouTube". | B9 |
| T28 | 14 | Same drag hint for exercises | Partly | Open | Same answer as the meal plan: better handles, a "+" path on every exercise, one hint the first time, no looping animation. | With T9. | B5 |
| T29 | 14 | "Normal" should be "Working set" | Right | Open | Agreed: "Normal" becomes "Working"; Top, Back-off, Drop and Failure are kinds of working set and say so. Your client's app already says "Working set". | One label and a help line. | B1 |
| T30 | 15 | "2 sets · RPE 5" is wrong; wants per-set lines "set 1: @5 10x2 250kg" | Right (defect), Partly (fix) | Open | Right, the line was wrong: it took set 1's effort for both sets. It will list the sets that differ. We keep "sets × reps · load · RPE" rather than "@5 10x2", which reads as ten sets of two to most lifters and drops the unit. | The grid row uses the session sheet's rule: equal sets once, differing sets each on a line (a change to the one-line rows the owner chose in R6.3; the owner confirms). | B7 |
| T31 | 15 | Curve based on what? The client must record what he actually lifts | Not quite | Not a bug | Based on the RTS chart or the Epley curve applied to that client's training max, set when you assign the program. The client already logs the real weight, reps and RPE on every set, kept apart from the prescription, and those sets suggest the next max to you. The builder never says any of this. | One explaining line on the formula menu and in the publish preview. | B7 |
| T32 | 15-16 | "70% of what?" Wants a box of main lifts and maxes on the program | Partly | By design | 70 % of that client's training max. A program is reused for many clients, so the maxes are typed when you assign it, and the assigned program shows them in its Training maxes panel. The builder will list "Needs a training max for: Back Squat, Overhead Press" so you know before publishing. | "% of training max" wording; a needs-a-max line in the builder header and the preview. | B7 |
| T33 | 16 | Let RPE sets reach 20 reps | Partly | By design | You can write 20-rep sets today with an RPE target and no computed weight, or a typed weight. A computed weight at 20 reps would be a guess: Epley and Brzycki disagree by 13 points there, and real reps at 70 % range from 6 to 28 between people. The refusal will offer the right tool in one tap. | The refusal gets "Let the client pick the weight" and "Type a weight" buttons. | B7 |
| T34 | 16 | At RPE 5 no kg shows | Partly | By design | RPE 5 is too far from failure for the chart (it starts at 6.5; at 5 reps in reserve people misjudge by over a rep). The refusal will offer "Use the Epley curve" and "Type a weight"; and the builder will show the chart's percentage so a set is never blank. | Buttons on the refusal; the percentage on chart sets. | B7 |
| T35 | 16 | Let the coach type 8-12 or just 10 | Right | Not a bug | Agreed: one box, "10" or "8-12". (Both boxes holding 10 already means 10; nothing said so.) | One Reps box. | B7 |
| T36 | 17-18, 21 | Progress could not be loaded; weight, measurements and photos could not be saved | Right (symptom) | Open (no "why") | Those errors came from Elie being blocked: someone pressed Block access on him, probably you while exploring Service & access. The Overview says "Elie's access is blocked", the Progress tab and the three sheets do not. | The Progress tab and the entry sheets say why and offer Unblock. | B6 |
| T37 | 21 | "Entries and corrections" looks like static text | Right | Open | Right: it is a fold whose arrow the styling removed; the app has three different fold looks. | A chevron on every fold, one look. | B2 |
| T38 | 21 | Show the starting weight and the age | Right | Open | Agreed: the age from the date of birth on About, and the starting weight with the change since the start on Progress (weekly averages, never two single days). | Age and the dated starting weight are display only; "since start" needs the weekly-mean comparison rule (PRG-005) approved and versioned first. | B6 |
| T39 | 19 | Renew plan: cannot scroll, the last line is cut | Right | Open | Right, and still on main: the sheet's button bar is held 24 px above the bottom by a CSS slip, so it covers the last line and leaves a strip under it. | A footer region outside the scrolling body in the kit's sheet, for every sheet; meanwhile the one-line fix the eight other sheets already use. | B2 |
| T40 | 20 | Record payment: the scroll stops with text hidden | Right | Open | Same cause: the bar covers the lower half of "Only your team sees it." at the end of the scroll. | Same fix. | B2 |
| T41 | 20 | Start plan: weird scroll, the bar over the page, scrollbars above and below, a line under the buttons | Right | Open | The bar staying in view is intended; its position is not: the line passes under it while scrolling and the body's scrollbar runs beside and below it. | Same fix. | B2 |
| T42 | 22 | "What kind of max?" Just 1RM, or a PR with reps, set and weight | Partly | By design | Two kinds exist because a program must not run off a PR day: the training max is what percentages use (5/3/1 keeps it near 90 %), a tested 1RM is a fact. You will be able to enter the set itself ("100 kg × 5"): the app works the max out and proposes the training max from it. | Reword the two kinds; add "From a set they did". | B7 |
| T43 | 22 | Records should not drive the program; the program has its own number; the client records himself | Not quite | Not a bug | That is already how it works: the program keeps its own maxes from the day you assign it, the client logs his own weights, and the record sheet is history that only pre-fills the assignment. The screens never said it. | One sentence on Record a max and the Strength history. | B7 |
| T44 | 23 | Assign program: the scroll again; let the coach pick which lifts get a max | Partly | Open (scroll), By design (lifts) | The sheet asks only for lifts the program computes from a max, so none can be skipped (a computed set without a max has no weight). Each row will say why it is there, the maxes move above Load settings, and the scroll is the same bar slip as T39. | Why-lines on the rows; the bar fix. | B2, B7 |
| T45 | 23 | Protein and fat quick picks look untidy | Right | Open | Agreed: the fourth protein pill always wraps and the rows sit above the boxes they fill. | Each number its own block: the box first, one neat row of picks under it, carbs said once the server has worked out the target. | B5 |
| T46 | 24 | "How active they are" is always 1.80; something is wrong | Right | Open | Right, and not only in feel. 1.80 comes from a nine-cell table (kind of work × steps band): "mixed work" with any step count from 5,000 to 9,999 gives 1.80, and nothing on screen says so. The cell is also too high: 1.80 is the FAO's "active" band, whose own worked day is a standing job plus an hour of exercise; a seated day with 6,000 steps is 1.53, and working adults measure about 1.70 to 1.75 on average. Every other way of estimating puts Elie between 2,760 and 3,470, so the 3,116 "cut" sits inside that spread and may be no cut at all. | Recalibrate the table (five step bands, four kinds of work, a small term per weekly workout), say the words beside the multiplier, let a coach set the multiplier instead, and get the clinical review the docs require (section 3.4). | B8 |
| T47 | 24 | Log the steps but do not add their calories to the total | Partly | By design | Steps never add calories here; they help pick the multiplier, which is the right model (walking is daily expenditure, and every published scale already contains it). Your 180 kcal is right: 5,000 steps at 97 kg cost about 183 kcal net. Your word "extra" is not: the honest line is "their 5,000 steps are inside the multiplier, worth about 180 calories a day". What is wrong today is that the screen says nothing about what the steps did. | Name the steps band and the work beside the multiplier, live and in the breakdown; a muted "worth about 180 calories, already inside it" line; the steps field's help says they are never added on top. | B8 |
| T48 | 24 | Look at calculator.net | Partly | By design | A good reference for how to present it, a poor one for the model. It uses the same three formulas, defaults to Mifflin-St Jeor for the reason it states, and shows every goal with its weekly rate and share of maintenance. But its activity levels are exercise frequency with hidden multipliers (1.2 to 1.9, "Moderate" 1.465 pre-selected) of no documented origin, with no steps and no job, so a nurse and a desk worker who both lift four times a week get the same number. | Borrow its presentation (goal rows with the rate and the share, plain-word levels, floors as warnings, the formula hint); keep work and steps as the inputs; offer its ladder only as the coach's explicit override (section 3.4). | B8 |

---

## 1. The ten things that matter

1. **He cannot sell what he sells.** A gym coach sells hours on the floor, in packs of 10 or one at a time. TB Gym
   sells dated plans of app features. Nothing counts a session, nothing shows a balance, and "session" in the app
   means a programmed workout. This is the one product gap in the critique, and every competitor that serves
   in-gym trainers has it (section 3.2). It should be the next commercial slice, with the design corrected by the
   skeptic: sessions as a sixth coaching feature, not a featureless product.
2. **The activity multiplier is a black box, and it reads high.** 1.80 is one of seven values in a table that
   exists only in code, that the docs themselves say awaits clinical review, and that moves a client's maintenance
   by 300 to 400 kcal at a step-count edge without a word on screen. Against the FAO's own worked days and the
   measured average of working adults it sits a band too high: every other estimate puts Elie's maintenance between
   2,760 and 3,470, so his 3,116 "cut" may be no cut at all. Toufic found it by looking at one number twice
   (section 3.4).
3. **Four kit defects explain most of the "weird" he saw.** Menus drawn inside scrolling or clipped containers
   (T8, T26), a sheet footer held 24 px above the sheet's bottom (T39 to T41, T44), a fold whose arrow the styling
   removed (T37), and a sidebar that does not fit a laptop window (T1, and the reason he never found Settings).
   Each is one small CSS or kit change and all four are still on main.
4. **Engine words on coach screens.** "Maxes to review", "Paused", "Ending soon", "Normal" set, "What kind of
   max", "Option name", "What clients get", "Archived too", "Waiting for reply". None is wrong; none says enough.
   The UI plan's own rule is "speak coach, never system". A words pass closes most of it in a session.
5. **Designs that are right but never explained.** Needs you versus Activity, Unread versus Waiting, "OR" options,
   training max versus tested 1RM, the program's own maxes, the client logging his own weights, which lifts need a
   max and why. In each case Toufic concluded the design was wrong because the screen did not say what it was
   doing. The fix is a sentence in the right place, not a redesign.
6. **The clients list is better than he thinks and worse than it should be.** The reasons he asks for are already
   under the status; the counts he asks for are already on the chips. What fails is weight (the generic pill is
   loud, the reasons are small grey text), a strip with five mark styles and no legend, reasons that lead nowhere,
   and rules written only in the docs. His spec's principle is right; his implementation (a percent, eight flat
   filters, a button per row) is not.
7. **The meal plan model is stronger than every competitor's and the least explained.** Options the client
   chooses between, averaged for planning, is a better model than Nutrium's "or" in a food name or Everfit's
   tagged variants. Nobody on either side is told. "Pick one of 3" on the coach's card and "Choose one" on the
   client's meal are the whole fix.
8. **The audit removed the check-ins page he fought, and a video link now opens on YouTube.** The old two-pane
   page is gone. The review page he never found (its own page, focus on its heading, groups To review / Not sent
   yet / Reviewed) was already on his build under the client's record; the sidebar led him to the old page, a
   navigation lesson in itself. One residue each: the Check-ins menu still lands on the forms, and the library
   card's tile still does nothing.
9. **The test copy misled him three times.** No USDA key, no media storage, and a client he blocked himself whose
   saves then failed with "Try again". The first two are one Render setting and one honest sentence; the third is a
   real gap (the Progress tab never says why) that would have confused him on production too.
10. **Where he is simply right and it is cheap.** "Working set". One Reps box. Starting weight and age on the
    profile. Saved replies at the top of Messages. Team in the sidebar. A Drafts filter. Fill in fat and carbs.

---

## 2. Already solved, and what was the test copy's fault

**Fixed by the audit before he could see it** (the Render copy was not redeployed after 15 Oct):

- **T15, the check-in review opening below the list.** A14b (c6b84e6, 22 Oct) removed the old "Client check-ins"
  page (its address now redirects) and moved assigning into a sheet. The better page was already on his build:
  since R4.3 (3eaf66a, 5 Oct) a client's Check-ins tab groups To review / Not sent yet / Reviewed and a sent
  check-in opens on its own page with focus on its heading; Today's "Review" already led there. The sidebar's
  Check-ins led him to the old page instead. The pills say Needs review, Reviewed, Overdue, Started. Nothing is
  left to auto-scroll to.
- **T27, the video link.** A1 (c684984, 20 Oct, the owner's C18 decision): a YouTube or Vimeo link opens on that
  site in a new tab from the client's workout and from the coach's demo sheet, through an address the server builds
  from the stored id. The library card's play tile is still decorative (section 3.6).
- **T21's second half.** A1 also made the coach invitation honest on a copy with email off ("Email is off on this
  server, so they won't get the link yet"); on his build a coach could be invited and never receive a link
  (audit LOST-1).
- **Today's greeting** (behind T2 and T3): A8 changed "9 clients need you today. Everyone else is on track." to
  "N clients have something for you today, listed under Needs you", because the old sentence and the clients
  list's "need attention" counted differently (COACH-4).

**The Render copy's configuration, not the product:**

- **T14, USDA.** `docker/test-copy/start.sh` reads `TB_GYM_USDA_API_KEY`; nobody set it in Render's dashboard.
  A free key from api.data.gov and one environment variable turn food search on, no redeploy needed. The screen
  shows the same sentence for "not set up" and for "USDA is down"; it should say which.
- **T25, media storage.** The copy runs `Media__StorageAdapter=None` (ADR 0023 fails closed), so uploads answer
  503 "Media storage is unavailable" while links work. Production gets the R2 bucket and the ClamAV scanner
  (GO-LIVE step 4). The sheet should say so before the Upload button, not after a failed attempt.
- **T36, the "could not be saved" errors.** Elie Azar was "Access blocked" because someone pressed Block access on
  him (the demo never blocks anyone; pages 19 and 20 show Toufic inside that tab's dialogs). A blocked client's
  coach reads answer 404 and writes 403 with no body (ADR 0009, PRG-008/009, on purpose, so a block cannot be
  probed), and the Progress tab and the three entry sheets fall back to "Try again". He worked it out himself on
  page 21 ("suddenly the measurements started being accepted, maybe because it was blocked"). The refusal is by
  design; the silence is a defect (section 3.10).
- **The frozen demo.** The copy's Atlas data was generated on 15 Oct and stood still, so on 23 Oct every check-in
  was "sent 6 days ago", every client "trained 5 days ago", nine of twelve needed attention and the week tile read
  "0 of 24". That inflated his reading of T2, T3 and T6. Rebuild the demo on the day of a review.

---

## 3. The analysis, area by area

### 3.1 Coach home and the clients list (T1, T2, T3, T6, T7, T38)

**What is true today.** Coach Today is the attention queue (CLI-018), three tiles, the "What clients did" feed and
the week chart, as the UI plan's C1 specifies. The clients list shows one status pill per client (Needs attention,
Paused, Ending soon, On track, No active plan), the reasons under it ("Check-in to review · Missed sessions ·
Maxes to review"), the last activity, a 7-day strip with "1 of 4" and the plan line; chips with counts; a
search by name or goal. The rules behind each signal are precise and named (missed = two or more programmed
sessions not started since the last workout, 14 days back; check-in to review = sent and not reviewed; ending soon
= last paid day within 14 days; new = joined within 14 days; maxes to review = logged sets imply a higher training
max) and appear nowhere a coach can read them, except as the chips' empty-state sentences. One boundary slip: the
screen colours "Plan ends in 14 days" warm while the server flags ending soon at 13 days or fewer.

**What the research says.** Every competitor names the reason, as a tag (Trainerize's auto tags: "Not Signed In
Lately", "Low workout compliance"), a category (CoachRx: "Missed 2+ Workouts in a Row", "Less than 50% Exercise
Compliance"), a status with a published breakdown (Everfit's check-in dashboard: On Track, Need Attention, At Risk
below 60 %), or a panel named for its trigger (TrueCoach's Due Soon beside Needs Attention). None shows a bare
generic word. Adherence is a percent everywhere, and that is the weak part of the norm: with one to five sessions a
week a percent swings wildly, as Trainerize's own help page shows ("1 of 1 (100%)" beside "2 of 5 (40%)"), and
"2 of 4" with the strip says which days as well. An activity feed is standard (CoachRx, Hevy, TrainHeroic, Everfit,
PT Distinction), and in CoachRx and TrueCoach the coach can react from it. A roster-wide completion number is
standard. Rules are published and in three apps tunable (Trainerize's thresholds and days, Everfit's 60 %, MyPTHub's
compliance scale). A plan's end is kept beside, not inside, Needs attention at TrueCoach and Everfit, which is TB
Gym's current rule; Trainerize tags "Main Program expiring" among its attention tags, so Toufic's reading has a
precedent too. Kahunas shows "starting and current weight" on every client dashboard; weight change is reported
against a baseline throughout the clinical literature (5 % of baseline is the usual threshold of meaning, Horn 2022;
Williamson 2015 debates the threshold, not the baseline), and age is an input of the formulas TB Gym already runs.

**Assessment of his proposals.** Removing Activity (T2) and the week tile (T3) does not fit: both are standard,
and the week he saw was dead demo data. Their labels are at fault: "Activity" says neither what it holds nor why,
and "Sessions" is a gym coach's word for a paid hour. His 7-point spec (T7) is right as a principle (reason first,
actionable, rules defined, nothing by hover or colour) and partly wrong as an implementation: "(50%)" adds noise
to "2 of 4"; a single progress bar loses which days were missed and whether today's is still due; eight flat
filter chips wrap on a phone and bury the first row (progressive disclosure); a button per row adds a tab stop
per client for an action the row already does. One item on his list does not exist in TB Gym at all: an overdue
check-in the client never sent (the app flags only check-ins the client sent; CHK-012 forbids reading anything into
a check-in's answers, which an absence is not, and CHK-013 already shows the coach that a draft exists).
T6 is right on the words; folding "Ending soon" into Needs attention is defensible but would sink the one money
item under check-ins and messages, and Today already puts plans ending into Needs you, so the two screens would
count alike only after that fold.

**Recommendation.**

- Clients list: in the Status cell, when a client needs attention, replace the generic pill by reason tags in one
  warning tone, each a short label with its count ("2 check-ins to review", "3 missed sessions", "1 unread
  message", "Week not shared", "No program yet", "Asked to renew", "Joined, no plan yet"), each the link Today's
  action already uses (the review, the conversation, Training, Service with `?renew=` or `?action=start`). The
  four plan-state pills stay ("On track", "Plan paused", "Plan ends soon", "No active plan"). Keep the strip and
  "n of m"; add a one-line legend under the column head, drawn with the same shapes as the marks; rename the head
  "Last 7 days · done of scheduled". A chevron at the row's end so the row's link is visible without hover. When
  the last activity was a workout, name it ("Trained Lower A 5 days ago"). A second row of reason chips with counts
  when "Needs attention" is on. A "How these statuses work" sheet beside the chips and under Today's Needs you,
  in the words of the rules above. The Clients lede says "12 clients · 9 need attention · 1 plan ends soon" so it
  never looks like it disagrees with Today. Fix the 14-day boundary (one side or the other).
- Today: "What your clients did · Last 7 days" with five rows then "Show all"; on narrow screens it sits under
  Needs you and starts folded with its count. "Client workouts this week · 9 of 24 · 12 were due by today ·
  3 missed · last week 18 of 26", linking to the missed-sessions chip. The feed's reaction ("Nice work", sent
  through messaging, so only for clients whose plan includes messaging) is a later, owner-decided step.
- Profile: "Date of birth Dec 24, 1983 (42)" on About and My profile, derived for the workspace's today (CLI-005).
  On the Overview's Weight panel and the Progress hero: "Started at 97.4 kg on Thu 15 Oct" (the first weigh-in of
  the current profile) and "Since start: −2.3 kg (−2.4 %)" as the latest weekly mean minus the first (PRG-005),
  the starting weight alone while fewer than two weekly means exist. No new field: the intake already writes the
  starting weight as the first weigh-in. The age and the dated start are display only; "Since start" is not: PRG-005
  marks the first-versus-latest comparison as a rule that needs approval and a stored version, so it ships as a named
  summary version with a reference test, like the "vs last week" figure (owner decision below).
- Owner decisions: an "overdue check-in" coach signal (proposed: due two or more days ago, not sent, check-ins in
  the plan, ranked after missed sessions, clears when sent or after 14 days; derived from the absence of a
  submission, never from answers; "Remind" opens the chat only while messaging is in the plan; needs a CLI-018 line
  and a domain test); the "Since start" comparison rule (recommended: latest weekly mean minus the first); whether a
  plan's end stays outside Needs attention (recommended yes; Trainerize folds it in, TrueCoach and Everfit do not);
  "workouts" instead of "sessions" on coach screens (recommended yes, with a glossary line).

### 3.2 Selling: sessions, packs, the plan's words (T4, T5, T17, T18, T19)

**What is true today.** A product is a plan: a name, a description (2,000 characters, labelled "What clients
get"), and price options, each an immutable set of length (weeks or days since A16b), price, currency and included
features (Training, Nutrition, Check-ins, Messaging, Resources). Selling one creates a dated enrollment; access
opens when the exact price is received in manual receipts; overlap is refused only per feature (SUB-004). There is
no session, credit, package, booking or attendance concept anywhere, no revenue or earnings view (money per plan
"this month" is explicitly deferred in the UI plan for lack of definitions and because currencies cannot be added),
and the client reads none of the plan's words: the client API answers feature access decisions only. Two things
the skeptic corrected in the research: an offer **cannot** have zero features (`ProductOffer` refuses it), so a
"featureless session product" is not a smaller design, and TB Gym's platform bill counts a client as billable only
while some coaching feature covers them (PBL-002).

**What the research says.** Every booking system (Mindbody, Glofox, Zen Planner, TeamUp, Vagaro) and both coaching
apps that added in-gym support (Trainerize session packs in 2021 after 212 votes on its idea board; Everfit session
credits in August 2026) model a pack as **a count of sessions with a price and an expiry, consumed one at a time,
with a per-client balance the client can see**, immutable once sold. They consume at booking because they have
calendars; Trainerize's users asked for consumption at completion. Coaching-only apps (TrueCoach, PT Distinction,
Hevy) have no session counts. Money views range from none to Everfit's per-coach revenue dashboard for owners and
Mindbody's and Glofox's pay rates per session. The behavioural evidence favours dated packs with a visible balance:
a prepaid cost fades from memory and attendance with it (Gourville and Soman 1998; Gourville's health-club
account), people overestimate how often they will come (DellaVigna and Malmendier 2006: monthly members paying
over $17 a visit when a 10-visit pass cost $10), and a dated, visible commitment holds habits (Royer, Stehr and
Sydnor 2015). Studio practice puts expiry at three to six months for 5 to 20 sessions. Stripe's model is the same
shape as TB Gym's (product = plan, price = option), with the price nickname hidden from customers and the product
description shown to them.

**Assessment.** T4 and T5 are right, and T19 is the reason to do them next: he liked the selling page and will be
frustrated the first time he tries to sell ten gym sessions. His "the coach decides what's included" already
exists as the feature chips. His "profit" is the wrong word: the app knows receipts, sessions held, plans sold,
clients started and ended; it does not know costs or a coach's share. T17 is right on the label (every competitor
and Stripe call it a description) and right by accident on something bigger: no client reads it, so the hint
"as you would say it to a new client" promises what does not happen. T18 is right on the label and wrong on the
use: a price option is an alternative of one plan ("4 weeks", "12 weeks", "Student rate"); a programme phase is
Training's business (the programme is named at assignment, block 2 is Build next block or a renewal), and ADR 0034
refuses two options of one plan with the same length and currency.

**Recommendation (the smallest design that keeps every invariant).**

- **Sessions as a sixth coaching feature**, "Sessions" (`CoachingFeature.Sessions`), whose offers set the existing
  `AllowsConcurrentCoverage` flag so the same client can hold several packs at once. This keeps every reader that
  keys on features working unchanged: access (SUB-009), the client list (a pack-only client is not greeted with
  "Joined, start a plan"), ask-to-renew (SUB-014), the client's own access read, the shared
  `ICoachingFeatureAccessService` port guarding the new API, and platform billing (PBL-002 counts a pack-only client
  with no amendment).
- **A product kind**: a plan is either a *coaching plan* (today) or a *session pack*. A pack's price option carries
  a session count (1 to 100) and keeps the length as the pack's validity (suggested defaults 90 days for a pack, 30
  for a single session; the coach decides), plus the other feature chips, which may be ticked or not. One active
  option per count, length and currency (ADR 0034's slot gains the count). A single session is a pack of 1.
- **Selling is an enrollment** as today: dated, waiting for payment until the exact price is received (a free pack
  is active at once), overlap checked only on the features it includes.
- **An append-only session ledger** per enrollment, the shape of PaymentRecord: Issued (the count, when the pack
  becomes active), Held (the workspace day, the coach, a note, optionally the client's workout of that day),
  Charged (a late cancel or no-show the coach charges, with a reason the client reads; TB Gym has no card on file),
  Voided (a correction pointing at the row it undoes), Lapsed (whatever is left at the end, written by date, not by
  the Worker, since the calendar date is authoritative). Balance = issued − held − charged + voided. Triggers refuse
  update and delete. Consumption at completion ("Record a session" from the client's page, with a receipt in the
  same sheet when the client paid cash that day), never at booking. Refusals in words: no sessions left, a day
  outside the window, a pack awaiting payment, a released client (ADR 0027), another coach's client (ADR 0026).
  When several packs run, the one ending first is consumed (Glofox, Everfit, Vagaro). Idempotency keys as for every
  commercial command.
- **Where it shows.** Coach: a "1-on-1 sessions" section on Service & access ("7 of 10 left · until 12 Jan · last
  held Tue 21 Oct", Record a session, Sell sessions, the ledger as history), a "2 sessions left" chip on the client
  row, Today items in CLI-018's specific style. Client: on Today or Me, "7 of 10 sessions with Toufic left, until 12
  January" and the dates held; the ending-soon notice as for plans. Single-session sales are ledger lines, not plan
  cards. Words: "1-on-1 sessions" everywhere; "Session pack" and "Single session" as the two presets; the Today tile
  becomes "Client workouts this week" the day packs ship.
- **"This month"**: money received (by the day it arrived, SUB-007), sessions held, plans and packs sold, clients
  started and ended, this month and last, in the workspace calendar; a coach sees their own, the owner every coach
  and the total (C8's business side). Never "profit" or "earned". Pay rates (Mindbody, Glofox) are a later ADR if
  gyms ask.
- **T17 and T18**: label "Description (optional)" with the hint "What you'll do for them and what you expect, as
  you'd tell a new client. The tick list is what the app opens for them."; "What's included" above the description;
  "Name for this price (optional)" with "Left empty it's called by its length, “12 weeks”. Name it when the length
  isn't the point, like “Student rate”.", hidden on a first plan behind "Name this price option". Give both a reader:
  a client-side plan page (name, what's included, dates, the description, and for a pack the sessions left), one
  new client read.
- **Not in v1**: booking, a calendar, self-booking, reminders, automatic no-show charging, several session types,
  pay rates, packs with no end date.
- **Owner decisions** (with recommendations): confirm that a pack-only client is billable to TB Gym as any covered
  client (yes, by PBL-002 as it stands); every pack has an end date (yes; no "never ends" in v1); a coach may
  charge a session without holding it, with a reason the client reads (yes); no extension of a lapsed pack, a free
  1-session pack is the goodwill tool (yes); a pause changes access, not dates, for packs too (yes, said plainly);
  the client plan page comes before or with packs (yes). Questions for Toufic: how long his packs are valid, his
  no-show rule, whether singles are paid cash on the day, whether he needs more than one kind of session per pack.

### 3.3 Meal plans, recipes and the targets sheet (T8, T9, T10, T11, T12, T13, T45)

**What is true today.** A meal plan is a flat list of numbered days (1 to 365) grouped in weeks for display; Add
week copies the last seven days; a day's menu offers Duplicate, Use for every day, Clear meals, Delete day (with
Undo), and Delete day shifts every later day up one. Publish refuses a day with no meals (NUT-013 and the server).
A meal holds options the client chooses between (NUT-005); the day's total uses their average for planning; a
recipe dropped on a meal becomes another option, dropped under the day a new meal; the only sentence explaining it
("The client eats one of them. With more than one, the day counts their average.") is inside the meal sheet; the
grid shows "OR" in 11-px capitals and "≈". The client's day shows the first option as the meal, "Ate as planned",
and the others behind "Swap or adjust"; the published version keeps no order for options. The recipe list has no
status filter and "Save as draft" runs the same completeness checks as Publish (name, servings, an ingredient, a
method): a TB Gym draft is a complete version not yet in meal plans. The builder's Daily target card warns when the
grams disagree with the calories by more than 5 % and suggests nothing; the client targets sheet already has the
NUT-008 split (protein grams, fat as a share with 20 / 25 / 30 / 35 % picks, carbs the remainder). The sheet's
"Protein and fat" fieldset puts four "x.x g a kilogram" pills above the protein box in a 640-px sheet, so the
fourth always wraps, and the group names are aria-labels only.

**What the research says.** Weeks are the unit in every builder (Everfit, That Clean Life "each planner spans 7
days", NutriAdmin "the maximum is 7 days", Nutrium, Foodzilla, Eat This Much), days in the middle are cleared,
copied or replaced rather than deleted (NutriAdmin removes days only from the end), and numbered days instead of
weekdays exist for programmes that start any day (Foodzilla, That Clean Life). Per-meal alternatives the client
chooses between are rare as a first-class structure: Nutrium joins foods with "or", NutriAdmin writes "OR" into a
food's name, That Clean Life allows two recipes in a slot, Everfit swaps a recipe for a tagged variant; choice
usually lives at the plan level as a swap permission, and none documents a client-side pick-one between whole
recipes with a planning average (TB Gym's NUT-005). Everfit has Draft / Published with a "Show Draft" button.
Macro helpers are percent presets (Trainerize 40/30/30, NutriAdmin) or tiers (MacroFactor); protein in g/kg is a
TB Gym advantage. The science behind the picks holds: 1.6 to 2.2 g/kg (Morton 2018; ISSN 2017: 1.4 to 2.0 for
most, 2.3 to 3.1 g/kg of body weight in a cut, the range Helms 2014 gives per kilogram of lean mass), fat 20 to 35 % of energy (the AMDR) or at least 0.5 to 1 g/kg in
a cut (Kerksick 2018), carbohydrate as the remainder, which is NUT-008's order of operations. On drag-and-drop,
NN/g asks for clear signifiers and feedback (handles, the move cursor, visible drop zones) and warns that overlays
and coach marks are dismissed unread and forgotten within seconds; WCAG 2.5.7 requires a single-pointer alternative
to every drag.

**Assessment.** T9 is right about the problem and wrong about the fix: a looping animation is a push revelation
that never stops, and the real gap is that a library row has no click action at all (on a phone there is no drag
source). T10 is right about the symptom and half right about the model: his fixed weeks, "clear but never delete"
and "add weeks freely" match every competitor and mostly exist already; what cannot be done by rule is publishing
an empty day, and TB Gym's numbered days from the start date are the right choice for plans that start any day.
T11 is right on both halves even though the drops were deterministic: nothing tells the coach what an option is,
and nothing tells the client that there are options. Under it lies a real model difference worth an owner question:
every competitor composes a meal from several items eaten together; TB Gym composes a meal from alternatives (one
recipe is the plate). T12 is right on both counts. T13 is right and the engine exists. T45 is right.

**Recommendation.**

- Drag (T9, T28): a grab cursor and a lift on hover, the grip kept; a "+" on every library row that selects the
  recipe and turns every drop slot into an "Add here" button (on each meal, under each day; Esc or a second press
  cancels), the WCAG 2.5.7 select-then-target shape, which also works on phones, where there is no drag source (the
  "+ Meal" picker runs the other way, a recipe for a known meal, so it cannot be reused; the smaller fallback is a
  menu "Add to…" listing the day in view's meals); the panel sentence names both paths ("Drag a recipe onto a meal,
  or press + to add it."); louder drop targets while dragging; one first-use callout anchored to the first row,
  closed on the first drop or press and reachable again from a "How dragging works" link; nothing animated under
  reduced motion, and never a loop (WCAG 2.2.2).
- Days (T10): keep numbered days; add "Delete week" and "Duplicate week" to the week header, "Insert a day
  before / after" and "Replace with a copy of day ..." to the day menu; Delete day's hint reads "Days after it move
  up one", its Undo toast "Day 33 deleted; days 34 to 49 moved up one", and inside a full week the confirm offers
  "Clear its meals instead" first; a short last week is labelled "Week 7 · 6 days"; Publish's refusal offers "Copy a
  day here".
- Options (T11): the coach's meal card says "Pick one of 3" with rows "Option 1 / 2 / 3" and a footer "≈ 526 kcal ·
  average of 3 options"; the drop toast says "added as option 2 of Breakfast: the client picks one" or "added as a
  new meal, Lunch, on day 2"; the client's meal with alternatives says "Choose one", lists every option as a
  selectable row with the first pre-selected, the button reads "I ate this", and "Swap or adjust" becomes "Change
  servings". Owner decision: an order column on the published version so the coach's first option is the client's
  default (recommended yes); and whether meals may ever be several recipes eaten together (recommended: keep
  alternatives for now, revisit after founding coaches have built a few plans).
- Drafts (T12): a three-way filter "All · Published · Drafts (n)" beside the search, applied on the server;
  recipe working drafts the ADR 0033 way (a `RecipeDraft` per person and recipe, values unchecked, autosaved,
  private, never reaching a meal plan, carrying an AI suggestion's pending review when the recipe began as one (ADR
  0035); Publish runs every rule and makes the next immutable version), listed as "In progress" beside the shared,
  complete-but-unpublished "Draft", which stays. Until then, the menu item says "Save as draft (complete, not published)".
- Targets (T13): "Fill in fat and carbs" in the Daily target card with the sheet's 20 / 25 / 30 / 35 % picks,
  writing fat = calories × share ÷ 9 and carbs = (calories − 4 × protein − fat calories) ÷ 4 into the boxes and
  saying it in one sentence; the arithmetic runs through the server's NUT-008 strategy (or a preview of it) so the
  grams keep their provenance and unrounded values, rather than browser arithmetic that stores rounded integers with
  no record of the 25 %; warnings in words below 20 % fat and when a chosen client's weight makes it under 0.5 g/kg;
  an optional "Start from a client's targets" (assigned clients only, ADR 0026). The PDF he names is probably the
  owner's own plan document, NUT-008's source; confirm, and if it differs it is a new named strategy, not an edit to
  NUT-008.
- Quick picks (T45): two blocks, Protein and Fat, each the box first and one segmented row under it ("1.6 · 1.8 ·
  2.0 · 2.2" captioned g per kg; "20 · 25 · 30 · 35" captioned % of calories), the help saying the derived figure
  both ways, and a read-only "Carbs: the rest, 225 g (45 %)" once Work out has answered (the calorie target comes
  from the server; a live figure would need a preview call, not a copy of the formulas in Angular).

### 3.4 Energy expenditure, activity and steps (T46, T47, T48)

**What is true today.** The calculator (R5.3d1) asks weight, height, age, sex, kind of work (Seated / Mixed /
Physical), steps a day, a goal in kcal, protein in g/kg and fat in %, and a BMR formula folded under "Formula:
Mifflin-St Jeor" (the default; Katch-McArdle and Harris-Benedict revised as alternatives, the last chosen on his
screenshot). The activity model `OccupationStepsPal v1` is a nine-cell table: Seated 1.50 / 1.70 / 1.85, Mixed
1.65 / **1.80** / 2.00, Physical 1.80 / 2.00 / 2.20 for under 5,000, 5,000 to 9,999 and 10,000 or more steps. His
numbers reproduce exactly (Harris-Benedict 2,009.018 × 1.80 = 3,616; −500 = 3,116; Mifflin would have given 1,882
and 3,387). Only seven distinct multipliers exist; "mixed" with any step count from 5,000 to 9,999 is 1.80 (Maya,
mixed with 7,000 steps, also gets 1.80 on main); one step across a band edge moves this client's maintenance by 301
or 402 kcal. Steps never add calories as a line: they pick the column, and training is not an input at all. The
table is documented nowhere outside the code; ADR 0008 and DOMAIN-RULES say the activity mapping "requires
qualified clinical review before production launch", and nobody has reviewed it; one reference test pins one cell
(Seated + 6,000 → 1.70). The result screen shows three lines ("What their body burns at rest", "Times 1.80 for how
active they are", "−500 for the goal"), names the steps only in "Worked out from …", and cites nothing. The energy
code is the same on his build and on main (A6 only added the macro override around it). One docs slip found on the
way: the docs call the TDEE step `TdeeMultiplication v1` while the code's key is `BmrTimesPal 1.0`.

**What the research says.**

- *Which formula.* The American Dietetic Association's systematic review (Frankenfield 2005) found Mifflin-St Jeor
  the most reliable equation, within 10 % of a measured value more often than Harris-Benedict and with the
  narrowest error range; the revised Harris-Benedict TB Gym implements (Roza and Shizgal 1984) carries about 14 %
  precision. For Elie it adds 127 kcal (6.8 %) at rest and 229 at the maintenance line. calculator.net says the
  same in its own text. Mifflin as the default is right; the Harris-Benedict hint should say what the evidence says.
- *Where the multipliers come from.* The familiar 1.2 / 1.375 / 1.55 / 1.725 / 1.9 ladder has no primary source
  that could be found (Harris and Benedict measured basal metabolism only); its levels are exercise frequency, and
  1.2 is a bed-rest or respiration-chamber value, not a lifestyle. FAO/WHO/UNU 2004 defines whole-day bands
  (sedentary 1.40 to 1.69, active 1.70 to 1.99, vigorous 2.00 to 2.40) and works out example days: an office clerk
  with an hour of walking is 1.53; a standing job with walking and an hour of aerobic exercise 1.76, 1.64 without
  the exercise; manual farm labour 2.25. The Institute of Medicine's categories from doubly-labelled water:
  sedentary under 1.4, low active 1.4 to 1.6, active 1.6 to 1.9, very active 1.9 to 2.5. Measured free-living
  adults (Black 1996; Westerterp 2013) range from about 1.2 to 2.5, working-age adults averaging 1.70 to 1.75;
  total expenditure flattens at high activity (Pontzer 2016), so additive multipliers overstate the most active.
- *Steps.* Tudor-Locke's bands: under 5,000 sedentary, 5,000 to 7,499 low active, 7,500 to 9,999 somewhat active,
  10,000 to 12,499 active, 12,500 and over highly active; US adults average about 5,100 (pedometer) to 6,500
  (accelerometer) steps a day, "low active". Walking costs about 0.5 kcal per kg per km above rest (the ACSM
  equation; the literature spans 0.41 to 0.59), so Elie's 5,000 steps (3.75 km at 97.4 kg) are about 183 kcal net:
  Toufic's 180 exactly. In multiplier terms that is roughly +0.012 to +0.02 per 1,000 steps.
- *Double counting.* Every published framework already contains walking (FAO's sedentary day has an hour of it;
  the IOM defines its categories by walking equivalents), so adding step calories on top of any lifestyle
  multiplier counts them twice: Toufic's point, and correct. TB Gym does not add them; it picks one multiplier from
  work and steps. The real calibration risk is inside the table: "Physical" already implies steps, and v1's 2.20 is
  within 0.05 of FAO's subsistence farm labourer (2.25), which a nurse, a waiter or a retail worker with 12,000
  steps is not.
- *What the apps do.* All start from Mifflin-St Jeor; the multiplier is the weak, unpublished step everywhere.
  MacroFactor documents that a calculator's average error is about 325 kcal a day, above 500 more than a fifth of
  the time, the wrong multiplier alone 10 to 15 %. MacroFactor and Carbon hold the daily number and adjust it from
  logged intake and the weight trend after two to four weeks (Carbon treats 5,000 → 10,000 steps as a "minor change"
  the trend absorbs); RP Diet Coach anchors a weekly average on weigh-ins and scales each day by its step target and
  scheduled workouts. Carbon and MyFitnessPal describe daily life by job and movement and keep exercise separate;
  MyFitnessPal floors at 1,200 / 1,500 kcal as calculator.net does; Cronometer replaces its baseline with tracked
  activity through the day so nothing is counted twice; Trainerize and Everfit use Mifflin plus an unpublished
  activity coefficient; none shows the arithmetic the way TB Gym's breakdown does.
- *Worked numbers for Elie* (97.4 kg, 178 cm, 42, male, mixed work, 5,000 steps):

  | estimate | BMR | × | maintenance | −500 |
  |---|---|---|---|---|
  | TB Gym v1 as on his screen (Harris-Benedict) | 2,009 | 1.80 | 3,616 | 3,116 |
  | TB Gym v1 with the default Mifflin | 1,882 | 1.80 | 3,387 | 2,887 |
  | calculator.net's default (Mifflin, "Moderate" 1.465) | 1,882 | 1.465 | 2,756 | 2,256 |
  | calculator.net with Harris-Benedict, "Moderate" / "Active" | 2,009 | 1.465 / 1.55 | 2,943 / 3,114 | 2,443 / 2,614 |
  | calculator.net "Very active" (Mifflin / Harris-Benedict) | | 1.725 | 3,246 / 3,466 | 2,746 / 2,966 |
  | FAO's office-clerk day (seated, ~6,000 steps, no exercise) | 1,882 | 1.53 | 2,879 | |
  | FAO's active day without its exercise hour (standing job, walking) | 1,882 | 1.64 | 3,086 | |
  | Proposed v2: mixed, 5,000 to 7,499 steps, 4 workouts a week | 1,882 | 1.68 | 3,161 | 2,661 |
  | Proposed v2, no workouts | 1,882 | 1.60 | 3,010 | 2,510 |

  TB Gym's 3,616 sits between calculator.net's "Very active" and "Extra active" with the older formula, for a man
  who takes the US average number of steps and whose training is not an input. Every other line puts his
  maintenance between 2,756 and 3,466, and 3,116, the "cut", sits inside that spread: a 500 kcal cut from 3,616 may
  be no cut at all. Against the FAO-anchored days it is 530 to 740 kcal high.

**Assessment.** T46 is right, with high confidence, on the symptom (a band 5,000 steps wide, so every mixed-work
client he tried landed on the same cell, with no words for the number) and on the substance (1.80 is FAO's active
band, whose own example is a standing job plus daily exercise; v1 gives it to a mixed job with "low active" steps
and no exercise counted, and Harris-Benedict adds 6.8 % on top). He proposes no model of his own; the calculator he
points at would give plausible numbers for the wrong reason. T47 is partly right: walking calories must never be
added on top, and the screen does not say what the steps do, so his fear is reasonable; but steps are not added,
they choose the multiplier, which is the better model and must stay (a coach who knows a client's steps has better
information than "exercise 4-5 times a week"); his "≈ 180 kcal extra" has the right number and the wrong word. T48
is partly right: a good reference for presentation (a default formula with a stated reason, every goal with its
weekly rate and share of maintenance, plain-word levels with printed definitions, caveats and floors), a poor one
for the model (exercise-frequency levels with hidden multipliers of undocumented origin, no steps, no job, a
pre-selected "Moderate", text that contradicts itself); copying its levels would contradict NUT-007 ("activity/steps
… must be explicit") and ADR 0008.

**Alternatives considered.** Keep v1 and add words (cheapest; rejected, the number stays implausible). Replace the
model with the 1.2 to 1.9 ladder (familiar; rejected as the default: undocumented, ignores job and steps, against
NUT-007; kept as a coach override). The FAO factorial method as the screen (the official method; asks a 24-hour
time budget per client; used to calibrate, not as a screen). An additive per-kilogram steps model (neat; counts the
job's own walking twice and hides the FAO frame; used only for the optional sentence). Adaptive expenditure from
intake and weight trend (the only thing that beats ±300 kcal; needs logging and a coach-facing design; the
follow-up, not instead of a sane start). A recalibrated lookup with finer bands, a small training term, words, a
live preview and a collapsed override: recommended, because it keeps ADR 0008's shape (work × steps → FAO band) and
fixes the calibration.

**Recommendation** (new work outside the go-live row, so it starts only on the owner's go).

- **`OccupationStepsPal` version 2** (v1 stays for every snapshot already made and keeps its own reference test;
  append-only). Inputs: kind of work in four kinds, since v1's "Physical" spans a waiter and a farm labourer (Seated
  "a desk, driving"; Mixed "up and about for part of the day"; On their feet "teaching, retail, nursing, serving";
  Heavy manual work "building, farm, moving loads"), steps a day in Tudor-Locke's five bands, and workouts a week (0
  to 7, prefilled from the client's program; the server records what was sent). A draft table anchored on FAO's
  worked days, the IOM bands and about +0.015 to +0.02 per 1,000 steps:

  | steps a day | Seated | Mixed | On their feet | Heavy manual |
  |---|---|---|---|---|
  | under 5,000 (sedentary) | 1.45 | 1.55 | 1.65 | 1.90 |
  | 5,000 to 7,499 (low active) | 1.50 | 1.60 | 1.70 | 1.95 |
  | 7,500 to 9,999 (somewhat active) | 1.55 | 1.65 | 1.75 | 2.00 |
  | 10,000 to 12,499 (active) | 1.60 | 1.70 | 1.80 | 2.05 |
  | 12,500 and over (highly active) | 1.65 | 1.75 | 1.85 | 2.10 |

  plus **+0.02 for each workout a week** (cap +0.14; an hour of lifting is 245 to 390 kcal net for a 97 kg man, so
  0.02 per weekly session is the conservative end). The whole value stays inside the existing 1.40 to 2.40 guard
  (at most 2.24); the FAO band label is derived as today; training is a small term on top of work and steps, never
  alone (ADR 0008). For Elie: 1.68 (mixed, 5,000 steps, 4 workouts) → Mifflin 1,882 × 1.68 = 3,161, target 2,661;
  1.60 → 3,010 without workouts. Every cell gets a reference test of its own, the derivation goes into an ADR 0008
  amendment in a few lines (with the override below, a science-policy change that belongs there too), and the
  mapping goes to the qualified reviewer the ADR already requires: Toufic plus a dietitian would be a fair pair,
  recorded by name and date; the reviewer may lift or lower the whole table by 0.05, and under ADR 0008 approves the
  display language as well (the band words, the floors, the "worth about 180 calories" line and the "about 0.5 kg a
  week" rate, which is its own named, versioned rule). The "always 1.80" symptom disappears with five bands and the
  training term; between bands the number moves by 0.05, which a coach can see and understand.
- **Formula.** Keep Mifflin-St Jeor as the default. Reword the Harris-Benedict hint from "An older formula some
  coaches still prefer." to "Older; less often within 10 % of a measured value than Mifflin-St Jeor, and runs
  higher for heavier clients." Keep Katch-McArdle and Harris-Benedict as explicit alternatives.
- **Words beside the multiplier, live and in the breakdown.** Under the three inputs, grouped as "How active they
  are", a line that updates as the coach types: "Counts as low active: × 1.68 (mixed work with 5,000 steps a day
  × 1.60, plus 4 workouts a week + 0.08)". The preview comes from the server (a preview call, or the table served
  with the sheet), never a copy of the table in Angular, since the backend is the source of truth. In "How this was
  worked out": "Times 1.68 for how active they are: mixed work and 5,000 steps a day (low active) × 1.60, 4 workouts
  a week + 0.08". An optional muted line, the honest version of Toufic's note: "Their 5,000 steps are inside that,
  worth about 180 calories a day at 97 kg." (display-only `WalkingCost v1`: 0.5 kcal × kg × km at 0.75 m a step,
  rounded to ten; never added, never stored). Never "extra". The steps field's help: "From their phone or watch on a
  normal day, work included. Walking is counted inside the multiplier, never added on top."
- **Warnings, not refusals,** as the protein warning works: a target below the resting estimate, and below 1,200
  (women) or 1,500 (men) kcal a day, the floors calculator.net and MyFitnessPal both use; the coach decides.
- **Borrow from calculator.net:** the goal picks say their rate and share ("−500 a day ≈ 0.5 kg a week, 84 % of
  what they burn", said as "about"); an anchor above the chain ("They burn about 3,161 a day; 2,661 is the target");
  plain words with examples for the levels; the caveats as warnings; the formula hint that names the evidence.
- **The coach's own multiplier as a collapsed override,** like the Formula control: "Or choose the multiplier
  yourself", a list from 1.4 to 2.4 in plain words ("1.4 little movement, no exercise" … "1.9 very hard training
  daily or heavy manual work") or a typed value inside 1.40 to 2.40 (the ladder's 1.2 and 1.375 refused in words as
  below the FAO guard), recorded as its own activity model (`CoachChosenPal v1`) with the words and an optional
  reason, append-only like the macro override. Toufic's generation of coaches gets the familiar ladder without it
  becoming the default.
- **Do not copy:** exercise-frequency levels as the model, the pre-selected "Moderate", hidden multipliers, the
  zigzag schedules, floors as refusals.
- **Follow-up, not this slice:** the weight-trend check. After two to three weeks of a running plan, the client's
  Nutrition tab reads the bodyweight trend against the rate the goal implied and what was logged, and says "eating
  about 2,650 a day, their weight moved −0.2 kg a week; they seem to burn about 2,850", with a suggested change the
  coach accepts or ignores. The only way past the ±300 kcal of any formula; both inputs already exist.
- **Demo and docs.** Rebuild the Atlas demo's calculations with v2 so no coach sees a 1.80 for a mixed-work client,
  and show Mifflin, not Harris-Benedict, on example screens. A few lines each in the DOMAIN-RULES Phase 4 decision
  (where `TdeeMultiplication v1` should also be aligned with the code's `BmrTimesPal`), the ADR 0008 amendment (the
  anchors, the override and who reviewed the mapping) and the UI plan's R5.3d1 note.

Confidence: the arithmetic, the cause of "always 1.80", v1 against FAO's own examples, Mifflin over Harris-Benedict
and what calculator.net does are high; the exact v2 cells and the 0.02 per workout are a draft for the reviewer
(0.02 to 0.03 is the evidence range); the kcal-per-step line is ±25 % with stride and pace.

### 3.5 Strength programming (T29 to T35, T42, T43, T44)

**What is true today.** Set types are Warm-up, Normal, Top, Back-off, Drop, Failure; only Warm-up carries a rule
(left out of summaries, progression, week-1 anchors and the logged-set suggestion); the client's player already
says "Working set". The grid's one-line summary takes the load and effort from the **first** working set, so his
"set 1 RPE 5, set 2 RPE 10" read "2 sets · RPE 5"; the set editor, the publish preview, the session sheet and the
player all list sets individually. Load modes: No prescribed load, Direct load, % training max, RPE · RTS chart,
RPE · Epley curve. The RTS chart covers RPE 6.5 to 10 by 1 to 12 reps and is never extrapolated (STR-010, locked by
a reference test and cross-checked against Helms 2016); the Epley-shaped curve refuses reps + RIR above 12
(STR-005); sets outside both take a typed weight ("Fixed load instead", folded under Rest, tempo & notes), a direct
load, or an RPE target with no computed load (reps 1 to 100). "Reps from" and "Reps to" each accept any number and
equal values read "10" everywhere. The builder never shows kilograms because a template has no client; the client's
training max per lift is entered at Assign program (only for lifts whose sets compute from a max, the server
refuses any other), lives in the program's own append-only chain (STR-011), is shown in the Training maxes panel,
and is only *suggested* by the client's logged sets (STR-012/013); Record a max writes history that pre-fills the
next assignment and nothing else; a client cannot record a max, they log every set's actual load, reps and RPE
(TRN-012/015/029).

**What the research says.** Training max and tested 1RM are two standard, distinct numbers: Wendler's 5/3/1 keeps
the training max near 90 % and warns against raising it off one PR ("Training is NOT testing"); Juggernaut programs
off a lowered 1RM; TrainHeroic's coach-set working max stands for the athlete's one-rep ability, Everfit raises the 1RM
automatically from logged workouts with no review, TeamBuildr predicts and lets the coach lock: a per-athlete
reference number is standard everywhere; a deliberately reduced training max is one school (Wendler's). Nobody keeps
maxes in a reusable template; they belong to the athlete. RIR is judged within about half a rep near failure and misjudged by over a rep at 5 RIR
(Remmert, in Stronger by Science's review), which is why RTS stops its chart at 6.5 and Helms at 7. 1RM equations
lose accuracy beyond about 10 reps (Reynolds 2006: "no more than 10 repetitions should be used in linear
equations"; Mayhew 2008); Epley and Brzycki agree within 2 points at 12 reps and disagree by 13 at 20; reps at 70 %
of 1RM range from 6 to 28 between people (Cooke, via Stronger by Science). Fifteen-to-twenty-rep sets are legitimate
hypertrophy work (RP: 5 to 30 reps by RIR) and the practice there is an RIR target with the lifter choosing the
load. On notation, "sets × reps" with words for load and effort is the convention in every app; RTS writes "x4
@10" and Barbell Medicine's forum thread exists because readers got its shorthand wrong; "10x2" reads as ten sets of
two to anyone raised on "3x5".

**Assessment.** T29 right (with the nuance that the other four are working sets too). T30 right about the defect,
wrong about the fix. T31 not a bug: everything he asks for exists; the builder never says what the curve multiplies.
T32 partly: the box belongs on the assigned program, where it already is; the builder owes him the list of lifts
that will ask. T33 and T34 partly: the caps are right by the evidence; the refusals are dead ends and the typed
weight is hidden. T35 right and already permitted; the two boxes mislead. T42 partly: two kinds are necessary; the
sheet offers no way in from what he has in his head, a PR like "100 kg × 5". T43 not a bug: it is exactly how TB
Gym works, unexplained. T44 partly: the list is derived and enforced by the server; the rows owe him a why, and the
scroll is T39's bar.

**Recommendation.**

- Words: "Normal" → "Working" with the help "Top, back-off, drop and failure sets are working sets too; a warm-up
  never counts in the summary or the records". "% training max" → "% of training max", help "of this client's
  training max, set when you assign the program".
- The grid row: equal sets once ("3 × 5 · 75 % · RPE 7"); differing sets each on their own line under the row
  (the session sheet's rule), never an effort or load that only one set carries. Extra lines change R6.3's
  one-line-per-exercise decision of 2026-10-12, so the owner confirms (recommended: lines only when sets differ). Follow-up: show the chart's
  percentage on chart sets ("5 · RPE 8 · 81 % of training max") once the chart is available to the web.
- The builder header: a live "Needs a training max for: Back Squat, Overhead Press · set when you assign" from the
  same rule Assign program uses; the publish preview repeats it, and its last line says "Weights are worked out
  when you assign the program, from this client's training max. Clients log what they actually lift; their logged
  sets then suggest a new max you can apply."
- Refusals with buttons: the reps cap offers "Let the client pick the weight" (No prescribed load, RPE kept) and
  "Type a weight" (Direct load) and says why ("the formulas stop at 12 reps"); the RPE 5 to 6 refusal offers "Use
  the Epley curve for this set" and "Type a weight" and says why ("four or more reps from failure, where the
  chart's percentages no longer hold"). The caps stay; raising them is a strategy version and an owner decision
  that the evidence does not support.
- One Reps box accepting "10" or "8-12" (hyphen, en dash or "to"), stored as the two numbers (a single number
  stores minimum = maximum at entry; old prescriptions with only a maximum keep reading "up to 10"); the same in
  Edit weeks.
- Record a max: reword the two kinds ("Training max: the number a program's percentages use; 5/3/1-style programs
  set it at 85 to 90 % of the best single, others use the single itself" / "Tested 1RM: the heaviest single they
  actually lifted, on that day") and add "From a set they did: weight × reps (up to 10)": Epley v1 accepts up to 12
  reps (STR-005), so the 10 is a product choice Reynolds 2006 supports. The unused estimate endpoint the audit found
  (INV-9) becomes the calculation; recording the result as an Estimated 1RM observation with a calculation source and
  "Also set their training max at 90 % of it" are two new append-only server operations, the 90 % a named, versioned
  step whose record keeps the estimate's numbers. Nothing is typed as an estimate (STR-001 holds). Owner decision:
  90 % as the default (Wendler's starting point).
- One sentence on Record a max and the Strength history: "Programs don't read these directly: each program keeps
  its own training maxes, set when you assign it and updated from there." Assign program's own sentence covers the
  usual case too: the max carried from the client's last program ("Use 80.75 kg", STR-014), not only a recorded one.
- Assign program: each max row says why the lift is listed ("3 sets use % of training max in weeks 1 to 4"); the
  Training maxes fieldset moves above Load settings; filled rows fold to one line.

### 3.6 The exercise library (T22, T23, T24, T27)

**What is true today.** Cards / List are two word buttons styled exactly like the filter chips. "Archived too"
adds archived exercises to the live list (dimmed, tagged, Restore only); there is no archived-only view, while
Foods has one with a sentence and Check-in forms and Plans fold theirs under "Archived (n)". The library is
staff-only; no client route or API reads it; a client meets exercises only inside an assigned program, which is a
snapshot; MED-002's "full-library access" sentence is a reserved rule nothing implements. Type is a fixed enum
(Strength, Conditioning, Mobility, General) that only filters and labels cards; Equipment, Pattern and Muscle each
have "Other", Type does not; tags are free text searched with the name and the API filters by tag, which the page
does not expose. The card's video tile is `aria-hidden` with no action; the sheet's media row has no link; the
coach's demo sheet with "Watch on YouTube" exists but is mounted only in the builder and a client's program.
Provider thumbnails are not loaded on purpose (the CSP allows images from TB Gym only, and loading them would send
every library view to Google).

**What the research says.** Most icons need a visible label (NN/g: "always include a visible text label"; the kit
itself refuses an icon button without a name); the grid/list pair is better known than most icons but not
universal. Apps that archive converge on a separate archived view with restore (Exercise.com, CoachMePlus,
MacroFactor); Everfit's hide and delete are irreversible, Hevy and TrainHeroic delete only, so TB Gym's append-only
archive is ahead of them and only its presentation is odd. No taxonomy anywhere has "Strength & Conditioning" as an
exercise type: ACSM separates resistance from cardiorespiratory (plus flexibility and neuromotor), Everfit's nine
modalities list Strength and Conditioning apart, Google Fit and Strava have neither as one item; "strength and
conditioning" is the NSCA's name for the profession. Competitors all let the coach preview the video from the
library entry (inline embed is the norm; TB Gym's "open on YouTube in a new tab" is the decided interim, with the
privacy-enhanced embed as a later step that needs CSP `frame-src`, a referrer policy that sends the origin, a
200 × 200 player and a fallback for videos whose uploader disabled embedding).

**Recommendation.**

- T22: the kit's segmented control, extended to take an icon per option (add `grid` and `list` glyphs), with the
  word beside the icon on wide screens and as the option's label on phones; a segmented track, not a chip, so a view
  choice and a filter never share a style; the choice stays in the address.
- T23: replace "Archived too" by "Your exercises" (default) and "Archived (n)" (shown while the count is above
  zero; the search answer gains the archived count), the archived view opening with "Archived exercises are left
  out of your pickers and of programs you build from now on. Programs already built keep them. Open one to restore
  it."; the API's `includeArchived` becomes a tri-state (active, archived, both). Write the rule once as a LIB line
  ("offered by no picker, rail, swap list, max recording or client view; programs, snapshots, records and history
  keep it; restored at any time; edited only after restore") and note in MED-002 that any client library grant
  excludes archived exercises.
- T24: do not merge. Rename General → Other (the column and the API carry the enum's name as text, so this is a
  data migration plus the wire value, not a label). Extend to Strength, Power, Conditioning,
  Mobility and flexibility, Balance and coordination, Warm-up and activation, Other, each with one line of meaning
  under the Type select ("Strength: a lift loaded for reps; feeds maxes and the RPE chart" ...). Expose tags as a
  fifth filter chip with counts. No AI. Owner decision: the full list or the minimum (General → Other plus Power).
- T27: the card's tile becomes "Watch on YouTube (opens in a new tab)" and the card menu gains the same item; the
  tile shows the link's own title and "YouTube" or "Vimeo" instead of "Video link"; the sheet's media row gets the
  link; the address comes from the server as the grant does today, never from the pasted text (the asset list the
  page reads carries no watch address yet, so it gains one: a small server change); the title stored is the
  provider's, optional and trimmed to the asset's 200-character bound, which amends MED-015's "first title" meaning;
  the link keeps A1's `rel="noopener noreferrer"`; a coach's own picture is preferred as the cover when one exists.
  The embed stays a later R-row.

### 3.7 Messages and check-ins (T15, T16, T20)

**What is true today.** On his build the Client check-ins page was a two-pane form with a bare list of names, no
search, and the opened review appended below everything with no focus move; A14b removed it (section 2), while the
client record's Check-ins tab and the review page that focuses its heading were already on his build (R4.3, 5 Oct).
The sidebar's Check-ins still lands on the forms library, and a check-in to review is reached from Today's queue, the
Clients list (which has the search) or a client's Check-ins tab. Messages' chips are All / Unread / Waiting for
reply with the server's counts (MSG-022): Unread = client messages past the coach's read cursor; Waiting = the
client wrote the newest message, read or not; a thread read and unanswered is waiting and not unread, which his
screenshot showed (2 and 4). Saved replies are a button under the message box inside an open chat (and in the
check-in review's reply box), opening the sheet where they are created, edited and deleted; no other entry; per
coach, 100 at most, plain text, no placeholders (MSG-023); the API is not tied to a conversation.

**What the research says.** Every help desk keeps "unread" and "unanswered" apart and names the second: Intercom
"waiting since" (ends on a teammate reply), Help Scout "Waiting" and "Waiting on Customer", Front "unreplied",
Zendesk Open versus Pending; coaching apps mostly stop at Unread, and Everfit's manual "Mark as unread" is the
hand-made substitute for "I read it, I still owe a reply". Management of saved replies outside any one chat is
common (WhatsApp Business under Tools, Intercom under Settings › Macros, Help Scout under Settings) but not
universal (Gmail and Everfit manage only from the composer); every product keeps the *use* in the composer, usually
behind "/" or "\". Revealing content out of sight with no focus move breaks the first usability heuristic and the
spirit of WCAG 2.4.3; an animated page scroll is the wrong remedy (disorienting, and off under reduced motion); the
right one is what main does: open the review where the coach looks and move focus to its heading.

**Recommendation.**

- T15: tell him the page is gone and where the review page always was; make the Check-ins section land on "To
  review" across clients (one row per submitted, unreviewed check-in of the clients the caller may coach, oldest
  first, with the client's face, the form, "Sent Mon 5 Oct · 1 day late", opening the review; a name search;
  "Nothing to review from clients with a plan" when empty, since CLI-018 leaves lapsed-plan clients out; the forms
  library as the section's second link), reusing the read Today already does, each client checked by
  CoachClientScope; record "next check-in to review after Mark reviewed" as its natural second step (already a C5
  follow-up).
- T16: keep both chips; rename "Waiting for reply" to "Needs your reply" and the row mark to "Needs reply"; say the
  difference once in the empty state ("Nobody needs your reply. Unread shows what is new since you last looked.")
  and in the chips' hidden legend. "Since Tue" on the row mark needs a new server field: the list carries the
  client's newest message, and the honest clock starts at their first unanswered one (Intercom's rule); renaming
  the chip also updates MSG-022's wording.
- T20: a "Saved replies" button in the inbox header (coach side only) opening the existing sheet in a manage mode
  (list, search, Edit on tap, New, Delete; no "use" since no composer is open; the unpaid-workspace refusal shown
  as on every write, ADR 0028); the composer's button stays; optionally "Save as a saved reply" on a sent message
  and "/" in the composer on a desktop keyboard (Help Scout, Front and WhatsApp use "/", Intercom "\" or "#"), which
  must never swallow a message that begins with a slash. Team-shared replies stay a later owner decision.

### 3.8 Team (T21)

**What is true today.** The Team page existed on his build (R5.2a, 10 Oct): the owner first, each coach with
initials, email, role, client count and join date, "Invite a coach" by email, pending invitations with resend and
cancel, "Remove from the team" moving their clients back to the owner; Reassign coach is on the client's profile;
each coach is a seat on the platform invoice. The only way to it is the sidebar's Settings (the last of eight
rows) and the Settings column's Team link; nothing else links to `/team`; the account menu has no Team. On his
window the sidebar's natural 673 px did not fit (the nav needs 484 px between a pinned brand and a pinned identity
row), so the Settings row itself sat below the fold; the zoomed scrollbar in his crop shows about 110 px hidden,
which is the Settings row, Products and the Business label.

**What the research says.** Every coaching app invites a coach by email and calls the thing Team (Trainerize,
TrueCoach, Everfit, PT Distinction, Hevy Coach) or Trainers / Staff (MyPTHub, Glofox, Mindbody); TrueCoach ("the
Team Icon" in the left sidebar), Everfit ("Team settings" from the sidebar) and Hevy Coach (a Team tab in the left
menu) give it a sidebar entry on pages that could be read; Trainerize, Mindbody and Glofox appear to as well, but
their help centres refuse automated reading. "Settings" is a catch-all label with weak information scent (NN/g), and the Android design guide's
definition of settings ("preferences ... low prominence because not frequently needed") does not fit people,
actions and money. TB Gym's rules (owner-only management, one coach per client, private chats, clients return to the
owner) are a subset of TrueCoach's; nothing in his request needs a new role.

**Recommendation.** A **Team** row in the sidebar for the owner only (Business: Products · Team · Settings), the
way Messages is shown by availability; Team leaves the Settings column (which keeps Name and region, Brand,
Nutrition, Billing and Undelivered notices) and becomes a first-class page at the same address; three lines on the page say how a team works (one coach per client, given from the client's profile;
coaches see and message only their own and their chats are private; a leaving coach's clients with access come
back to you and are told); no admin role, no coach permission (ADR 0026). The sidebar fits short windows: under
about 720 px tighten gaps and rows (28 → 16, 40 → 36, 24 → 16, 8 → 4), under about 640 px visually hide the three
group labels (not `display: none`, the headings must stay for screen readers), and where it must still scroll, a
thin dark-scheme scrollbar with a stable gutter (this is T1's fix, section 3.9). Optionally the owner's "Invite client"
becomes an "Invite" menu with "Invite a coach". Owner decisions: the seats line (the page can say "You and 2 coaches · 3 seats this
month" from the owner's billing read, and the invite sheet "They count as a seat from the day they accept", leaving
the amount to Billing, since a trial month is not invoiced, ADR 0028); a read-only team list for coaches (not
needed); a coach filter on the owner's Clients list (the natural next step, web-only: every row already carries the
coach).

### 3.9 Dialogs, menus, folds and the sidebar: the kit (T1, T8, T26, T37, T39, T40, T41, T44)

**What is true today.** The kit and shell files are byte-identical on his build and on main, except the menu's
touch size (A9) and one account-menu item (A16a), so all eight items are open on main. All three "dialogs" he
fought are the kit sheet: 640 px wide, at most 90 dvh tall, the body the only scroll container, so the end is always
reachable. Their action bar is sticky with `inset-block-end: 0` inside a body with 24 px padding, and Chromium
clamps a sticky box to the scroller's content box, so the bar is held 24 px above the sheet's bottom: it covers the
last 8 px of whatever precedes it (a line cut at its baseline, a help line cut in half), leaves a 24 px strip under
itself through which content passes while scrolling, and with classic Windows scrollbars the body's track runs
beside and below it. The repo already holds the working variant: eight other sheets (the kit's own EntryActions,
Invite a client, the intake edit, the product sheets, the legal publish, the platform sheets, the exercise sheet and
the food editor, whose own comment names the bug) compensate with `inset-block-end: -1.5rem` and sit flush; the four
with `0` are Start / Renew plan, Record payment, Assign program, Update maxes and Build next block. The repo's own
pictures at 1440 × 900 show the cut line on main (`artifacts/audit-a14a/screenshots/start-plan-chosen-1440.png`),
and the live check at 1366 × 660 reproduced it; A14a's in-flow calendar and select make these sheets taller, so they
scroll more often now, not less. The kit menu draws its list `position: absolute` inside the trigger wrapper, flips
only horizontally against the viewport, and never against a scroll container or vertically: the meal plan's week
grid (`overflow: auto`) clips the first column's day menu on the left (reproduced live: panel left 496 px, container
left 552 px, 56 px cut), and the exercise card (`overflow: hidden`) cuts its menu's bottom; in List view the row
clips everything but "Edit", so "Archive" is unreachable by mouse (reproduced live). Twelve screens share the
component. "Entries and corrections" is a native `<details>` whose `<summary>` is `display: flex`, which removes the
browser's disclosure triangle; the app has three fold looks at once across thirty folds in twenty-five templates (a
rotating chevron on Plans, Check-in forms and the publish preview; the native triangle on History, Strength and
Earlier targets among others; nothing on this one, Load settings, the maxes panel's folds and the client's "All
entries"), and no kit disclosure exists. The sidebar is 100 dvh with the brand and identity pinned and only the nav
scrolling, unstyled: the nav needs 484 px and the pinned parts 189 to 213 px, so a window under about 675 to 695 px
gets the browser's default light bar (15 px in today's Chromium) on the dark green; the owner's laptop window is
730 px tall, a maximized Chrome on a 1366 × 768 laptop at 100 % about 633 px, at 125 % scaling about 489 px.

**What the research says.**

- *Dialogs.* The ARIA Authoring Practices' modal pattern keeps focus inside, closes on Esc and, when content
  scrolls, focuses a static title first (the kit does this); the HTML standard caps a modal `<dialog>` at the
  viewport and scrolls inside it; Atlassian's and GitHub Primer's dialogs keep header and footer fixed and scroll the
  body: the footer belongs outside the scroll region. The cause here is CSSWG issue 3352, open since 2018: a sticky
  box inside a padded scroll container is constrained to the content box, and Chromium chose interop with that. The
  pinned Vercel guidelines: sticky footers must not cover the focused element. At 125 % scaling a 90 dvh sheet is
  440 px tall, so most forms scroll and the defect shows at the end of every scroll, which is why he met it three
  times in one session.
- *Menus.* The platform's answer to clipping is the top layer: the `popover` attribute (Baseline since April 2024;
  Chromium 114, Firefox 125, Safari 17) is not affected by a parent's position or overflow styling. Placing a
  top-layer panel beside its button needs CSS anchor positioning (partial in every browser, 87 % of users) or
  script. The Angular CDK overlay the kit already uses for sheets, dialogs and toasts renders every overlay as a
  native popover in the top layer by default and positions it against an origin with fallbacks and a push into the
  viewport; Angular Aria's menu draws its panel through the same connected overlay; Radix portals its menu to the
  body and avoids collisions by default. Only the kit's menu is not an overlay. Audit A14a's in-flow select and
  date field suit fields that grow inside a form, not a transient "…" menu on a card.
- *Folds.* NN/g's 136-participant first-click study: the caret is the only safe signifier, and with no icon people
  expect a tap to open a new page; the APG disclosure pattern is a button with `aria-expanded` and an arrow that
  points right, then down; MDN: a summary's triangle is a `::marker`, which exists only on `display: list-item`, so
  `display: flex` deletes it.
- *Drag.* NN/g: clear signifiers (handles, cursor, hover) and visible drop targets, menus as the alternative, and
  watch whether people try to drag; coach marks are dismissed unread and forgotten in about 20 seconds; repeated
  motion is "downright annoying" and "no animation at all would be the least distracting". WCAG 2.2.2 (A) requires
  pause, stop or hide for auto-starting motion over five seconds beside other content; 2.5.7 (AA) requires a
  single-pointer path without dragging (a menu, up/down controls, select-then-target). Trello offers Move from the
  card menu beside dragging; TrueCoach drags workouts by a dedicated icon.
- *Scrollbars.* Chromium 133 made the space-taking Fluent bar (15 px) the Windows default, with overlay bars "still
  being decided", so every Windows coach whose window is short enough sees it; Windows' "Always show scrollbars"
  setting governs Windows' own controls, not what a web page draws. MDN: `scrollbar-width: thin` keeps a usable bar
  and `none` is discouraged; `scrollbar-color` needs 3:1 between thumb and track; `scrollbar-gutter: stable` stops
  the labels shifting when a classic bar appears; `color-scheme` on an element recolours its own bars. NN/g: offer a
  real bar where an area scrolls, in the platform's look; custom widgets go unused.

**Assessment.** T1 right, his implied fix (make it look better) partly: the bar is a symptom of a sidebar that
stops fitting at about 675 px, which pushed Products and Settings below the fold (T21's "no Team" was sitting
there); its placement inside the nav region is correct. T8 and T26 right, cause confirmed; the List view is worse.
T37 right: a fold with no marker reads as a title, and the app shows three conventions at once. T39 right but not
for the reason he thinks: nothing was unreachable, the bar overlaps the last line. T40 right. T41 partly: his three
observations are exact, his fix (put the bar in the scroll) is not, since every reference keeps a dialog's actions
fixed while the body scrolls; what is wrong is where the bar sticks and that it sits inside the scroller at all.

**Recommendation.**

- Sheets (T39 to T41, T44): give the kit's modal surface a footer region outside the scrolling body (a `flex: none`
  sibling after the body, surface colour and top hairline, the safe-area padding moved to it, a submit button bound
  to the form by the `form` attribute); migrate the four broken sheets first, then the eight compensated ones and
  the kit's own entry actions, deleting the per-feature sticky rules, the negative margins and the 5 rem
  `scroll-margin` workarounds (the kit's established pattern, which Assign program lacks); a soft shadow on the
  footer while the body can still scroll (a sentinel at its end), a little extra padding before it; the short
  dialogs take the same footer. Stop-gap if the kit change must wait: `inset-block-end: -1.5rem` in the four files.
  Verify at 1440 × 900, 390 × 844, 1366 × 633 and 1093 × 489 with classic scrollbars, scrolled to the end: the last
  line whole above the footer, the body's scrollbar ending above it, the kit select's list and the date field's
  calendar opening without pushing fields under anything; the e2e that checks a refusal scrolls "above the sticky
  actions" moves to the footer. Small follow-up: size the sheet by the overlay container, not `100vw`, so a narrow
  desktop window with classic scrollbars does not get a sheet 15 px wider than the visible area.
- Menus (T8, T26): keep `app-menu`'s API and behaviour (label, items, chip, size, align, `chosen` after close,
  first item focused on open, arrows and Home/End, Esc back to the button) and draw its list through a CDK connected
  overlay anchored on the trigger: below-end, below-start, above-end, above-start, an 8 px viewport margin, push as
  the last resort, reposition on scroll, no backdrop, close on an outside pointer and on Esc, RTL aware, the dark
  mode copied to the pane as the sheets do; leave the CDK's popover hosting on, so no ancestor's overflow, scroll box
  or transform can clip it and it shows above an open sheet; delete `keepOnScreen()`. One change for twelve screens.
  Vitest for the position fallbacks and the outside click; photograph the card with and without tags at 1440, two-up
  at 390, List view, and Day 1's menu at 1440 and on a phone. When anchor positioning is Baseline, the same
  component drops the position strategy.
- Folds (T37): one kit disclosure on native `<details>/<summary>`: a row with the title, an optional hint and
  count, the kit's chevron at the end turning 180° when open (200 ms, none under reduced motion), `list-style: none`
  and the WebKit marker hidden so every browser draws the same chevron, a hover fill, the focus ring, a 44 px row,
  content created on first open as today. Adopt it first in the marker-less folds (Entries and corrections on the
  coach's Progress and the client's own page, Load settings, the maxes panel's two, All entries, the admin's
  preview), then the native-triangle and chevron folds, from a fresh grep (thirty today). Note it in the UI plan's
  kit list.
- Sidebar (T1, with T21): a short-window density step under about 700 px (group gap 28 → 16, rows 40 → 36, label
  gap 8 → 4, the sidebar's padding and gaps 24 → 16, the space's name kept to one line), computed to move the
  overflow threshold from about 675 to about 585 px, so a maximized Chrome on a 1366 × 768 laptop at 100 % shows all
  eight destinations, nine with Team, and no bar. Where it must still scroll (125 % scaling, very short windows):
  `color-scheme: dark` scoped to the sidebar so Chromium draws its dark bar on the green, `scrollbar-width: thin`
  with a light thumb at 3:1 on a transparent track, `scrollbar-gutter: stable`; never `none`; brand and identity
  stay pinned. Add 1366 × 633 and 1093 × 489 to the live sweep and the plan's definition of done, which photographs
  widths only. The owner can see Toufic's screen with Chrome's device toolbar at 1366 × 600.
- Drag (T9, T28): as in section 3.3. None of this touches a domain rule; the 36 px rows against the Figma-derived
  40 px are the owner's visual call.

### 3.10 The client's progress and profile (T36, T37, T38)

**What is true today.** For a blocked client the coach's Overview explains ("Elie's access is blocked. Their
training, progress and check-ins stay closed to you until you unblock them.") with a button to Service & access,
and Training and Check-ins say "You have blocked Elie, so ...". Progress is the one tab that says nothing: the
dashboard answers 404 (by design: a block is indistinguishable from an unknown client on that endpoint) and the
screen shows "The progress dashboard could not be loaded." with Try again (A10a), then the fold, whose Weight tab
says "Weights couldn't be loaded" and still offers Log weight, whose save answers 403 with no body and "The weight
could not be saved. Try again." The record already holds `IsCoachBlocked` for the header pill, so the tab can say
why without reading the progress API. The intake's About card shows the date of birth and height, never the age;
the starting weight is the first weigh-in (CLI-007) and is never labelled; the span read already returns the first
date.

**Recommendation.** The Progress tab reads the block from the record it already has and says "Elie's access is
blocked, so their progress isn't shown. Unblock them on Service & access." in place of the dashboard, hides the
entry fold, and the three entry sheets refuse with the same sentence if opened from elsewhere; the "Try again"
stays for real outages. The fold (T37) gets the kit's disclosure. Age and starting weight as in section 3.1.

---

## 4. Build batches

The owner chose what to build between 24 and 27 October 2026, on a decision page of sketches and in chat. The rows,
in order and with every decision, are in `docs/CRITIQUE-FIXES-2026-10.md`. The owner took this report's
recommendation everywhere except:

- Messages: one Unread filter with Mark as unread, as in WhatsApp, instead of two filters (his ask).
- Team: coaches get a read-only Team page.
- Today: "Client workouts this week" goes; money received, active clients and the owner's coaches take its place,
  with actions on plans ending soon or ended.
- Clients: a table the owner described (age and goal; status joined with the last 7 days; the plan with what's
  included, its price and its end; last check-in; last activity). The filter chips keep their words for now.
- Meal plans: deleting a day never moves later days, so inserting and duplicating a day go too; "Pick one of N" also
  shows the average macros.
- Profile: the starting weight is a record of its own, the first start and each comeback.
- Exercise types: Other asks for the coach's own name.
- Strength: a % set warns only when the chart says it cannot be done.
- Energy: version 2 is switched on only after Toufic and a dietitian have reviewed it.

---

## 5. Decisions for the owner

All decided; the plan's section 0 records each one. Still open: Toufic's answers on how long packs stay valid,
no-shows, cash for single sessions and mixed kinds of session (before B10b), and the review of energy version 2
(before B8c). Chats stay private from the owner, as ADR 0026 says (confirmed 2026-10-27).

---

## 6. For the test copy, before the next reviewer

- Set `TB_GYM_USDA_API_KEY` in Render's dashboard (free at api.data.gov); no redeploy.
- Redeploy the copy from main (auto-deploy is off; it still runs 15 Oct) and rebuild the demo on the day of a
  review, so no reviewer judges a frozen week.
- Tell the reviewer that media uploads are off on the copy and that "Block access" on a demo client makes their
  progress read-only (or build B6 first).
- Confirm with Toufic whether the macro PDF he mentions on page 8 is the owner's own plan document, NUT-008's source.
- After B8, rebuild the demo so no example shows a 1.80 multiplier or Harris-Benedict as the formula.

## 7. Sources

The research notes carry every URL (`critique/notes/research-R1.md` to `research-R9.md` in the session's
scratchpad, each with a verification section). The ones this document leans on most: Trainerize's auto-tag,
compliance, session-pack and credit help pages and its idea board; TrueCoach's dashboard, compliance, team and
products pages; Everfit's check-in dashboard, meal-plan, recipe, session-credit, sales-analytics, team and
saved-responses pages; CoachRx's Needs Attention and dashboard articles; Hevy Coach's dashboard and set-type pages;
TrainHeroic's compliance analytics and working-max pages; Fitr, MyPTHub, Kahunas, PT Distinction, Mindbody, Glofox,
TeamUp, Vagaro, Zen Planner help pages; Stripe's products and prices docs; Intercom, Help Scout, Front, Zendesk,
WhatsApp Business and Gmail help pages on unanswered conversations and saved replies; NN/g on dashboards, icons,
tooltips, progressive disclosure, drag-and-drop, coach marks, accordion icons, accordions, animation, scrollbars,
scrolljacking, information scent and hidden navigation; WCAG 2.2 (1.4.1, 2.2.2, 2.3.3, 2.4.3, 2.5.7, 3.2.2) and the
ARIA Authoring Practices (modal dialog, menu button, disclosure); the HTML standard's dialog styles, MDN on popover,
the top layer, summary, ::marker and the scrollbar properties, CSSWG issue 3352, Chromium's Fluent scrollbars intent,
the Angular CDK overlay and Angular Aria menu guides, Radix, Atlassian's and Primer's dialogs, caniuse on anchor
positioning; FAO/WHO/UNU 2004 (Human energy requirements, chapter 5), Frankenfield 2005, Roza and Shizgal 1984,
Tudor-Locke 2004 and 2011, the IOM 2005 activity categories (Gerrior 2006), Black 1996, Westerterp 2013 and Pontzer
2016 on measured expenditure, the ACSM walking equation, calculator.net's page and the MacroFactor, RP, Carbon,
Cronometer, MyFitnessPal, Everfit and Trainerize help centres on how they start and adjust; Lally 2010; Sperandei
2016; Horn 2022 and Williamson 2015 on weight-change baselines; Gourville and Soman 1998; DellaVigna and Malmendier
2006; Royer,
Stehr and Sydnor 2015; Charness and Gneezy 2009; Morton 2018; Jäger 2017 and Kerksick 2018 (ISSN); Helms 2014;
Aragon 2017; the DRI macronutrient tables; Wendler, Juggernaut and RTS on the training max; Zourdos 2016 and Helms
2016 on RPE and RIR; Reynolds 2006, Mayhew 2008 and LeSuer 1997 on 1RM prediction; Shimano 2006 and Stronger by
Science on reps at a percentage; ACSM 2011 on exercise taxonomy; YouTube's required minimum functionality and
developer policies and Vimeo's terms on embeds.

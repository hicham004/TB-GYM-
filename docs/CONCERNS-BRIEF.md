# Concerns brief

Status: **running list, started 2026-10-14.** The owner asks a question, reports a problem or parks an
idea for later while using the app; each one becomes an entry here: what was seen, what the code does
today, a recommendation, and a status. This file plans nothing. An entry is built only when the owner
says so, and `docs/ROADMAP.md` keeps the order. Where an entry needs a business answer it says **Owner
decides**.

New entries go at the bottom, numbered C10, C11 and so on. Status is Open, Decided, Later, or Built with
the commit.
"Today" is read from the code unless the entry says it was also clicked through.

---

## C1 Rest, tempo and set note left empty

**Seen:** the builder's "Rest, tempo & notes" section on a set. Does an empty box get a default value?

**Today:** no. Empty stays empty and means "the coach said nothing".

- A new exercise's first set starts blank: 5 reps, no load, no effort target, rest empty, tempo and note
  empty (`emptySet()` in `src/web/src/app/features/training/training-builder.models.ts`).
- Empty rest is stored as nothing (null; the database accepts null or 0 to 3600 seconds). The client's
  phone shows no rest on that set, and no rest timer starts after they log it: `logSet` in
  `today-training.ts` starts the timer only when rest is above 0.
- Empty tempo and empty set note are stored as nothing too, and show nothing.
- The only thing that fills them is the **Add a set like the last** button: the new set is a copy of the
  previous one, rest, tempo and note included (`add()` in `program-sets-editor.ts`).

**Decided (owner, 2026-10-14):** a new set comes with a rest. The owner suggested 1:30 and left the
choice to me. I chose **3:00 for a main lift and 1:30 for every other exercise**: 1:30 is short between
heavy sets of a squat or a bench press, and the usual guidelines agree (ACSM 2009: at least 2 to 3 minutes
for heavy core lifts, 1 to 2 for assistance work; NSCA: 2 to 5 minutes for strength).

- Fill it in when a set is created from scratch, so the coach sees 1:30 or 3:00 in the box and can change
  it: `emptySet()` and `emptyExercise()` in `training-builder.models.ts`, which the program builder and
  editing a client's program both use (`prescriptionFor` and `addExercise` in `program-builder.models.ts`).
  Nothing is filled in when a program is read, and the API keeps accepting an empty rest.
- A new exercise always starts as not a main lift (`prescriptionFor` passes false), so ticking Main lift
  (`mainLiftChanged` in `program-session-editor.ts`) moves that exercise's sets still at 1:30 to 3:00, and
  unticking moves sets at 3:00 back to 1:30. Any other value stays, the way `renumberWeeks` leaves a week
  label the coach wrote.
- "Add a set like the last" keeps copying. Clearing the box stays allowed and still means no rest and no
  timer. Programs already saved keep their empty rests: no backfill.
- Tests: Vitest for the pre-fill and the main-lift switch.
- Later, only if coaches ask: a per-coach default in Settings.

**Status:** Built in 2828085 (2026-10-15). The box counts seconds, so the coach sees 90 or 180 there; the client's
screen says 1:30 or 3:00.

## C2 Tempo has no standard form

**Seen:** tempo is a plain text box; it should have a fixed shape like 3-1-1-0.

**Today:** free text. The box takes any 32 characters (`maxlength="32"` in `program-sets-editor.html`).
The backend only trims the text and caps it at 32 (`TrainingText.Optional` in `ProgramTemplates.cs` and
`TrainingMesocycle.cs`, `Text(...)` in `ProgramDrafts.cs`), and the database only caps the length too
(`ProgramTemplateSet.Tempo`, `SetPrescription.Tempo`, `WorkoutSetPerformance.PrescribedTempo`). So "slow",
"banana" and "3-1-1" are all saved, and the client sees them exactly as typed ("tempo 3-1-1" in
`today-training.html`). The repo itself disagrees on the shape: the tests use `3-1-1` (three slots), the UI
lab sample uses `3-1-1-0` (four).

**Decided (owner, 2026-10-14):** the standard form, enforced: "slow" or "banana" is refused.

- **The form:** four slots in seconds, joined by hyphens: down, pause at the bottom, up, pause at the top.
  Each slot is a digit 0 to 9; the down and up slots may be X instead (as fast as possible). So `3-1-1-0`
  is "3 s down, 1 s pause, 1 s up, no pause", and `3-0-X-0` is a controlled lowering and an explosive lift.
  Empty stays allowed (no tempo). Three slots like `3-1-1` are not accepted.
- **Builder:** one field that types the shape for the coach (digits and x only, hyphens added for them, x
  shown as X), with the hint "Down, pause, up, pause, in seconds. X = as fast as possible." An unfinished
  tempo shows an error on that set.
- **Backend, the source of truth:** one tempo rule in the Training module. The API answers 400 with a plain
  message for anything else, and a database check guards `ProgramTemplateSets` and `SetPrescriptions`.
- **Client:** the plain reading under the set ("3 s down, 1 s pause, 1 s up, no pause").
- **Old values:** assigning a template, Update maxes and Build next block copy each set's stored tempo into
  new rows (`ToBlueprint` in `TrainingApplicationService.Maxes.cs`, `ToRequest` in
  `TrainingApplicationService.Progression.cs`), so text saved before the rule would make them fail. Convert
  it once in the same migration: readable values to the form (`3-1-1` to `3-1-1-0`, `31X0` to `3-1-X-0`),
  anything else emptied, with its words added to that set's note. Template versions are otherwise
  immutable, so the migration says why it touches them. Finished workouts
  (`WorkoutSetPerformance.PrescribedTempo`) are history: left as they are, with no check. A saved builder
  draft holding old text shows the error on that set when published. Built before go-live, the old values
  are only dev and demo data.
- **Tests:** domain tests for the form and the conversion, API tests for the 400 and the database check
  against PostgreSQL, Vitest for the field and the plain reading.

**Status:** Decided, not built.

## C3 The set note never reaches the client

**Seen:** found while checking C1 (not reported by the owner): the third box, "Set note".

**Today:** the note is saved, copied into the workout when it starts
(`WorkoutSetPerformance.CoachNotesSnapshot`), and then goes nowhere. `ClientSetView` (`TrainingContracts.cs`)
has no field for it, `ToClientSet` in `TrainingApplicationService.Client.cs` does not pass it, and no client
screen shows it. Only the coach's Publish preview (`program-publish-preview.html`) displays it, so the
preview shows a note the client will not get. Read from the code; not yet clicked through as a client.

**Decided (owner, 2026-10-14):** yes, the client sees it. Show it on the client's set row, one line under
"Target: ...", and keep the preview as it is. A small slice: one field on `ClientSetView` (then
`npm run api:generate`), the line in `today-training.html`, API and Vitest tests. The coach's view of a
client's workout (`coach-workout.html`) shows session and exercise notes but no set notes either; give it
the same line.

**Status:** Built in 2828085 (2026-10-15): the client reads it under the set's target, marked like the coach's
note on the exercise, and the coach's record of the workout says "Set note".

## C4 Brand preview: say the Light/Dark switch only changes the preview

**Seen:** Settings, Brand. The Preview card has a "Show the preview in" switch, Light or Dark. A coach can
take it for the app's own light/dark mode.

**Today:** the switch only changes the picture, and nothing is saved. It starts in the coach's own mode
(`startingMode()` in `workspace-brand.ts`: their Appearance choice, or the device's) and lives only on that
page. The real mode is in Settings, Appearance (`/account/appearance`), and it is each person's own: "Your
choice follows you to every coaching space and device." Nothing visible on the Brand page says so; its only
description is a sentence for screen readers.

**Decided (owner, 2026-10-14):** add one visible line under the switch (the owner's words: "this is just a
preview, to change the light to dark mode move to appearance"):

> This only changes the preview. To switch your own screens between light and dark, go to Appearance.

- "Appearance" is a link to `/account/appearance`.
- Small text in the page's muted style, right under the switch; on a phone it wraps under it.
- Marked `i18n` like the rest of the page (`workspace-brand.html`, the preview head).
- Tests: Vitest that the line and its link show on the Brand page.

**Status:** Built in 2828085 (2026-10-15).

## C5 Counting calories: the two choices can't be compared

**Seen:** Settings, Nutrition, Counting calories. Is it US or EU? The labels don't make the choice clear.

**Today:** one option is named after a formula ("4/4/9 from the macros"), the other after a region ("As on
EU food labels"), and neither says how to choose (`workspace-nutrition.html`). What really differs is how
fibre, sugar alcohols and alcohol count (`AtwaterEnergyPolicy` and `Eu1169EnergyPolicy` in
`NutritionCalculations.cs`). Most foods come out the same either way; high-fibre foods differ a little
(porridge oats: 18 kcal per 100 g).

**Recommend:** name both by the labels they match, and say how to pick:

> Choose the kind of food labels your clients read, so the app's calories match the packet.
>
> - **US-style labels:** carbs include fibre; protein and carbs count 4 kcal a gram, fat 9. The usual way
>   in the US and in most apps.
> - **EU-style labels:** fibre is listed apart from the carbs and counts 2 kcal a gram; sugar alcohols 2.4,
>   alcohol 7. Used in the EU and the UK.
>
> Most foods come out the same either way; high-fibre foods, sugar-free sweets and alcohol differ.

Keep the line about saved foods keeping their calories. Use the same names wherever the choice shows
(`policyWords` in `food.models.ts` says "counted 4/4/9 from the macros" and "counted as on EU labels"). If
C7 is fixed, the US-style line adds "alcohol 7".

**Decided (owner, 2026-10-14):** as recommended; the owner asked only that it rest on research. Sources
for the facts in the wording: EU Regulation 1169/2011, Annex XIV (energy factors: fibre 2, sugar alcohols
2.4, alcohol 7 kcal a gram; the UK kept it); US 21 CFR 101.9 (total carbohydrate includes fibre; general
factors 4, 4 and 9). **Status:** Built in 2828085 (2026-10-15), with C7, so the US-style line says "alcohol 7" and
the closing line names only high-fibre foods and sugar-free sweets: both choices now count alcohol the
same way.

## C6 EU option: a label typed as printed gets too few calories

**Seen:** found while checking C5 (not reported by the owner).

**Today:** the food form always asks for total carbs, fibre included (the Carbs box's hint "Total, fibre
included" in `food-editor.html`; NUT-011 and ADR 0008 store total carbs). US labels print carbs that way,
but EU labels print carbs without the fibre, so a coach who copies an EU label as printed has the fibre
taken off twice. Porridge oats per 100 g on a typical UK label: protein 11 g, carbs 60 g, fat 8 g, fibre
9 g, 374 kcal. Typed as printed under the EU option, the app counts 338 kcal and the label check flags the
label as wrong; typed with carbs 69 (fibre added), it counts 374. ADR 0008's "the figure printed on a
nutrition label, so a coach transcribes a label without converting" holds for US labels only.

**Recommend:** under EU-style labels, the Carbs box asks for the carbs as printed (without fibre) and the
app adds the fibre before saving, so storage stays total carbs and NUT-011 is unchanged. The backend does
the adding (the request says which way the carbs were typed), not only the screen. USDA imports are already
total carbs and stay as they are. A reference test with the oats example; ADR 0008 amended in a few lines.

**Decided (owner, 2026-10-14):** fix it this way. Source: EU Regulation 1169/2011, Annex I (EU
"carbohydrate" is the carbohydrate the body digests, sugar alcohols included; fibre is defined and declared
on its own). **Status:** Decided, not built.

## C7 The 4/4/9 option counts alcohol as 0 kcal

**Seen:** found while checking C5 (not reported by the owner).

**Today:** `AtwaterEnergyPolicy` counts protein x 4 + carbs x 4 + fat x 9 and ignores alcohol, though the
food form has an "Alcohol (g)" box, USDA imports bring alcohol in, and recipes carry it. This is the default
option. A 100 ml glass of red wine (about 10.6 g alcohol, 2.6 g carbs) comes out at about 11 kcal instead
of about 85, and the label check then blames the label. NUT-008 already says the 4/4/9 policy must be
extended explicitly once alcohol is supported.

**Recommend:** count alcohol at 7 kcal a gram in this option too (Atwater's general factors include it),
as a new version, `Atwater v2`, for foods and recipes saved from then on; saved ones keep their calories,
as the settings page promises. Fixed reference tests (the wine example); NUT-008 updated.

**Decided (owner, 2026-10-14):** count alcohol at 7. Sources: FAO (2003), Food energy: methods of
analysis and conversion factors (Atwater's general factors: protein 4, fat 9, carbohydrate 4, alcohol 7
kcal a gram); EU Regulation 1169/2011, Annex XIV (alcohol 7). **Status:** Built in 2828085 (2026-10-15). A
migration moves each Atwater workspace's setting to v2; saved foods keep v1. Checked live: red wine
(USDA FDC 173190) now counts 84.92 kcal per 100 g against its 85 on the label.

## C8 The owner sees every client's private details

**Seen:** the owner remembered this as fixed: the owner should not see the private details of another
coach's clients. The Team page still says "you see every client".

**Today:** not fixed. It was discussed with Codex on 2026-10-10 ("no code, just answer"); nothing was
decided in the docs or built. The rule is still ADR 0026 and CLI-013: a Coach sees only their own clients,
the Owner sees every client, and only chats stay private. `CoachClientScope` restricts Coaches only, so the
owner opens another coach's client's workouts, food logs, check-in answers, weigh-ins, measurements and
progress photos (ADR 0011). Seen live on the Atlas demo: the owner's Today lists "Nour Hamdan sent a
check-in", coached by Lea Khoury, with a Review button. So the Team page's sentence is true today.

Codex's research that day (help pages of Trainerize, Everfit and TrueCoach): all three let an owner or admin
reach every client; TrueCoach keeps messages to the assigned coach. TB Gym matches them, so a stricter rule
is TB Gym's own choice, and one it can sell to privacy-minded clients. Where privacy law applies it leans
the same way: GDPR's data minimisation (Article 5(1)(c)) and its stricter rules for health data
(Article 9). This is a direction, not legal advice.

**Recommend** (revised the same day after the owner's points: the owner may not coach at all, a departing
coach's clients should not land on the owner, and a receptionist may be the one running the Today screen):
keep three things apart: who runs the business, who coaches a client, and who works the front desk.

- **Owner:** runs the business. For every client they see the business side: name, coach, plan and payment
  status, renewals, and activity counts (sessions done, check-ins waiting and answered), enough to oversee
  the coaches. The private side (training and food logs, check-in answers, weigh-ins, measurements,
  progress photos, intake answers) opens only to the client's own coach. An owner who coaches, like a solo
  coach, is simply the coach of the clients assigned to them; an owner who doesn't coach has none.
- **A coach leaving:** their clients wait for a coach instead of moving to the owner. Their program and meal
  plan keep running and they can still log; nobody opens their private side until a new coach is
  assigned; the owner's Today shows "clients waiting for a coach" first. The message those clients get
  today already says the workspace will assign a new coach (CLI-014). Their pending invitations wait the
  same way.
- **Front desk:** a staff login of its own with a business-only role: the business side of every client,
  and a Today screen of renewals, payments to record, invitations and clients waiting for a coach. It
  records payments, sends invitations and assigns a coach to a waiting client. No private side, no team or
  billing settings, and nobody shares the owner's password.
- **Never silent:** every coach change, including an owner taking a client, goes in the append-only coach
  history, and the client is told.
- **The build**, two slices, the first needed by the second:
  1. The owner's split and "waiting for a coach". `CoachClientScope` answers two questions (may manage, may
     coach) and every client route is sorted into one. A client's coach may be empty, so ADR 0026's "exactly
     one coach" becomes "at most one" and its database guards change with it. Coach Today, notifications,
     search, share cards and exports follow, and the Team page's sentence changes.
  2. The front-desk role and its Today.

  ADR 0026 is amended (a business decision). Integration tests: the owner and the front desk are refused on
  another coach's client's private routes and allowed on the business ones; a coach leaving leaves their
  clients waiting, with nothing deleted.

**Decided (owner, 2026-10-14):** this model, with the receptionist as the new role (called Front desk
here so it also fits a gym manager; the owner may name it Receptionist). An owner who coaches never gets a
departing coach's clients automatically: they take a waiting client by assigning it to themselves, like any
coach, and the client is told. Their own clients' details they see as today.

**Still open:** the two smaller choices, with my recommendation: the front desk assigns a coach only to a
waiting client, while moving a client away from their current coach stays with the owner; and a front-desk
login is free, since seats are priced for coaching. **Status:** Decided, for later; not built (two small
choices open).

## C9 Later: TB Gym as the coaching layer for gym chains

**Seen:** the owner's plan (2026-10-14): later, bring TB Gym to well-known gym chains, possibly a custom
build for each chain, because their apps only book classes and sessions and hold no programs or schedules.
The research below was done in a Claude web chat and pasted here; its sources are kept at the end, and its
facts about other companies were not re-checked.

**The research, in short:**

- The big Lebanese chains already have booking apps built by agencies: Fitness Zone (8+ branches and a
  Dubai club; In2uitions), Mercury Club Beirut (Cloud Systems), MUV Beirut (Progmanic, not updated since
  2021). They cover classes, PT booking, memberships and payments (Fitness Zone takes Whish and Neo). None
  covers the coaching itself.
- The Gym 247 Lebanon seems to run ABC Trainerize under its own name (read from a copyright line, not a
  confirmed contract): proof that a gym pays for coaching software. Trainerize's studio plan is about $248
  a month per location, a price benchmark.
- Smaller gyms use local front-desk tools: GymLeb ($25 to $70 a month: memberships, WhatsApp reminders,
  USD/LBP, turnstiles, Arabic), Compu-Vision and bearhouse. Fitness Force, a global gym CRM, entered
  Lebanon in May 2025.
- The pitch: "keep your membership app, add TB Gym as your PT and coaching layer", with online coaching
  packages and a payment and plan history owners can trust.
- What these gyms need most: local payments and easy renewals, keeping members, WhatsApp, Arabic, and data
  on what their trainers deliver.
- Its advice: the big chains are long sales with agencies already in place; win boutique gyms and PT
  studios first for case studies, and close Whish, WhatsApp and Arabic before pitching the chains.

**TB Gym today (checked in the repo):** Whish payments are recorded by hand (ADR 0028; Whish automation is
roadmap Step 5). WhatsApp is not built (`docs/ARCHITECTURE.md`: "WhatsApp is still not implemented"; a
roadmap item). The screens are ready for right-to-left and ship the Arabic font, but there is one English
locale (`en-LB`). One line of the research is out of date: "the owner sees everything" no longer holds after
C8. Say instead that the owner sees each client's plan, payments and coach activity, and that clients stay
with the gym when a trainer leaves.

**Recommend:** one product for every chain, not a separate build each, because a build per chain means
every fix shipped and tested once per chain. TB Gym already gives each workspace its own brand (name, logo
and colours). A chain would add what it needs as configuration: its own web address, its branches, and a
link to its booking app, so a member who books PT lands as that trainer's client. Two pieces need design
when this starts: a chain with several branches (today a workspace is one gym), and the link to each
chain's app, which depends on what its agency exposes. C8's front-desk role is part of being ready for
gyms.

**Owner decides, later:** when to start, and one product configured per chain (recommended) or custom
builds. **Status:** Later; not on the roadmap.

**Sources** (from the research):

- [Fitness Zone app (Google Play)](https://play.google.com/store/apps/details?id=com.in2uitions.fitnesszone&hl=en)
- [Fitness Zone Club (App Store)](https://apps.apple.com/lb/app/fitness-zone-club/id1669224863)
- [Fitness Zone Waterfront Dbayeh, Beirut.com](https://www.beirut.com/en/779069/fitness-zones-most-premium-gym-is-coming-soon-to-waterfront-city-dbayeh/)
- [Fitness Zone opens in UAE, Australasian Leisure Management](https://www.ausleisure.com.au/news/fitness-zone-opens-its-first-location-in-uae)
- [Mercury Beirut app (Google Play)](https://play.google.com/store/apps/details?id=tech.cloudsystems.mercury&hl=en)
- [Mercury Club Beirut site](https://www.mercurybeirut.com/)
- [MUV Beirut app (Google Play)](https://play.google.com/store/apps/details?id=com.muvfit.gmindplus&hl=en_US)
- [The Gym 247 Lebanon (App Store)](https://apps.apple.com/app/id6449500502)
- [GymLeb](https://gym-leb.com/)
- [Compu-Vision gym software](https://www.compu-vision.me/product/126/)
- [bearhouse gym platform](https://bearhouse.io/lb/platforms/gyms)
- [Fitness Force enters Lebanon](https://www.fitnessforce.com/blog/fitness-force-enters-lebanon-to-revolutionize-the-fitness-crm-industry-cmaypcxit0069qcb4pfy8qxjp)
- [Trainerize pricing, Costbench](https://costbench.com/software/gym-management/trainerize/)
- [Muscle Plus on the Lebanese gym market](https://musclepluslb.com/blog/bulk-supplement-supply-for-gyms-lebanon/)
- [Executive Magazine: four top fitness centers](https://www.executive-magazine.com/tourism-and-hospitality/burning-the-fat)
- [Inside the Lebanese Fitness Industry, Active Management](https://activemgmt.com.au/inside-the-lebanese-fitness-industry/)

## C10 Recipe photo: too big in the editor, and no way to choose what shows

**Seen:** the recipe editor's photo fills the page, and the coach can't move or crop it; it just shows
centred.

**Today:** the editor's photo box is 4:3 with the image filling it from the centre (`.photo` in
`recipe-editor.scss`: `aspect-ratio: 4 / 3`, `object-fit: cover`). From 56rem of width the photo sits in a
side column about 20rem wide, but below that the layout is one column with the photo first, so it
stretches across the whole width (about 975 x 730 px in the owner's screenshot) and pushes the form down.
The same photo is cut differently elsewhere, always from the centre: 16:10 on the recipe list
(`recipe-list.scss`), 4:3 on the client's recipe sheet (`client-recipe.scss`), a small square in the
client's Today (`today-nutrition.scss`). The only actions are Change photo and Remove. The photo is
`RecipeVersion.PhotoMediaAssetId` (ARCHITECTURE.md), and client plans copy it (NUT-006).

**Recommend:**

- **Smaller preview:** in one column, cap the photo's height (about 16rem) instead of letting 4:3 fill the
  width, so the form stays in view.
- **One shape everywhere:** the editor, the recipe list and the client's sheet use the same ratio, so the
  preview shows what clients get.
- **Choose what shows:** the coach drags the photo inside its frame (or uses the arrow keys) to set the
  point that matters. It is stored with the recipe as two percentages, and every place that shows the photo
  uses it (`object-position`). The original file is never changed, so any frame shape still works. A zoom
  can come later if coaches ask; a real crop that rewrites the file is not needed.
- **Backend:** the point is part of the recipe version (0 to 100, checked by the API and a database
  check), and client plans copy it with the photo.
- **Tests:** Vitest for dragging and the arrow keys, an API test for the range, and a check that a client
  plan's copy keeps the point.

**Decided (owner, 2026-10-14):** as recommended: the coach drags the photo to centre what matters, and
the preview gets smaller so it doesn't take the page. **Status:** Decided, not built.

## C11 Check-in forms: a draft can't be deleted

**Seen:** Check-ins, Check-in forms. The owner started a draft (version 2) to change a published form and
found no way to delete it. Asked for a delete button that makes clear what it deletes.

**Today:** a draft can be edited or published, nothing else (`checkin-forms.html`), and the API has no way
to remove one (`CheckInEndpoints.cs`: create, edit and publish a version; archive and restore a whole form).
A form holds at most one open draft (CHK-001, a partial unique index in `GymDbContext.CheckIns.cs`), and
"New draft from this" shows only while there is none. So an unwanted draft stays until it is published, and
starting a fresh one is refused ("This form already has an open draft version. Publish or edit that one.").
A draft is safe to delete: clients only ever get a published version (CHK-004), so no answer points at it.

**Decided (owner, 2026-10-14):** add the button, with words that say exactly what goes:

- A form with a published version: **Delete draft** on the draft's row, in the danger colour. The dialog:
  "Delete the version 2 draft? Its changes are lost. Version 1 stays published, and clients keep getting
  it." Buttons: Delete draft, Keep it.
- A form never published (its only version is the draft): the button reads **Delete form**, and the
  dialog: "Delete this form? It was never published, so no client has it. This can't be undone."
- Published versions never get a delete, since clients' answers point at them; Archive stays the way to
  retire a form.
- Backend: delete works only on a draft (a published version answers 409), for the same people who may
  edit forms, with the version's concurrency check; deleting a never-published form's only draft removes
  the form too.
- Tests: domain (only a draft), API (a published version 409, another workspace's form 404, a stale
  version 409), Vitest for both dialogs.

**Status:** Decided, not built.

## C12 Check-ins are not sent automatically

**Seen:** the owner asked whether check-ins go out weekly on their own.

**Today:** no. A coach sends each check-in by hand: one form, one client, one due date (CHK-004; kept that
way on purpose in R5.3e, 2026-10-10). Nothing repeats, and nobody is reminded: the notification catalogue
(`NotificationTemplates.cs`) has no check-in notice, so a client learns of a new check-in only by opening
their Check-ins, and nothing tells them it is due. The coach does see a submitted check-in on Today. The
demo's weekly check-ins exist because the demo script acts as the coach every week. The roadmap lists
"recurring check-in scheduling and reminders" as deferred. The research behind R5.3e: Everfit sends daily
and weekly check-ins on a schedule (Autoflow); Trainerize coaches are still asking for it.

**Recommend:** repeating check-ins, plus reminders.

- The coach picks a form, a client, how often (every week, or every two weeks), the day, and when to stop
  (the end of the client's plan by default).
- The server creates each one in the workspace's time zone, only while the client has check-in access
  (CHK-011), and stops when the plan ends, is paused, or the client is released or leaves. Each one is
  still an ordinary check-in (CHK-004 unchanged); the schedule only creates them, at most one per date
  (a unique key, so a retry never sends two). Each uses the form's newest published version at that
  moment, so an edit applies from the next one.
- Reminders: the client is told when a check-in arrives and on the day it is due (in-app, and by email
  once email notices are on); the coach's Today shows one that passed its due date without an answer.
- Tests: domain (dates in the workspace's time zone, a paused or ended plan stops it), API (wrong
  workspace, another coach's client), the Worker job's retry not duplicating, Vitest for the schedule
  form.

**Decided (owner, 2026-10-14):** repeating check-ins every week or every two weeks, with reminders. The
coach sets one up once per client; from then on the app sends each check-in by itself. Later, if coaches
ask: a coaching product carries a default schedule, so every client who buys it gets one without the coach
setting it up. **Status:** Decided, not built.

## C13 A coach has no Settings in the sidebar

**Seen:** signed in as Lea (a coach), the sidebar has no Settings; her own settings (Notifications,
Appearance, Password and security) open only from the avatar menu at the top right.

**Today:** the sidebar's Settings link is owner-only (`ownerOnly: true` on the `settings` destination in
`src/web/src/app/shell/coach-navigation.ts`) and points at `/workspace`, which `ownerGuard` keeps to the
owner. The Settings page itself already shows a coach only the Your account part.

**Decided (owner, 2026-10-14):** every coach gets Settings in the sidebar, showing only what a coach may
change.

- The link depends on the role: the owner's goes to `/workspace` as today, a coach's to their first
  account page (`/notifications/settings`, the top of their Settings menu). The same section paths keep it
  highlighted on every Settings page.
- Owner-only pages stay protected by `ownerGuard` and the API; the link is presentation only.
- Tests: Vitest that a coach's sidebar shows Settings with the coach's link and it is current on the
  account pages, and that the owner's is unchanged.

**Status:** Built in 2828085 (2026-10-15).

## C14 Coach Today's "This week" chart can't be opened and hides what matters

**Seen:** the "This week, 5 of 12 sessions done so far" bars. The owner: if it isn't clickable and doesn't
show the sessions not done or still to do, it's useless.

**Today:** the bars are a picture only (`coach-today.html`, `aria-hidden`, no click). Each day's bar is
as tall as its scheduled sessions and filled for the done ones, with future days hatched. A day shows no
numbers, a missed session looks the same as one still to come today (the unfilled grey part), and no
client is named. Screen readers get a hidden table of done and scheduled per day. "Needs you" only names
clients who missed 3 sessions in a row. So the chart adds little beyond the "5 of 12".

**Decided (owner, 2026-10-14):** make it clickable and show what isn't done.

- Each day is a button. It opens a sheet, for example "Monday 12 October, 3 of 5 done", listing that day's
  sessions by client in three groups: missed (a past day, not done, with Message), still to do (today and
  later), and done (with the workout and the time).
- The bars say more on their own: each shows its count ("3/5"); missed sessions get their own warm colour
  instead of grey, still-to-come stays hatched, and a small legend names the three.
- The buttons carry the words ("Monday: 3 of 5 done, 2 missed"), replacing the hidden table.
- Who sees whom: a coach only their own clients (ADR 0026). Under C8 the owner's sheet shows attendance
  (who trained, who missed) but not the workout itself.
- Backend: Today's week figures have no names today, so a day's sessions come from a read scoped by
  `CoachClientScope`, with API tests for another coach's client and another workspace.
- Tests: Vitest for the sheet's groups and the buttons' words.

**Status:** Decided, not built.

## C15 Later: a public directory of coaches (a marketplace)

**Seen:** the owner's idea (2026-10-14): a library where a potential client scrolls through TB Gym's
coaches, opens one they like, sees their programs and joins. Like ClickCoach, but with the programs and
the whole coaching behind it. Asked how easy it is, and how TB Gym could benefit from ClickCoach.

**What exists elsewhere** (web search, 2026-10-14):

- ClickCoach (Click Coach S.A.L., Beirut; first release January 2026, few ratings yet): an app to find and
  book sports coaches by sport and place, at home or at a venue. A coach's profile shows sports, venues, a
  price per hour (for example $30), certifications, experience, languages, reviews and sessions done;
  booking happens in the app. No programs, check-ins or progress: it finds coaches, it doesn't run the
  coaching.
- Future (US) matches a client with a remote coach for about $149 to $199 a month. Playbook lets creators
  sell programs by subscription and keep about 80% of net revenue.
- No public coach directory turned up for Trainerize or Everfit; they sell tools to coaches only.
- Marketplace money: commissions run about 10 to 25%. The hard part is starting both sides at once: one
  coaching marketplace offered for sale had 549 coaches, 373 users and no revenue.

**TB Gym today:** clients join only by invitation; there is no public coach profile; programs are private
to the workspace; payments are recorded by hand (Whish automation is roadmap Step 5). Pieces to reuse: the
public website module and its rate-limited form (ADR 0037), pre-rendered pages, workspace brands, products
and offers (packages and prices), programs, and invitations.

**Recommend, in this order:**

1. Not before go-live: coaches come first, as planned.
2. An opt-in public page per coach: photo, bio, sports, city or online, languages, certifications,
   packages with prices, a program outline (its structure and one sample week, never the whole program,
   which is the coach's work), and a **Request coaching** button. A request lands on the coach's Today;
   accepting sends the normal invitation. Coaches share the link on Instagram and WhatsApp, so each brings
   their own visitors and the empty-marketplace problem never starts.
3. The directory itself (search by sport, city, online, language and price) once enough coaches have a
   page, say 30 to 50 in Lebanon.
4. Paying through TB Gym, and a commission, only after Whish automation and a legal review.

Effort: steps 2 and 3 are about four or five build slices (the profile and its opt-in, the public pages,
the program outline, requests, moderation), plus an ADR for the new module and the owner's listing terms
(legal wording is the owner's, never invented). Step 4 is large.

**Using ClickCoach:** ClickCoach finds coaches but doesn't run the coaching; TB Gym runs it. So (a) a
partnership: ClickCoach coaches deliver programs, check-ins and progress through TB Gym, with a link or
badge both ways; (b) their listings are a ready list of Lebanese coaches to approach as customers; (c)
their profile fields show what local clients look for. Check who runs it before any deal: it is new, and
its publisher's name differs between listings.

**Owner decides, later:** when, and whether to start with the coach page (recommended) or the full
directory. **Status:** Later; not on the roadmap.

**Sources:**

- [Click Coach (App Store)](https://apps.apple.com/us/app/click-coach/id6749614324)
- [Click Coach on mwm.ai](https://mwm.ai/apps/click-coach/6749614324)
- [A Click Coach coach profile](https://clickcoach.app/coaches/hanna-kazan-gym-personal-training-coach)
- [Playbook creator agreement](https://joinplaybook.com/creator-agreement)
- [Future app review 2026, SensAI](https://www.sensai.fit/blog/future-app-review-2026)
- [A coaching marketplace for sale, Flippa](https://flippa.com/13029329-the-uber-of-coaching-fitness-coaching-marketplace-app-ios-android-connects-personal-trainers-clients-commission-based-live-in-production)
- [How to build a fitness trainer marketplace, LowCode Agency](https://www.lowcode.agency/blog/how-to-build-a-fitness-trainer-marketplace)
- [GoalMate, Contra](https://contra.com/community/A32HsWUY-explore-goal-mate-your-ultimate-sports-coaching)

## C16 Later: a marketplace for products (supplements, equipment)

**Seen:** the owner's idea (2026-10-14): a second marketplace inside TB Gym, for products such as
supplements and machines.

**What the search found** (2026-10-14):

- Supplements are regulated in Lebanon by the Ministry of Public Health: each product is registered before
  sale, only approved importers and distributors may bring them in, labels are in Arabic or French, disease
  claims are not allowed, and advertising (online too) needs the ministry's approval; online sellers also
  register with the Ministry of Economy. Most of this comes from a legal Q&A site rather than the ministry,
  so a lawyer must confirm it.
- Many sellers already exist: local online shops (some deliver and take cash on arrival), shops such as
  Nutritech ME in Hamra, classified ads, and bulk suppliers to gyms (Muscle Plus, in C9's sources).
- Supplement affiliate programmes pay about 3 to 20% of a sale (Bodybuilding.com 8% on new customers, GNC
  5%, iHerb 5 to 20%, Muscle & Strength 10%, Onnit 15%).
- Trainerize and Everfit don't sell products themselves; Everfit links to Shopify through Zapier at most.

**Recommend:** don't build a shop. Selling goods means stock, delivery, returns, payments TB Gym can't
take yet (Whish automation is roadmap Step 5), product registration and health-claim rules, and a coaching
app selling supplements to its own clients raises trust questions. If it is wanted later, in this order:

1. **Coach recommends:** a coach adds a product to a client's plan with a partner shop's link and discount
   code, and the client buys on the shop's own site. The licensed shop handles stock, delivery, payment and
   the rules; TB Gym or the coach earns a referral fee. The words say "your coach recommends", never a
   health claim. Small: one or two build slices.
2. **Equipment:** a partner deal for gyms (TB Gym introduces an equipment supplier to its gym customers),
   not a store.
3. A real store only after payments are automated, with legal advice, and only if step 1 shows clients
   actually buy.

**Owner decides, later:** whether to do step 1 at all, and with which shop. **Status:** Later; not on the
roadmap; lower priority than C15.

**Sources:**

- [Starting an online dietary supplement business in Lebanon, JustAnswer](https://www.justanswer.com/business-law/smlel-planning-start-online-business-selling-dietary.html)
- [MoPH: drugs and pharmaceutical-like registration](https://www.moph.gov.lb/en/Pages/0/8024/drugs-pharmaceutical-like-registration)
- [MoPH inspection of a supplement factory, LBC](https://www.lbcgroup.tv/news/lebanon-news/877059/lebanons-health-ministry-announces-inspection-results-for-food-supplem/en)
- [MazenOnline whey listing](https://mazenonline.com/en-iraq/products/diet-whey-high-protein-powder)
- [Nutritech ME supplement store](https://www.yocale.com/b/nutrifitech)
- [Lebanon nutritional supplements market, Insights10](https://insights10.com/report/lebanon-nutritional-supplements-market-analysis)
- [Bodybuilding affiliate programs, UpPromote](https://uppromote.com/blog/bodybuilding-affiliate-programs)
- [Fitness affiliate programs, Wellness Creatives](https://www.wellnesscreatives.com/fitness-affiliate-programs/)
- [Everfit on Zapier](https://Zapier.com/find-apps/e/everfit)

## C17 Company, tax and payments in Lebanon

**Seen:** the owner asked what a Lebanese startup does about the legal side and the accounting now that TB Gym
takes payments, what manual and then automatic Whish payments need, and how Lebanese businesses take Visa and
Mastercard online. The full research is a Claude doc,
[TB Gym: company, tax and payments in Lebanon](https://claude.ai/code/artifact/ef63cdf2-2128-4284-87c2-e7f2652920a1)
(2026-10-14, sources inside). It is research, not legal or tax advice.

**Today:** TB Gym's own income is recorded by hand: a workspace owner sends an invoice's exact amount by Whish
with its reference code, and the platform admin records one append-only payment (ADR 0028, PBL-001 to
PBL-007). The Whish number is a setting (`PlatformBilling:WhishNumber`) and is empty. Coach-to-client money
never passes through TB Gym: coaches record what they received (ADR 0005). Whish automation is roadmap Step 5,
and in-app client payments wait for a Whish agreement and a legal review. There is no printable invoice until
TB Gym has a legal name, address and Ministry of Finance number, and the terms, privacy policy and health
consent have no wording yet (ADR 0003, ADR 0006).

**Recommend:**

- Register a Lebanese SARL now, with the lawyer it must keep on retainer and an accountant before the first
  paid invoice. It limits the owner's liability and gives TB Gym the commercial register and tax numbers that
  Whish, banks and gateways ask for.
- Keep Whish manual for the founding coaches. Whish's terms keep a personal account to personal,
  non-commercial use, and the central bank's Basic Decision 13790 (9 January 2026) caps a personal wallet at
  $3,000 held and $10,000 a month coming in, against $30,000 and $50,000 for a registered company. After
  registering: a Whish business account, the Whish Pay agreement, then Step 5, which records a payment only
  after asking Whish for its status, through the existing payment row.
- No card gateway yet. When coaches ask, get offers from Tap (pays into a Lebanese bank) and Paddle (5% plus
  50 cents a payment, handles tax). Stripe does not serve Lebanon.
- Never hold clients' money for coaches: Decision 13790 makes that a licensed payment service (a Lebanese SAL
  with at least $279,330 of capital). Showing the coach's own Whish number to their client is the safe first
  step.
- A lawyer-written explicit health-data consent before real clients (Law 81/2018, Articles 91 and 97), and
  the business details Article 31 requires on the website.

**Owner decides:** the seven choices in the doc's "Your decisions" table, first the legal shape, when to
register and the trainer partner's stake. **Status:** Open.

## C18 Exercise videos: a YouTube or Vimeo link is saved but never plays

**Seen:** the owner asked whether a video can be added to a specific exercise (2026-10-15, while setting up
the Render test copy).

**Today:** yes for an upload, not yet for a link. Read from the code, not clicked through.

- New exercise and Edit in the exercise library (`exercise-sheet.ts`) take an uploaded picture or video (up
  to 500 MB, scanned before it is kept, MED-006) and a YouTube or Vimeo link. An exercise can hold several,
  in order (`ExerciseMediaLink`). Clients get "Watch demo 1, 2" on that exercise in their workout
  (`today-training.html`), the coach gets "Watch demo" in the builder (`exercise-demo.ts`), and an uploaded
  video plays inside the app.
- A link is checked and saved (one asset per video per workspace, MED-015) but never plays: the client sees
  "External video demos are not enabled for this beta" (`today-training.ts`) and the coach "This demo is a
  video hosted elsewhere, which can't be played here yet". ADR 0007 already names privacy-oriented embeds for
  these links; the page's Content-Security-Policy (`src/web/nginx.conf`) allows no outside player today.
- The Render test copy has no storage and no upload scanner, so exercise videos can't be tried there at all.
  On the laptop's development stack, uploads work.

**Recommend:**

- Now, small: a link opens the video on YouTube or Vimeo ("Watch on YouTube") instead of the error. Nothing
  from Google or Vimeo loads inside TB Gym, and the policy stays as it is. Vitest for both screens.
- Later: play links inside the app through the privacy-oriented players ADR 0007 names
  (youtube-nocookie.com, Vimeo with do-not-track), allowing exactly those two in the page's policy, with a
  note on what a client's viewing tells Google or Vimeo.
- For the trainer partner's filmed moves, uploads stay the better path: they play inside the app and no
  third party sees who watches. They need the go-live server (scanner and storage).

**Owner decides:** open links outside the app now, embed them later, or keep uploads only. **Status:** Decided,
not built (2026-10-19): a link opens the video on YouTube or Vimeo in a new tab now, embedding later; built with
the audit's fix batch A1 (`docs/FULL-AUDIT-2026-10.md`, section 0).

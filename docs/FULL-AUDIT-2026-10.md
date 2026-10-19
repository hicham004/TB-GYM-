# TB Gym full audit, October 2026

Branch `audit/full-audit-2026-10` from main at `3e27bd9` (2026-10-15). Audit day: Sunday 18 October 2026,
Beirut. Nothing in the app was fixed; the only code added is the live Playwright suite under
`src/web/e2e/live/` (section 10). Every finding was reproduced or re-read by a second agent before it went in;
what did not hold up is gone, and what was corrected is reported in its corrected form.

## 0. Fix status

The batches of section 11 as rows for `.\scripts\start-plan-runner.ps1` (the plan runner's audit plan),
built on the branch `audit-fixes` one fresh chat per row. A row is built as section 11 describes its batch,
minus what its third column leaves out; Batch 15 is split into A15 and A16. The owner's decisions of
2026-10-19 are in the third column; calls marked "the lead's call" were not asked and the owner may change
them. Waiting for the owner: the personal-record rule (after research), the allergen sentence, and where
and how often the live suite runs on a schedule; declined: plans running side by side (INV-7). A status
reads Open, Done · date · commit (plus "left out: …" when an item was left out), Built, not committed,
or Blocked.

| Step | What | The owner's decisions and what is left out (2026-10-19) | Status |
| --- | --- | --- | --- |
| A1 | Batch 1 · Green CI and an honest test copy | Video links (C18): a YouTube or Vimeo link opens the video on that site in a new tab ("Watch on YouTube") from the client's player and the coach's demo sheet; nothing from Google or Vimeo loads inside TB Gym and the CSP stays; the exercise sheet stops promising "Clients see it in their workout" for a link; embedding comes later. Left out: configuring email, the contact recipient and the Whish number on the test copy (the owner's accounts); showing confirmation, reset or invitation links to an owner or admin when email is off (the lead's call: a security trade-off not taken; the screens say plainly that email is off instead). | Open |
| A2 | Batch 2 · The session | "Keep me signed in" ticked keeps the sign-in for 30 days, renewed while it is used; unticked stays a browser session with today's 8 hours; "Sign out everywhere" and a password change still end it at once (AUTH-3). | Open |
| A3 | Batch 3 · Training rules that protect the record | Nothing to decide. | Open |
| A4 | Batch 4 · The workout player | Nothing to decide; the UI plan's big-target rule (its section 2, rule 6) sets the steppers' size. | Open |
| A5 | Batch 5 · Messaging | Nothing to decide. | Open |
| A6 | Batch 6 · Nutrition coach tools | EU-style labels (NCM-3) follow the concerns brief's C6 decision of 2026-10-14. Left out: the allergen sentence (NCM-8); the owner decides later. | Open |
| A7 | Batch 7 · Money and plans | Only a paid renewal counts as coverage: "Ending soon" and the plan's end on Coach Today ignore a renewal still waiting for payment (BEB-7; CLI-018 says so). A new or renamed plan cannot take the name of another active plan in the workspace; existing duplicates stay until renamed (BILL-7). | Open |
| A8 | Batch 8 · Coach screens and sheets | Coach Today shows a "Joined, start a plan" row for a new client with no plan, and the client list a "Not set up yet" chip for a client who never finished their profile (COACH-9, LOST-12; CLI-018 changes). | Open |
| A9 | Batch 9 · The client's Today, Training and Progress | A client may start a missed session of a running program late ("Do it now"); the coach sees it done late and it no longer counts as missed (CLIENT-12; TRN-020 changes). | Open |
| A10 | Batch 10 · Error words and the API contract | Nothing to decide. | Open |
| A11 | Batch 11 · Sign-up and the signed-out screens | The lead's calls: the signed-out screens stay light like the homepage and only the browser bar's colour follows them (UIQ-9); registration still says an email is taken (the accepted trade-off), while sign-in checks the password before saying an account is unconfirmed and confirm-email answers a bad code alike for every account (BEB-4, SEC-9). | Open |
| A12 | Batch 12 · Notices and words | Left out: the personal-record rule (CLIENT-8). The owner wants all-time records and decides after research; the current rule (ADR 0031) is already all-time per exact rep count, and a returning client's new profile starts without the old records. | Open |
| A13 | Batch 13 · Performance and the shell | Nothing to decide. | Open |
| A14 | Batch 14 · The kit everywhere, and the check-in pages | The check-in pages are redesigned without a preview round, after the other coach pages (a card list, assignment from a sheet on the client's Check-ins tab, empty states that invite); the owner judges the screenshots (AUTH-8). Page titles follow the UI plan (section 3 and the prototype gap it records): bold IBM Plex Sans, with Instrument Serif only for moments (greetings, summaries, empty-state headlines). | Open |
| A15 | Batch 15 · Tests and tooling | The tests and tooling of Batch 15 and the owners' dead-letter list (INV-4). Left out: where and how often the live suite runs on a schedule; the owner decides later. | Open |
| A16 | Batch 15 · The owner's extras | The legal consent pages: publishing a document version and an acceptance step at registration and invitation accept, asked only once a document is published, with no wording invented (INV-3). Cooking factors (INV-6); plans you sell measured in days (INV-7, not plans running side by side); the workspace's language on Name and region (INV-8). | Open |

## 1. The ten things to know

1. **Nothing critical, nothing leaked.** 929 security probes with legitimate accounts across two workspaces,
   134 screen-and-role combinations, 23 new live browser specs, and the full backend suite (1,432 tests)
   found no cross-workspace, cross-coach, released-client or unpaid-workspace read or write; every amount on
   the billing screens matched the hand calculation; the redesign holds on a 390 px phone, in dark mode,
   under every brand colour and at 200% text. The defects below are concentrated in a few flows.
2. **An ended session is never noticed** (WEB-1, high). After the 8-hour cookie, after "Sign out everywhere"
   or a password change elsewhere, every open tab blames the connection ("Clients could not be loaded.
   Check your connection"), shows a wrong empty state on Check-ins and loses typed work; only a reload
   reaches sign-in. "Keep me signed in" also means the same 8 hours (AUTH-3). A coach's every morning
   starts like this.
3. **Two training writes rewrite the client's record** (CLIENT-2 and TRAIN-3, high). Swapping an exercise
   back after logging a set under the substitute re-credits that set and its personal record to a lift the
   client never did; swapping a session for a saved session moves it to the saved session's weekday, so the
   client gets two sessions on one day and an empty one elsewhere.
4. **The workout player needs one focused session** (CLIENT-1, CLIENT-3, CLIENT-6, WEA-1 medium; UIQ-1 low).
   The kg/lb toggle empties every starting load and blocks Finish until a reload; a second device can never
   log again after one conflict; the steppers are 24 px on the one screen the plan says must have big
   targets; typed values are dropped on any navigation with no question; a finished workout's clock keeps
   counting. The set rows themselves are better than the prototype's.
5. **Chat loses its edits** (NCM-12, high; NCM-4, COACH-13, medium). A second or two after a message reaches
   the other side, Edit, Remove and "Remove as coach" fail with "This message changed since it was read"
   (the recipient's acknowledgement rewrites the row version); the unread badge counts messages the person
   is reading; after a reassignment the owner's old thread stays live for both sides while a coach's goes
   read-only as the rule says.
6. **Built, never wired to a screen** (NCM-1, high; INV-2, INV-3, INV-4, COACH-16). A coach cannot stop a
   meal plan assigned to the wrong client or dates, so the mistake stays on the client's phone until it
   ends; the manual macro override, the owner's dead-letter view, the client's coach history (which the
   Reassign dialog promises) and the whole legal-consent flow exist only as endpoints. Eighteen endpoints
   have no caller; the full inventory is in section 3.
7. **Promises a founding coach will test on day one** (WEA-2, LOST-1, BEB-1, BILL-2, BILL-5, LOST-3). "Clients
   see it in their workout" for a pasted YouTube link, and nobody can play or even open it; "Check your
   email" on a deployment where email is off (the Render test copy: a coach who registers can never sign in);
   "We'll get back to you" with no recipient configured there; "TB Gym will confirm the payment details with
   you" with no Whish number and no contact; "can use everything their current plan includes" for a client
   whose plan is unpaid, ended or cancelled; "Only you and your coach can see them" when the owner can too.
8. **Money is right, with two edges** (BILL-1, SEC-5). Seats, client coverage, discounts, voids, partial
   receipts, overpayment, currency and idempotency all behaved; but a receipt or a price with more than two
   decimals is rounded and stored instead of refused, and the table that holds a client's paid coverage
   dates (and the intake change history, SEC-6) lacks the append-only guard every sibling table has.
9. **The words are where the redesign still feels unfinished** (UIQ-2, AUTH-2, AUTH-15, COACH-12, TRAIN-5).
   Error states show "Failed to fetch" and server titles and three screens have no Retry; a locked-out or
   rate-limited person is told their password is wrong; plan and team notices say "workspace" and link
   nowhere; a dozen native date, select and time controls remain; the two check-in pages are still the old
   two-pane shape. Per screen, section 5.
10. **The baseline.** Backend 1,430 of 1,432 (two load flakes pass alone); web format, lint, build, 194
    Vitest files and `npm audit` green; but CI on main has been red since 2026-10-15 because the NU1903
    advisory on `Microsoft.AspNetCore.SignalR.Common` 10.0.11 fails the restore under
    `TreatWarningsAsErrors`. Bump it first. The lost-feature diff against the pre-redesign app found 147 of
    180 capabilities kept at the same reach, 23 buried, 7 missing (section 4).

The fixes are grouped into fifteen one-session batches in section 11, in the order to do them. Section 9
says what could not be tested and why; nothing in this report is claimed about those things.

## 2. How the audit ran

- **Branch and tree.** All work on `audit/full-audit-2026-10` from `3e27bd9` (main, 2026-10-15). The only
  repository changes are new test files under `src/web/e2e/live/`, the live Playwright config, two one-line
  edits so the mocked suite skips them, and this report. Nothing in the app was fixed.
- **Baseline, before anything else (2026-10-18, 14:51-15:56).** Backend: `dotnet build` Release and the
  full suite on the throwaway test PostgreSQL: 1,432 tests (592 domain, 55 architecture, 785 integration),
  1,430 passed, 2 failed under the load of the live stacks and passed alone afterwards
  (`ConcurrentDifferentTokensForOneGenerationAcceptExactlyOne`: an Npgsql connect timeout while its test
  database migrated; `AnythingThatIsNotAVerdictIsAnOperationalFailure("a clean verdict with a trailing
  space")`: a socket disposed during the fake clamd's shutdown). The build still warns NU1903 on
  `Microsoft.AspNetCore.SignalR.Common` 10.0.11 (GHSA-334f-vvp4-7g6p), which `TreatWarningsAsErrors` turns
  into a failed restore unless `-p:WarningsNotAsErrors=NU1903` is passed. Web: `format:check`, `lint`
  (including the legacy-style check), the production build with its pre-render checks, 194 Vitest files,
  and `npm audit` (0 vulnerabilities) all green.
- **CI on main.** The last run (3e27bd9, 2026-10-15) is red: the backend job fails at `Restore` on that same
  NU1903 advisory; the web job passed; the container job never ran. The two runs before it on main (a9dd425,
  b702cfc) also failed; the last green run on main is d83fd7c (2026-10-13).
- **The map.** 266 API endpoints across 19 endpoint files (CheckIns 21, Clients 19, ExerciseLibrary 5,
  Identity 13, Invitations 10, Media 10, Messaging 15, Notifications 8, Nutrition 44, PlatformBilling 11,
  Progress 29, Strength 4, Subscriptions 16, Tenancy 8, Training 49, Website 3, System 1), 46 Angular
  routes, 95 templates (66 at ae4f8e1), 6 background services, 3 CLI commands. The inventory agent
  classified every endpoint by policy, antiforgery, rate limit, read-only exemption and calling screen.
- **The live stack.** A fresh Atlas Performance demo was built from the audit branch into its own
  PostgreSQL database and cloned eight times, one copy per live agent (API, Worker and a static server that
  serves the built app exactly as nginx does, with the production security headers and CSP). Agents that
  changed data never shared a copy. Browsers were Playwright's Chromium, headless, at 390x844 (touch) and
  1440x900, in Asia/Beirut, light and dark.
- **The agents.** Round one: 6 code agents (endpoint inventory, lost-feature diff against ae4f8e1, two
  backend reviews, two web reviews with the repo's ui-review skill) and 8 live agents (coach flows, client
  flows, training tools, nutrition/check-ins/messages, billing and the platform admin, auth/invitations/
  website, security probing, UI quality). Round two: 6 verifier agents, each handed another agent's findings
  to reproduce or disprove on its own data and instances (202 findings: 182 confirmed as written, 17
  confirmed with a correction, 1 disproved, 2 duplicates, 13 severities lowered and none raised, 3 new
  findings of their own); what did not hold up was dropped or corrected below. The agents' full reports,
  scripts, raw API answers and about 2,400 screenshots are in the session's scratchpad; the paths quoted
  under Evidence point there.
- **Live Playwright specs added** (`src/web/e2e/live/`, run only when `TB_GYM_LIVE_URL` names a served app with
  a live API on a fresh demo): 23 files. Results on the fresh demo are in section 10.

## 3. The map: what the product can do, and who can reach it

### 3.1 Endpoints and screens

266 endpoints: 107 GET, 126 POST, 32 PUT, 1 DELETE. 159 change state; 156 of them validate the antiforgery
token (the three that do not are the two pure strength calculators and the signature-authenticated Resend
webhook); 68 carry a rate-limit policy and 91 do not (INV-10); 14 carry `AllowedWhileWorkspaceReadOnly`,
exactly the list the integration test `PlatformBillingTests.ReviewedReadOnlyExemptions` pins and ADR 0028
intends. Every tenant-scoped group names a policy; routes that reach a client without a client route
parameter ask `CoachClientScope` in their service (the inventory agent listed each site and the security agent
probed them: section 7).

Per module: CheckIns 21, Clients 19, ExerciseLibrary 5, Identity 13, Invitations 10, Media 10, Messaging 15,
Notifications 8, Nutrition 44, PlatformBilling 11, Progress 29, Strength 4, Subscriptions 16, Tenancy 8,
Training 49, Website 3, System 1. The full table (policy, antiforgery, read-only exemption, rate limit, purpose,
calling screen for every endpoint) is the inventory agent's Part A in the scratchpad.

**Endpoints no screen calls (18).** Person-facing and therefore hidden features:
- `POST /api/nutrition/clients/{id}/plans/{planId}/cancel`: the audited one-way cancellation of an assigned
  meal plan (ADR 0008, NUT-011). A coach cannot end or replace a wrong plan from any screen (NCM-1).
- `POST /api/nutrition/clients/{id}/calculations/{snapshotId}/macro-overrides`: the manual macro override
  NUT-008 promises ("manual coach overrides win"). The Targets sheet only calculates (INV-2).
- `GET /api/legal/documents/current`, `POST /api/legal/consents`: the whole legal consent flow. No document can
  exist, nothing asks for acceptance at registration or invitation accept (INV-3).
- `GET /api/workspace/notification-dead-letters`: the owner's dead-letter view ARCHITECTURE promises; no screen
  (INV-4).
- `GET /api/clients/{id}/coach-assignments`: the client's coach history with the owner's reassignment notes;
  recorded, shown nowhere (COACH-16).
- `GET`/`POST /api/nutrition/cooking-factors`: raw-to-cooked factors (the UI plan records the gap) (INV-6).
- `POST /api/strength/estimate-one-rep-max`: the Epley/Brzycki estimate STR-005 names; Record a max takes a
  typed tested max only (INV-9).
- Superseded by the drafts flow and harmless: `POST /api/training/templates`, `.../templates/{id}/versions`,
  `POST /api/nutrition/meal-plans`, `.../versions`, `.../meal-plan-versions/{id}/publish`; redundant reads:
  `GET /api/checkins/clients/{id}/assignments/{assignmentId}`, `GET /api/checkins/me/assignments/{id}`.
- Machine-facing by design: `POST /api/notifications/email/provider-events` (the Resend webhook) and
  `GET /api/system/status`.
There are no DEV-ONLY endpoints (the dev build's UI lab calls no API). Sixteen `ApiClient` wrapper methods
have no caller.

**Capabilities with no screen although the rules describe them** (inventory Part C): offer durations in
days and `allowsConcurrentCoverage` (both deliberately kept off screen per the UI plan), the workspace's
default culture (`DefaultCulture` is carried through `PUT /api/workspace` unchanged and no screen edits it),
and the owner's dead-letter view. The client's "leave" and a coach's "resign" exist but sit three clicks deep
under Password and security; a coach who resigns is never seen by the owner except as a notice.

**Routes nobody reaches by clicking:** `/changelog` for any signed-in person (the links exist only on the
homepage, which signed-in people never see) and `/account/appearance` for a client (Me has the same control
inline). Every `routerLink`, fragment and notification target resolves; no dead link was found.

### 3.2 Settings

- Workspace (owner only): name, time zone (searchable list), currency, week start (`PUT /api/workspace`);
  brand colours and logo (`PUT /api/workspace/brand`); energy policy, provider-calorie tolerance, AI requests
  and cost allowance capped by `Nutrition:AiAllowance` (`PUT /api/nutrition/settings`). `DefaultCulture` and
  `AiCostCurrency` pass through unedited.
- Personal: theme (staff on Appearance, clients on Me and Appearance), weight unit (clients only, Me),
  notification preferences (service email, quiet hours), password, sign out everywhere, leave the space
  (client) or the team (coach).

### 3.3 Background jobs and commands

Six hosted services: notification dispatch (Worker, every 5 s), action mail (Worker, every 5 s, four queues:
account mail, invitations, workspace notices, Talk-to-us), platform billing (Worker, every 15 min: invoices
for the previous UTC month and reminders), media purge (API, every 15 min), media inventory reconciliation
(API, daily, read-only, needs R2), realtime messaging publication (API, every 2 s). The first three have a
screen that shows their outcome (inbox, billing pages); purge and reconciliation have none and reconciliation
has no endpoint either. Three CLI commands: `platform-admin grant|revoke|list`, `send-test-email`,
`demo-workspace`.

Configuration that changes product behaviour and is empty or off in the committed defaults: email
(`Notifications:Email:Adapter = None`), media storage and scanner (None outside Development), the Whish
number, the Talk-to-us recipient, the WhatsApp number, analytics, the USDA key, Anthropic and the AI allowance
(zero). Several screens promise what these would do (section 4.2).

## 4. Lost, buried and URL-only, and the promises screens make

### 4.1 Before and after the redesign: lost, buried and URL-only

The lost-feature agent read every one of the 66 templates at ae4f8e1 with their components, enumerated 180
user-visible capabilities and located each in HEAD: **147 kept at the same reach (plus one partial), 23
buried (more steps or behind a disclosure), 7 missing, 1 dev-only, 1 replaced (the homepage)**; routes nobody
reaches by clicking: 2. The verifier re-checked 15 rows (every "missing" one among them) and corrected one:
the media list is buried, not missing. The full table is the agent's Part A.

**Missing (no screen path today; the API still has them unless noted)**
- A program's lifecycle history (assigned, renamed, cancelled with its reason, completed) was on the old
  client-training page; nothing in HEAD renders `lifecycle`, so a cancel reason is never seen again.
- The coach could record an "Estimated 1RM" by hand; Record a max now offers Working max and Tested 1RM only.
  Deliberate (the sheet's comment says an estimate is not something a coach types) and consistent with the
  server, which refuses typed estimates; recorded as a note, not a defect.
- The workspace's default language (en-LB / ar-LB) and its identifier left Name and region; the API accepts
  a culture and registration still sets one, so a workspace created with another culture cannot be changed
  from the UI.
- The record header's "Workspace calendar, time zone" line, the inbox Refresh and the preferences Reload
  buttons, and the player's "Refresh workout" after an error: all minor; the first is informational, the
  others were replaced by live reloads.

**Buried (worth a second look)**
- The clients list lost phone, email and onboarding status; "Not set up yet" is not one of the attention
  reasons, so a coach cannot see at a glance who never finished (two steps away on each record's Intake).
- The per-feature access reasons on Service & access became "What's included" chips plus one sentence; which
  feature is closed and why (no entitlement, pending payment, paused) is inferred from the plan pill.
- Pending invitations lost their count on Coach Today (the Invitations page says "Waiting to join N").
- The workspace-wide media list moved into every exercise sheet's More details, which lists each Ready asset
  with an attach checkbox and a delete, so a video can be attached to a second exercise; what is gone is the
  Pending and Tombstoned status and a page of its own. (The lost-feature agent called this missing; the
  verifier disproved that, LOST-11.)
- Nutrition settings moved from a coach page to an owner-only Settings page (deliberate, R4.4c).
- The rest are one extra click behind a menu, a sheet or a disclosure, which the redesign's rule 5 asks for.

**URL-only:** `/changelog` for every signed-in person and `/account/appearance` for a client (section 3.1).

### 4.2 What screens promise that the code or the configuration does not do

The lost-feature agent scanned every template for promise words; each row below was then verified, and the
last column names the entry in section 6 that carries the proof.

| Where | The promise | What happens | Finding |
| --- | --- | --- | --- |
| Register, forgot password, Invitations, Invite a client, Team, End coaching, Service & access | an email goes out | only with a provider; the committed default and the Render test copy have none, and sign-in refuses an unconfirmed account | LOST-1 (high) |
| Exercise sheet, exercise library empty state | "Clients see it in their workout" for a video link | the client reads "External video demos are not enabled for this beta"; the coach's preview says it cannot play here; no link either side | WEA-2 (medium) |
| Check-in photo step, photo sheet | "Only you and your coach can see them" | the owner sees every client's photos (CLI-013); the intake step words it right | LOST-3 (medium) |
| Homepage Talk to us | "We'll get back to you" | stored and emailed to `Website:ContactRecipient`, which production wires and the test copy does not; a send that fails four times is dead-lettered and no screen lists requests | BEB-1 (medium) |
| Billing, How to pay | "TB Gym will confirm the payment details with you" | with no Whish number configured there is no number, no contact and no link | BILL-2 (medium) |
| Service & access, Access line | "can use everything their current plan includes" | shown for no plan, an unpaid, an ended and a cancelled plan | BILL-5 (medium) |
| Exercise sheet on a 409 | "The library has been reloaded; try again" | nothing reloads; every retry resends the stale version | WEA-3 (medium) |
| Reassign coach dialog | "The current coach loses access, and their chat with the client stays readable to the client only" | not when the current coach is the owner | COACH-13 (medium) |
| Reassign coach dialog | "Kept in the client's coach history" | recorded, shown nowhere | COACH-16 (low) |
| Settings › Nutrition | "the app's calories match the packet" under EU-style labels | a label typed as printed is 36 kcal short and flagged (C6, decided, not built) | NCM-3 (medium) |
| Settings › Nutrition | "Your coaches can start a recipe from a description" | shown whenever TB Gym's AI ceiling is above zero; the recipe editor says AI is not set up | LOST-4 (low) |
| Sign-in | "Keep me signed in" | the same 8 hours either way | AUTH-3 (medium) |
| Name and region | "reminders follow this clock" | plan notices do; check-in and workout reminders do not exist | LOST-14 (low) |
| Me | "Emails from your coach and quiet hours" | the emails are TB Gym's payment, activation, renewal and plan-ending notices, not the coach's | LOST-C7 (low) |
| Talk to us, rate limited | "or write to us on WhatsApp" | no WhatsApp number or link exists | AUTH-4 (low) |
| Client Today (a hidden heading) | "Latest from your coach" | the client's own last message, never refreshed live | CLIENT-13 (low) |
| The UI plan itself (M1, R5.4c, §2 rule 6) | a duration on the hero card; every sheet asks before it closes; big targets in the player | no duration or week kicker; the Invitations and Team sheets do not ask; 24 px steppers | UIQ-16, COACH-1, CLIENT-6 |

Promises checked and found true: "Only you see this page" (Billing); "Only you can see it until you publish
it" (program and meal-plan drafts, the owner included); "Your client never sees this" (coach notes); "Only
your team sees it" (payment note); the before-and-after wording (PRG-013: who, when, pose, two photos, never
the picture); the share sheet's "TB Gym doesn't upload or keep it"; "Write to us on WhatsApp" appears only
when a number is configured; the notification settings say plainly when email is off; the Team page's "you
see everyone's" (CLI-013); "Your answers save as you go" (check-ins autosave and resume). No screen mentions
SMS, push notifications, attachments, voice notes, recurring check-ins, PDF or CSV export; "Print recipe" is a
real browser print.

## 5. Does the new UI give its best? Screen by screen

Method: 134 screen and role combinations (visitor; owner Karim; coach Lea; clients Maya, Jad, Elie, Lynn,
Karl, Rami, Nour), each at 390x844 and 1440x900, light and dark, with axe (WCAG 2.0/2.1/2.2 A and AA plus
best practice), a 320 px and 200% text pass, a right-to-left flip, a keyboard tour and the accessibility tree;
28 sheets and dialogs opened without saving; 15 screens pushed through loading, 500, network failure,
offline and long-content states; six brand pairs across eight screens in both modes; 11 pages timed cold,
warm and on Fast 3G with a 4x CPU slowdown; the three hero screens set beside the committed prototype.
About 1,700 screenshots: `scratchpad\shots\uiq\<screen>-<role>-<viewport>-<mode>.png`.

**The short version.** The redesign holds up far better than the "meh" the plan set out to cure. No screen
scrolls sideways at 1440, 390, 320 or at 200% text. Dark mode is complete and consistent on every signed-in
screen. All four brand presets and a custom pair keep AA contrast everywhere; only a deliberately bad
white-on-black pair drops the player clock to 3.94:1. Every sheet and dialog keeps the modal contract (label,
focus in, Tab held, Escape out, focus back, a question before typed work is lost), with the exceptions
below. axe finds one rule failing anywhere (`target-size`, four controls on the client's Progress, Training,
Security and Profile pages that sit under the sticky tab bar at the initial scroll and pass once scrolled).
One typographic slip runs through the coach's main pages: the root font stack names Inter, which is never
loaded, so Coach Today, Clients, Programs, Recipes, Plans you sell and Check-in forms render in the system
font while the rest renders in IBM Plex, and the Progress title falls back to Georgia (VER3B-NEW-1). The empty states of a brand-new
workspace invite the one action that fills them on every section except the two check-in pages. Where it
still feels unfinished is concentrated: error states that show "Failed to fetch", the player's small steppers,
a handful of 200% breakages, the two old-shaped check-in pages, and the hero screens' remaining gaps against
the prototype (no duration or week kicker on the client's hero card, no last-week comparison on the coach's
tiles, faces are initials everywhere because the demo has no photos).

| Screen | Verdict against the UI plan's quality bar (its §2) and screen specs (its §5) |
| --- | --- |
| Homepage, changelog | Strong. Pre-rendered, LCP 0.24 s cold and 1.3 s on Fast 3G, axe clean, reduced motion honoured, every link real. Stays light under a dark scheme by design. |
| Sign-in, register, forgot/reset, confirm, invite | Clean and accessible; but blank for about 5 s on Fast 3G (not pre-rendered, the whole initial bundle first), light-only while the browser chrome goes dark, and registration still asks for a raw IANA zone and a currency code with a native select. |
| Coach Today | The prototype's structure, one read, right sentences and one-action rows. Gaps: tiles carry no comparison with last week, the queue shows all 15 rows with no cap (the week chart drops below the fold), the "N need you" number disagrees with Clients, CLS 0.14 on every load (the shell arrives after the launch placeholder), heading and body drawn in the system font rather than IBM Plex (VER3B-NEW-1). |
| Clients, Former clients, Invitations | Match C2 and R5.3a. A Coach who opens Former clients is told to check their connection. |
| Client record: Overview, Training, Nutrition, Check-ins, review, Progress, Service, Intake | Match their specs; dark mode complete. Training: about 610 px of empty cream beside the maxes panel at 1440, CLS 0.37 as the panel arrives, native select and date input inside Assign program and the session sheet, the Strength history's lift cards split "Deadlift" mid-word at 200%. Overview: the week strip's day labels collide at 200% on a phone. Nutrition: the ring legend overlaps at 200%. Service & access: the Access line is wrong for ended, unpaid and cancelled plans. |
| Program builder, Edit weeks | Dense and consistent (R6.3); 238 controls all reachable; the library and recipe panels read the whole library on every open. |
| Exercises, Programs, Recipes, Foods, Meal plans, builder | Fine; cards are lettered tiles on the demo (no media). Foods: every USDA import carries a "Check" flag. |
| Check-in forms, Client check-ins | Still the old two-pane shape: a list and a pane that says "Select a form/client"; twelve bare names without faces; empty by default in a new workspace. The one coach section that reads system-shaped (review item U3, still open). |
| Messages (coach and client) | Matches C6/M7; the client panel, chips and day groups are right. 500 and network failures show "An error occurred while processing your request." or "Failed to fetch" with no Retry; the page title is serif while sibling pages are sans. |
| Notifications, settings | Fine as screens; the coach's inbox is a wall of 27 identical "left a note on a workout" rows over two months, never collapsed and never naming the workout; quiet hours are native time inputs. |
| Products, Settings (Name and region, Brand, Nutrition, Team, Billing, Appearance, Security) | Good. Billing keeps TB Gym's colours under every brand. |
| Client Today | Close to the prototype: hero card, week strip, Also today, coach message. Missing the duration and the "Week 4 of 6" kicker the spec names; the coach message card shows the client's own last message under "Latest from your coach"; CLS 0.21 cold / 0.34 on Fast 3G as the lower cards arrive. |
| Workout player | The set rows are denser and more legible than the prototype's and the Target line is a plus. But: the kg/lb toggle wipes every open set's load and blocks Finish, the steppers are 24x32 px with 9 px captions on the one screen the plan says must have big targets, the per-set "previous" column is hidden on phones, a finished workout's clock keeps counting, network errors read "Failed to fetch" with no Retry, and there is no leave guard for typed values. No media tile (the demo has none). |
| Training (client) | Good: hero, week segments, this week, other weeks, finished workouts with PR chips. "This week" is the program week while Today's strip is the calendar week. |
| Nutrition day | Good: day strip, four rings with context, meal cards, one-tap Ate as planned, recipe sheet with scaled amounts and Print. Two native selects; a legal sentence closes the page. |
| Progress, Your entries | Good hero chart with context; "Manage" and "View all" are 20 px tall targets; the "Measurements" heading spills past its card at 200%; the title is drawn in Georgia, not the app's serif; a moved weigh-in's See changes hides its history. |
| Check-ins (client) | One question per screen, progress bar, autosave and resume all hold; the photo step's privacy line is wrong about the owner. |
| Me, My profile, Notifications settings, Security | Good; Appearance and the weight unit save on the account. 40 px buttons on several of these pages. |
| Platform admin | Triage order, sheets, date field and change lists all right; it renders inside the admin's own workspace shell (sidebar of that space) and accepts a 0-day grace that the rule floors at 1. |

Performance on the production build (raw bytes; production nginx gzips): the initial JavaScript is 552 kB
raw (539 kB as the budget counts it) against the plan's 520 kB target because the whole SignalR client
ships in `main` and the feature mappers are imported by the shared API client; the homepage and sign-in
download it too. Two homepage-only fonts are preloaded on every app route and an emoji in a thread pulls
the 72 kB Arabic face. Three reads are made twice on one load (the commercial client, the workspace, and
`/api/billing/access` after sign-in on a slow link), and the billing access read repeats on every route
change. Warm navigations are 200-300 ms to usable; cold on Fast 3G with a slow CPU they are
6-9 s, with the sign-in page the worst first paint. Layout shift is 0.14 on every coach page from the
shell's late arrival.

## 6. Bugs, by severity

Every finding below was raised by one agent and then reproduced or re-read by a second (the verifier named
at the end of each entry, with the instance letter it used). Findings the verifier disproved are not here;
where the verifier corrected a severity or a detail, the corrected version is what you read. Each entry is
keyed by the id of the best write-up, with the duplicate ids after it in brackets; then the people it
affects, what happens, the cause with file and line, where the proof sits in the session's scratchpad
(`shots\<agent>\…`, `work\<agent>\…`), and who verified it. Severity: critical = data loss, money wrong or a
security hole; high = a main flow broken or a person acting on wrong information; medium = a real task
harder, misleading or failing in a less common situation; low = polish, consistency, hygiene.

**After verification: 0 critical, 6 high, 33 medium, 114 low entries.** The six verifiers handled 202
round-one findings: 182 confirmed as written, 17 confirmed with a correction, 1 disproved (LOST-11), 2
duplicates of another (LOST-2, COACH-11); 13 severities lowered, none raised; 3 new findings of their own
(VER2B-NEW-1, VER3A-NEW-1, VER3B-NEW-1). Duplicates are merged below.

### 6.1 High

**WEB-1 · An ended session is never noticed in an open tab** (AUTH-1, CLIENT-15). Coach, owner, client.
After the 8-hour cookie ends, after "Sign out everywhere" or a password change on another device, the shell
stays up with the person's name and every screen shows its own load error in the wrong words ("Clients
could not be loaded. Check your connection and try again."); Try again fails the same way; a typed
invitation is lost with "The invitation could not be created."; the Check-ins page's Library panel says "No
check-in forms yet." (wrong information: the form exists). Only a full reload reaches sign-in, and a reload
of `/` lands a client on the public homepage. Identical on the development and the production build. Cause:
the only HTTP interceptor adds the tenant header (`src/web/src/app/app.config.ts:53-56`),
`core/api/api-error.ts:22-23` interprets 403 only, and the guards reuse the first `initialize()` promise
forever (`core/auth/auth.guards.ts:6-13`). Evidence: `shots\auth\auth-expired-session-*.png`,
`work\auth\expired.out.json`, `shots\VER3C\VER3C-CLIENT-15-expired-390.png`, `work\VER2B\f2.out`. Verified
live: AUTH (f), CLIENT (b), VER3C (b), VER2B (f and the production build on h).

**CLIENT-2 · A set logged under a swapped exercise becomes the prescribed exercise's set, and its record,
when the client swaps back.** Client, coach. Swap Bulgarian Split Squat for Walking Lunge, log 10 kg x 8
("New personal record!"), swap back: the parent `WorkoutExercisePerformances` row's `ActualExerciseId` is
rewritten to the prescribed lift with `WasSubstituted = false` while the completed set row keeps its id and
values, so the finish summary, Training history and Progress › Personal records credit "Bulgarian Split
Squat 10 kg x 8" to a lift the client never did; the coach cannot tell. Cause:
`WorkoutExercisePerformance.SelectActuallyPerformedExercise` (`src/backend/Modules/Training/TB.Gym.Modules.Training/WorkoutExecution.cs:223-241`)
never looks at `Sets`, `SubstituteExerciseAsync` (`TB.Gym.Infrastructure/Application/TrainingApplicationService.Client.cs:378-421`)
has no completed-set guard, and every record read joins on the current `ActualExerciseId`. TRN-010 and
TRN-012 say a completed performance row is not rewritten. Evidence: `work\client\flow1c.log`,
`work\VER3C\batchA2.log` (database rows before and after), `shots\VER3C\VER3C-CLIENT-2-*.png`. Verified live:
CLIENT (b, Maya), VER3C (b, Jad, with the database rows).

**TRAIN-3 · Swapping a future session for a saved session moves it to the saved session's weekday.**
Coach, client. "Swap this session" on Wed 21 Oct for a saved session that sat on day 1 answers "Lower B was
swapped." and re-dates the same row to Sun 18 Oct: the client has two sessions on Sunday, Wednesday is
empty, Today says "0 of 2 sessions done", and a saved session from an earlier weekday can land a session on
a day already gone (instantly Missed). Cause: `features/clients/program-session.ts:391-396` sends the saved
session with its own `dayOffset`, and `TrainingMesocycle.ReplacePrescription` (`TrainingMesocycle.cs:632-652`)
applies the blueprint's `DayOffset` and `ScheduledDate`; the "historical sessions cannot be reprogrammed"
guard (`TrainingApplicationService.cs:613`) checks only the old date. Evidence: `work\train\out\prog-3.log`,
`shots\train\train-86-maya-home-after-swap-390.png`, `work\ver1\out\probe-c.log` (Sara's Fri 27 Nov session
moved to Sat 28 Nov and put back). Verified live: TRAIN (c), VER1 (c, own data).

**NCM-12 · Edit, Remove and "Remove as coach" fail once the other side's app has acknowledged the
message.** Coach, client. Within about a second of delivery the recipient's app acknowledges the message
over REST (MSG-015); that write rewrites the message row, whose `xmin` is the concurrency token, so the
sender's edit, removal or moderation sends a stale `expectedVersion` and is answered 409
`messaging_stale_message_version` ("This message changed since it was read. Reload the conversation and try
again."). Deterministic: 11 of 11 commands sent after the acknowledgement failed; the two sent within half a
second of the send, and one after a reload, succeeded. Cause: `AcknowledgeRealtimeEventsAsync`
(`MessagingApplicationService.cs:756-897`) saves `RealtimeAcknowledgedAtUtc` on the tracked `Message` rows and
emits no event (MSG-014); `EditAsync`/`RemoveAsync` compare `message.Version != ExpectedVersion` (`:497`,
`:1043`); the sender's screen keeps the version from its own POST (`messaging.models.ts:321`
`isNewerProjection` ignores a same-revision frame). The live spec `messaging-live.e2e.ts` fails on this.
Evidence: `work\ncm\05b.log`, `work\VER3A\msg-a.log` (13 commands, database rows `acked`),
`shots\VER3A\ncm12-*.png`. Verified live: NCM (d), VER3A (d).

**NCM-1 · A coach cannot stop or replace an assigned meal plan from any screen** (INV-1). Coach, client.
The client's Nutrition tab offers Message, Actions, "Work out again", "Assign a meal plan", "Edit allergens"
and nothing on the running plan; no file under `src/web/src/app` calls
`POST /api/nutrition/clients/{clientProfileId}/plans/{planId}/cancel` (`NutritionEndpoints.cs:200-204`), and
assigning over the running plan answers 409 `nutrition_plan_conflict`. A plan assigned to the wrong client or
the wrong dates stays on the client's phone until it ends. The API itself is right: a blank reason is
refused, the cancel answers 200, a second cancel 409, and the client's day then says "Your coach hasn't set a
meal plan for this day yet". ADR 0008 and `docs/ARCHITECTURE.md:124` promise this "audited, one-way
cancellation". Evidence: `work\ncm\03b2.log`, `shots\ncm\client-nutrition-nour-two-plans-1440.png`,
`shots\VER3A\ncm1-maya-nutrition-tab-1440.png`. Verified: INV (exhaustive grep), VER1 (code), NCM live (d), VER3A
live (d).

**LOST-1 · Registration, password reset, invitations and release notices promise an email that only a
configured provider sends; on the test copy a new coach can never sign in.** Visitor, coach, client. Nine
strings promise mail ("Check your email. We queued a confirmation link", "We email them a link", "we are
emailing them": `auth/register-coach.html:10-11`, `auth/forgot-password.html:8`,
`invitations/invitations.html:30`, `invitations/invite-client.ts:50`, `invitations/invitations.ts:146`,
`team/team.html:140`, `clients/client-release.html:16`, `clients/client-service.ts:383`). The committed
default is no provider (`src/backend/TB.Gym.Api/appsettings.json:27-30`), the Render test copy runs Production
with email off (`docker/test-copy/start.sh:54-56`), a Production deployment without a provider dead-letters
its action mail (`ActionMailOptions.cs:16-21`), sign-in refuses an unconfirmed account
(`IdentityEndpoints.cs:129-134`) and the fallback link exists only outside Production
(`AccountActionMailContracts.cs:40-46`). So on the test copy a coach who registers is told to check an email
that never comes and can never sign in, and an invited client never gets a link; nothing on screen says
email is off. In production GO-LIVE.md configures Resend (`docs/GO-LIVE.md:11,32`), so the promise holds once
that step is done. Verified: LOST (code), VER2A (code and configuration; critical on the test copy, high
elsewhere).

### 6.2 Medium

**CLIENT-1 · The kg/lb toggle in the workout player empties every open set's starting load, a one-tap set
then saves with no load, and Finish refuses until a reload.** Client. Tap lb then kg (no typing): every open
set's load field is empty (the prescribed 100 kg too, while the Target line still says 100 kg); one tap on
the checkmark records `isCompleted true, actualLoad null` ("— x 5"); Finish answers "Save every edited set
before completing the workout." naming no set. A typed load is lost the same way. Cause: `chooseUnit`
(`features/training/today-training.ts:456-471`) calls `updateSetDraft` on every open set,
`updateWorkoutSetDraft` always sets `dirty: true` and nulls a load whose unit differs; `requestFinish`
(`:560-568`) refuses while any draft is dirty. The plan records the Finish half as not built
(`docs/UI-REDESIGN-PLAN.md:1025-1027`); the silent loss of the starting loads is new. The live spec
`workout-logging.e2e.ts` fails on this step. Evidence: `work\client\flow1a.log`, `flow1b.log`, `flow1c.log`,
`shots\VER3C\VER3C-CLIENT-1-*.png`. Verified live: CLIENT (b, Maya), VER3C (b, Jad; lowered from high: it needs
a tap on the unit control, the Target line keeps the number, a reload clears it).

**WEA-2 · The exercise sheet promises "Clients see it in their workout" for a YouTube or Vimeo link, but
nobody can play or open it** (LOST-2, TRAIN-6). Coach, client. `features/training/exercise-sheet.ts:613-618`
says "YouTube video found. Clients see it in their workout."; the client's player answers "External video
demos are not enabled for this beta." after a successful grant (`today-training.ts:772-775`), the coach's demo
sheet "This demo is a video hosted elsewhere, which can't be played here yet." (`exercise-demo.ts:230-233`),
neither offers a link, and the CSP has no `frame-src` (`src/web/nginx.conf:51`). The library card shows the
link as the exercise's cover, so a coach has every reason to believe it works. The owner tracks the embed
itself as C18; the promise is the defect. Evidence: `shots\train\train-120-player-external-video-390.png`,
`train-121-coach-demo-external-video-1440.png`, `train-122-library-video-promise-1440.png`,
`work\train\out\demo-1.log`. Verified: TRAIN live (c), VER1 (code; lowered from high because the flows
complete and C18 is tracked), VER2A (code).

**COACH-13 · After a reassignment the owner's old thread with the client stays live for both sides.**
Owner, client. When a Coach loses a client the client's copy goes read-only and a send answers 409; when the
Owner is the old coach, the owner's Messages still lists the client, `POST …/messages` answers 200, the
client's thread reads `isReadOnly: false` with an open composer and their send is accepted; the new coach
correctly gets 404 on the old thread. Cause: `CoachClientScope.MayCoachAsync` (`CoachClientScope.cs:112-131`)
is true for an active Owner always, and `MessagingApplicationService.cs:1292-1316` and `:1490-1500` decide
"current coach" with it. ADR 0026 has no owner exception, and the Reassign dialog promises the owner the
opposite about himself (`client-coach.html:22-25`). The live spec `team-reassign.e2e.ts` (third test) fails on
this. Evidence: `work\coach\flow5b.log`, `shots\coach\coach-13-owner-thread-stays-live-*.png`,
`work\VER2B\a1.out`. Verified live: COACH (a), VER2B (a, own client).

**BILL-5 · Service & access says the client "can use everything their current plan includes" with no
plan, an unpaid plan, an ended plan or a cancelled plan** (COACH-19). Coach, owner.
`features/clients/client-service.ts:197-203` derives the Access line from `isCoachBlocked` only and never
reads `featureAccess`, which the same page already holds (every feature `Expired`, `PaymentRequired` or
`Cancelled`). Evidence: `shots\bill\bill-06-elie-service-before-desktop-light.png`,
`bill-06-elie-part-paid-desktop-light.png`, `shots\coach\coach-19-access-line-*.png`,
`work\bill\out\elie-commercial.json`. Verified: BILL live (e), COACH live (a), VER1 (code), VER2B live (a).

**BILL-1 · Money with more than two decimals is rounded and stored instead of refused** (SEC-11, price
half). Coach, owner. `POST /api/commercial/enrollments/{id}/payments` with 1.005 USD is stored as 1.01
(10.005 as 10.01, 2.345 as 2.35; 0.004 is refused only because it rounds to 0.00), so the ledger and "USD
63.36 of 130 paid" hold cents nobody paid; an offer priced 10.123 is stored as 10.12 and "exact price"
matching uses the rounded value. Cause: `MoneyRules.NormalizeAmount` (`CommercialDomain.cs:646-655`,
`MidpointRounding.AwayFromZero`) used at `CommercialApplicationService.cs:402`; the column is `numeric(18,2)`.
The Record payment sheet says "Use at most two decimals." and the platform plan side refuses sub-cent prices
(`PlatformPricePlan.cs:37-39`). No screen sends such an amount; the API is the contract. Evidence:
`work\bill\out\06b-money-report.json`, `06d-money-report.json`, `work\ver1\out\probe-e.log`,
`work\sec\probes-s8.jsonl`. Verified live: BILL (e), SEC (g), VER1 (e), VER3A (g).

**BILL-2 · With no Whish number configured the owner is told to pay and given no way to do it.** Owner.
`PlatformBilling:WhishNumber` is empty by default (`appsettings.json:24`); `features/billing/billing.html:69-73`
then reads "Pay the exact amount. TB Gym will confirm the payment details with you." with no contact, no link
and no sign that anything is missing, while the invoice still falls due 7 days after issue and locks the
space 7 days later. Evidence: `shots\bill\bill-01-owner-billing-desktop-light.png`,
`work\bill\out\owner-billing.json`. Verified live: BILL (e), VER1 (e).

**BEA-1 · Build next block that would run into the client's next program: the preview says fine, the
apply says "This program changed".** Coach. Back-to-back programs A and B; on A, Build next block one copy:
preview `isInsideTrainingCoverage: true`, no problem; apply extends A into B, the GiST exclusion refuses, and
`catch (DbUpdateException)` (`TrainingApplicationService.Progression.cs:131-134`) answers 409
`progression_conflict`, which the web renders as "This program changed since you opened this. Close it and
open it again…". Nothing is written; the coach cannot learn that B is in the way. Assignment and the grid
edit do name the overlap (`TrainingApplicationService.cs:349-351`, `Edit.cs:238-244`). Evidence:
`work\ver1\out\probe-c.log`, `stack\c\api.log` line 10442. Verified: BEA (code), VER1 live (c, own data).

**BEA-2 · A USDA outage, timeout or malformed answer turns the food search and import into a 500.**
Coach. `UsdaFoodDataCentralProvider.cs:42-44, 86-93, 149-163` translates non-2xx statuses only;
`HttpRequestException`, `TaskCanceledException` (the 20 s `HttpClient` timeout, `DependencyInjection.cs:171-176`)
and `JsonException` escape `SearchUsdaAsync` and `ImportUsdaFoodAsync` (`NutritionApplicationService.cs:250-265,
297-351`) to the generic handler instead of the designed `usda_*` failure code or 503
`nutrition_provider_unavailable` (NUT-003, NUT-004). The Anthropic adapter translates the same exceptions
(`AnthropicAiMealDraftProvider.cs:155-166`, tested). Verified: BEA (code), VER1 (code; not reproducible without
re-pointing the provider).

**BEB-1 · A Talk-to-us request whose email fails four times in about 36 minutes is dead-lettered for good
and listed nowhere; the test copy has no recipient at all** (LOST-5). Owner, the gym that wrote in.
`ContactRequestMailService.cs:197-200, 219-232, 261-272` retries after 1, 5 and 30 minutes then
`MarkDeadLettered`; `Unauthorized`, `RateLimited`, `Timeout`, `Unavailable` and a missing transport (email off
in Production, `WorkerDependencyInjection.cs:236-250`) all count as attempts; no endpoint lists contact
requests (the Website module maps only the POST). Production wires the recipient
(`compose.production.yaml:46`, `docs/GO-LIVE.md:83-85`); `render.yaml` and `docker/test-copy/start.sh` set none
and email is off, so on the test copy "We'll get back to you" is not true. Tests prove the schedule and the
dead letter (`R62gTalkToUsTests`). Verified: BEB (code), VER1 (code), VER2A (LOST-5 corrected: "set nowhere in
the repo" was wrong for production).

**BEB-2 · Coach Today loads every historical completed set of the feed's clients on each visit.** Coach,
owner. `CoachOverviewReader.cs:766-791` (`ReadRecordsAsync`, called from `LoadActivityAsync:692` on every
`GET /api/coach-today`) materializes every completed set of the feed's clients for every exercise in the 20
newest workouts, with no date floor, per-client cap or aggregation, and compares in memory (`:794-814`); the
remark at `:18-25` promises a constant cost per coach. At 4 sessions a week this is tens of thousands of
rows per page load after a year. Not measured (the demo is small). Verified: BEB (code), VER1 (code).

**TRAIN-4 · "How they have done" estimates a set's max by Epley while the maxes panel values the same set
by the RTS chart.** Coach. Maya's Deadlift 62.5 kg x 7 at RPE 8.5: the panel's suggestion says 80.749 kg
(`methodKey: RpeChart`), the history sheet says 77.08 kg for the same `setPerformanceId`
(`TrainingApplicationService.Client.cs:625-631`, `new EpleyOneRepMaxEstimator()` on every set, RPE shown but
ignored); RPE 6.5 sets read 72.9 kg although at 3.5 reps in reserve the chart puts them near 78. Evidence:
`work\train\out\strength-1.log`, `prog-1.log`, `shots\train\train-91-how-they-have-done-1440.png`,
`work\ver1\out\probe-c.log`. Verified live: TRAIN (c), VER1 (c).

**CLIENT-3 · A second tab or device with the same workout open can never log again after one conflict.**
Client. Tab A logs a set; tab B's next save answers 409 "Training data was changed by another request." and
every Retry resends the same stale `version` (2190768 while the server was at 2190781); nothing suggests a
reload and tab A's set never appears in B. Cause: the `saveSet` catch path (`today-training.ts:320-336`) only
reports; `executionVersion` is refreshed only on a success. Evidence: `work\client\flow1a.log`,
`shots\VER3C\VER3C-CLIENT-3-tabB-390.png`. Verified live: CLIENT (b), VER3C (b).

**CLIENT-4 · "This week" counts two different weeks on Today and on Training.** Client. Today's strip is
the calendar week from the workspace's Monday (`GET /api/training/me/week`, `weekStart` 2026-10-12: "4 of 4
sessions done"); Training's "This week" is the program week from the program's start weekday (TRN-007; Sun
18 to Fri 23: "1 of 4 done"), unlabelled. Evidence: `shots\VER3C\VER3C-CLIENT-4-today-390.png`,
`VER3C-CLIENT-4-training-390.png`. Verified live: CLIENT (b), VER3C (b).

**CLIENT-6 · The player's load and rep steppers are 24 x 32 px, the inputs 24 px tall and the captions
9 px, on the one screen the plan says must have big targets** (WEA-5). Client. Measured at 390 px: "Less
weight"/"More weight"/"One rep less"/"One rep more" 24 x 32, the Load input 75 x 24, Reps 43 x 24 (the
checkmark 43 x 44). `today-training.scss:214-226` (1.8 rem buttons, 0.58 rem labels), `:477-479` (1.5 rem
under 620 px). Plan §2 rule 6. Evidence: `work\client\flow1a.log` layout lines,
`shots\client\CLIENT-player-started-390.png`. Verified: WEA (stylesheet), CLIENT live (b), VER3C live
measurement (b).

**CLIENT-14 · After "Wrong day", the moved weigh-in's See changes shows no history and the voided original
is unreachable.** Client, coach. Log 70.2 kg, correct to 70.4, move to the next day: the replacement's
history answers `previousValues []`, `void null`, and its sheet says "This is the number that was first
entered. It has not been corrected."; the voided original (with the 70.2 → 70.4 correction and the "Logged
on the wrong day" void) is listed nowhere the client can open. PRG-011 promises the trail stays visible.
Cause: `GetHistoryAsync` (`ProgressApplicationService.cs:620-664`) reads only the row's own corrections and
void; nothing links a replacement back. Evidence: `work\client\flow4b.log`,
`shots\VER3C\VER3C-CLIENT-14-see-changes-390.png`. Verified live: CLIENT (b), VER3C (b, both histories through
the API).

**COACH-1 · Invite a client and Invite a coach are disposed by Browser Back without asking; Brand and
Nutrition settings drop unsaved changes on in-app navigation** (WEB-6). Coach, owner. Typed invitation +
Back: lands on the previous page, no dialog, work gone (`beforeunload` not prevented); Plans you sell's New
plan sheet on the same probes asks. Cause: `app.routes.ts:59-66` and `:188-193` carry no `confirmSheetLeave`
and the sheets keep CDK's `closeOnNavigation` default (`ui/sheet.ts:53`); `workspace/brand` and
`workspace/nutrition` (`app.routes.ts:157-176`) have no `canDeactivate` and neither page registers with
`UnsavedWork` (Brand has `beforeunload` only, `workspace-brand.ts:70-73,308-310`). R5.4c promises every sheet
host asks. Evidence: `shots\coach\coach-1-invite-back-drops-work.png`, `coach-1-products-back-asks.png`,
`coach-1-team-sheet-back-drops-work.png`, `work\coach\flow1.log`, `flow5.out`, `work\VER2B\a2.out`. Verified
live: COACH (a), VER2B (a); WEB-6 code by VER2A.

**COACH-2 · After Change price the new option says "No clients yet" while its clients sit on the retired
one, and the Renew sheet then preselects nothing** (COACH-3). Coach, owner. SUB-015 counts per option
(`CommercialApplicationService.cs:844-893`, no link across `OfferPriceChanges`) and ADR 0034 keeps clients on
their price, so after 130 → 150 the card reads "USD 150 · 4 weeks · No clients yet" with "Old price options
(1): USD 130 · 4 weeks · 3 clients" folded away; a coach reads that nobody is on the plan. Renew plan for such
a client checks nothing and shows no "Runs …" line (`plan-sheets.ts:361-364` preselects only the renewed
plan's own offer id); pressing Renew then says "Choose a price option." Evidence:
`shots\coach\coach-2-new-price-no-clients.png`, `coach-3-renew-after-price-change.png`, `work\coach\flow2c.log`,
`flow2b.log`, `work\VER2B\a4.out`. Verified live: COACH (a), VER2B (a).

**NCM-2 · The recipe photo preview is a broken image right after the upload.** Coach. `recipe-editor.ts:523`
previews with `URL.createObjectURL(file)`; the CSP's `img-src 'self' data:` (`nginx.conf:51`,
`serve-built.mjs:43`) blocks `blob:`, so the Photo card shows the alt text until Publish and a reload (the
upload itself succeeds). `ng serve` has no CSP, which is why the mocked suite never saw it. Evidence:
`shots\ncm\recipe-photo-1440.png`, `work\ncm\02-recipes.log`, `shots\VER3A\ncm2-recipe-photo-prod-h-1440.png`.
Verified live: NCM (d), VER3A (d and the production build on h).

**NCM-3 · Under "EU-style labels" a label typed as printed is 36 kcal short and flagged as wrong.** Coach.
Porridge oats per 100 g: protein 11, carbs 60 (as the UK label prints them), fat 8, fibre 9, label 374 kcal
→ "About 338 kcal", saved as 338 with "Label calories differ"; the Carbs box asks for total carbs under both
settings, so an EU label's fibre is subtracted twice. This is the concerns brief's C6 (owner decided
2026-10-14, not built); recorded because Settings › Nutrition promises "the app's calories match the
packet". Evidence: `shots\ncm\foods-new-porridge-eu.png`, `work\ncm\01-foods.log`, `work\VER3A\ncm3.log`.
Verified live: NCM (d), VER3A (d, API).

**NCM-4 · A message that arrives while its thread is open is counted as unread; the badge grows with every
message read on screen and stays until the thread is reopened** (WEB-3). Client, coach. Each message
appears in the open thread within 1.3 s marked unread; the tab badge counted up to 9 while Maya was reading
them, `GET /api/messaging/unread-count` agreed, and the thread's own screen-reader status said "Nothing
unread in this conversation."; the badge survives a trip to Today and clears only when the thread is
reopened, which then draws the "NEW MESSAGES" divider above messages already read. Cause:
`applyRealtimeEvent` (`messages.ts:430-467`) never advances the read cursor; `advanceRead` is called only from
`loadThread`; `select()` returns at once for the open conversation. ADR 0020 does not promise automatic
advancement, but the screen contradicts itself. Evidence: `shots\ncm\messages-maya-arrived-390.png`,
`shots\VER3A\ncm4-*.png`, `work\VER3A\msg-a.log`. Verified live: NCM (d), VER3A (d), WEB-3 code by VER2A.

**SEC-2 · A NUL character in a note or intake field crashes the request.** Coach, client.
`PUT /api/clients/{id}/coach-notes` and `PUT /api/client-profile/me/intake` with `\0` in a string answer 500
in Development and in Production (`Npgsql.PostgresException 22021: invalid byte sequence for encoding
"UTF8": 0x00`); messaging refuses the same input with 400 (`MessageContent`). Evidence:
`work\sec\probes-s8.jsonl`, `work\VER3A\sec-probes.log`, `prod-probe2.log`. Verified live: SEC (g), VER3A (g, and
a Production-mode run of the same build).

**SEC-5 · Enrollment entitlement rows (a client's paid coverage) have no database guard.** Owner, platform
admin (anyone with database access). Inside a rolled-back transaction, `DELETE FROM
subscriptions."EnrollmentEntitlements"` and `UPDATE … SET "EndDateExclusive" = '2030-01-01'` both succeed,
while `ClientEnrollments`, `OfferEntitlements`, `PaymentRecords`, `OfferPriceChanges` and
`EnrollmentStatusChanges` are frozen by trigger. Deleting them removes the client's coverage dates and the
row the GiST overlap constraint protects; re-dating them extends paid access without a payment. No API path
does either. Fix note from the verifier: `ClientEnrollment.Cancel()` legitimately flips the row's
`BlocksOverlap` once (`CommercialDomain.cs:379,485`), so the guard must refuse DELETE and every change except
that flag, not copy the siblings' blanket trigger. Evidence: `work\sec\s10.log`, `work\VER3A\sec5-6.log`.
Verified: SEC (g, SQL), VER3A (g, SQL and trigger inventory).

**UIQ-2 · Error states show the browser's and the server's own words, and three screens offer no way to
retry** (CLIENT-17 items 1, 3, 4; COACH-5). Coach, client. On a network failure Clients, Messages (both
roles), the player, Progress, Training, Nutrition day and Check-ins show "Failed to fetch"; on a 500 they
show the ProblemDetails title ("An error occurred while processing your request.", a routed "boom" on a meal
save, "Service unavailable" on Messages); Messages, the player and Progress have no Retry at all; a Coach
who opens Former clients (403) is told "Clients could not be loaded. Check your connection and try again."
Coach Today and the client's Today do it right. Cause: `apiErrorMessage` (`core/api/api-error.ts:81-83`)
returns `body.title`, and the screens render the error object's message; `clients.ts:193` maps every failure
to the connection sentence. Evidence: `work\uiq\results\states.json`, `shots\uiq\state-*-netfail.png`,
`state-*-error500.png`, `shots\VER3C\VER3C-CLIENT-17-*.png`, `shots\coach\coach-5-coach-former-clients-403.png`.
Verified live: UIQ (h), CLIENT (b), COACH (a), VER3C (b), VER2B (a), VER3B (h).

**UIQ-3 · Six spots break at 200% text.** Coach, client. The client Nutrition tab's ring legend draws "120 g"
over "Protein"; the Strength history's lift cards split "Deadlif / t" (the maxes panel itself reflows to full
width); the client Overview's week strip runs "MonTueWedThu" together; Coach Today's avatar stack overflows
its circles; the player's "Load"/"Reps" captions sit over the "+" buttons; the Progress dashboard's
"Measurements" heading spills past its card and is cut at the page edge. Nothing scrolls sideways at 200%, so
the layout as a whole holds (WCAG 1.4.4). Evidence: `shots\uiq\zoom-*.png`, `shots\VER3B\VER3B-3*.png`.
Verified live: UIQ (h), VER3B (h, two locations corrected).

**WEA-1 · The workout player drops typed set values and the workout note on any navigation, with no leave
guard.** Client. The `today` route carries no `canDeactivate` (`training.routes.ts:42`; the coach's builder
and library have `confirmBeforeLeaving`), and `today-training.ts` registers nothing with `UnsavedWork`, so the
× in the header, the Today tab, Browser Back, a workspace switch or sign-out destroy the drafts silently;
the only safeguard is the sentence "Unsaved edits stay on this page. Save before leaving." Every other
editor asks. Verified: WEA (code), VER2A live (a).

**WEA-3 · On a 409 the exercise sheet says "The library has been reloaded; try again", but nothing reloads
and every retry resends the stale version.** Coach. `exercise-library.models.ts:477-480` promises the
reload; `exercise-sheet.ts:843-850` only sets `error`, keeps `this.exercise()` and its `version`, emits
nothing; only closing the sheet and reopening the exercise gets out. Verified: WEA (code), VER2A (code).

**WEB-2 · Opening a notice through its link does not reliably mark it read.** Client, coach. The row's
anchor carries both `routerLink` and `(click)="opened(item)"` (`notifications.html:98-100`); `markRead` runs
inside the component's `TenantAsyncScope` and first awaits a CSRF GET (`notifications.ts:258-275`), so when the
destination chunk is cached the component is destroyed first, `owns()` is false, the POST is never sent and
nothing is shown; the badge keeps counting. It depends on latency: with a 150 ms token round trip the notice
stays unread; on a local server the GET wins the race, which is why it was not seen before. The Vitest mocks
the CSRF refresh as resolved and never destroys the component (`notifications.spec.ts:359-375`). Verified: WEB
(code), VER2A live (a, with a 150 ms round trip).

**AUTH-2 · A locked account is told "Email or password is incorrect.", including when the password is
right.** Coach, client. `IdentityEndpoints.cs:136-139` ignores `result.IsLockedOut`; after five failures the
row has `LockoutEnd` 15 minutes ahead and attempts 6 onward, correct password included, answer 401
`invalid_credentials`. A person who knows their password will reset it and still be refused until the lock
expires (Identity's reset does not clear `LockoutEnd`; not reproducible without a reset link). Evidence:
`work\auth\lockout.out.json`, `shots\auth\auth-signin-1440-correct-while-locked.png`, `work\VER2B\f3.out`.
Verified live: AUTH (f), SEC (g), VER2B (f, fresh account).

**AUTH-15 · A rate-limited person is told "Email or password is incorrect." or "Your coach account could
not be created."** Coach, client. `PublicAuthentication` is 30 a minute per source address with a bodiless
429 and no Retry-After (`DependencyInjection.cs:309-318`, no `OnRejected`); `sign-in.ts:78-83` maps every error
but `email_not_confirmed` to the wrong-password sentence and `register-coach.ts:140` falls back to its generic
one. Behind nginx the address is the one it forwards, so a gym's phones on one Wi-Fi share the allowance.
Evidence: `work\auth\ratelimit.out.json`, `shots\auth\auth-signin-1440-rate-limited.png`, `work\VER2B\f5.out`.
Verified live: AUTH (f), VER2B (f).

**AUTH-3 · "Keep me signed in" keeps nobody signed in past the same 8 hours.** Coach, client. With the box
ticked the cookie's `expires` is sign-in time plus exactly 8 hours (`ExpireTimeSpan = 8 h`, sliding,
`DependencyInjection.cs:92-93`; `RememberMe` only sets `isPersistent`, `IdentityEndpoints.cs:126`); without it a
session cookie with the same server lifetime. The box only lets the cookie outlive the browser inside those
8 hours; a coach who opens the app each morning signs in again every day. Evidence:
`work\auth\signin.out.json`, `work\VER2B\f1.out`. Verified live: AUTH (f), VER2B (f).

**LOST-3 · "Only you and your coach can see them" on check-in photos leaves out the owner.** Client.
`checkins/checkin-flow.html:295` and `progress/photo-sheets.ts:224`; CLI-013 lets the owner open every
client's record and photos (the concerns brief's C8); the intake step words it right
(`intake/intake-steps.ts:106-109`). A privacy sentence about health data that is wrong for every client of a
non-owner coach. Verified: LOST (code), VER2A (code).

**INV-2 · The manual macro override NUT-008 promises has no screen.** Coach.
`POST …/calculations/{snapshotId}/macro-overrides` (`NutritionEndpoints.cs:169-173`) has no caller outside the
generated types; the Targets sheet only calculates. "Manual coach overrides win" (AGENTS.md, NUT-008).
Verified: INV (static), VER1 (code).

**INV-3 · The legal consent flow exists in the API, but no document, screen or sign-up step uses it.**
Owner, visitor. `LegalConsentEndpoints.cs:18-46`; neither registration nor invitation accept asks; no document
can exist (seeding is forbidden, CLI-010). A known deferral (`docs/ROADMAP.md:82-84`, the concerns brief's
C17), recorded because founding coaches are about to sign up. Verified: INV (static), VER1 (code).

### 6.3 Low

Grouped by area. The same format, shorter.

**Training and strength**

- **BEA-3** (BEA-11) · Rescheduling a program after a workout started answers 500 (`InvalidOperationException`
  from `TrainingMesocycle.Reschedule` escapes `RescheduleMesocycleAsync`, `TrainingApplicationService.cs:503-512`);
  the screen disables Reschedule once started, so the race or an API caller is the way in; no API test
  covers it. Verified live: VER1 (c).
- **BEA-4** (BEA-14) · When a session prescribes the same lift twice, the set save says "personal record" for
  the lighter later set while the finish summary and history deny it (`Client.cs:826-831` compares within one
  prescription; `WorkoutPersonalRecordRule` across the workout). TRN-019 wants one rule. Verified live: VER1
  (c, own session for Lynn).
- **BEA-5** (BEA-15) · Inserting a week before a shared week makes a "weeks shared" notice for the moved week's
  content the client already saw (`Notices.cs:55` diffs week ids; a moved week is a new row). Verified: VER1
  (code).
- **BEA-8** · A coach can write a workout note on a client whose training reads are closed to them (paused or
  blocked): `AddWorkoutNoteAsync` (`Client.cs:512-524`) checks scope and release but never the shared access
  port; the note is stored and surfaces when access returns. The only staff write found that skips
  `ICoachingFeatureAccessService`. Verified live: VER1 (c, Karl paused).
- **BEA-9** · Build next block's preview accepts a 110-character week label the apply then refuses (the
  generated " - progression N" suffix passes 120, `Progression.cs:398-401`). Verified: VER1 (code).
- **BEA-10** · A calculated load that rounds to zero (Down rounding, or a target under half an increment, reached
  through a later max update or grid edit) is answered 409 "This program changed" by the three previews
  (`LoadRoundingPolicy.Round` throws `InvalidOperationException`, mapped to the conflict codes at
  `TrainingEndpoints.cs:294-301, 348-355, 416-425`). The first write-up's 10%-of-20-kg example was wrong (it
  rounds to 2.5 kg). Verified: VER1 (code, corrected).
- **BEA-12** · No test covers Build next block running into the client's next program (would fail today, BEA-1).
- **TRAIN-2** · The builder grid's one-line summary counts a warm-up set as a working set ("2 × 8–10 · RPE 8",
  `program-builder.models.ts:102-103`). Verified: VER1 (code).
- **TRAIN-7** · Two video links on one exercise are listed as identical rows ("Video link · YouTube" twice,
  `exercise-sheet.ts:275-284`). Verified: VER1 (code, TRAIN's log).
- **UIQ-1** · A finished workout's header clock keeps counting from the start time ("561:35", twenty seconds
  later "561:55", over "Completed · read only"; `today-training.ts:431-434` computes now − `startedAtUtc`
  whatever the status). The plan lists the sibling defect on the finish summary as not built
  (`UI-REDESIGN-PLAN.md:1104`). Verified live: UIQ (h), VER3B (h; lowered from medium: a wrong number on a
  read-only screen that no action depends on, one-line fix).
- **TRAIN-5** (COACH-7, UIQ-11, CLIENT-11, NCM-6, UIQ-10) · Browser-default controls remain on redesigned screens:
  native date inputs in Assign program (`program-assign.ts:164`), Reschedule (`program-block-dialogs.ts:191`),
  Start a plan and Record payment (`plan-sheets.ts:288,518`); native selects for the program and the saved
  session in Assign program and the session sheet, Reassign coach (`client-coach.html:26`), "How it was paid"
  (`plan-sheets.ts:527`), the nutrition day's "What did you eat?" and extra-food unit (`today-nutrition.html:203,
  359`), and Register's language; native time inputs for quiet hours (`notification-preferences.html:112,120`).
  The kit's `date-field.ts:46-50` states the rule they break; Record a max uses it. Verified live: COACH (a),
  TRAIN (c), UIQ (h), CLIENT (b), NCM (d), VER1, VER2B, VER3A, VER3C.
- **CLIENT-8** · Any set at a repetition count never done before is a personal record (ExactRepsLoad v1, ADR
  0031): 55 kg x 4 after 52.5 x 5, and Jad's 10 kg x 8 lunge after 20 kg x 10, each celebrated with a PR badge and
  a share card. The rule behaves as written; the product question is whether it should (plan §2 rule 9,
  "delight only at real moments"). Verified live: CLIENT (b), VER3C (b).
- **CLIENT-9** · RIR cannot be entered in the player although the rules accept RIR 0-5 and the Target line
  speaks it ("about 1.5 reps left"); `logSet` always sends `actualRir: null` (`today-training.ts:375`). Verified
  live: VER3C (b).
- **CLIENT-12** · The API starts a missed session no screen offers (TRN-020: "no screen offers that yet") and
  refuses tomorrow's with a bodiless 403 (`TrainingEndpoints.cs:822`); the screens handle the result well once
  it exists. Verified: VER3C (b, API).
- **WEA-7** · On phones the per-set "Previous" numbers and the column headers are hidden
  (`today-training.scss:468-476` under 620 px), so a set no longer has last time's numbers beside it (TRN-029);
  only the exercise-level "Last time" line remains. Verified: VER2A (computed style on a 390 px phone).
- **WEA-11** · One shared `logSet` lane (`today-training.ts:363`): ticking a second set while the first is saving
  makes the first operation obsolete, so its rest timer and focus return never run. Verified: VER2A (a).
- **WEA-12** · The exercise demo sheet is not tenant-scoped (`exercise-demo.ts:209-241`): a grant answered after a
  workspace switch is shown in the next workspace. Latent (every demo account has one workspace). Verified:
  VER2A (code).
- **WEA-15** · The client workspace reads `clientId` from the route snapshot once (`client-workspace.ts:79`); a
  record-to-record route change would keep the first client. Latent (no in-app link does this today).
  Verified: VER2A (code).
- **UIQ-14** · The coach's client Training tab leaves about 610 px of empty cream under the 156 px hero at
  1440 while the maxes panel beside it runs to 731 px; the grid already has `align-items: start` and the
  Timeline is a separate row, so the Timeline must start in the left column or the panel must move.
  Verified live: UIQ (h), VER3B (h, size and fix corrected).
- **UIQ-18** · With a very dark accent (#ffffff/#000000, derived to #858585) the player's clock drops to 3.94:1;
  every other screen under every brand passes AA. Verified live: UIQ (h), VER3B (h).
- **INV-9** · The Epley/Brzycki estimate endpoint STR-005 names is unused; Record a max takes a typed tested max
  only. Verified: VER1 (code).
- **LOST-6** · A program's lifecycle history (assigned, renamed, cancelled with its reason, completed) is shown
  nowhere since the redesign; the typed cancel reason is never seen again (`lifecycle` still in the API).
  Verified: VER2A (grep, old template).
- **LOST-7** · A coach can no longer record an "Estimated 1RM" by hand (deliberate, consistent with the server;
  a note). Verified: VER2A.

**Nutrition**

- **BEA-6** (BEA-16) · Two saves of the same food at the same moment answer 500 for the loser on the very first
  pair (`23505 IX_FoodItemVersions_TenantId_FoodItemId_Revision`; `AddFoodVersionAsync` catches
  `DbUpdateConcurrencyException` only, `NutritionApplicationService.cs:183-197`); recipes translate the same
  race into `recipe_changed`. Verified live: VER1 (c).
- **BEA-7** · Approving an AI meal draft twice at once answers 500 the second time (xmin conflict uncaught,
  `NutritionApplicationService.cs:1331-1355`); no duplicate recipe. Verified: VER1 (code).
- **BEA-13** · No test sends a transport failure or timeout through the USDA provider (would fail today, BEA-2).
- **CLIENT-10** · A logged meal with changed servings keeps the per-serving calories beside the new amount ("1.5
  servings · 545 kcal planned" while the rings added 817; `today-nutrition.html:159,188-190`). Verified live:
  VER3C (b).
- **NCM-8** · The client's nutrition day ends on a legal sentence ("Allergen declarations may be incomplete.
  Absence of a declared conflict is not evidence of absence; TB Gym does not assert any meal is safe.",
  `NutritionApplicationService.cs:1545`, `today-nutrition.html:428`). Verified live: VER3A (d).
- **NCM-9** · Every USDA import carries a "Check sugar alcohols, alcohol" flag (USDA rarely reports polyols) and
  the lists lack "and" (`food.models.ts:105,157,232`). Verified live: VER3A (d).
- **SEC-8** · Nutrition answers 403 for a client id that does not exist where every other module answers 404
  (`NutritionEndpoints.cs:164-205` evaluates the feature before resolving the client). No data leaks. Verified
  live: VER3A (g).
- **INV-6** · Cooking factors (raw-to-cooked, NUT-001) have endpoints and no screen; the UI plan records the gap.
  Verified: VER1.
- **LOST-4** · Settings › Nutrition says "Your coaches can start a recipe from a description" whenever TB Gym's
  AI ceiling is above zero, while the recipe editor says "AI suggestions aren't set up for this coaching space
  yet" (`workspace-nutrition.ts:101-104` vs `recipe-editor.ts:333-340`; two API answers on the same instance).
  Verified live: VER2A (a).

**Messaging and notices**

- **VER3A-NEW-1** (NCM-13) · In Messages, an error line is wiped by the next live update: a refused send ("A
  message can only contain ordinary text.") is shown within 0.3 s and stays, but `loadConversations` resets
  `error` on every realtime list refresh (`messages.ts:1134-1141`), so it vanished 2.6 s after the other side's
  next message; the same path clears a failed edit or removal. NCM-13's "shows nothing" was wrong. Verified
  live: VER3A (d, MutationObserver).
- **NCM-14** · While the live channel is down the screen says "Reconnecting for live updates. Nothing has been
  lost." for minutes and the "Check for new messages" button the plan promises never appears, even with the
  device truly offline for 40 s: the reconnect policy never gives up (`messaging-realtime.service.ts:60-66`),
  so `onclose` never fires and the `offline` state is unreachable during a reconnect. Verified live: NCM (d),
  VER3A (d, socket cut and `setOffline`).
- **COACH-12** (COACH-17, NCM-7) · Plan and team notices are written in system words: "Coaching access
  activated. Your coaching access is now active. Open your workspace to get started.", "A renewal was
  created…", "Your service has ended…", "A client left the workspace…", "Your coach is no longer with this
  workspace. The workspace will assign you a new coach." (`NotificationTemplates.cs:66-125`); none links
  anywhere; the wording is snapshotted per row, so a template change fixes only future notices. The client-left
  notice to a Coach names nobody although the coach cannot open Former clients to find out who (the
  coach-departure notices rightly name nobody, ADR 0026/CLI-014). Verified live: COACH (a), VER2B (a), VER3A (d).
- **UIQ-21** · The coach's notifications are two dozen identical "left a note on a workout" rows over two
  months under 21 day headings, all expanded, never naming the workout or the note; the only control is Mark
  all as read. Verified live: UIQ (h), VER3B (h).
- **CLIENT-13** · The coach-message card on the client's Today shows the client's own last message ("You: …")
  under a visually hidden "Latest from your coach" heading (M1 promises the coach's latest), and it never
  refreshes live: the Messages badge went to 1 while the card kept the old message until a reload. Verified
  live: CLIENT (b), VER3C (b; lowered from medium: the visible card is honest about the author).
- **INV-4** (NCM-5) · The owner's dead-letter view promised by `docs/ARCHITECTURE.md:901` exists only as
  `GET /api/workspace/notification-dead-letters` (200 for Karim, 403 for Lea); no screen. Verified: VER1, VER3A.
- **BEB-6** · Mark all as read answers 500 after three concurrent conflicts (`catch … when (attempt < 3)`,
  `NotificationApplicationService.cs:91-106`). Verified: VER1 (code).
- **AUTH-13** · The chat hub logs an Error with a full stack when a browser leaves during connect
  (`OperationCanceledException` from `BindVerifiedTenantAsync`, `ChatHub.cs:42-46,139`); seen on f and c.
  Verified: VER2B (log).

**Clients, team and invitations**

- **COACH-4** (WEA-4) · Coach Today says "19 clients need you today" while Clients says "18 need attention"
  (Karim on a; 10 vs 7 on the fresh demo): `coach-today.models.ts:105,112` counts every attention row, CLI-018
  keeps `PlanEndingSoon` and `MaxesToReview` out of the status on purpose (`CoachAttentionPolicy.cs:97-100`).
  Each number follows its rule; the sentence should say what it counts. Verified live: COACH (a), VER2A (a,
  kept medium), VER2B (a, lowered to low); kept low here because nothing fails and the fix is one sentence.
- **COACH-6** (AUTH-11, WEB-11) · Invitation dates outside the house style and zone: "Expires Oct 25, 2026,
  9:16:58 PM" with seconds in the browser's zone (`accept-invitation.html:46`, `date: 'medium'`); the expiry
  day is UTC on Invitations (`invitations.models.ts:39-45`) and the device's on Team (`team.models.ts:132-139`),
  neither the workspace's; a dead coach link is headed "CLIENT INVITATION" (fixed eyebrow and route title);
  Team prints "Invited · Invited Oct 18"; the intake's "Date of birth Mar 14, 1994". Verified live: COACH (a),
  AUTH (f), VER2B (a, f), VER2A (code).
- **COACH-8** (AUTH-17, SEC-12, BILL-8, VER2B-NEW-1) · One sentence, "An active invitation or client relationship
  (or workspace membership) already exists for this email.", answers six different situations: inviting an
  existing client, inviting a current coach, inviting a former client as a coach (CLI-016, 409 is right, the
  words are not), inviting another coach's client's email (which tells Lea the address is in the workspace),
  a revoke sent without the current version, and a resend or cancel with a stale version
  (`InvitationEndpoints.cs:228-258` maps every Conflict to it). Accept also tells a revoked token apart from
  an unknown one (410 `invitation_revoked` vs `invitation_invalid_or_expired`). Verified live: COACH (a), AUTH
  (f), SEC (g), BILL (e), VER1 (e), VER2B (f), VER3A (g).
- **COACH-9** · A new client who joined and set up their profile but has no plan never appears on Coach Today
  (CLI-018 reads every signal through a plan), so "Start a plan" is invisible there; only Clients says "No
  plan yet". By design; a founding coach will expect a row. Verified live: COACH (a), VER2B (a).
- **COACH-10** · The client page header says "Messaging isn't part of this plan." for a client who has no plan
  at all (`client-workspace.ts:186-190`, reason `NoEntitlement`). Verified live: VER2B (a).
- **COACH-14** · A client who left or was released sees the staff empty states on Messages ("Open a client and
  choose Message…", "Go to clients") and Notifications ("Check-ins and messages that need you are on Today.");
  every other route redirects to the no-space page (`app.routes.ts:98-114` behind `authGuard` only). Verified
  live: COACH (a), VER2B (a).
- **COACH-15** · "End coaching permanently" with an empty reason does nothing, silently (`client-release.ts:66-70`
  returns after `markAllAsTouched`; the Reason field binds no `[errors]`). Verified live: COACH (a), VER2B (a).
- **COACH-16** (INV-5) · The client's coach history (`GET /api/clients/{id}/coach-assignments`: five entries with
  the owner's notes on Hadi) is recorded and shown nowhere, although the Reassign dialog promises "Kept in the
  client's coach history". Verified live: COACH (a), VER2B (a), VER1 (code).
- **COACH-18** · "Their 1 clients move to you" and "1 clients moved to you" in Remove from the team
  (`team.ts:279,297`). Verified live: VER2B (a).
- **COACH-20** · A cancelled plan's header reads "ended Sat 14 Nov", a day still to come
  (`client-workspace.ts:150-162` prints `lastActiveDate` as "ended" for Cancelled). Verified live: VER2B (a).
- **CLIENT-19** · Coach Today groups a client's check-ins under the oldest one's time ("Rita Daher sent 2
  check-ins · Sent 6 days ago" while one arrived minutes earlier; `CoachOverviewReader.cs:327` uses
  `OldestCheckIn`). Verified live: CLIENT (b), VER3C (b).
- **CLIENT-17 item 2** · Two vocabularies for a sent check-in: Today says "Submitted today · awaiting coach
  review" (`today-also.html:142`), the check-ins pages "Sent Sun 18 Oct · Waiting for your coach". Verified
  live: VER3C (b).
- **LOST-12** · Onboarding status, phone and email left the Clients list; "Not set up yet" is not an attention
  reason (`clients.models.ts:180-209`), so who never finished is two steps away per record. Verified: VER2A.
- **LOST-13** · The per-feature access reasons on Service & access became "What's included" chips plus one
  sentence (the one BILL-5 gets wrong); which feature is closed and why is inferred from the plan pill.
  Verified: VER2A.
- **AUTH-16** · A coach who joins somebody's team is greeted "Your coaching space is ready. Invite your first
  client…" (`coach-today.html:50-58`, keyed on zero clients for any staff). Verified live: AUTH (f), VER2B (f).
- **AUTH-8** (UIQ-20) · Check-in forms and Client check-ins are still the old two-pane pages: a list and a pane
  saying "Select a form to see its versions, or create a new one." / "Select a client to assign and review
  their check-ins.", twelve bare names without faces, empty by default in a new workspace (the 2026-10-11
  review's U3, still open). Verified live: AUTH (f, fresh owner), UIQ (h), VER2B (f), VER3B (h).
- **UIQ-12** · The "Discard what you typed?" question's buttons are, in order, "Close" (its x), "Keep editing",
  "Close" (the action that discards); a screen reader hears two "Close" with opposite meanings. Verified live:
  UIQ (h), VER3B (h).

**Commercial and billing**

- **BILL-3** · While an invoice is merely open the owner is never told the read-only day (the API sends
  `readOnlyFrom`; `billing.html` never renders it; the admin's screens do). Verified: BILL live (e), VER1 (code).
- **BILL-4** · A price plan accepts "0 days after it is due before read-only" and the change list says "7 > 0",
  but the rule applies 1 (`PlatformBillingRules.cs:326` `Math.Max(1, graceDays)`) and the card then says "1 day".
  Verified live: BILL (e), VER1 (e).
- **BILL-6** · The owner's billing dates are UTC days (`billing-access.ts:24-26`) and the page never says so; the
  admin's payment sheet does. Verified: BILL (e), VER1 (code).
- **BILL-7** · Duplicate plan names are allowed in Plans you sell (two identical "Form check (free)" cards; the
  only index is non-unique `(TenantId, Name)`). Verified live: BILL (e), VER1 (e).
- **BEB-7** · An unpaid renewal counts as coverage: "Ending soon" goes quiet and `PlanEndsOn`/`PlanName` name
  the unpaid renewal (`CoachOverviewReader.cs:462-470` includes `PendingPayment`), although SUB-008 grants it
  nothing. CLI-018 says "counting renewals already in place" without saying paid: the owner's product call.
  Verified: VER1 (code).
- **WEA-6** · A payment's "received" instant is built from the coach's browser clock and zone
  (`client-service-forms.models.ts:124-132`, noon in the browser zone) and read back in each reader's zone, so
  the calendar day of an append-only money record can differ by one between coach, owner and server.
  Verified: VER2A (code).
- **INV-7** · The offer sheet cannot express day lengths or concurrent coverage (always `Week` and `false`,
  `products.models.ts:258-263`) although SUB-002/004 allow both; the UI plan keeps both off screen on purpose.
  Verified: VER1.

**Sign-in and the signed-out screens**

- **AUTH-5** (UIQ-10) · Registration asks for a raw IANA zone (`Asia/Beirut`) and a currency code in text boxes
  and uses a native select for the language; "Beirut" is answered "A valid IANA time zone is required.
  (Parameter 'timeZoneId')". Settings › Name and region already has the friendly picker. Verified live: AUTH
  (f), UIQ (h), VER2B (f).
- **AUTH-7** · A reset link that fails leaves a dead form: "The link is invalid or expired." with the fields
  cleared, the spent token kept, and no "Request a new reset link" (offered only for an incomplete link,
  `reset-password.html:6-12`). Verified live: AUTH (f), VER2B (f).
- **AUTH-9** · A duplicate email at registration says "An account already uses this email." with no next step in
  the message (the page's footer does carry a Sign in link). Verified live: VER2B (f, corrected).
- **AUTH-10** (CLIENT-16) · Any unknown address answers 200 with the shell and redirects to `/` (the homepage for
  a visitor, Today for a signed-in person) with no word; `/sitemap.xml` is HTML (`app.routes.ts:239`
  `'**' → ''`). Verified live: AUTH (f), CLIENT (b), VER2B (f), VER3C (b).
- **AUTH-12** (COACH-11, NCM-11, UIQ-17) · Console errors on ordinary pages: every signed-out page (homepage,
  changelog, sign-in, register, invitation) logs a 401 on `GET /api/auth/me` (`auth.store.ts:128-136` always
  probes); a client without a meal plan logs a 404 on `GET /api/nutrition/me/day` per day shown; an ended
  plan logs a 403 on check-ins. The screens render the right words; the noise will hide real errors. Verified
  live: AUTH (f), COACH (a), NCM (d), UIQ (h), VER2B (dev and production builds), VER3A (d).
- **AUTH-4** · The Talk-to-us rate-limit sentence ends "or write to us on WhatsApp" while no WhatsApp number is
  configured and no link exists on the page (`home-talk.ts:219-221`, unconditional). Verified live: AUTH (f),
  VER2B (f, lowered from medium: a visitor's sixth message in an hour).
- **BEB-4** (SEC-9) · Three account-existence oracles on anonymous routes: sign-in answers 403
  `email_not_confirmed` for an unconfirmed account before checking the password (`IdentityEndpoints.cs:123-134`);
  `confirm-email` answers 204 for a confirmed user id with a garbage code; `register/coach` answers 409 for a
  taken email (the accepted trade-off of a registration form, recorded). Forgot-password is built right.
  Verified live: VER1 (c), SEC (g), VER3A (g).
- **WEB-8** · Signing in again after an expired session always lands in the first workspace (`login()` clears
  the tenant store first, `auth.store.ts:66-69`). Verified: VER2A (code).
- **WEB-9** · A "Checking session..." top bar flashes above the sign-in page while signing in (`app.ts:69-79`,
  `app.html:16-57`). Verified: VER2A (a).
- **WEB-10** · The invitation token is copied into the sign-in `returnUrl`, a second history entry carrying it
  (`accept-invitation.ts:58-60`; referrers are already blocked). Verified: VER2A (code).
- **WEB-16** · Nine loading strings on the signed-out screens use "..." where the app uses the ellipsis
  character. Verified: VER2A (grep).
- **UIQ-9** · The signed-out screens stay light under a dark device scheme while the browser chrome goes dark
  (`main[data-mode="light"]` plus the dark `theme-color` meta). Verified live: UIQ (h), VER3B (h).
- **UIQ-13** · Sign-in stays blank for about five seconds on Fast 3G with a slow CPU (not pre-rendered; 22 JS
  files first; roughly 2-3 s with production gzip). Verified live: UIQ (h), VER3B (h).
- **AUTH-14** · Doubled security headers: what the agent saw ("DENY, DENY") was the audit's own proxy; the API
  alone sends each once and the production Caddy edge sends `/api/*` straight to the API. Where nginx fronts
  `/api` (the dev compose stack and the Render test copy, `docker/test-copy/Dockerfile:69`) its
  `add_header … always` with no `proxy_hide_header` would double five of the six; not run. Verified: VER2B
  (corrected; low, configuration only).

**API hygiene and security consistency**

- **SEC-1** (TRAIN-1) · A malformed request body (wrong type, broken JSON, `null`, empty, a wrong enum spelling,
  100 nested arrays) answers 500 in Development, where every audit instance and the integration tests run,
  and a bare 400 with no body in Production (the framework's `ThrowOnBadRequest` default; nothing in the repo
  sets it), so the field is never named and the Angular helper falls back to a generic sentence. Verified
  live: SEC (g), TRAIN (c), VER1 (c), VER3A (g, and a Production-mode run of the same build; lowered from medium).
- **SEC-3** · `PUT /api/client-profile/me/intake` with names and version only on a completed profile answers 500
  through `CK_ClientProfiles_CompletedOnboarding` in both environments (`ClientProfile.UpdateIntake` assigns
  nulls as given); the form sends every field, so nobody reaches it today. Verified live: SEC (g), VER3A (g;
  lowered from medium).
- **SEC-4** (INV-11) · The two strength calculators are the only POSTs that skip antiforgery (no state changes,
  no exposure), and `estimate-one-rep-max` answers 500 `NullReferenceException` on `{}`
  (`StrengthApplicationService.cs:126`). Verified live: SEC (g), VER3A (g), VER1 (code).
- **SEC-6** · `clients."ClientProfileChanges"` (the intake change history SYS-003 wants durable) can be deleted or
  rewritten: no trigger; `DELETE 42`, `UPDATE 42` inside a rolled-back transaction. Verified: SEC (g, SQL),
  VER3A (g, SQL).
- **SEC-7** · Inside a workspace, someone else's photo asset or workout answers 403 (`POST /api/media/{id}/access`,
  the client workout routes, the workout-note route) where a missing one answers 404; existence is confirmed,
  no data returned. ADR 0026 wants 404. Verified live: SEC (g), VER3A (g).
- **SEC-10** · `%` and `_` in the exercise, food and recipe search match every row (ILIKE pattern not escaped);
  the conversation search handles them. Verified live: SEC (g), VER3A (g).
- **SEC-11** (date half) · An enrollment starting 2100-01-01 and a bodyweight dated 1850-06-01 are accepted (a
  future bodyweight is refused); the first agent's 2100 enrollment persists on g and now blocks that period.
  Verified live: SEC (g), VER3A (g).
- **INV-10** · 91 of 159 state-changing endpoints carry no rate-limit policy, Training (0 of 28) and Nutrition
  (0 of 27) among them, while every CheckIns, Commercial, Messaging, Invitations, Notifications and
  PlatformBilling write carries `SensitiveWrite`; no document explains the split. Every unlimited write is
  authenticated and tenant-scoped and the one cost-bearing route is bounded by the monthly allowance, so a
  consistency item. Verified: INV (count), VER1 (own count; lowered from medium).
- **INV-12** · Seven endpoints (the direct template and meal-plan writes superseded by drafts, two redundant
  check-in reads) and sixteen `ApiClient` wrappers have no caller. Verified: VER1.
- **INV-8** (LOST-8) · The workspace's default culture (en-LB / ar-LB) is carried through `PUT /api/workspace`
  unchanged; no screen shows or edits it since the redesign. Verified: VER1, VER2A.
- **BEB-3** · The anonymous Talk-to-us POST deserializes up to Kestrel's 30 MB before antiforgery and the
  1,000-character rule run (no `RequestSizeLimit`; nginx allows 501 MB for video uploads); bounded by the 5-an-hour
  limiter. Verified: VER1 (code).
- **WEB-14** · The CSP's `connect-src 'self' ws: wss:` allows a socket to any host; the only socket is same-origin.
  Verified: VER2A.
- **BEB-5** · No test proves the Worker's sweep drains the contact-request queue (every R62g test calls the
  service directly). Verified: VER1 (grep).

**Progress and the client's other screens**

- **WEA-8** · The Progress hero's date span ends on the exclusive bound ("… – 19 Oct 2026" on 18 Oct,
  `progress-dashboard.html:73-76`). Verified: VER2A (a).
- **WEA-10** · "Sent today" for the coach's message on Client Today compares the device's calendar date with
  the workspace's date (`today-coach-message.ts:63-66`, `today.models.ts:321-326`); wrong whenever the two
  calendars differ. Verified: VER2A (code).
- **CLIENT-7** (UIQ-4) · Small targets on client screens, measured at 390 px: Progress dashboard "Manage"
  52 x 20 and "View all" 50 x 20, "Open the full entry history…" 273 x 18, row menus 36 x 36, the nutrition
  day strip's buttons 38 px wide and its week arrows 24 px, recipe Close 40 x 40, 40 px buttons on Me, My
  profile, Password and security, Notification settings and Training; all under the plan's own 44 px bar.
  axe's four `target-size` hits at 1440 (the "Manage" link included) are controls that sit under the sticky
  tab bar at the initial scroll and pass once scrolled, so they fail a zero-violation gate rather than a
  person; the accessibility live spec fails on them. Verified live: CLIENT (b), UIQ (h), VER3C (b, every size
  re-measured), VER3B (h, the axe hits corrected).
- **CLIENT-18** · My profile › Your health › Edit carries no privacy sentence once the first run is over; the
  sentence exists only in `intake-steps.ts:108-109`. Verified live: VER3C (b).
- **LOST-C7** · Me says "Emails from your coach and quiet hours" (`features/account/client-account.html:57`)
  while the page it opens says the emails are TB Gym's payment, activation, renewal and plan-ending notices
  (`notifications/notification-preferences.html:50-61`); the coach never emails anyone. Verified: the
  lost-feature agent (code), re-read by the lead at both templates.
- **UIQ-16** · Client Today's hero card lacks the duration and the "Week 4 of 6" kicker M1 names; Coach Today's
  tiles carry no comparison with last week (plan §2 rule 4). Verified live: UIQ (h), VER3B (h).
- **VER3B-NEW-1** (UIQ-19) · The app is drawn in three typefaces: `:root` names "Inter", a face the build
  never loads (`src/web/src/styles.scss:11-19`), so Coach Today, Clients, Programs, Recipes, Plans you sell
  and Check-in forms render in the operating system's font (Segoe UI here, SF on iPhone, Roboto on Android)
  while Notifications, Workspace, Team, Training and Me render in IBM Plex Sans; the Progress dashboard's
  title falls back to Georgia because `progress-dashboard.scss:30` names `'Instrument Serif'` where the loaded
  family is `TB Home Serif`. On top of that, Messages, the client's Check-ins, the nutrition day and Progress
  use a serif page title while the other pages use the sans. Plan §3: "There is one type scale." Evidence:
  `work\VER3B\out\fontcheck.json` (the platform font that drew each page's title and first paragraph).
  Verified live: UIQ (h, the title mix), VER3B (h, the cause).
- **UIQ-23** · Under RTL the layout mirrors but the text arrows stay right-pointing ("Next exercise →", the
  homepage's "→" links). Verified live: UIQ (h), VER3B (h).
- **LOST-9** · `/changelog` is unreachable for every signed-in person (the links exist only on the homepage,
  which signed-in people never see; the page has an "embedded" frame built for them). Verified: VER2A (a).
- **LOST-10** · `/account/appearance` has no link for a client (Me has the control inline); harmless. Verified:
  VER2A.
- **LOST-14** · "Days in programs, check-ins and plans start and end at midnight here, and reminders follow this
  clock." (Name and region): plan reminders do exist and follow the clock; what a reader may take the word to
  mean, check-in or workout reminders (C12), does not. Wording. Verified: VER2A (corrected).

**Shell, performance and build**

- **WEB-5** (UIQ-6, WEA-13) · The initial JavaScript is 552,276 bytes raw (539 kB as the budget counts it; 168 kB
  gzip with the stylesheet) against the plan's 520 kB warning: the whole SignalR client is in `main` because
  a root store injects `MessagingRealtimeService` (`message-unread.store.ts:36`), and `core/api/api-client.ts:5-60`
  imports the feature mappers and their `$localize` strings; the pre-rendered homepage and sign-in download it
  all. Angular's `initial` budget counts the stylesheet too, so the comparable figure is 576,912 bytes, the
  plan's own "575 kB" note. Measured on the production build. Verified: WEB, UIQ, VER2A, VER3B (sizes exact;
  lowered from medium: a warning budget with no visible failure).
- **UIQ-7** · Two homepage-only fonts (IBM Plex Sans Medium, Plex Mono Medium, 47 kB) are preloaded on every app
  route and Chrome warns they go unused; an emoji in a thread pulls the 72 kB Arabic face because it has no
  `unicode-range`. Verified live: UIQ (h), VER3B (h).
- **UIQ-8** (WEB-7) · The same read is made twice on one load: the commercial client read on the Overview
  and Service tabs, the workspace read on the Training and Nutrition tabs, and `/api/billing/access` after
  sign-in and on a slow link (the banner is deferred, so not on every fast first load) plus once more on
  every route change (`billing-banner.ts:88-99`, an effect and a `NavigationEnd` subscription); the banner's
  overdue sentence would print an empty day if `readOnlyFrom` were null (possible by type, not reproduced).
  The unread-count, csrf and client-access doubles the first write-up listed did not reproduce in four tries
  each. Verified live: UIQ (h), VER2A (a), VER3B (h, three patterns dropped).
- **UIQ-5** · Layout shift 0.14 on every coach page (the launch placeholder gives way to the shell at about
  245 ms), 0.22 on the client Overview, 0.37 on the client Training tab (the maxes panel arrives late), 0.14 to
  0.21 cold and 0.28 to 0.34 on Fast 3G on the client's Today (two runs); the client record tabs show
  "Loading client…" with no skeleton. Verified live: UIQ (h), VER3B (h).
- **WEB-4** · The deep-link shell (`location /`) and the hashed assets carry no `Cache-Control`
  (`src/web/nginx.conf:63-77`): the shell may be reused stale after a deploy and every hashed chunk is
  revalidated on each load. A stale shell is not a blank app: `core/routing/navigation-failure.ts:38-45` catches
  the failed chunk and offers Reload. Verified: VER2A (code; lowered from medium).
- **WEB-15** · The 36 kB dev-only `hero-lab.css` ships in the production image. Verified: VER2A (dist).
- **WEA-14** · The program and meal-plan builders read the whole library (up to 10 pages of 100) and grant every
  thumbnail on every open, then render it unvirtualised (`program-builder.ts:623-650`,
  `meal-plan-builder.ts:605-622`); fine at 25 exercises, not at a few hundred. Verified: VER2A (code).
- **WEB-13** (UIQ-15) · The coach shell has no "Skip to content" link (the client shell has one;
  `app.html:1-10`); route arrival focuses the h1, which mitigates it. Verified live: UIQ (h), VER2A (a), VER3B (h).
- **WEA-9** · Sheet refusal summaries are inserted on demand (`@if … role="alert"`, 81 sites across clients,
  nutrition, training, progress and intake) instead of the §8 live region present from first render that
  takes focus; `food-editor.html:3-14` is the only in-scope sheet shaped per the convention. Verified: VER2A
  (grep, ARCHITECTURE.md:432-450).
- **WEB-12** · Quiet-hours validation is announced through the page's `role="alert"` line instead of under the
  fields, and focus stays on Save (`notification-preferences.ts:294-318`). Verified: VER2A (code).

**Tests and tooling**

- **WEB-17** · Both committed Playwright configs pin `timezoneId: 'UTC'`, so no e2e runs in a browser whose day
  differs from the workspace's; and a full run rewrites about 27 committed pictures under `docs/design`
  (eight spec files write there). Verified: VER2A.
- **WEB-18** · No Vitest beside `ui/sheet.ts`, `ui/dialog.ts`, `ui/menu.ts`, `ui/segmented-control.ts`,
  `ui/tabs.ts`, `ui/confirm.ts`, `core/forms/guarded-sheets.ts`, `unsaved-work.ts`, `leave-guard.ts`,
  `form-attempt.ts`, `core/auth/auth.guards.ts`, `core/messaging/message-unread.store.ts`, the conversation list
  and composer, the invite, product and platform sheets, the team and billing models, or the homepage; the
  notifications spec is shaped so WEB-2's race cannot show. Verified: VER2A (file listing).
- The backend test gaps named above: BEA-11 (reschedule after start), BEA-12 (next block overlap), BEA-13 (USDA
  transport), BEA-14 (TRN-019 agreement), BEA-15 (notice after a moved week), BEA-16 (food and AI races), BEB-5
  (the contact queue sweep). Each would fail today on the bug beside it.

## 7. Security results

### 7.1 What held (929 probes at the API level, plus the live specs)

The security agent probed instance g with legitimate accounts only: Atlas's owner, two coaches and five
clients, the platform admin, and "Eve", the owner of a second workspace it registered. 929 probes, every one
recorded with request, expected and actual in its appendix; none read or wrote another workspace's, another
coach's client's, a released client's or an unpaid workspace's data. The verifier re-ran twenty of the
passing probes and the repo spec `security-tenancy.e2e.ts` pins the key refusals.

- **Workspace isolation (318 probes).** With Atlas's tenant id Eve got 403 on all 157 tenant routes; with her
  own tenant and Atlas's row ids she got 404 on every id-bearing route, and the batch media grant answered
  an empty list and set no cookie. No header, an empty, malformed, nil, random, braces, upper-case or
  two-valued header: 403 everywhere. The hub refuses a foreign or missing `Origin` (403) and aborts a
  connection whose `tenantId` names another workspace, is junk or is doubled.
- **Coach scope (112 probes).** Lea on every route naming Omar's client Jad or his rows (profile, intake,
  notes, block, commercial, enrollment payments and lifecycle, every mesocycle action, workout read and
  note, the Omar-Jad conversation and its realtime routes, check-ins, bodyweight, measurements, photos,
  Omar's draft and saved reply, a nutrition plan cancel, creating a conversation with Jad): 404, or 403 on
  owner-only routes. Her lists, Coach Today, search and notifications never contain him. The owner reads
  everything (CLI-013; the concerns brief's C8 is confirmed: the intake shows another coach's client's
  allergies to the owner) but cannot read or moderate Omar's chat (404).
- **Released client (122 probes).** After the owner released Sara: her session and a fresh sign-in no longer
  list Atlas; all 24 self-service reads and 8 writes with the Atlas header answer 403; Lea gets 404 on 36
  writes naming her; the owner gets 409 `client_released` on all 33 direct and indirect writes (payments,
  renewals, pause, resume, cancel, workout notes, every mesocycle action, a max, a nutrition plan, check-in
  assign and review, reassign); her chat closes; her membership is Removed, her plans, program and meal
  plan Cancelled, the payment kept, one release notice queued and her three future notices cancelled.
- **Unpaid read-only.** Of 158 non-GET routes, 102 staff tenant writes are blocked by the handler when the
  bill is unpaid, 14 carry `AllowedWhileWorkspaceReadOnly` (ADR 0028's list plus the four read-as-POST
  previews), and no staff write stays open outside that list. Live on two copies with a back-dated invoice:
  37 staff writes answered 403 `workspace_read_only` with the sentence on screen, reads and the exempt
  routes stayed open, a client logged a set and sent a message unaffected, and the admin's exact payment
  lifted the lock at once without a sign-out.
- **Client self-service (56 probes).** Another client's bodyweight, measurement, photo, export, nutrition,
  conversation, notification, check-in, program summary and session routes: 404 (the workout routes 403,
  SEC-7). Media grants are HttpOnly, SameSite=Strict, path-scoped and bound to the user: Jad's grant
  presented by Maya is 403; content without a grant 403; a grant without the sign-in cookie 401; 33 ids 400.
- **Request forgery and sessions (215 probes).** Every state-changing route answers 400
  `antiforgery_token_invalid` without the token (the two state-free strength calculators excepted); another
  session's token, a garbage token and the pre-login token are refused; the sign-in cookie is HttpOnly and
  SameSite=Lax (Secure and `__Host-` in production by configuration); `/api` answers `no-store`; revoke-all
  and a password change end the other device's session at once; six wrong passwords lock the account.
- **Rate limits.** The contact form's sixth post in an hour, the 61st sensitive write in a minute, the 10th
  upload in an hour and the 31st sign-in from one address in a minute each answer 429 at exactly the limit,
  per address or per user as designed; forgot-password answers 202 identically for known and unknown
  addresses (medians 27 ms vs 28 ms, and 19.8 vs 17.8 ms in the auth agent's run).
- **Input.** A 2,001-character message, a 10 MB note, a 31 MB body (413), load 2001, reps 101, RPE 11 or 7.3,
  negative or absurd weights, calories and prices, far birth dates, a 100,000-character goal: all refused.
  HTML and control characters in notes and messages are stored and rendered as text. Every id smuggled into
  a body (another client's enrollment, workout, set, photo, asset, template version, tenant) is refused.
- **Logs and notification rows.** After storing marker strings as allergies, medications, injuries, a
  workout note, a coach note, a message, a release reason and the invitation and confirmation tokens, none
  appears in 5,363 API log lines or the Worker's; notification bodies are fixed templates, payloads hold ids
  only, the dead-letter view carries no payload field, and a Talk-to-us request's name, contact and words
  reach the database and the captured email and no log line.
- **Database guards.** Inside rolled-back transactions, update and delete were refused by the triggers on
  payments, enrollment snapshots, max history, published check-in versions, message revisions, mesocycle
  dates, completed workouts and set actuals, workout notes, coach history, relationship events, membership
  history, notifications, photos, weigh-ins, invoices, invitations, working-max snapshots, template and
  recipe versions, nutrition plans and completed logs; the GiST exclusion constraints on coverage, primary
  mesocycles and renewal requests held; a storage key under another tenant's segment or with dot segments
  was refused. The two tables that lack a promised guard are SEC-5 and SEC-6 below.

### 7.2 What did not hold

No finding in this group reads or writes another person's data; they are consistency and hardening items,
each with its full entry in section 6.

- Medium: SEC-2 (a NUL character crashes a note or intake save, in Production too) and SEC-5 (the rows that
  hold a client's paid coverage dates have no append-only guard).
- Low: SEC-1 (malformed bodies: 500 in Development, a bare 400 naming no field in Production), SEC-3 (an
  intake update that omits fields hits a check constraint), SEC-4 (the two calculators skip antiforgery and
  one crashes on an empty body), SEC-6 (the intake change history is mutable), SEC-7 (403 where ADR 0026 wants
  404 for another person's photo asset or workout inside a workspace), SEC-8 (nutrition's 403 for a client
  that does not exist), SEC-9 with BEB-4 (three account-existence oracles on the anonymous routes), SEC-10
  (search wildcards match every row), SEC-11 (far dates accepted; the rounding half is BILL-1), SEC-12 (a
  revoked token told apart from an unknown one on accept; a coach learns an email belongs to the workspace),
  BEB-3 (a 30 MB body is read before the contact form's checks), WEB-14 (`connect-src` wider than needed),
  WEB-10 (the invitation token copied into the sign-in URL), AUTH-14 (the doubled headers were the audit
  proxy's; plausible only where nginx fronts `/api`, not run), BEA-8 (a coach's workout note skips the shared
  access port).
- Rate limits: INV-10 (91 of 159 state-changing endpoints carry no policy, Training and Nutrition none at all;
  every one authenticated and tenant-scoped).

The two production-only checks the security agent could not make, the `Secure`/`__Host-` cookie flags and
the forwarded-address chain behind Render, are in section 9.

## 8. Enforcements and enhancements

### 8.1 Rules enforced only in the browser, or not at all

- **A substitution can be changed after a set was completed under it** (CLIENT-2): no domain guard in
  `SubstituteExerciseAsync`; the browser's menu even lists the prescribed lift first "so a swap can be
  undone".
- **A session replacement may change the session's date** (TRAIN-3): no invariant that `ReplacePrescription`
  keeps `DayOffset`/`ScheduledDate`; the screen happens to send the saved session's day.
- **A completed set may have no load** (CLIENT-1): the server accepts `isCompleted true, actualLoad null` for a
  set whose prescription has a load; the "edited set" state that blocks Finish is purely client-side.
- **A coach's workout note skips the shared access port** (BEA-8): the only staff write found that does not
  evaluate `ICoachingFeatureAccessService` (AGENTS.md says every coaching-feature API must).
- **The owner is never "the old coach"** (COACH-13): the read-only rule after a reassignment exists for a Coach
  and is bypassed for an Owner through `MayCoachAsync`.
- **"A completed profile keeps its intake fields" lives only in a database check** (SEC-3): the domain's
  `UpdateIntake` assigns nulls as given and the constraint answers with a 500.
- **Two decimals** (BILL-1, SEC-11): the platform plan refuses a sub-cent price, the coach-to-client ledger
  rounds one.
- **The release reason is required by the API and silently by the screen** (COACH-15).
- **Grace days** (BILL-4): the form allows 0, the rule applies 1, the card shows 1.
- **A payment's calendar day is built in the browser** (WEA-6) rather than stamped by the server in the
  workspace's zone.
- **Plausibility of dates and names** (SEC-11, BILL-7): enrollments from 2100, weigh-ins dated 1850 and two
  products with one name are accepted.

### 8.2 Database guards that are missing

- `subscriptions."EnrollmentEntitlements"` (SEC-5): no trigger, while every sibling of the enrollment snapshot
  is frozen. The guard must still allow the one legitimate change, `BlocksOverlap` true → false on
  cancellation.
- `clients."ClientProfileChanges"` (SEC-6): the intake change history can be deleted or rewritten.
- No second line of defence on a payment's currency or total: a 100,000 EUR payment on a USD enrollment
  inserts by SQL (the API refuses it; the domain is the only guard).
- Optional: a unique index on `(TenantId, lower(Name))` among active coaching products (BILL-7).
- Everything else the security agent tried was refused by its trigger, foreign key, check or exclusion
  constraint (section 7.1); the other tables without triggers are mutable by design.

### 8.3 Tests that are missing (each would fail today on the bug beside it)

Backend (MSTest against PostgreSQL): reschedule after a workout started (BEA-11); Build next block into the
next program (BEA-12); a transport failure or timeout through the USDA provider (BEA-13); TRN-019 agreement
between the set save and the finish summary (BEA-14); the training notice after an edit that moves a visible
week (BEA-15); two food versions and two AI approvals at once (BEA-16); the Worker's contact-queue sweep
(BEB-5); a session swap that must keep its date (TRAIN-3); a substitution change after a completed set
(CLIENT-2); the owner as old coach after a reassignment (COACH-13); an edit after the counterpart's
acknowledgement (NCM-12); a sub-cent receipt (BILL-1); a NUL in a text field (SEC-2); malformed bodies in
Production mode (SEC-1); the two append-only triggers once added (SEC-5, SEC-6).

Web (Vitest): a 401 interceptor and guard re-check (WEB-1); the unit toggle keeping drafts clean (CLIENT-1);
the player's leave guard (WEA-1) and per-set lane (WEA-11); a notice opened through its link with the
component destroyed before the CSRF answer (WEB-2); the invite sheets on Browser Back (COACH-1); the kit's
overlay pieces, the leave guards, the auth guards, the unread store and the invite, product and platform
sheets (WEB-18); a Playwright project in a non-UTC zone and the docs pictures behind a flag (WEB-17).

Live: the new suite in `src/web/e2e/live/` found NCM-12, COACH-13, CLIENT-1 and the target-size failures by
failing; run it nightly against a fresh demo (a Docker PostgreSQL, the API in Development, the built site)
so a regression in a cross-role flow shows before a coach sees it.

CI: red on main since 2026-10-15 (NU1903 on SignalR.Common 10.0.11); bump to 10.0.13.

### 8.4 Performance and the bundle

- Initial JavaScript 552 kB raw against the 520 kB budget (WEB-5): a dynamic `import('@microsoft/signalr')`
  in the realtime service and an `ApiClient` that returns generated types (the feature mappers move into
  their lazy chunks, WEA-13) bring it under; then make the budget an error.
- Two homepage-only fonts preloaded on every route and an emoji pulling the 72 kB Arabic face (UIQ-7).
- Five duplicate reads per page load, `GET /api/billing/access` on every route change among them (UIQ-8,
  WEB-7).
- Layout shift 0.14 on every coach page from the shell's late arrival, 0.37 on the client Training tab
  (UIQ-5): reserve the shell's frame in the launch screen and give the record tabs skeleton panels.
- Sign-in is blank for about five seconds on Fast 3G (UIQ-13): pre-render it like the homepage.
- Coach Today's record check reads every historical set (BEB-2): one SQL aggregate per (client, exercise)
  with a date bound, or records cached at completion.
- The builders read the whole library and grant every thumbnail on each open (WEA-14): first page plus a
  server search, `content-visibility: auto` on the rows.
- No `Cache-Control` on the shell or the hashed assets (WEB-4); `hero-lab.css` in the production image
  (WEB-15); `connect-src` wider than needed (WEB-14).

### 8.5 Enhancements and small delighters the agents noted

- Client Today's hero card: the duration (from sets and rests, which the builder knows) and "Week 4 of 6"
  (UIQ-16); Coach Today's tiles: last week beside this week; a "See all" cap on the queue so the week chart
  stays above the fold.
- A "joined, start a plan" row for a new client with no plan (COACH-9) and a "Not set up yet" chip plus
  the phone number on the record header (LOST-12).
- A small History fold under the program hero with the lifecycle events and the cancel reason (LOST-6); the
  coach history inside the Reassign sheet (COACH-16).
- The read-only day on an open invoice and one line saying billing days are UTC (BILL-3, BILL-6).
- Notices that name the workout and quote the note's first words, with older days collapsed (UIQ-21).
- RIR in the player's More options (CLIENT-9); "estimate from reps" in Record a max (INV-9); "Do this
  session late" on a Missed row, marked late for the coach, or close the API path (CLIENT-12).
- The personal-record rule (CLIENT-8): 55 kg x 4 after 52.5 x 5 is a record by ExactRepsLoad v1 and becomes a
  share card; the owner may prefer a rule that asks for a better estimated max too. A product call.
- Video links: until C18's embed ships, open the link in a new tab from both demo buttons and reword the
  sheet (WEA-2); titles or thumbnails for video links (TRAIN-7).
- Drop the "Check" flag for nutrients USDA never reports (NCM-9); say "Allergen lists can be incomplete.
  Check a recipe yourself if you have an allergy." instead of the legal sentence (NCM-8).
- A not-found page (AUTH-10, CLIENT-16); "What changed" in the account menu (LOST-9); the Settings zone
  picker and currency choice on registration (AUTH-5); one title style across pages (UIQ-19); the Timeline
  flowing under the program hero at 1440 (UIQ-14).
- Owner's calls recorded in the findings: an unpaid renewal counting as coverage (BEB-7), a typed estimated
  1RM (LOST-7), day-length offers and concurrent coverage (INV-7), "Keep me signed in" meaning 30 days or
  being renamed (AUTH-3), and the legal documents (INV-3).

## 9. What could not be tested, and why

Everything below was left untested for the reason given; nothing in this report is claimed about it.

**Needs a production deployment or a provider the audit stack does not have**
- Email: every stack ran the captured adapter, so no real mail was sent, read or bounced; the invoice,
  release and invitation mails were seen only as queue rows and log lines. Password-reset links are never
  returned in any environment (NOT-029), so the reset happy path, an expired link and whether a reset clears
  a lockout were not exercised.
- Media in production: Cloudflare R2, ClamAV, the EICAR refusal path and large (500 MB) video uploads; the
  stacks used the Development local store and the allow-everything scanner with small PNGs.
- AI meal suggestions: no Anthropic key is configured, so only the "not set up" wording was seen.
- nginx and Caddy themselves: the stacks served the built app through the repo's own `serve-built.mjs`
  logic plus a Node proxy, so nginx's `limit_req` on the Talk-to-us path, its cookie map, gzip, cache
  headers and `X-Robots-Tag` were read from the configuration, not observed; the doubled security headers
  the auth agent saw came from the audit stack's own proxy, and whether nginx doubles them where it fronts
  `/api` (the test copy, the dev compose stack) is read from the configuration only (AUTH-14). Byte counts in
  the performance table are raw (production gzips).
- Production-only behaviour: the `Secure`/`__Host-` cookie flags and Render's forwarded address chain. (The
  400 answer for malformed bodies in Production, SEC-1, was reproduced by a verifier on a Production-mode run
  of the same build, so it is not in this list.)
- Lighthouse: not installed and not fetchable offline; LCP, CLS and timings came from the browser's own
  performance APIs under CDP throttling.
- WhatsApp, Plausible analytics and the Whish number: none is configured anywhere, so their paths were
  exercised only as "absent".

**Needs a real device**
- The install card and Add to Home Screen, Wake Lock, vibration and the phone share sheet (headless Chromium
  never fires `beforeinstallprompt` or `navigator.share` with files; only Save image was proved).
- Enter on a real phone keyboard (Playwright's phone emulation still reports a fine pointer).
- A device that is truly offline: only a cut socket could be produced, so the Messages "You're offline"
  state never appeared (NCM-14); offline navigation itself was tested with `setOffline`.
- iPhone startup images and iOS behaviour in general.

**Needs data the demo does not have, or time travel**
- A client whose plan lapses today (Ask to renew was tested through Elie's stored request and the API).
- A second workspace for the same account (workspace switching): every demo account has one.
- A program finished as the running hero (the Training "Share your program" offer), the finish summary
  under each brand theme and the PR burst under brands.
- Exercise media in the player (the demo has no uploaded video), the coach's set note on a demo set,
  the first-run profile steps (every demo profile is complete; the intake was driven with a newly invited
  client instead), a Record payment sheet on instance h (no unpaid plan there), the legal consent
  append-only guard (no published document exists).
- Two coaches editing one client's program at the same time; pound-based or Down/Up-rounded programs.
- A very large client list or library (the demo has 12 clients and about 25 exercises).

**Needs the owner's accounts or decisions**
- An admin whose role was revoked, or an admin with no workspace at all (the seeded admin owns the empty
  "Demo Coach Workspace").
- Arabic: there is no Arabic locale, so right-to-left was checked by flipping `dir="rtl"` only (mirroring and
  overflow), never a translation.
- The owner's own Render test copy was not touched; LOST-1's claim about it was verified from its
  configuration and the code paths, not by registering there.

## 10. The live Playwright suite added by this audit

`src/web/e2e/live/` holds 23 spec files plus `support.ts`, run by `src/web/playwright.live.config.ts` against a
served app with a live API on a fresh Atlas demo (`TB_GYM_LIVE_URL=<origin> npx playwright test -c
playwright.live.config.ts`; the platform-admin spec also reads `TB_GYM_LIVE_ADMIN_EMAIL` and
`TB_GYM_LIVE_ADMIN_PASSWORD`). Without `TB_GYM_LIVE_URL` every spec skips itself, and the mocked projects in
`playwright.config.ts` ignore the folder, so `npm run e2e` is unchanged. Every spec signs in through the real
sign-in page or the real login route, creates what it changes (new people through `uniqueEmail`, new programs
and plans it cancels afterwards) and reads the demo's existing people, so a rebuilt demo runs it again.

Result on a fresh demo copy (2026-10-18 evening, one worker, 8 minutes, then a rerun of four files after
two suite fixes): **46 tests, 40 pass, 4 fail on real defects they pin, 2 skip when the workspace is not
locked.** A failing test is left failing on purpose, as asked.

| Spec | Tests | Result | Fails because |
| --- | --- | --- | --- |
| accessibility-sweep | 4 | 3 pass, 1 fail | axe `target-size` on four client controls that sit under the sticky tab bar at the initial scroll at 1440 (CLIENT-7); a zero-violation gate fails although they pass once scrolled |
| assign-program | 1 | pass | |
| checkin-review | 1 | pass | |
| client-checkin | 2 | pass | |
| client-me | 3 | pass | |
| invitation-lifecycle | 1 | pass | |
| invite-and-onboard | 2 | pass | |
| meal-plan-assign | 1 | pass | |
| messaging-live | 1 | fail | an edit or removal answers 409 once the other side's app acknowledged the message, which happens within about a second of delivery (NCM-12); the test passes only when its command beats that acknowledgement |
| nutrition-day | 2 | pass | |
| platform-admin-payment | 1 | pass | |
| program-builder-publish | 2 | pass | |
| progress-entries | 2 | pass | |
| register-and-confirm | 1 | pass | |
| release-and-return | 2 | pass | |
| security-tenancy | 5 | pass | |
| sell-and-pay | 1 | pass | |
| sign-in-and-reset | 3 | pass | |
| talk-to-us | 2 | pass | |
| team-reassign | 3 | 2 pass, 1 fail | the owner's old thread with a reassigned client stays live (COACH-13) |
| unpaid-read-only | 2 | skip | the demo's first invoice is not overdue; locks are proved on a copy whose invoice was back-dated |
| update-maxes | 1 | pass | |
| workout-logging | 3 | 2 pass, 1 fail | the kg/lb toggle marks every set edited and blocks Finish (CLIENT-1) |

Two suite defects surfaced on the whole-suite run and were fixed before the rerun: the sign-in helpers now
wait a minute and retry once when the public sign-in limit (30 a minute per address) answers 429, which a
full run from one machine can reach; and the assign-program spec cancels the program it assigns so Lynn stays
the client with no program that the rest-day test relies on.

Traps for whoever extends the suite: the mocked suite pins `timezoneId: 'UTC'`, the live one Asia/Beirut;
the Talk-to-us spec can only post five times an hour per address; a spec must never keep a demo id (they
change on every rebuild) but look people up by name; and the owner's own API (5134) and web (4200) must not
be used as the target.

## 11. Fix batches, in order

Each batch is sized for one session (backend rule, API, screen and tests together, per AGENTS.md), names the
findings it closes by their ids in section 6, and ends with the test that proves it. The order puts what a
founding coach meets first, then what corrupts data, then words and polish. Items marked "owner decides" need
an answer before the batch starts; the recommendation is given.

**Batch 1 · Green CI and an honest test copy.** Bump `Microsoft.AspNetCore.SignalR.Common` to 10.0.13 so
main restores again. On deployments where email is off, have the API say so in the register, forgot-password,
invitation and release answers and show it on screen, and expose the action link to the owner or admin
(LOST-1); treat a missing transport as "wait", not an attempt, and list pending and dead-lettered contact
requests on the platform admin page (BEB-1); show a contact when no Whish number is configured and add the
number to GO-LIVE's checklist (BILL-2); open external video links in a new tab from both demo buttons and
reword the exercise sheet until C18 ships (WEA-2). Tests: integration tests for the "email is off" answers and
the contact-request wait; a Vitest for the sheet wording. Configure Resend, the contact recipient and the
Whish number on the test copy before anyone outside the team registers there.

**Batch 2 · The session.** A 401 interceptor that ends the session in the app and goes to sign-in with a
`returnUrl` and one sentence, plus a guard re-check on `visibilitychange` after a long hidden period (WEB-1);
keep the chosen workspace on re-sign-in (WEB-8); `account_locked` and `too_many_attempts` codes with a
Retry-After and the sentences for them on sign-in and register (AUTH-2, AUTH-15); a 30-day sliding lifetime
behind "Keep me signed in" or a rename of the box (AUTH-3, owner decides; recommended: 30 days); no
"Checking session…" bar over sign-in (WEB-9). Tests: Vitest for the interceptor and guard; integration tests
for the two codes; extend `sign-in-and-reset.e2e.ts` with the lockout sentence.

**Batch 3 · Training rules that protect the record.** Refuse a substitution change once a set is completed
under it, 409 with a reason the player shows (CLIENT-2); keep a session's own date on a swap (TRAIN-3);
answer 409 `lifecycle_conflict` on reschedule after a start (BEA-3); name the overlap in Build next block's
preview and apply (BEA-1); one personal-record rule for the set save and the summary (BEA-4); cap the
generated week label and answer a rounds-to-zero load as a 400 naming the set (BEA-9, BEA-10); estimate with
the RTS chart in "How they have done" when the set has an RPE, Epley otherwise, and name the formula
(TRAIN-4); count working sets in the grid summary (TRAIN-2). Tests: BEA-11, BEA-12, BEA-14 plus a swap-keeps-
date and a substitution-after-completion test; add a swap step to a live spec.

**Batch 4 · The workout player.** Relabel a draft's unit without emptying or dirtying it and recompute the
starting values (CLIENT-1); on a 409 reload the day keeping dirty drafts and retry once, in a person's words
(CLIENT-3); a leave guard and `beforeunload` for dirty sets and the note (WEA-1); a per-set `logSet` lane
(WEA-11); the summary's duration instead of a running clock on a finished workout (UIQ-1); 44 px steppers,
taller inputs and readable captions, with the per-set previous kept on phones (CLIENT-6, WEA-7); RIR in More
options (CLIENT-9); the RPE step hint before the round trip and "kg lifted" in the summary (CLIENT-5); the
clock in `--tb-accent-bright` (UIQ-18). Tests: Vitest for the unit toggle, the 409 path and the guard;
`workout-logging.e2e.ts` goes green.

**Batch 5 · Messaging.** Keep the realtime acknowledgement off the row the person edits (a column excluded
from the concurrency token, or the existing `RealtimeAcknowledgements` table) and refresh the thread and
retry once on a stale version (NCM-12); advance the read cursor when a message arrives in the open, visible,
following thread and keep badge, row and status in agreement (NCM-4); decide "current coach" by the
assignment, not by `MayCoachAsync`, so the owner's old thread closes too (COACH-13); do not reset the error
line on a realtime list refresh (VER3A-NEW-1); after a few failed reconnects show the offline line with
"Check for new messages" (NCM-14); mark a notice read from a root store that outlives the page (WEB-2).
Tests: integration tests for the acknowledgement-then-edit and the owner reassignment; Vitest for the cursor
and the error signal; `messaging-live.e2e.ts` and `team-reassign.e2e.ts` go green.

**Batch 6 · Nutrition coach tools.** "Stop this meal plan" with a reason on the plan card, stopped plans
listed with their reason (NCM-1); "Adjust macros" after a calculation (INV-2); preview the recipe photo
through a `data:` URL (NCM-2); the C6 decision for EU-style labels, so a label typed as printed is not
flagged (NCM-3); translate USDA transport failures into the designed codes (BEA-2); answer the food-version
and AI-approval races with their 409s (BEA-6, BEA-7); 404 for a client that does not exist (SEC-8); the
logged amount's calories on a changed meal (CLIENT-10); the allergen sentence and the USDA flag (NCM-8,
NCM-9); one availability call for the AI sentence on Settings (LOST-4). Tests: BEA-13, BEA-16; Vitest for the
two sheets; extend `meal-plan-assign.e2e.ts` with the stop.

**Batch 7 · Money and plans.** Refuse amounts and prices with more than two decimals (BILL-1, SEC-11); derive
the Access line from `featureAccess` and bring back the per-feature reasons (BILL-5, LOST-13); count a
replacement option with the options it replaced and preselect the replacement in Renew (COACH-2, COACH-3);
"cancelled Sun 18 Oct" instead of a future "ended" (COACH-20); grace days minimum 1 (BILL-4); unique active
plan names (BILL-7); the read-only day on an open invoice and the UTC line (BILL-3, BILL-6); send the receipt
day as a date and stamp it server-side (WEA-6); the append-only triggers on `EnrollmentEntitlements` (allowing
the cancel flag) and `ClientProfileChanges` in one migration (SEC-5, SEC-6); whether an unpaid renewal counts
as coverage (BEB-7, owner decides; recommended: only a paid one). Tests: sub-cent refusal, the two triggers,
the count across a price change; `sell-and-pay.e2e.ts` gains the decimals case.

**Batch 8 · Coach screens and sheets.** Leave guards on the Invitations and Team sheets and the Brand and
Nutrition pages (COACH-1); re-read the exercise on a 409 (WEA-3); say what Today's number counts (COACH-4);
the release reason's error (COACH-15); "1 client" (COACH-18); "No plan yet" alone (COACH-10); the client's own
empty states for a departed client (COACH-14); "Discard" instead of a second "Close" (UIQ-12); the newest
check-in's time (CLIENT-19); a row for a new client with no plan and a "Not set up yet" chip (COACH-9,
LOST-12); the program's History fold and the coach history in the Reassign sheet (LOST-6, COACH-16);
invitation and birth dates in the house style and the workspace's zone (COACH-6); video-link titles (TRAIN-7);
the Training tab's layout at 1440 (UIQ-14). Tests: Vitest for each guard and sentence.

**Batch 9 · The client's Today, Training and Progress.** The coach's latest message, refreshed live
(CLIENT-13); label Training's week with its dates (CLIENT-4); carry a replaced weigh-in's history into the
replacement and link "Moved from" (CLIENT-14); the inclusive end of the Progress span (WEA-8); "today" in the
workspace's zone (WEA-10); the hero card's duration and week kicker (UIQ-16); the privacy sentence on the
health edit (CLIENT-18); 24 px minimum targets on the dashboard links and the row menus, and scroll padding
for the sticky bar (CLIENT-7); the six 200% breakages (UIQ-3); "Do this session late" or close the API path
(CLIENT-12); one word for a sent check-in (CLIENT-17). Tests: Vitest; `accessibility-sweep.e2e.ts` goes green.

**Batch 10 · Error words and the API contract.** One app sentence for network and server failures and a
Retry on Messages, the player and Progress; "Only the owner sees former clients" (UIQ-2); `ThrowOnBadRequest
= false` plus a handler that answers 400 naming the field in both environments (SEC-1); refuse NUL in text
fields (SEC-2); validate the completed-profile rule in the domain (SEC-3); the calculators' empty body and
antiforgery (SEC-4); strip `(Parameter '…')` suffixes and word the Identity and reset sentences (CLIENT-5,
NCM-10, AUTH-5, AUTH-6); 404 for in-workspace "not yours" rows (SEC-7); escape search wildcards (SEC-10);
distinct invitation conflict reasons and sentences (COACH-8 group); the mark-all-read third conflict (BEB-6);
the cancelled hub connect (AUTH-13); a body limit on the contact form (BEB-3); `SensitiveWrite` at the group
level for Training, Nutrition, Exercises and Progress writes, or an ARCHITECTURE line explaining the split
(INV-10); the unused endpoints and wrappers (INV-12). Tests: integration tests for each status.

**Batch 11 · Sign-up and the signed-out screens.** The Settings zone picker and currency choice on
registration (AUTH-5); "Request a new reset link" after a failed one (AUTH-7); a next step in the duplicate-
email sentence (AUTH-9); a coach's own greeting on joining a team (AUTH-16); a not-found page and a 404 for
crawlers where the edge can tell (AUTH-10); the three account-existence oracles (BEB-4, SEC-9); keep the
invitation token out of the sign-in URL (WEB-10); the ellipsis character (WEB-16); dark mode on the signed-
out screens (UIQ-9); pre-render sign-in (UIQ-13); skip the session probe on a pre-rendered signed-out page and
answer "nothing here" with 200 (AUTH-12); drop WhatsApp from the rate-limit sentence unless a number exists
(AUTH-4). Tests: Vitest; `register-and-confirm.e2e.ts` gains the picker.

**Batch 12 · Notices and words.** The plan and team notice templates in the glossary's words, each with a
link, and the client-left notice naming the client to the coach (COACH-12); notices that name the workout
and quote the note, older days collapsed (UIQ-21); "shared" notices by week number, not row id (BEA-5); the
check-in photo privacy line (LOST-3); "Reminders" wording on Name and region (LOST-14); the sheet summaries
as §8 live regions and quiet-hours reasons under the fields (WEA-9, WEB-12); the access check on coach workout
notes (BEA-8); the personal-record rule (CLIENT-8, owner decides). Tests: BEA-15, an integration test for
BEA-8, Vitest for the regions.

**Batch 13 · Performance and the shell.** The dynamic SignalR import and an `ApiClient` that returns
generated types (WEB-5); the font preloads and the Arabic `unicode-range` (UIQ-7); one read per fact per page
(UIQ-8); the shell's frame reserved before the session answers and skeleton panels on the record tabs
(UIQ-5); `Cache-Control` on the shell and the hashed assets (WEB-4); `hero-lab.css` out of the image (WEB-15);
`connect-src 'self'` (WEB-14); the Coach Today record aggregate (BEB-2); first page plus server search in the
builders (WEA-14); the coach shell's skip link (WEB-13); arrows that flip under RTL (UIQ-23). Tests: the
bundle budget as an error; a Playwright check on the headers in the test-copy proof script.

**Batch 14 · The kit everywhere, and the check-in pages.** Replace the remaining native date, select and
time controls with the kit's (TRAIN-5 group, twelve sites); point the root font stack at the loaded IBM Plex
face and the Progress title at the app's serif, and settle the serif-versus-sans title rule (VER3B-NEW-1,
UIQ-19); then
the one redesign left over from the 2026-10-11 review's U3: Check-in forms as a card list and assignment from a
sheet on the client's Check-ins tab, with empty states that invite (AUTH-8). Tests: Vitest and the mocked
Playwright baselines.

**Batch 15 · Tests and tooling.** A non-UTC Playwright project and the docs pictures behind a flag (WEB-17);
the Vitest list in WEB-18; the Worker sweep test (BEB-5); the remaining backend gaps; a nightly job that
builds the demo and runs `src/web/e2e/live/`; the legal-consent publish path and acceptance step once the
owner has the wording (INV-3); the dead-letter list for owners (INV-4); the cooking factors, the day-length
and concurrent-coverage offers and the default culture only if the owner wants them (INV-6, INV-7, INV-8).

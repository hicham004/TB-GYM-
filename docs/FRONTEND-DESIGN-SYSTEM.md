# TB Gym — Frontend Design System

Status: foundation slice 1 implemented 2026-09-22 on top of `c18903f` and committed as
`feat(web): add frontend design-system foundation`. Slice 2, on top of it, adds the **production
coach shell** and migrates the **exercise library's default list state** — the first migrated route.
Every other route still renders its pre-existing markup inside the new shell.

This is the handoff for anyone migrating a screen to the approved design. It covers the Figma-to-code
mapping, how to use the primitives, how to run the lab and tests, what the foundation deliberately
does not change, and what is still open. It corresponds to Task 2 of
[FRONTEND-UX-AUDIT.md](FRONTEND-UX-AUDIT.md) (a bounded subset) and starts its Task 9 browser layer.

## 1. Where things live

| Path | What it is |
|---|---|
| `src/web/src/styles/_tokens.scss` | Figma variables as CSS custom properties on `:root` |
| `src/web/src/styles/_ui.scss` | Opt-in `.tb-*` classes: theme scope, typography, buttons, native controls, field, checkbox, data table, dialog |
| `src/web/src/app/shell/` | The coach shell: navigation model, `app-coach-nav`, `app-coach-shell` (slice 2) |
| `src/web/src/app/ui/` | Primitives: `button.ts`, `icon.ts`, `status-label.ts`, `avatar.ts`, `field.ts`, `checkbox.ts` (+ specs) |
| `src/web/src/app/dev/` | Development-only routes and the UI lab (`/dev/ui-lab`) |
| `src/web/e2e/` | Playwright + axe browser checks and their screenshot baselines |

Both partials are pulled into `styles.scss` with `@use` and are **additive**: every selector is a
`.tb-*` class that a primitive or a migrated screen applies on purpose. No bare-element rule and no
legacy class (`.primary-button`, `.form-grid`, …) was changed.

Design source: Figma file `7N4K2BM3XFoYhBjUnsi4wa` (TB Gym — Product Design v1). Inventory verified
live on 2026-09-22: 63 variables (Primitives 18, Color 20, Layout 22, Button v1 3), 9 text styles,
1 effect style, 10 component sets and 14 standalone components (all icon masters).

## 2. Token mapping

Custom-property names are the variables' Figma **code syntax (WEB)**, so Figma Dev Mode and the code
name every value identically. Semantic colours keep their Figma aliases as `var()` references to the
primitives. Use semantic roles in product code; `--primitive-*` exist only as alias targets.

| Figma variable (collection) | CSS custom property | Value |
|---|---|---|
| `color/background` (Color) → `neutral/background` | `--color-background` | `#f7f7f3` |
| `color/surface` → `neutral/surface` | `--color-surface` | `#ffffff` |
| `color/surface-subtle` | `--color-surface-subtle` | `#f1f3f2` |
| `color/text-primary` | `--color-text-primary` | `#161b1a` |
| `color/text-secondary` | `--color-text-secondary` | `#66716e` (5.06:1 on surface) |
| `color/border-subtle` | `--color-border-subtle` | `#d7ddda` — dividers only, never an interactive edge |
| `color/border-control` | `--color-border-control` | `#7d8783` (3.71:1 on surface) — every interactive boundary |
| `color/accent` / `accent-hover` / `accent-subtle` | `--color-accent` / `-hover` / `-subtle` | `#0f766e` / `#0b5f59` / `#e7f4f2` |
| `color/on-accent` → `neutral/surface` | `--color-on-accent` | `#ffffff` |
| `color/success` / `warning` / `danger` / `information` (+ `-subtle`) | `--color-success` … `--color-information-subtle` | `#237a57`, `#a05a00`, `#b42318`, `#2563eb` (+ subtle tints) |
| `color/text-on-inverse-muted` | `--color-text-on-inverse-muted` | `#969898` — dark sidebar only (2.7:1 on the app background) |
| `spacing/4 … spacing/48` (Layout) | `--space-4 … --space-48` | 4, 8, 12, 16, 24, 32, 48 px |
| `radius/4`, `/6`, `/8`, `/full` | `--radius-4`, `-6`, `-8`, `-full` | 4, 6, 8, 9999 px |
| `control-height/32`, `/40`, `/48` | `--control-height-32`, `-40`, `-48` | 32, 40, 48 px |
| `content-width/desktop/720…1200` | `--content-width-720`, `-960`, `-1200` | max inline sizes, never viewport sizes |
| `padding/mobile-horizontal/16`, `padding/desktop-page/24`, `/32` | `--page-padding-mobile`, `-desktop-compact`, `-desktop` | 16, 24, 32 px |
| `focus/ring-width`, `focus/separation-gap` | `--focus-ring-width`, `--focus-separation-gap` | 3 px, 2 px |
| Effect style `Elevation/Overlay` | `--elevation-overlay` | `0 8px 24px -8px rgb(22 27 26 / 14%)` — menus, dialogs, sticky overlays only |

Typography: the nine `Typography/*` text styles become size/line-height token pairs and classes.

| Text style | Class | Size / line height | Weight |
|---|---|---|---|
| Display | `.tb-text-display` | 36 / 44 | 600 |
| Page title | `.tb-text-page-title` | 28 / 36 | 600 |
| Section title | `.tb-text-section-title` | 20 / 28 | 600 |
| Body, Body strong | `.tb-text-body`, `.tb-text-body-strong` | 16 / 24 | 400, 600 |
| Compact body, Compact strong | `.tb-text-compact`, `.tb-text-compact-strong` | 14 / 20 | 400, 600 |
| Metadata, Metadata strong | `.tb-text-metadata`, `.tb-text-metadata-strong` | 12 / 16 | 400, 600 |

Also: `.tb-theme` (opt-in root: font, colour, body text), `.tb-numeric` (tabular figures for loads,
reps, money, dates), `.tb-visually-hidden`.

**Fonts.** `--font-sans` uses the already-bundled faces `'Notebook Plex'` (IBM Plex Sans) and
`'Notebook Plex Arabic'` (IBM Plex Sans Arabic), Regular 400 and SemiBold 600 — the two weights the
text styles use. The files in `public/fonts/ibm-plex/` are unmodified upstream WOFF2 under the SIL
Open Font License 1.1 (see its `README.md` and `LICENSE.txt`). Arabic text (`:lang(ar)` or a
`lang="ar"` region inside `.tb-theme`) puts the Arabic face first. No font was fetched or added.

## 3. Component mapping

| Figma | Angular | Selector / API |
|---|---|---|
| Action/Button `46:3` | `Button`, `ButtonLink` (`ui/button.ts`) | `<button appButton type="…">`: `type` required; `variant` `filled`·`outlined`·`text`; `size` `pointer` (40)·`touch` (48); `loading`. `<a appButton>`: `variant`, `size` only |
| Action/Icon button `101:164` | `IconButton` | `<button appIconButton type="…" label="…">` + one `<app-icon>`; `label` required (the accessible name); `size`; `loading` |
| Icon/Plus `42:4`, Icon/Notification `98:47`, Icon/Check `64:19` | `Icon` (`ui/icon.ts`) | `<app-icon name="plus \| bell \| check-circle">`; always `aria-hidden` |
| Feedback/Status label `69:55` | `StatusLabel` | `<app-status-label label="…" tone="neutral\|success\|warning\|danger" marker="dot\|check">`; `label` required |
| Identity/Avatar `66:29` | `Avatar` | `<app-avatar initials="…" presentation="…">`; seven named presets; always `aria-hidden` |
| Form/Text field `236:583`, Form/Select `237:553`, Form/Text area `238:553` | `Field` + `Control` (`ui/field.ts`) | `<app-field label help [errors] density hideLabel>` around `<input\|select\|textarea appControl>` |
| Form/Checkbox `239:530` | `Checkbox` + `Control` (`ui/checkbox.ts`) | `<app-checkbox label="…">` around `<input type="checkbox" appControl>` |
| Icon/Chevron down `234:485` | CSS, and `<app-icon name="chevron-down">` for the workspace switcher | Background image of `.tb-select`, at the logical inline end |

Added with slice 2: Navigation/Sidebar item `121:165` as `app-coach-nav`'s row; the eight navigation
glyph masters plus the chevron in `ui/icon.ts`; `app-section-nav` for a section's pages
(Figma `266:1484`); `.tb-table`/`.tb-table__label` and `.tb-dialog`/`.tb-dialog__actions` in
`_ui.scss`. The eight glyphs are the masters' own exported path data, with each master's subpaths
joined into one path; seven of them carry a 0.68 group opacity in Figma that Icon/Overview does not,
and that is not copied, because the navigation spec gives labels and icons the same 17.4:1 contrast.

Still not built: Feedback/Linear progress `71:45`, cards, locked states, confirmation tiers beyond
the one dialog, date pickers.

## 4. Usage

```html
<!-- A migrated screen opts in once; everything inside may use the primitives and classes. -->
<section class="tb-theme">
  <h1 class="tb-text-page-title" i18n>Exercises</h1>

  <form [formGroup]="form" (ngSubmit)="save()">
    @let nameReasons = nameErrors();
    <app-field
      label="Name" i18n-label
      help="Required. Up to 160 characters." i18n-help
      [errors]="attempt.shows('name', nameReasons) ? nameReasons : null"
    >
      <input appControl type="text" formControlName="name" (blur)="attempt.touch('name')" />
    </app-field>

    <app-checkbox label="Include archived" i18n-label>
      <input type="checkbox" appControl formControlName="includeArchived" />
    </app-checkbox>

    <p id="exercise-summary" role="alert" tabindex="-1" #summary><!-- refused-submit summary --></p>
    <button appButton type="submit" [loading]="saving()" aria-describedby="exercise-summary">
      @if (saving()) { <ng-container i18n>Saving…</ng-container> }
      @else { <ng-container i18n>Save changes</ng-container> }
    </button>
    <a appButton variant="text" routerLink="/training/exercises" i18n>Back to exercises</a>
  </form>

  <button appIconButton type="button" label="Notifications" i18n-label (click)="open()">
    <app-icon name="bell" />
  </button>
  <app-status-label label="Active" i18n-label tone="success" marker="check" />
</section>
```

Rules the primitives encode:

- **Buttons.** `type` is required at compile time, so no button submits by accident. Use native
  `disabled` only when the action cannot apply, with the reason in visible text. While a request is
  in flight use `loading`: the button keeps focus, is announced as unavailable (`aria-disabled`),
  and a capture-phase guard cancels clicks, Enter, Space and implicit form submission before any
  handler runs. `<a appButton>` stays a real link and has no disabled or loading state.
- **Fields.** `appControl` adds no value accessor, so `formControlName`, `[formControl]` and
  `ngModel` bind to the native element as before. The directive owns `id` (a consumer id wins,
  otherwise `tb-control-N`), `aria-invalid` and `aria-describedby`. Never bind
  `[attr.aria-describedby]` or `[attr.aria-invalid]` on it; pass extra descriptions (a character
  counter, a row message) through `aria-describedby="…"` or `[aria-describedby]="…"` and they are
  merged after the field's own, without duplicates.
- **Validation timing** stays with `core/forms/form-attempt.ts` (ARCHITECTURE §8). The field shows
  whatever messages it is given, so pass only the ones that are due. Messages are plain text; the
  form's single `role="alert"` summary is the only assertive region. **An error replaces the help
  text** (one slot, as in Figma), so the error sentence must restate any constraint the help gave.
- **Density.** Standard / 40 for forms, dialogs and toolbars. Compact / 32 only in dense editors and
  data grids; touch-first client screens stay on Standard. Touch-first primary actions use the
  48px button `size="touch"`; mobile targets are at least 44×44.
- **Status and avatars.** Status text carries the meaning; tone only colours the marker. Avatars are
  decorative; the adjacent name or the wrapping control supplies the accessible name.
- **RTL.** Everything uses logical properties. Set `dir` from the locale; give user-authored text
  `dir="auto"` and mixed digits/punctuation (tempo, loads, ranges) an LTR isolate (`dir="ltr"` on
  the input, `<bdi>` in text).
- **Focus.** Every primitive draws `outline: 3px var(--color-accent)` at a 2px offset on
  `:focus-visible`, reaching 5px beyond the control. Containers keep that margin; a scroll region
  scrolls on one axis, with padding and `scroll-padding` so its first and last rows stay unclipped.

## 5. Deliberate deviations from the Figma file

1. **Units.** Text sizes and line heights are `rem` (px ÷ 16): identical at default settings, and a
   larger browser font setting enlarges text. Spacing, radii and control heights stay in px.
2. **Heights are minimums** (`min-block-size`), so enlarged or translated text grows a control
   instead of being clipped.
3. **Border in layout.** Figma draws button strokes inside the frame and outside layout; CSS borders
   take space, so button padding subtracts the 1px border and the label sits where Figma puts it.
   Inputs already count their border in Figma (text 13px / 9px from the edge), so they use the
   padding tokens directly.
4. **Button v1 collection deduplicated.** Its `neutral/border-control` `#7f8985` and
   `color/border-control` are not exported; buttons use the canonical `--color-border-control`
   `#7d8783`. Its `icon/foreground` (text-primary on surface, on-accent on accent) is implemented as
   `currentColor` inheritance. The Foundations documentation frame still captions border-control as
   `#89938F`; that caption is stale — the variable value `#7d8783` is canonical. (Figma was left
   unedited outside the four corrections in §8.)
5. **Disabled at 45%** is applied as colour alpha (`color-mix`), not element opacity, so the Outlined
   border keeps full strength as drawn.
6. **Loading** has no Figma variant. Code adds a decorative 16px spinner (static under reduced motion)
   that replaces a leading icon; the label and accessible name are unchanged.
7. **Read-only** has no Figma variant. Code uses the surface-subtle fill, the control border and the
   primary text colour, so the value stays legible and the control stays focusable.
8. **Select chevron** is a background image with its colour baked in (`#161b1a`; 45% when disabled)
   because custom properties cannot reach inside an image. Under `forced-colors` the select and the
   checkbox fall back to native rendering so the platform draws them in system colours.
9. **Checkbox label association** is explicit `for`/`id` on a label that spans the rest of the row,
   rather than a wrapping `<label>`: a label wrapping projected content cannot be checked by the
   template accessibility lint rule, and the rule was not suppressed.
10. **Icon/Check** is drawn without the master's 14px clip frame, so its circle stroke is not trimmed.
11. **Status marker `check`** reproduces Figma's check-circle; use it only for positive or completed
    states (Figma's swap default shows it for every tone).

## 6. UI lab and tests

The lab is a development-only route showing every primitive with synthetic fixtures and real
Angular forms (reactive form with `FormAttempt`, template-driven and standalone controls, pristine,
touched, invalid, disabled, read-only, compact, narrow/wide, long labels, an Arabic RTL section,
edge focus). It makes no API calls.

```powershell
# Run the lab (development configuration; no API needed — the shell just shows signed-out)
.\scripts\run-web.ps1                    # then open http://localhost:4200/dev/ui-lab (?dir=rtl)

# From src/web, after dot-sourcing scripts/Toolchain.ps1 and Initialize-TbGymToolchains:
npm test                                 # Vitest, including src/app/ui and the lab spec
npm run e2e                              # Playwright + axe; starts ng serve on 127.0.0.1:4300
npx playwright install chromium          # once per machine
npx playwright test ui-lab               # just the lab checks
```

**Production exclusion.** `app.routes.ts` spreads `devRoutes` from `dev/dev-routes.ts`, which is
an empty array. Only the `development` build configuration replaces that file with
`dev-routes.development.ts` (`fileReplacements` in `angular.json`), so a production build never
imports the lab: its code is absent from the bundle, and `/dev/ui-lab` falls through to the normal
catch-all and route guards. No guard was added or relaxed.

**Browser checks** (`e2e/ui-lab.e2e.ts`): 390, 1024 and 1440 px in LTR and RTL with no sideways
scroll and an axe scan of the lab (WCAG 2.0–2.2 A/AA plus best practices) with zero violations;
every tab stop's 3px accent ring; unclipped rings at a scroll region's edges; loading and disabled
buttons ignoring clicks, Enter and Space; Enter unable to resubmit a saving form; checkbox
first-line alignment; wrapping labels and multi-line errors; 200% text and 320px reflow; reduced
motion; forced colours. `e2e/existing-routes.e2e.ts` compares sign-in and coach registration against
baselines captured at `c18903f` before any foundation code existed, as a guard against global-style
regressions, and checks that both reflow at 200% text (the defect slice 2 fixed in the signed-out
bar). `e2e/coach-shell.e2e.ts` covers the shell at 1440 and 390 px in both directions, Owner and
Coach, the navigation dialog's keyboard behaviour, the sidebar's focus rings inside its scroll
region, workspace switching and 200% text. `e2e/exercises.e2e.ts` covers the library's loading,
populated, empty, error and capped-result states, its filters (Apply, Enter, and a select that does
not apply on its own), the archive dialog and its focus return, and the stacked narrow layout. All
API responses are test-only `page.route` mocks; the application's guards and interceptors run
unchanged.

**No console noise.** `e2e/support.ts` fails a test on any unexpected console error or uncaught page
error. The messaging hub is answered — a negotiate response plus a mocked WebSocket that completes
the SignalR handshake and replies to pings — so a signed-in page no longer retries a 404 hub and logs
an error each time. The allow-list has one default entry: a signed-out visitor's `GET /api/auth/me`
is answered 401 by the real API too, and the browser logs every failed request. One test adds the
500 its own error state is about.

**Screenshot baselines** live beside each spec (`*-snapshots/*-chromium-win32.png`, about 1.5 MB)
and are environment-specific: they were recorded with Playwright 1.63.0's Chrome for Testing
153.0.8010.12 on Windows 11 (NT 10.0.26200). Never accept a new or changed baseline without looking
at it (`npx playwright test --update-snapshots` only after inspection). Running e2e in Linux CI would
need its own baselines; e2e is not part of CI or `scripts/check.ps1` yet.

## 7. Migration boundaries

- Migrate one route at a time: put `.tb-theme` on its root and replace legacy markup with the
  primitives. Do not mix a legacy class (`.primary-button`, `.compact`) with a primitive on the same
  element.
- The pre-foundation palette (`--accent`, `--surface`, `--border-strong`, …), the global element
  rules and the global `#1c1b19` focus outline stay until every route is migrated, then go in one
  dedicated cleanup. No compatibility aliases were added: only `--accent`, `--danger` and `--surface`
  share a value with a new token, and aliasing them would couple unmigrated routes to the new palette.
- Keep all behaviour contracts: cookies and antiforgery, tenant headers, workspace/session epoch
  checks, API contracts, route permissions and entitlement decisions are untouched by the
  primitives. Never hardcode a Figma sample value such as the "Owner" role label; roles come from
  the membership.
- Do not add inert product controls (placeholder search, fake unread counts) while migrating.
- Standalone controls work (`density` applies without a field), but grid-cell error wiring —
  `aria-invalid` plus a row-level message — is not built yet; add it with the Program editor grid.

## 8. Figma corrections applied with this slice (2026-09-22)

Figma was treated as read-only afterwards. Each edit was proven minimal by reverting it in one
script and re-hashing all 11 Screens frames (node properties, PNG export and annotation text)
against the pre-change fingerprints: every frame matched, then the edits were restored.

| Node | Change |
|---|---|
| `193:346` (Programs `190:243`, row Conditioning Base, v2) | "29 Aug" → "10 Aug", matching assignment `321:2096` |
| `339:2178` annotation (Today `339:2140`) | Stale "Cut — 2,050 kcal / 120 g protein" provenance replaced: the meal count is illustrative; slots and logging status come from the client nutrition-day response |
| `148:195`, `148:218`, `148:226` (Check-in review `145:122`) | Compact strong → Compact body, matching `148:203`; text, colour and layout unchanged |
| `373:2170` annotation | Adds that answer presentation is neutral and not value-dependent |
| `294:1814` annotation (Exercise editor `292:1719`) | CSS note corrected: one vertical form-scroll region; `overflow-x: visible` computes to `auto` beside `overflow-y: auto`; prevent sideways overflow by layout and padding; verify first/last focus in the browser |

## 9. Slice 2 — the coach shell

Figma: coach proof `15:2` and Desktop Navigation v1 `118:135` (the Navigation/Sidebar item component
set `121:165` and its eight icon masters). Code: `src/app/shell/`.

**Three shells, one at a time, chosen from the validated membership.** `App.shell()` returns `coach`
when `TenantStore.canCoach()`, `member` for a client or an account with no workspace (the
pre-existing top bar, unchanged, plus the client bottom tabs), `public` for a visitor, and `pending`
while a session's first membership list is still loading — so an owner never sees the member bar
flash first. **This is presentation.** Guards, tenant headers and server decisions are untouched:
Settings is omitted for a Coach while `ownerGuard` and the API still refuse `/workspace`.

**Layout.** `app-coach-shell` is `display: contents`, so its `<aside class="sidebar">` (a
complementary landmark) and `<header class="topbar">` (banner) are grid items of the app root beside
its single `<main>` and router outlet. The sidebar is `max(232px, 14.5rem)` — Figma's 232px at the
default text size, growing with a larger browser text setting rather than truncating every label.
Brand and account footer are fixed; only the navigation region scrolls, with 24px inline and 8px end
padding so a row's 5px focus reach is never clipped. In RTL the grid mirrors and the sidebar sits at
the inline end.

**Route selection.** One destination per section, pointing at that section's landing page:

| Destination | Link | Section it stands for |
|---|---|---|
| Overview | `/` | that page only |
| Clients | `/clients` | `/clients`, `/invitations` (its "Invite client" page) |
| Training | `/training/programs` | `/training/*` |
| Nutrition | `/nutrition/library` | `/nutrition/*` |
| Check-ins | `/checkins/forms` | `/checkins/*` |
| Messages | `/messages` | `/messages/*`, shown only while `MessageUnreadStore.isAvailable()` |
| Products | `/products` | `/products/*` |
| Settings | `/workspace` | `/workspace/*`, Owner only |

`destinationState()` returns `page` only when the open path **is** the link's path, and `section`
when another page of that section is open; the template maps those to `aria-current="page"` and
`aria-current="true"`. Selection is a filled row plus `aria-current`, and forced-colours mode
substitutes the system selection colours, so it never depends on colour alone.

**Reachability.** Sections with a second page carry `app-section-nav` links on their own pages
(Programs | Exercises, Check-in forms | Client check-ins), which is how `/training/exercises` and
`/checkins/clients` stay reachable without their own sidebar rows. Invitations is reached from
Clients. Notifications is the top-bar bell (its own unread count, never summed with messages),
account security and sign-out are in the account menu, and workspace switching is the workspace
control in the top bar when the user belongs to more than one.

**Responsive.** Below 1024px the sidebar is replaced by a **Menu** button that opens the same
navigation in a native modal `<dialog>`: the platform owns the focus trap, the inert background and
the top layer, while the component owns Escape (so focus returns to the Menu button on every path)
and closes it on navigation, on a workspace change and when the window grows past the breakpoint.
Figma has no hamburger or close glyph, so both controls are text buttons rather than invented icons.

**Session safety.** `TenantContext.onChange` closes every menu and the dialog synchronously, so
nothing opened for one workspace can act on another; workspace switching and sign-out run through
`App`, which keeps the existing `select` → invalidate → navigate and clear-both-counts → logout →
navigate sequences.

## 10. Slice 2 — the exercise library (first migrated route)

Figma `266:1429`, including its development, interaction, content and accessibility annotations.
Only the **default list state** is migrated. `New exercise` and `Edit` still open the pre-existing
inline editor and its media management, whose markup, payload construction and calls are unchanged
and deliberately outside `.tb-theme` (`exercise-library.legacy.scss`).

| Figma | Code |
|---|---|
| Training header `266:1477`, scope copy `266:1481` | `.page-header` (heading, section links, one Filled action) |
| Section navigation `266:1484` | `app-section-nav` — links with `aria-current="page"`, never a tablist |
| Search and filters `267:1581` | `<form role="search">` over the existing `GET /api/exercises` parameters |
| Library summary `266:1494` | `role="status"` line, repeated as the table `<caption>` |
| List header `266:1496` and rows `269:1570`… | `.tb-table` with `<th scope="col">`, a visually hidden Actions header and explicit ARIA roles |
| Status `269:1578` | `app-status-label` (success + check / neutral + dot) plus "Not in new templates" |
| Row actions `268:1630` | Text buttons whose accessible names carry the exercise name |

**Honest counts.** The client asks for `take=100`, which is what the server returns at most (it
clamps `take` to 1-100; the previous `take=200` claimed a page size that never existed). The summary
says `N exercises · sorted by name` when every match is loaded and
`Showing the first X of N. Refine the search.` when it is not. Both are plural-aware ICU messages
with locale number formatting and `<bdi>` around every count. No archived count is invented: `total`
counts every match while the rows are capped, so the two could disagree.

**Filters** stay server-side and are applied only by **Apply** or **Enter** in the search field.
Draft control values and applied values are separate signals, so a select changed but not applied
never leaks into the reload that follows an archive or restore.

**Archive asks first.** `Archive` opens a modal dialog titled `Archive {name}?` that explains what
changes and what is kept; only its `Archive exercise` button sends `{ isArchived: true, version }`.
Cancel and Escape send nothing and return focus to the row's Archive button. `Restore` is direct.
A 409 reloads the list and says so in the polite status region without applying stale local state,
and a tenant switch, a sign-out or leaving the screen closes the dialog and clears the busy state.
Archived rows offer `Restore` alone, because the server refuses to edit an archived exercise.

**Table behaviour.** Desktop keeps Figma's column widths as `table-layout: auto` preferences, so a
longer translation takes the width it needs from the Exercise column; headers wrap between words and
never inside one; names clamp to two lines with the full name in `title` and in the action names.
Below `60em` of card width — a container query in `em`, so enlarged text stacks too — each row
becomes a labelled block, with the column headers kept for assistive technology and explicit ARIA
roles keeping it a table. The page never scrolls sideways in either direction.

**Deliberate deviations.** The Figma quick search and its ⌘K hint are not rendered: no such
repository capability is wired. The list scrolls inside its card at desktop sizes with a sticky
header row, but the card is bounded by `max(24rem, calc(100dvh - 16rem))` rather than owning the
viewport, so enlarged text scrolls the page instead of shrinking the region to nothing. Media
management appears with the legacy editor rather than on the default list, which is where Figma puts
it (`292:1719`); every media call is unchanged.

## 11. Remaining work

**Foundation follow-ups:** grid-cell error wiring; Linear progress; aligning the global focus rule
and removing the legacy palette after migration; Linux baselines if e2e joins CI; `@types/node`
and an e2e `tsconfig` if editor type-checking of the browser tests is wanted (the specs pass
strict type-checking apart from Node globals); reviewed Arabic copy (the lab's Arabic is sample
text only).

**Feature gates — keep explicit; not solved by this slice:**

- Exercise editor: preserve all muscles, alternative IDs and notes, and linked media; enforce limits;
  add unsaved-changes protection; preserve edits on conflicts. Do not ship a redesigned editor on
  the current data-losing save behaviour.
- Check-in workflow: retain message idempotency; after partial success retry only the review;
  address navigation and reload recovery before shipping that flow.
- Programs search: backend query support is unresolved.
- Paging: the backend supports paging; do not repeat the outdated "no paging endpoint" claim.
- Today: the remaining coverage-state ambiguities need a contract decision.
- Production shells must preserve workspace switching, account actions and role-aware routes. The
  coach shell does (slice 2, §9); the client and signed-out shells are still the pre-existing ones
  and are migrated in their own slices.
- Historical backend integration-test failures remain separate work: the messaging rate-limit test
  that failed only under full-suite load, and the media-purge test that reproduces locally (a
  Windows-related cause is a hypothesis, not a diagnosis).

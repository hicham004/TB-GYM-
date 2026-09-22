# TB Gym — Frontend Design System (Foundation Slice 1)

Status: foundation slice 1 implemented 2026-09-22 on top of `c18903f`. Tokens, core primitives, a
development-only UI lab and browser checks exist. **No production route has been migrated yet.**

This is the handoff for anyone migrating a screen to the approved design. It covers the Figma-to-code
mapping, how to use the primitives, how to run the lab and tests, what the foundation deliberately
does not change, and what is still open. It corresponds to Task 2 of
[FRONTEND-UX-AUDIT.md](FRONTEND-UX-AUDIT.md) (a bounded subset) and starts its Task 9 browser layer.

## 1. Where things live

| Path | What it is |
|---|---|
| `src/web/src/styles/_tokens.scss` | Figma variables as CSS custom properties on `:root` |
| `src/web/src/styles/_ui.scss` | Opt-in `.tb-*` classes: theme scope, typography, buttons, native controls, field, checkbox |
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
| Icon/Chevron down `234:485` | CSS | Background image of `.tb-select`, at the logical inline end |

Not built in this slice: Feedback/Linear progress `71:45`, Navigation/Sidebar item `121:165` and the
navigation icon masters (coach-shell slice), tables, cards, empty/error/locked states, dialogs,
confirmation tiers, date pickers.

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
motion; forced colours. `e2e/existing-routes.e2e.ts` compares sign-in, coach registration and the
exercise library (owner session, mocked) against baselines captured at `c18903f` before any
foundation code existed, as a guard against global-style regressions. All API responses are
test-only `page.route` mocks; the application's guards and interceptors run unchanged.

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

## 9. Remaining work

**Next bounded slice — coach shell.** Sidebar item, top bar, account and workspace switching built
from these primitives, preserving workspace switching, account actions and role-aware routes. It
should also fix a pre-existing defect found here: the current shell's public navigation keeps
"Coach registration" on one line (`.primary-button` is `nowrap`), so at 200% text the page scrolls
sideways on every signed-out route, `/auth/sign-in` included.

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
- Production shells must preserve workspace switching, account actions and role-aware routes.
- Historical backend integration-test failures remain separate work: the messaging rate-limit test
  that failed only under full-suite load, and the media-purge test that reproduces locally (a
  Windows-related cause is a hypothesis, not a diagnosis).

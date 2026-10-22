# TB Gym — Frontend Implementation Reference

**What the product should look like, and in which order screens are rebuilt, is decided only by
[UI-REDESIGN-PLAN.md](UI-REDESIGN-PLAN.md).** This file is the practical reference for where
frontend code lives and how to run the lab and browser tests. The Figma file is retired as a source
of truth (plan §8); its token names remain as aliases until R5.3.

## Where things live

| Path | What it is |
| --- | --- |
| `src/web/src/styles/_tokens.scss` | Brand v2 and light/dark CSS properties, with v1 and legacy aliases during migration |
| `src/web/src/app/core/theme/` | Validated brand colour derivation, mode state and the route marker for rebuilt pages |
| `src/web/src/styles/_brand.scss` | The homepage's fixed TB Gym brand, the shared Instrument Serif italic, and the homepage's own faces (Plex Medium, Plex Mono Medium, the upright serif; R6.2f) |
| `src/web/src/styles/_ui.scss` | Opt-in `.tb-*` classes: typography, buttons, native controls, field, checkbox, table, dialog |
| `src/web/src/styles.scss` | Global styles; legacy colour names now resolve through `_tokens.scss` |
| `src/web/src/app/ui/` | Component kit v2: surfaces, metrics, people/status, charts, selection controls and overlays, alongside the existing form primitives |
| `src/web/src/app/shell/` | The coach shell and the client tab bar |
| `src/web/src/app/dev/` | Development-only routes: component kit (`/dev/ui-lab`) and the three prototype hero screens (`/dev/ui-lab/hero`) |
| `src/web/public/hero-lab.css` | Prototype-scoped hero preview styles; loaded only by the development hero route |
| `src/web/e2e/` | Playwright + axe browser checks and their screenshot baselines; `e2e/built/` runs against a real build (the pre-rendered homepage and changelog, R6.2a, R6.2f) |
| `src/web/scripts/` | Build-time checks: the style lint (`check-legacy-styles.mjs`), the pre-render check `npm run build` ends with (`check-prerender.mjs`), `serve-built.mjs`, which serves a build the way `nginx.conf` does for the `built` Playwright project, `home-pictures.mjs`, which photographs the sample demo for the homepage (R6.2d; Apple's bezel and `sharp` stay outside the repository), and `inline-home-styles.mjs`, which `npm run build` runs to put the global stylesheet inside the pre-rendered pages |
| `src/web/public/fonts/` | The self-hosted faces: IBM Plex Sans (Latin subsets since R6.2b, Medium since R6.2f, see its README), IBM Plex Sans Arabic, IBM Plex Mono Medium and Instrument Serif (italic and upright) |
| `src/web/public/images/home/` | The homepage's pictures of the app on the sample demo "Oakline Strength" (R6.2f): phones under Apple's iPhone 17 bezel at three widths, coach windows at 2x and 1x, AVIF and WebP |
| `src/web/src/content/changelog.md` | What changed, in coaches' words, newest first; imported as text at build time for `/changelog` and the homepage's "last change" date (R6.2f) |
| `src/web/src/main.server.ts`, `src/app/app.config.server.ts`, `src/app/app.routes.server.ts` | The build-time render: its entry, its providers and the two routes it renders (`/` and `/changelog`) |

## Lab and tests

```powershell
# Lab (development build only; no API needed)
.\scripts\run-web.ps1                    # then open http://localhost:4200/dev/ui-lab?brand=navy&mode=dark

# From src/web, after dot-sourcing scripts/Toolchain.ps1 and Initialize-TbGymToolchains:
npm test                                 # Vitest
npm run e2e                              # Playwright + axe; starts ng serve on 127.0.0.1:4300 and, for e2e/built/, a build in .e2e-dist on 4301
npm run build                            # production build; ends with the pre-render check (scripts/check-prerender.mjs)
npx playwright install chromium          # once per machine
```

- **Production exclusion.** The `development` configuration swaps in both the UI lab route and the
  `?brand=forest|navy|charcoal|plum&mode=light|dark|system` preview provider. Production contains
  neither. Until R2.1 and R3.5 save personal mode and coach brand, production uses the CSS defaults.
- **R1.2 dependencies.** `@angular/aria` supplies tab keyboard, focus and RTL behavior;
  `@angular/cdk` supplies dialog focus management and overlay positioning for dialogs, sheets and
  toasts. Their styles load with the overlay components, keeping them out of the initial bundle.
- **R1.3 preview.** The hero lab uses local demo fixtures and does not save a workout or coach action.
  GSAP is imported only when a preview motion plays. Compare its 390 px and 1440 px Playwright
  captures with the saved prototype captures in `e2e/hero-lab.e2e.ts-snapshots/`.
- **No console noise.** `e2e/support.ts` fails a test on any unexpected console error. It answers the
  messaging hub (SignalR negotiate plus a mocked WebSocket) and `GET /api/billing/access`. When a
  shell-level request is added, add its mock here, or every shell test fails.
- **Screenshot baselines** sit beside each spec (`*-snapshots/*-chromium-win32.png`). They depend on
  the environment (Playwright's Chrome for Testing on Windows 11). Never accept a new or changed
  baseline without looking at it. e2e is not part of `scripts/check.ps1`, so run it whenever the
  shell or a shared component changes.
- **Two zones** (audit WEB-17). The `chromium` project's browser is in UTC. The `far-zone` project runs the
  screens that show a workspace's day with the browser in Kiritimati (UTC+14) while the mocked workspaces keep
  Asia/Beirut, so from 10:00 to 21:00 UTC the device's day is the workspace's tomorrow: a screen that reads a day
  from the device where the workspace's belongs fails there for an instant in that window (pin the clock in it, as
  most specs do at noon), and in `chromium` for one from 21:00 UTC. It compares no pixels; `--project=chromium`
  runs one project.
- **Design pictures.** A spec writes its `docs/design` pictures only when asked,
  `$env:TB_GYM_DOCS_PICTURES = '1'` (then `Remove-Item Env:TB_GYM_DOCS_PICTURES`), and only from `chromium`
  (`e2e/docs-pictures.ts`), so a plain run leaves the committed pictures alone.
- **Name specs `*.e2e.ts`.** Prettier reads `src/web/.gitignore` only.

## Quality checks every redesigned screen keeps

axe with zero violations (WCAG 2.0–2.2 A/AA), 200% text and 320 px reflow, no sideways scroll at
390 and 1440 px, LTR and RTL layout, visible focus rings, and reduced motion. The full definition of
done is in plan §2.

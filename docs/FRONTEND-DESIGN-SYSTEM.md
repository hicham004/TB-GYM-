# TB Gym — Frontend Implementation Reference

**What the product should look like, and in which order screens are rebuilt, is decided only by
[UI-REDESIGN-PLAN.md](UI-REDESIGN-PLAN.md).** This file is the practical reference for where
frontend code lives and how to run the lab and browser tests. The Figma file
(`7N4K2BM3XFoYhBjUnsi4wa`) is retired as a source of truth (plan §8). Its token names still appear
in `_tokens.scss` until brand v2 replaces them (plan §3).

## Where things live

| Path | What it is |
| --- | --- |
| `src/web/src/styles/_tokens.scss` | Design tokens as CSS custom properties on `:root` (v1, to be replaced by brand v2) |
| `src/web/src/styles/_brand.scss` | The homepage brand (forest, cream, lime, Instrument Serif); the source for brand v2 |
| `src/web/src/styles/_ui.scss` | Opt-in `.tb-*` classes: typography, buttons, native controls, field, checkbox, table, dialog |
| `src/web/src/styles.scss` | Global styles, including the **legacy palette** (`--accent`, `--surface`, ...) that the redesign deletes |
| `src/web/src/app/ui/` | Primitives: button, icon, status label, avatar, field, checkbox, section nav, password reveal. Component kit v2 grows here |
| `src/web/src/app/shell/` | The coach shell and the client tab bar |
| `src/web/src/app/dev/` | Development-only routes and the UI lab (`/dev/ui-lab`) |
| `src/web/e2e/` | Playwright + axe browser checks and their screenshot baselines |

## Lab and tests

```powershell
# Lab (development build only; no API needed)
.\scripts\run-web.ps1                    # then open http://localhost:4200/dev/ui-lab (?dir=rtl)

# From src/web, after dot-sourcing scripts/Toolchain.ps1 and Initialize-TbGymToolchains:
npm test                                 # Vitest
npm run e2e                              # Playwright + axe; starts ng serve on 127.0.0.1:4300
npx playwright install chromium          # once per machine
```

- **Production exclusion.** `app.routes.ts` spreads `devRoutes` from `dev/dev-routes.ts`, an empty
  array. Only the `development` configuration swaps in `dev-routes.development.ts`, so production
  builds never contain the lab.
- **No console noise.** `e2e/support.ts` fails a test on any unexpected console error. It answers the
  messaging hub (SignalR negotiate plus a mocked WebSocket) and `GET /api/billing/access`. When a
  shell-level request is added, add its mock here, or every shell test fails.
- **Screenshot baselines** sit beside each spec (`*-snapshots/*-chromium-win32.png`). They depend on
  the environment (Playwright's Chrome for Testing on Windows 11). Never accept a new or changed
  baseline without looking at it. e2e is not part of `scripts/check.ps1`, so run it whenever the
  shell or a shared component changes.
- **Name specs `*.e2e.ts`.** Prettier reads `src/web/.gitignore` only.

## Quality checks every redesigned screen keeps

axe with zero violations (WCAG 2.0–2.2 A/AA), 200% text and 320 px reflow, no sideways scroll at
390 and 1440 px, LTR and RTL layout, visible focus rings, and reduced motion. The full definition of
done is in plan §2.

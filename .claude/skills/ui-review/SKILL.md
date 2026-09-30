---
name: ui-review
description: Review TB Gym Angular templates, SCSS and components against a pinned copy of Vercel's Web Interface Guidelines (accessibility, focus, forms, motion, copy, touch, dark mode, performance), read in Angular terms and overridden by docs/UI-REDESIGN-PLAN.md. Use before calling a redesigned screen or kit component done, or when asked to review the UI, accessibility or UX of changed files.
argument-hint: <file-or-pattern>
---

# UI review

Review the files the user names (or the UI files changed in the working tree, if they say "my
changes"). If nothing is named, ask which files.

1. Read `vercel-rules.md` in this folder. It is a frozen copy of
   `vercel-labs/web-interface-guidelines` `command.md` at commit `e3d624b` (2026-08-17, MIT, see
   `LICENSE`). Never fetch the live file. To update it, diff the upstream file against this copy,
   review the change, then replace it.
2. Read the named templates, SCSS and TypeScript files.
3. Check them against those rules, applying the overrides below.
4. Report in the rules file's terse `file:line` format, grouped by file. Put any clash between a
   rule and our plan under a final **Plan conflicts** heading instead of fixing it.

This is a static read of code. It does not replace axe, the 390 px and 1440 px screenshots, or the
real-browser click-through in the plan's definition of done (§2).

## TB Gym overrides (these win over the rules file)

- **Precedence.** `docs/UI-REDESIGN-PLAN.md` (§2 quality bar, §3 brand and motion, §4 kit, §6
  words) and `AGENTS.md` win over any rule here.
- **Copy.** Sentence case for headings and buttons ("Save changes"). Skip the Title Case rule.
  Also flag any system word listed in the plan's §6 glossary.
- **Hydration Safety.** Skip the section. The app renders in the browser only (no SSR).
- **Focus rings.** `outline: none` is fine on a heading or region that only takes programmatic
  focus (focused after navigation or a retry, not tabbable). Flag it only on controls.
- **No Tailwind** (plan §4). Read Tailwind class names as the equivalent CSS in the component SCSS:
  `focus-visible:ring-*` is a `:focus-visible` style, `truncate` / `line-clamp-*` / `min-w-0` /
  `overflow-x-hidden` / `hover:` are the matching CSS properties and states.
- **React and Next.js terms, read as Angular:**
  - `onKeyDown` / `onKeyUp`: `(keydown)` / `(keyup)`. A native `<button>` or `<a>` needs no key
    handler. For custom widgets (menu, listbox, tabs, combobox) prefer `@angular/aria` or
    `@angular/cdk/a11y` over hand-written key handling.
  - `<Link>`: `<a routerLink>`. Flag `(click)` handlers that navigate from a non-link element.
  - `htmlFor`: `for`. `spellCheck={false}`: `spellcheck="false"`. `autoFocus`: `autofocus` or
    `cdkFocusInitial`.
  - Controlled and uncontrolled inputs: the component's existing reactive or template-driven
    form. Keep per-keystroke work cheap (no heavy `valueChanges` or `effect` chains).
  - `useState` plus nuqs URL sync: router query params.
  - Unsaved-changes warning: a `CanDeactivate` guard.
  - `virtua` and large `.map()` lists: large `@for` lists without `@angular/cdk/scrolling`
    virtual scroll, `content-visibility: auto` or paging.
  - Image `priority`: `NgOptimizedImage` `priority`, or `fetchpriority="high"`.
  - `Intl.*` formatting: Angular's `DatePipe`, `DecimalPipe` and `CurrencyPipe` count as `Intl`.
    Flag hand-built date, number or money strings.

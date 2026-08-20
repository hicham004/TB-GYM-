# ADR 0003: Lebanon launch and localization-ready defaults

- Status: Accepted
- Date: 2026-08-20

## Context

The initial market is Lebanon. English ships first, Arabic and other languages must be
possible without changing domain contracts. Currency and calendar behavior cannot be
hard-coded into the application.

## Decision

- English is the source locale. Angular user-facing text is marked for extraction with the
  Angular localization toolchain, and layouts use direction-aware CSS so Arabic can add RTL
  presentation later.
- API contracts use stable machine-readable codes. Translated display text belongs at the
  presentation boundary rather than in persisted enums or domain rules.
- New workspaces default to `Asia/Beirut`, Monday as the first day of the week, `en-LB`, and
  `USD`. Owners may configure valid IANA time zones, cultures, week starts, and three-letter
  ISO currency codes.
- Stored money always includes its currency. No business calculation assumes USD.
- Phase 1 is adults-only. The server rejects onboarding completion for a person under 18 on
  the effective tenant-local date. Minor/guardian consent requires a later legal and product
  decision.
- Lebanon's Law 81/2018 on electronic transactions and personal data is a launch constraint.
  Sensitive intake data requires least privilege, auditability, retention decisions, and
  qualified Lebanese legal review before production.

## Consequences

- Dates are interpreted using workspace settings, while instants remain UTC.
- Adding Arabic requires translated message files and review, not a rewrite of components or
  database values.
- Production readiness cannot be declared until privacy notices, consent, processor/provider
  contracts, retention, export, and deletion behavior receive legal review.


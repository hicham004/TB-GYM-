# ADR 0006: Access, Notification Outbox, and Legal Consent

Status: accepted, 2026-08-20

## Context

Every future coaching module needs the same answer to whether a client may use a feature.
Angular navigation cannot be authoritative. Commercial events also need delayed and retried
notifications without duplicate delivery, and launch preparation requires evidence of the
exact legal-document version a user accepted.

## Decision

`ICoachingFeatureAccessService` is the narrow cross-cutting port in SharedKernel. Its
Infrastructure implementation evaluates, in order:

1. active tenant and client membership;
2. platform account block;
3. workspace-local client relationship block;
4. feature entitlement and service dates;
5. enrollment lifecycle;
6. full-payment rule.

It returns a stable reason such as `Granted`, `PaymentRequired`, `Paused`, `Expired`, or
`RelationshipBlocked`. Future feature APIs must call this service on every protected
resource request and deny by default. This follows the OWASP recommendation to validate
authorization on every request and deny by default in the
[Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

The Notifications module owns a persistent outbox row with tenant, recipient, aggregate,
kind, deduplication key, payload, scheduled UTC instant, and source tenant time zone. Phase 2
schedules payment-required, activated, ending-soon, expired, and renewed jobs atomically
with commercial state. A unique tenant/deduplication key prevents duplicate scheduling.
Dispatch, templates, retry backoff, and provider delivery are intentionally deferred; a
future worker must re-evaluate eligibility before sending a delayed item.

Identity owns global versioned legal-document metadata and append-only acceptances. A
document records kind, version label, culture, context, immutable content hash/URI,
professional-review status, publication, and retirement. An acceptance records user,
document version, platform/workspace context, tenant where applicable, accepted time, and
audit actor. No legal wording is seeded. Only approved, published, current versions can be
accepted.

## Consequences

- Workspace A can block a shared user without affecting Workspace B.
- Unpaid clients retain authentication and basic profile access while coaching features are
  locked.
- Notification scheduling is durable and idempotent, but Phase 2 does not claim delivery.
- Final Terms, Privacy Policy, health consent, and Lebanon-specific obligations remain launch
  blockers until professional review.
- Sensitive health/payment details are excluded from outbox payloads and logs, consistent
  with the [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).

# ADR 0004: Client onboarding field ownership

- Status: Accepted
- Date: 2026-08-20

## Context

Coach-prefilled data, client-entered intake, and private professional notes must not be mixed
in one unrestricted update model.

## Decision

- Clients may edit their own name, phone, birth date, height, work/activity information,
  training background, food preferences and aversions, goals, allergies, medications, and
  previous injuries inside the active workspace.
- Account email is read-only in the intake flow. Email change requires a separate
  re-verification workflow.
- Owners and Coaches may correct client-editable intake fields for clients they manage. Actor,
  UTC timestamp, and optimistic concurrency version are retained for every update.
- Coach professional notes and coach-block state are separate coach-only fields and are never
  returned in the client's self-profile contract.
- Initial bodyweight is submitted with an explicit unit and measurement date and becomes a
  tenant-owned progress observation. It is not copied into a second mutable "current weight"
  profile field.
- Onboarding completion requires an adult birth date, valid height, initial bodyweight, and a
  non-empty goal. Other sensitive answers may be omitted or explicitly left blank.
- Profile photography is optional. Bytes and publication metadata will use the Media module's
  validated upload flow; Phase 1 does not introduce an unsafe ad hoc upload endpoint.

## Consequences

- Client and coach updates use different request contracts and authorization policies.
- Backend validation remains authoritative even when Angular hides coach-only controls.
- Sensitive intake values are excluded from logs, notification payloads, and generic audit
  messages.


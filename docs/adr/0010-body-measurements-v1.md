# ADR 0010: Body Measurements v1

Status: accepted, 2026-08-23

## Context

Phase 5B-1 adds dated measurements without creating a new module or weakening the Phase 5A
history and tenancy model.

## Decision

One current row exists per tenant, client, local measurement date, and `MeasurementType`.
Types are `Waist`, `Chest`, `Hips`, `Thigh`, `Arm`, and `BodyFatPercentage`; adding a type is
an enum-only change, not a schema or generic EAV/type-table change.

`MeasurementUnit` is `Centimetre`, `Inch`, or `Percent`. Girths accept centimetres or inches
and store canonical centimetres. Body fat accepts and stores percent only. Entered value and
unit are retained, and display conversion always starts from the canonical value.

Canonical girths must be 10-300 centimetres. Body fat must be 1-75 percent. Domain validation
and PostgreSQL check constraints enforce both ranges and compatible type/unit combinations.

## Consequence

Missing types remain absent facts; no measurement or body-fat value is inferred.

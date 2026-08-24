# ADR 0009: Bodyweight and Weight Trend

Status: accepted, 2026-08-22

## Context

Phase 1 already creates `BodyweightObservation` from intake. Phase 5A needs daily entry,
correction history, workspace-week summaries, and a modest trend estimate without creating a
second current-weight fact, gating personal history behind payment, or coupling Progress to
Nutrition.

## Decision

`BodyweightObservation` remains the one current observation per tenant, client, and local
calendar date. Intake creates the client's first observation through that same model.
Kilograms are canonical and rounded to three decimals; every row also retains the entered
value and `Kilogram` or `Pound` unit. Display conversion always starts from canonical kg, so a
display-unit change cannot reinterpret stored data. Origin is `Client` or `Coach`; the
`DeviceImport` value is reserved but no device integration is implemented.

A correction never changes the observation date or identity. It updates the current value
under optimistic concurrency while atomically appending the complete prior canonical and
entered values, unit, origin, recording actor/time, correction actor/time, and reason. Unique
and tenant-composite database constraints protect the current row; database and application
guards make correction history append-only and prevent observation deletion.

Dates default from `IClock` converted into the workspace IANA time zone. Weekly summaries
align to `Tenant.WeekStartsOn`, cover half-open seven-day windows, average recorded
observations only, and publish the observed-day count. Missing dates remain absent facts and
are rendered as empty days.

Clients may log and view their own bodyweight with an active tenant-client membership even
when coaching entitlement is absent or expired. Client endpoints resolve the profile from the
authenticated user and never accept a client-profile identifier. Coach operations require
`TenantCoach`, a client visible inside that tenant, and an unblocked workspace relationship.
After `ClientProfile.IsCoachBlocked` is set, coach-facing progress and history reads return
not found and coach writes return forbidden; the client's own progress access is unchanged.
This relationship rule is workspace-scoped. No new `CoachingFeature` is added.

`BodyweightTrendEwma` version `1` used a fixed smoothing factor of `0.25` per observation. It
is superseded because it treated a one-day and a sixty-day gap identically.

The active strategy is `BodyweightTrendEwma` version `2.0` (v2). For consecutive observations it
uses elapsed calendar days and `alpha = 1 - exp(-deltaDays / tau)`, with `tau = 10 days`.
The oldest included observation seeds the estimate. Every displayed observation date is
calculated from real observations in its own half-open 90-day warm-up period plus that date;
this keeps a date's rounded result independent of the requested display window. Reads fetch
only the 90 days preceding `from` in addition to the requested/weekly range, so work remains
bounded. Ninety days is about nine time constants, leaving less than 0.1% influence from an
earlier observation. Estimates are rounded to three decimals only at the output boundary.

A trend is `NotEnoughData` until the requested display window contains at least three real
observations. That state carries the current window sample count and emits no latest or daily
trend estimate. An available response includes the method key/version, 10-day time constant,
90-day warm-up, minimum sample count, actual window sample count, half-open window, and an
explicit estimate flag. API and UI language never describes the result as fat loss or
physiological truth. Progress query windows contain 1 through 366 days; invalid ranges are a
400 validation response.

## Consequences and deferrals

Progress reads and writes do not trigger TDEE, calorie target, macro, meal-plan, or other
Nutrition changes, and Nutrition does not read Progress in Phase 5A.

Mesocycle-aligned summaries, end-of-mesocycle change, subscription/program-period links,
date-adjustment impact analysis, exports, retention/deletion workflows, and device imports are
deferred to Phase 5B or later. The raw observation remains coherent and available independent
of those future projections.

Correcting an accidentally mis-dated observation, including voiding/replacing it without
losing audit history, remains a follow-up. Phase 5A correction changes values only. This was
subsequently delivered as void-and-replace; see
`docs/adr/0015-bodyweight-date-correction-v1.md`.

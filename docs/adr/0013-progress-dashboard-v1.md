# ADR 0013: Combined Progress Dashboard v1

Status: accepted, 2026-08-23

## Context

Bodyweight, measurements, photos, nutrition logging, and training completion are recorded by
separate modules under separate rules. A coach reviewing a client currently reads five places. The
combined view was deferred from Phase 5A onward because composing it naively is an authorization
hazard, not because the projection is hard.

## Decision

The dashboard is a **read-side projection and nothing else**. It creates no table, owns no data,
and copies nothing into Progress. Two endpoints, `GET /api/progress/me/dashboard` and
`GET /api/progress/clients/{clientProfileId}/dashboard`, mirror the authorization shape of every
other progress read: a client sees only themselves, and a coach-facing read on an unknown client and
on a blocked relationship are both `404`, so blocking cannot be probed.

Composition happens in Infrastructure. The Progress module still references `TB.Gym.SharedKernel`
alone, which the module-dependency architecture test enforces, so the dashboard contracts carry
counts, dates, and `CoachingFeature`/`FeatureAccessReason` rather than another module's types.

**Per-section entitlement is the point of this chunk.** Progress is deliberately
entitlement-independent: a client keeps their bodyweight, measurements, and photos when a
subscription lapses. Nutrition and Training are not. A dashboard that read those tables directly
would show a lapsed client's meal logs and training history to anyone who could load the page — an
authorization bypass that no existing test would have caught, because no existing endpoint composes
across that boundary.

Each cross-domain section therefore resolves `ICoachingFeatureAccessService` for **its own feature**
before any of its data is read. An unentitled section is returned present, explicitly
`Unavailable`, carrying the deciding `FeatureAccessReason` and a null context. It is never omitted,
because a missing section is indistinguishable from an empty one; and never populated, because
partial counts would leak the activity the entitlement was meant to gate. `EvaluateAllAsync` is
called once — it makes an independent decision per feature in a single pass over the entitlement
tables, so two `EvaluateAsync` calls would repeat five queries to reach the same two answers.

**Honest metrics only.** Every count is reported with the span it was counted over: "logged on 6 of
the last 7 days", "weighed on 12 of 84 days", "4 of 12 scheduled sessions completed". No adherence
score, percentage, streak, or rating is derived, because this data defines no target the client was
supposed to hit, so any such number would be invented. Scheduled-session counts exclude cancelled
mesocycles so the denominator reflects work actually asked for. A change is reported only when the
window holds at least two observations, rather than being shown as zero. The view states in the page
that the figures are placed side by side and that no relationship between them is implied; nothing
in this data establishes causation between domains, and the dashboard makes no clinical claim and no
recommendation.

Windows reuse the existing progress defaults unchanged — 84-day default, 366-day maximum, the same
`400` on an invalid range — and all dates resolve through the workspace time zone and configured
`WeekStartsOn`. The "recent" span is carved out of the requested window rather than measured from
today, so every figure comes from inside the range the caller asked for.

Photos use the Phase 5B-3 rendition only. The payload carries the thumbnail path or null, never a
path to the original. A photo stored before renditions existed renders as an explicit "preview
unavailable" tile rather than silently pulling a multi-megabyte image into a thumbnail slot.

## Consequences and deferred work

Efficiency is part of the contract. Every section is a bounded, date-filtered, database-side
projection over columns rather than a loaded aggregate, and the photo timeline resolves rendition
existence in the same statement instead of once per photo. An integration test asserts the whole
response stays within a query-count ceiling using the existing interceptor; the observed count is
16 against a ceiling of 20.

The `RecentDays = 7` span is a presentation choice, not a domain rule, and is stated in the payload
(`recentFrom`, `recentToExclusive`, `recentDayCount`) so a client renders the denominator it was
actually given rather than assuming seven.

Deferred: physical purge of tombstoned bytes, per-client storage quotas, counting derivative bytes
toward the workspace quota, correcting a mis-dated bodyweight observation, mesocycle-aligned
summaries, side-by-side photo comparison, exports, and any coupling to nutrition calculations.

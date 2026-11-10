# ADR 0040: Last time + step

Status: accepted, 2026-11-10 (notes plan N6a; decisions 21 and 22 of 5 Nov 2026, with 20 and the rest of 22
decided on 7 Nov); N6b and N6c will amend it

## Context

The plan's Point 6 (the owner's notes of 3 Nov 2026) asks for "+X kg" from what was logged: on many lifts a
coach raises the weight by a fixed step once the client has done the reps, rather than working it out from a
max. A set had five weight choices: no prescribed load (the client picks), a typed weight, % of training max,
and RPE on the Epley curve or the RTS chart; the last three start from the program's training max (ADR 0036,
STR-002, STR-011), and since 7 Nov 2026 nothing suggests a max from logged sets (STR-007, ADR 0036's last
section). Decision 21 (5 Nov) says who moves the weight: the coach, each week, after reading the logged sets
(the plan's option C), not the app when the workout opens (option A) and not a client's "Try 7 kg today" button
(option B). Decision 22 (5 and 7 Nov): reps typed before a set counts, no rounding at first, carry on from the
last time the lift was done, and a logged weight more than 25% away from the one before holds the lift.
Decision 20 (7 Nov): the step only when every set reached its reps.

## Decision

1. A sixth weight choice, `LastTimeStep`, "Last time + step" on screen (TRN-032), beside the five and under
   none. A set with it carries a step (`LoadStep`, more than 0 and at most 50 in the set's unit, two decimals at
   most), its unit (required; kg and lb are never converted), its reps (required: decision 20 judges every set
   against them) and an optional starting weight (more than 0 and at most 2,000; with none the client picks).
   The coach types both numbers: the weight is never worked out from a max or rounded, needs no training max,
   and a fixed load instead is refused on the set.
2. The step survives every copy: the draft, Publish, assignment, the builder's week copies and Build next block
   (their weight step moves the starting weight as it moves a typed weight, and the set's own step is copied as
   it is), Edit weeks, and the workout's snapshot at start, so a started workout keeps the choice and the step
   it began with.
3. The coach applies, never the app or the client (decision 21). N6a never adds the step: N6b will say where
   each lift stands, by a named, versioned rule, and N6c will let the coach apply it; until then the coach
   changes the weight with Edit weeks.
4. Reps first (decision 22): the player starts a step set's reps box empty and asks for the reps before ✓. It is
   a nudge only: the server still records a set logged without reps, and N6b's rule will never count it.

Why the coach (decision 21): ADR 0036's reasons for maxes hold for a step too. One day's sets move with sleep
and fatigue, which a coach can read and a rule cannot; typed weights win (STR-011); and nothing changes a weight
on its own.

## Beside, not under

- ADR 0036 keeps its rules for training maxes. A step set needs no max (STR-002), a max update leaves it alone
  (STR-011), and it never anchors "From week 1's weight" (TRN-026): a step never moves a max, and a max never
  moves a step set.
- STR-007 is untouched: a step set is not a calculated load, and a step from what was logged is the separate
  strategy STR-007 keeps apart from a max. STR-008's rounding is for weights worked out from a max; a step set
  is never rounded (decision 22: the client types the nearest weight they have).
- STR-009 holds: N6a adds no transform of its own, and a step reaches a weight only when the coach applies it
  (N6c).

## Consequences

- One migration, `LastTimeStepSets`: `LoadStep` on `training."ProgramTemplateSets"` and
  `training."SetPrescriptions"`, their two load-strategy checks widened (`CK_ProgramTemplateSets_LoadStrategy`,
  `CK_SetPrescriptions_LoadStrategy`) and a `CK_*_LoadStep` each, so only a step set has a step; the choice and
  the step on the workout's snapshot, `training."WorkoutSetPerformances"` (`LoadStrategySnapshot`,
  `PrescribedLoadStep`), held by `CK_WorkoutSetPerformances_LoadStep`; and `training.protect_workout_set()`
  extended, so neither changes once the workout has started.
- The API's set shapes (`SetPrescriptionRequest`, `SetPrescriptionView`) carry `LoadStep`, and the client's set
  view (`ClientSetView`) the choice and the step; the web's API client is regenerated.

## Migration and recovery

Nothing is backfilled: the new columns are nullable, and the append-only and history triggers forbid rewriting
old rows, so a workout started before keeps no choice and reads as before. Rolling back restores the trigger
function, drops the new columns and checks and narrows the two load-strategy checks again. Once a step set
exists the old checks would refuse it and a started workout would lose its step, so Down stops first with a
plain message ("Some sets use Last time + step; roll forward instead of reverting this migration.") and, as
ADR 0036 says of the chart, a rollback is a forward fix.

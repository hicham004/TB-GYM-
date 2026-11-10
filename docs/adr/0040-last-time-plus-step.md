# ADR 0040: Last time + step

Status: accepted, 2026-11-10 (notes plan N6a; decisions 21 and 22 of 5 Nov 2026, with 20 and the rest of 22
decided on 7 Nov); amended 2026-11-10 (notes plan N6b, then N6c, then N6d)

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
3. The coach applies, never the app or the client (decision 21). N6a never adds the step: N6b says where each
   lift stands, by a named, versioned rule (STR-019, below), and the coach applies it (STR-020, below) or types
   another weight with Edit weeks.
4. Reps first (decision 22): the player starts a step set's reps box empty and asks for the reps before ✓. It is
   a nudge only: the server still records a set logged without reps, and N6b's rule never counts it (STR-019).

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

## Where a lift stands (notes plan N6b)

`LastTimeStep` v1 (STR-019) is a named, versioned rule in the Training module, `LastTimeStepRule`, whose input
records Infrastructure fills from the rows. For each writing with a step set in a lift's coming session, the
client's latest workout of the lift by scheduled day decides, from any program under any session name. It
answers per set a new weight (last time's logged weight plus the step, exact, never rounded or converted) or a
hold with its reason. Each line is the owner's to change in a later version; the first hold that applies wins:

- never done; (b) the latest workout over 14 days old, even if still running; (g) the latest still running;
- (f) no writing to match last time (writings, then sets, are matched by order, warm-ups counted; a writing is
  the lift's only where it was done as written, and a swapped one keeps its place); the unit: a set logged in
  the other unit (warm-ups too);
- (e) a weight more than 25% from that set's latest earlier log that stood and from the weight that workout
  asked (warm-ups too): a first log stands, a typo after a log that stood holds once, an applied step never
  holds, and a typo logged again holds until a workout logs the set near a weight the coach types;
- (a, h) a working set not logged, logged with no reps typed (decision 22) or short of the reps that workout
  asked; (c) a working set rated above its target effort. Warm-ups never count in (a) or (c).

(d) Carry-on: a hold of (a) or (c) keeps last time's weight, the holds before them the set's own; (i) each set
steps by its own number. A set whose match gave nothing to step from or keep (no weight, or on a step no reps
typed) carries on its latest log that stood within the 14 days, else keeps its own; a set with no match keeps
its own. The coach's program read (TRN-022), mesocycle read and logged workout read carry the answers while the
coach's read is open (TRN-023), never the client's reads. N6b writes nothing, no table and no migration: the
coach applies (N6c, below).

## Applying a weight (notes plan N6c)

The coach applies an answer (STR-020), one lift or "Apply all" for a client, with
`POST /api/training/clients/{clientProfileId}/lift-weights/apply`: per lift, the sets the answer moves (a step
up, or last time's weight kept on a set at another weight) with the weights the coach read. The server reads
the answer again and writes only while it still says exactly that, else 409 `lift_standing_changed`; so a
coach never applies what they did not read, and nothing is worked out on the way. Why the coach and not a
button for the client or the app at the start of a workout stays decision 21: each apply is the coach's
weekly reading of the logged sets.

- The weight is written where a typed starting weight is, on the set itself (`DirectLoad`, and the
  prescribed load beside it), with the rule's key and version and why in words in the set's calculation
  fields, so Edit weeks, Build next block and the workout's snapshot carry it as they carry a typed weight,
  and the step stays. A dedicated route on the training maxes' pattern, rather than Edit weeks' whole-grid
  preview and apply, keeps the request to what the coach read and binds a retry to it.
- Each lift's apply leaves a row in `training."LiftWeightApplications"`, append-only: the rule and its
  version, the answer it read (last time's logged sets included), each set's weight before and after, who and
  when, and the idempotency key with the whole request's fingerprint. Sets and sessions are named by id with
  no foreign key, since Edit weeks replaces a changed session's rows; the row names its program.
- The client's line ("Up 2 kg · all 3 × 10 done on Tue") is built from that row on the client's reads of a
  workout still to do or running, while each set it wrote still holds that weight, and names nothing of the
  coach's.

## Coach Today (notes plan N6d)

The weekly apply is the coach's homework (decision 21), so Coach Today's Needs you, the client list and a client's
page name each client with weights to apply (CLI-018 v8): one per writing of a lift whose answer writes a weight, as
the Training tab lists them, ranked last and never Needs attention, each opening the tab at Weights to apply. They
read the same rule through one reader, `LiftStandingsReader`, batched over every client in scope, and from each
lift's last 15 days: Today is read every few seconds while a coach is around, and audit BEB-2 keeps its rows from
growing with a client's history. Only the typo guard (line e) reads further back, and a log within 25% of the
weight its own workout asked stands whatever came before it, so `LastTimeStepRule.RecentSettles` says when the last
weeks give the whole history's answer; the reader reads the workouts before them only when they do not (step sets
given no weight their client logged near in those weeks: no starting weight before the first apply, or two weeks
unapplied), so only such a lift's read grows with its history. Its coming read keeps each lift's first open session
on or after the UTC day after, and the few before it, rather than every week written ahead. The Training tab still
reads the whole history. Keeping the guard's standing on each finished set, or a guard that forgets after some weeks
(a version 2), would end the remaining growth (notes plan section 3).

## Consequences

- One migration, `LastTimeStepSets`: `LoadStep` on `training."ProgramTemplateSets"` and
  `training."SetPrescriptions"`, their two load-strategy checks widened (`CK_ProgramTemplateSets_LoadStrategy`,
  `CK_SetPrescriptions_LoadStrategy`) and a `CK_*_LoadStep` each, so only a step set has a step; the choice and
  the step on the workout's snapshot, `training."WorkoutSetPerformances"` (`LoadStrategySnapshot`,
  `PrescribedLoadStep`), held by `CK_WorkoutSetPerformances_LoadStep`; and `training.protect_workout_set()`
  extended, so neither changes once the workout has started.
- The API's set shapes (`SetPrescriptionRequest`, `SetPrescriptionView`) carry `LoadStep`, and the client's set
  view (`ClientSetView`) the choice and the step; the web's API client is regenerated.

- A second migration, `LiftWeightApplications` (notes plan N6c), adds that table, its indexes (one row per
  key and lift; by lift and by client in time) and its append-only trigger.

## Migration and recovery

Nothing is backfilled: the new columns are nullable, and the append-only and history triggers forbid rewriting
old rows, so a workout started before keeps no choice and reads as before. Rolling back restores the trigger
function, drops the new columns and checks and narrows the two load-strategy checks again. Once a step set
exists the old checks would refuse it and a started workout would lose its step, so Down stops first with a
plain message ("Some sets use Last time + step; roll forward instead of reverting this migration.") and, as
ADR 0036 says of the chart, a rollback is a forward fix.
N6c's migration does the same once any weight was applied ("Some weights were applied from Last time + step;
roll forward instead of reverting this migration."), since dropping the table would lose that history.

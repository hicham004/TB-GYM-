# ADR 0036: Progression and training maxes

Status: accepted by the owner, 2026-10-05. It lifts two roadmap deferrals: more progression
transforms, and an intentional rebase of a program's working max (DOMAIN-RULES §12 question 6, STR-002).

## Context

A coach builds week 1 of a powerlifting block, copies it into later weeks changing RPE and reps by a
step, and wants the weights worked out from the client's max for that program or from week 1's
weight. Each assigned program has its own maxes, the coach can update them and the coming weeks
follow, and the client's program can always be adjusted.

## Decision

1. **RpeChart v1** (STR-010) is a load formula beside WorkingMaxLoad v2: working max times the
   chart's percentage for the top reps at the target RPE. It covers RPE 6.5 to 10 and 1 to 12 reps;
   anything outside is rejected, not extrapolated. The coach picks the formula per program in the
   builder (choosing it again at assignment is a follow-up, not built in P1 or P2); RpeChart is the
   default for new RPE-loaded sets. Every calculated load stores its explanation with the numbers and
   the rounding.
2. **Duplicate with progression, WeekStep v1** (TRN-025, step P1): the server calculates 1 to 12
   copies of a week with RPE, reps, % and fixed-weight steps. The coach reads them before they join
   the draft; they are plain numbers, so assigned programs keep their snapshots.
3. **Training maxes** (step P2): a program keeps its own maxes. Updating them creates a superseding
   working-max snapshot with a reason, recalculates only sessions not started, and goes through
   preview, hash and apply with the concurrency token and an idempotency key. "From week 1's weight"
   estimates a max as load / chart % from the prescription only; adjusting from logged performance is
   a separate, later strategy (STR-007), planned in P4 and not built. As built in P2 (STR-011,
   TRN-026): an update recalculates only sets calculated from the max, in sessions that have not
   started and are not in the past; typed weights and manual overrides win; each lift keeps one chain
   of maxes, so two updates racing for one max cannot both win; every update leaves an append-only
   record; and the program can be named when assigned and renamed later without touching where it
   came from or when it runs.
4. **Editing and next block** (step P3): Build next block takes the same steps; future weeks are
   edited in the builder's grid through the coverage policy (TRN-014) with an audit record. Started
   and finished sessions stay locked.
5. kg and lb are never converted, and history (snapshots, executions, versions) is never rewritten.

## Where the chart comes from

RTS publishes a method for building a personal chart, not a fixed table. The table here is the
widely used Tuchscherer chart as reproduced in coaching practice, locked by a reference test (all 96
cells). It agrees with the peer-reviewed table in Helms et al. (2016, Table 2: RPE 7 to 10, 1 to 8
reps) on all 56 shared cells, by 0.8 points on average and 2.2 at most. It is a starting point, not
physiology. RPE 5 to 6 stay valid prescriptions (STR-004), so such a set takes a typed weight or the
Epley-shaped formula. Personal charts per lifter, as RTS teaches, would be a later version.

## What competitors do (their public docs, checked 2026-10-05)

| Product | Percentage and RPE loading |
| --- | --- |
| Everfit | "Use %" fills the weight from the client's 1RM, estimated from logged workouts (Epley); it changes as the client sets PRs. No preview, rounding or per-program max is described. |
| TrainHeroic | Percentages calculate from the athlete's working max; Linear Weight Progression uses the last logged set. RPE is mostly written in notes. |
| Trainerize | Tests and stores rep maxes, logs RPE after a workout; users still ask for percentage loading in the builder. |
| Hevy Coach | RPE targets and duplicating workouts; nothing on percentage of 1RM or calculated weights. |
| TrueCoach | No documentation of calculated loads found. |
| Juggernaut AI | Adjusts upcoming sessions from logged RPE and readiness, for the athlete: our later strategy. |

TB Gym matches percentage and RPE loading and adds: a preview before anything is applied, an
explanation on every calculated weight, separate maxes per program, units never converted, and
history never rewritten.

## Consequences

- The migration widens the two load-strategy check constraints. Rolling it back after a chart set
  exists would violate the old constraint, so a rollback is a forward fix.
- The P2 migration swaps the working-max uniqueness (one max per lift and week) for a chain: one first
  max per lift and one successor per max, and adds the update record with its own append-only trigger.
  It stops with a plain message if a program already has two first maxes for a lift. Rolling it back
  after a lift was updated twice from the same week would break the old index, so that is a forward
  fix too.
- The chart is versioned; any change to a cell is RpeChart v2, never an edit.
- Sources: [Helms et al. 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC4961270/),
  [RTS: Customizing Your RPE Chart](https://store.reactivetrainingsystems.com/blogs/advanced-concepts/customizing-your-rpe-chart),
  [Everfit](https://help.everfit.io/en/articles/3060080-program-workouts-using-1rm-tracking-auto-progression),
  [TrainHeroic](https://support.trainheroic.com/hc/en-us/articles/18156690075917-Programming-with-Linear-Weight-Progression-or-Percentages),
  [Hevy Coach](https://hevycoach.com/features/workout-program-builder/),
  [Trainerize ideas](https://ideas.trainerize.com/forums/167887-trainerize/suggestions/12510144-adding-an-auto-percentage-max-rep-calculator-based).

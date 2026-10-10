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
   and finished sessions stay locked. Split in two: P3a is Build next block, built (TRN-027): the
   builder's four steps, then each copy's weights worked out from the program's maxes by each set's own
   formula, so the program keeps the formula the coach chose in the builder. P3b, the grid editing of
   a client's future weeks, is built (TRN-028): "Edit weeks" opens the program in the builder's grid,
   the sessions that started, finished or passed drawn locked beside it, and the coach reviews the
   server's preview (every new weight worked out) before applying it. **An edit is made in one sitting,
   not kept as a private server draft** (decided 2026-10-06, when the owner left the question to Claude):
   a draft of a live program goes stale as the client trains (a session it changes starts, a day
   passes), Everfit, TrainHeroic, TrueCoach and QuickCoach all change a client's coming workouts
   directly, and the review then checks the edit against the program as it is. Leaving with changes not
   applied asks first. A draft could be added later if coaches lose work.
5. kg and lb are never converted, and history (snapshots, executions, versions) is never rewritten.
6. **Session extras** (step P4), split in two. P4a is built: Watch demo on the builder's and Edit weeks'
   grid rows (the library's media) and in a client's session sheet (the snapshot the client was given,
   MED-002), opened through the usual short-lived grant; the coach's note on a client's workout from the
   session sheet, and every note on the client's finished-workout history (TRN-009). The workout player
   already had both. P4b, adjusting next week from logged performance, is decided below and built
   (STR-012, 2026-10-08).

## Adjusting next week from logged performance (P4b, decided 2026-10-07, built 2026-10-08)

The owner asked for it to be planned, then left its three questions to Claude after research
(2026-10-07). A separate strategy, as STR-007 says:

- **What it reads.** For each lift with a training max in the program, the client's working sets of the
  week just finished that logged 1 to 8 reps at RPE 7 to 10. That is where the chart matches Helms et al.
  (below), and where people judge reps in reserve best: closer to failure and with fewer reps (Halperin et
  al. 2022). Each such set implies a max: load divided by the chart's percentage (STR-011 already does
  this for week 1's prescription). Warm-ups and sets without an RPE never count.
- **Which set: the best of the week** (the highest implied max), not the average of the top two. Back-off
  sets come after the top set and are tired by it (RTS drops their load by a set "fatigue percent" to reach
  the same RPE again), so an average of two usually mixes a fresh set with a tired one and reads low.
  Lifters also under-call their reps in reserve by about one rep on average (Halperin et al. 2022), which
  already makes an RPE estimate lean low. And one set is something the coach can check by hand: the
  suggestion names it ("from 55 kg × 5 at RPE 8 on Tue 13 Oct").
- **What it does: a suggestion the coach applies, never automatic.** When the estimate differs from the
  max in use by more than one rounding step, either way, the Training maxes panel says so ("Logged sets
  suggest 65 kg for Back Squat, up from 62.5 kg") and offers the existing P2 update: preview every changed
  weight of the coming weeks, then apply, with the source "Estimated from logged sets, week N" on the new
  max. Why not automatic: the rules already forbid a silent rebase and let typed weights win (STR-011);
  one day's estimate moves with sleep and fatigue, which a coach can read and a rule cannot; and the
  products that adjust on their own either have no coach (Juggernaut AI, KeyLifts) or stop once a coach
  sets the max (TrainHeroic keeps a tested or typed working max fixed). Everfit raises its 1RM on its
  own, with no per-program max and no preview.
- **What it never does.** Change a max without the coach, rewrite a week already started, mix kg and
  lb, or treat a set without an RPE as evidence.
- **When: right after the nutrition builder (R4.4).** Founding coaches can already update maxes by hand
  with the full preview (P2) and read every logged set on the session sheet (P4a), while the meal-plan
  builder is the last coach builder still on an old screen.
- **As built (2026-10-08), decided by Claude for the owner after checking Everfit, TrainHeroic and
  Juggernaut again.** "The week" is the latest program week holding a set that counts, so a finished
  workout speaks the same day (Everfit recalculates the 1RM once a workout is logged, TrainHeroic from any
  lift performed, Juggernaut within the session). Only sets logged after the max in use was set count:
  TrainHeroic keeps a max the coach set fixed until the coach changes it, so here the coach's own update
  quiets an older suggestion. Only finished workouts count, since a finished workout cannot change under
  the coach's review. The coach applies the suggestion by naming its set; the server works the max out
  again and refuses a set the rule no longer picks (a newer best set arrived), and the new max keeps the
  set it came from. A suggestion also shows on a program past its last day, because Build next block
  works the new weeks out from the program's maxes.
- **P4b's follow-ups, built as P4c (2026-10-08), decided by Claude for the owner** (the owner asked for
  web research and a decision, compared with competitors). **Keep this max (STR-013):** Everfit raises the
  1RM by itself and TrainHeroic stops adjusting once the coach sets a max; a suggestion with no way to say
  "no" would only nag, the more so once Coach Today shows it. So the coach can keep the max in use: it is
  recorded, and only sets logged afterwards can suggest again (TrainHeroic's "fixed by the coach", but new
  evidence still speaks). No undo: the keep is history, and typing the suggested number is always open.
  **Coach Today (CLI-018 v2):** Trainerize coaches complain that PR alerts do not say what was achieved, so
  the item names the lift and both numbers ("80.75 kg, up from 77.5 kg") and opens the panel. It ranks last
  and never makes a client Needs attention: getting stronger is good news. **A newer set during review**
  answers with its own code, and the sheet reads the new estimate and says so. **Demo data:** demo clients
  log the RPE their weight was on the chart for their strength; those who set bests get about 2% stronger
  a week and push their last set, so the demo suggests only heavier maxes.
- **Between programs, decided by Claude for the owner on 2026-10-08** (the owner's "do the last session's
  not-done work", with research). In Everfit, TrainHeroic and TrueCoach a max belongs to the client, so the
  next program simply uses it; in TB Gym each program keeps its own maxes (STR-002), and Assign program read
  only the client's recorded maxes, so a max raised during a program was lost at the next assignment and a
  finished program's suggestion had nowhere to go. **The next program starts where the last one ended
  (STR-014):** Assign program fills each lift with the max the client's latest program uses now (unless a
  max recorded since is newer) and offers that program's suggestion as "Use 80.75 kg"; the new max names the
  max it carried or the set it came from, and the database keeps it to the same client. Coach Today does not
  add a Maxes to review item for a finished program, which cannot be updated: its No program item names the
  suggestion ("Last program's sets suggest Deadlift 80.75 kg, up from 77.5 kg") and opens Assign program.
  The client list gains a **Maxes to review** chip, shown only while a client has one. **No notification
  for a suggestion:** it is never urgent (the max in use stays valid until the coach acts) and comes most
  weeks for most clients on percentage programs, so a notice would compete with messages and check-ins;
  Coach Today already names it with both numbers. TrainingPeaks, the closest equivalent, emails threshold
  improvements only when the coach switches them on per athlete, and Trainerize's personal-best alerts are
  criticised for saying nothing useful. If founding coaches ask, it comes back as an opt-in in-app notice.
- **One max history per lift (STR-015), decided by Claude for the owner on 2026-10-08** (P4c's last
  follow-up, at the owner's request). In Everfit and TrainHeroic a client has one max per lift, so every
  change, by the coach or the app, shows in that lift's history on the client's profile. Here a max raised
  during a program stayed in that program, and the client's Training max history showed only the coach's
  own entries. Copying it into the recorded maxes would store each fact twice, and a copy would also reach
  Assign program as a "saved max" beside the carried one (STR-014). So the history reads both instead:
  asked for, it lists every program's training maxes beside the recorded ones, named "Phase 2, from week 5,
  from logged sets", while Assign program keeps reading the recorded maxes alone.

**Telling the client about changes** (the owner's open question from P3a, P3b and P4a, decided by Claude
on the same day). TB Gym sends no training notices at all today, not even for a new program or a shared
week, and the coaching apps notify on new workouts and programs rather than on edits (TrueCoach; Trainerize,
whose users ask for more). So no notice is added for edits alone: training notices are built together in
R5.1, in-app only. A client hears of a new program, a week shared, a change the coach applies to a week
the client can already see (one notice per apply, naming the weeks, not their contents) and a coach's note
on a workout ("Your coach left a note on Tuesday's workout", never the note's text).

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
  [Halperin et al. 2022, reps-to-failure prediction meta-analysis](https://sportrxiv.org/index.php/server/preprint/view/67),
  [Trainerize client notices](https://ideas.abcfitness.com/forums/167887-coach-trainer-abc-trainerize/suggestions/45879544-notify-client-when-program-phase-or-workout-is-add),
  [KeyLifts](https://keylifts.helpscoutdocs.com/article/26-training-max-auto-increase),
  [TrainHeroic working maxes](https://support.trainheroic.com/hc/en-us/articles/18171015485837),
  [RTS: Customizing Your RPE Chart](https://store.reactivetrainingsystems.com/blogs/advanced-concepts/customizing-your-rpe-chart),
  [Everfit](https://help.everfit.io/en/articles/3060080-program-workouts-using-1rm-tracking-auto-progression),
  [TrainHeroic](https://support.trainheroic.com/hc/en-us/articles/18156690075917-Programming-with-Linear-Weight-Progression-or-Percentages),
  [Hevy Coach](https://hevycoach.com/features/workout-program-builder/),
  [Trainerize ideas](https://ideas.trainerize.com/forums/167887-trainerize/suggestions/12510144-adding-an-auto-percentage-max-rep-calculator-based).

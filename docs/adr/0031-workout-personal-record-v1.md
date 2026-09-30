# ADR 0031: Workout personal record v1

Status: accepted for R2.2, 2026-09-30

## Decision

A workout personal record is the highest positive load in a completed set for one exercise,
exact repetition count, and explicit load unit. `ExactRepsLoad` version 1 compares only completed
sets; kg and lb remain separate. A greater load is a new record, while an equal load is a tie.
The server evaluates a set save against prior completed workouts and earlier completed sets in
the same workout. The finish summary recomputes records from saved actuals. The client never
decides the record or converts units.

The previous-session prefill copies the same set position only when its unit matches the
prescribed unit. Existing actuals always win. The finish summary uses persisted start/end UTC
instants, completed-set counts, and load times repetitions grouped by unit.

## Consequences

This definition is explainable and does not pretend that a lighter higher-repetition set is
comparable to a heavier lower-repetition set. Other record types need a named versioned rule.

# ADR 0032: Client-entered food on a nutrition day

Status: accepted by owner, 2026-09-30

## Decision

A client may record food eaten outside the coach's assigned meal choices. Each entry records the
client's name, amount and unit, and calories, protein, carbohydrate and fat for **that amount**.
It is labelled as client-entered nutrition, never treated as a coach-approved recipe or inserted
into the assigned plan snapshot. The day's consumed totals include it; planned targets remain the
coach's snapshot. This is a log of what the client entered, not a verified nutrition fact.

The Nutrition module owns the entry. The API resolves the current client profile, checks Nutrition
access on the server, and permits the write only for an active plan day owned by that client. The
daily log version controls concurrent writes. A completed day is frozen. The database keeps the
entry tenant-scoped, linked to its log by a composite foreign key, and append-only; a trigger also
refuses insertion into a completed log. No sensitive food values go into notification payloads.

## Consequences

The first version adds entries only. Correcting a mistaken client-entered food needs a separate,
audited reversal operation before the day is completed; that follow-up remains in the UI plan.
No food library, provider import, coach prescription or clinical claim is created by this action.

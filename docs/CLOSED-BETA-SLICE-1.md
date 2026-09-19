# Closed-beta Slice 1

Status: implementation and local-verification record. This document is not evidence that the beta
launch gates in [CLOSED-BETA-READINESS.md](CLOSED-BETA-READINESS.md) or
[LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md) have passed.

## Purpose and scope

Slice 1 makes the core coaching loop easier to use during the closed beta:

- a client can understand today's state, start or resume a visible workout, and record sets from a
  mobile-first runner;
- a coach can inspect a completed client's prescribed-versus-actual workout and append-only notes;
- a coach can open the existing direct conversation for a client from Client Details.

The rebuilt surfaces use the scoped Coach's Notebook presentation, self-hosted IBM Plex fonts, and
high-contrast keyboard focus. The runner retains per-set drafts keyed by set-performance ID and the
existing serial same-workout save queue. It rejects external video embeds; approved uploaded media
continues to use the existing protected native-media path.

## Training reads and limits

The slice adds only these Training-owned GET endpoints:

| Endpoint                                                                            | Audience       | Bounded result                                                     |
| ----------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------ |
| `/api/training/me/upcoming?skip=0`                                                  | current client | 90-day future horizon and five unfinished workouts per page        |
| `/api/training/clients/{clientProfileId}/workouts/{workoutExecutionId}?notesSkip=0` | coach          | complete read-only workout graph and 50 append-only notes per page |

The reads evaluate the existing tenant membership, role, relationship block, feature access,
publication visibility, and Training calendar rules on the server. They distinguish no assignment,
unshared programming, rest/next session, and resumable earlier workouts without weakening existing
write behavior.

## Boundaries retained

This is read/UI composition only. It introduces no schema or migration, no new write contract, and
no changed access, snapshot, commercial, completion, progression, or persistence invariant. The
existing workout write APIs remain authoritative.

RPE remains the canonical exertion input. The runner explains the calculated RIR convention, but a
preferred client effort-input scale is deliberately deferred.

## Local evidence

The targeted PostgreSQL integration run recorded five passing tests: four Slice 1 read tests plus
the existing bounded Today-read query test. Its result is retained at
`tests/backend/TB.Gym.Api.IntegrationTests/TestResults/slice1-reads.trx`.

Measured local integration observations were:

| Read                        | SQL commands | Elapsed time |
| --------------------------- | -----------: | -----------: |
| Upcoming with one workout   |           25 |     778.9 ms |
| Upcoming with five workouts |           33 |     890.0 ms |
| Coach workout detail        |           19 |     390.5 ms |

These are local development measurements, not production performance benchmarks.

Frontend coverage exercises the Today states, runner save/refusal/draft behavior, accessible focus
flow, stale-tenant response handling, client-detail conversation launch, coach read-only workout
content, and Messages handoff outside the first bounded conversation page.

`./scripts/check.ps1` passed in full: the Release build had zero warnings and errors; 307 domain,
48 architecture, and 553 PostgreSQL API integration tests passed; Prettier, Angular lint and
production build passed; all 471 Angular tests passed; and `npm audit --audit-level=high` found zero
vulnerabilities. `git diff --check` also exited successfully with no whitespace errors.

## Still required outside this code change

The focused runner controls use a 48px minimum target and keyboard behavior is covered by rendered
control tests, but an authenticated live-browser pass at 360px was not available in this worktree.
Physical iOS/VoiceOver testing is also not represented by automated tests and remains a
device-validation task. Before inviting participants, use the readiness plan and launch checklist
for the separate legal, operational, deployment, media, and accessibility gates.

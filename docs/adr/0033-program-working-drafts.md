# ADR 0033: Program working drafts kept on the server

Status: accepted by owner, 2026-10-05

## Context

The program builder (plan C4) promised autosaved drafts. Every save of a program creates a new
immutable `ProgramTemplateVersion`, and database triggers refuse any change to one (ADR 0007), so
autosave cannot call the save endpoint: each pause would leave a permanent version in history. The
owner chose between a working draft kept on the server and one kept only in the browser.

## Decision

The builder keeps each coach's changes as a `ProgramDraft` on the server (TRN-024), owned by the
Training module: one per person and program, plus up to 20 new programs per person not published
yet. It holds the program in a save's shape with values unchecked, so any half-typed state can be
kept, and it is bounded only by a version's limits and a total size. The builder writes it a moment
after each change and carries the row version, so a second tab or device is told to reload instead
of overwriting. Drafts belong to one membership and are read by nobody else, the workspace owner
included; they never reach a client. `Save draft` is removed: autosave keeps the work, and
**Publish** is the only way a draft becomes a version. Publish runs every rule a save runs, creates
the next version published and deletes the draft in one transaction, asking first when a version was
published after the draft began.

Rejected:

- **A draft only in the browser.** Lost on another device, in a private window or when site data is
  cleared, and left on a shared gym computer after the tab closes.
- **Autosave as versions.** Hundreds of permanent versions; Versions would stop being a history of
  what was saved on purpose.
- **Editing the newest unpublished version in place.** It breaks ADR 0007's immutable versions, the
  triggers that protect them, and saved sessions that point at a version's sessions.

## Consequences

- The work follows the coach to any device, and nothing of a program stays on a shared computer.
- Leaving the builder sends any change not yet saved and asks only when that fails (plan §9). A
  workspace switch or a sign-out asks the open editor first, because both change the session before
  any route does.
- A new program is private until its first Publish; the team sees it only then. "Add to saved
  sessions" needs a published session, so it waits for Publish.
- Unpublished versions made by the old `Save draft` stay in history and can still be opened and
  published.
- A departed coach's drafts stay with their ended membership and are never shown. Sweeping old drafts
  is a later job if they ever matter.

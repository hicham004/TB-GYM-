# ADR 0039: Coach certificate lines

Status: accepted, 2026-11-07 (notes plan N4a, decision 7 of 5 Nov 2026)

## Context

The owners want a coach's clients to read what the coach showed TB Gym as proof: a certificate, a gym
they own, years of coaching, a degree. Decision 7 settles how it is checked: the trainer partner confirms
each proof with the coach over WhatsApp and marks it done in a click; no issuer, university or "valid
to" date is asked; nothing is forced and a check never stops a sign-up. What TB Gym keeps about a coach,
and how it is erased on request, is a business decision with privacy weight, so it is recorded here.

## Decision

The record is TB Gym's, kept by the platform admin: `identity."CoachCertificateLines"`, one row per
proof about one coach in one coaching space (CLI-021). It lives in the Identity module, as a record about
a person beside the legal records, but it is the first tenant-owned table there: it carries the space's
`TenantId` with the global query filter and the write-scope guard, so a read inside a workspace can only
ever see that space's lines. The admin's list reads every space with `IgnoreQueryFilters`, and each write
sets its space as the request's tenant first, as the billing admin does. The admin service lives in
Infrastructure, which composes Identity with Tenancy's memberships.

A line holds text only, typed by the admin: what was shown (one line, 1 to 120 characters), the day it
was shown in the space's calendar, who confirmed it with the coach (a typed name, prefilled on screen
with the admin's own) and the admin who recorded it. Never a copy, a photo, a file or a link. It is
waiting until confirmed, the only state a reader may ever see, and is then taken down or erased; a
waiting line may be dropped outright, since a "not confirmed" result is not kept. The words "verified",
"licensed", "qualified" and "approved" and the protected physio titles are refused as whole words: the
first four are the platform's promises, never a coach's proof, and a title would need a check against
the Order that decision 7 does not make. Nothing of a line reaches a log, an exception, a notification or
analytics, and no line changes a coach's access, bill, clients or sign-up.

A confirmed line's words, day and confirmer never change and the row is never deleted (a trigger with
error 55000, mirrored by the model). Erasing on request blanks the words and the confirmer's name, drops
the day and keeps the dates and who acted, so the row itself is the history of the erasure without the
data; the request's day is kept and the page shows the 10 days within which it is met. Erasure takes no
version: a coach's request covers every line of theirs in the space, those added since the page was read
included.

The sentence a reader sees is one constant, `CoachCertificateLineWording` version 1, "<what>, shown to
TB Gym on <date>", with the date in the space's language: a placeholder until the lawyer's words replace
it in one edit, pinned by one reference test.

## Consequences

- Only the platform admin reads or writes the record (`/api/platform-admin/coaches`), on the Coaches
  page; until notes plan N4b nothing of it reaches a coach or a client.
- N4b adds the coach's switch (`CoachShows`, on from the start), the client's read and the keeping period
  after a take-down with its daily sweep, which erases with the reason `KeepingPeriod` and no person.
- Whether the trainer partner holds the platform admin role, which also opens billing and legal
  documents, stays the owner's call; the typed confirmer name serves either way.

## Migration and recovery

`CoachCertificateLines` adds the table, its checks, the one-line-per-words-and-day index and the trigger.
Rolling back drops them; once real lines are recorded, prefer a forward fix, since an erasure's history
lives in these rows.

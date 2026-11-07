# ADR 0039: Coach certificate lines

Status: accepted, 2026-11-07 (notes plan N4a, decision 7 of 5 Nov 2026); amended 2026-11-07 (notes plan N4b)

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
waiting until confirmed, the only state a client may ever see, and is then taken down or erased; a
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

Who reads it (notes plan N4b). A coach reads their own lines in the open space (`/api/coach-certificates/me`,
the tenant-coach policy) and switches each confirmed line on or off for their clients (`CoachShows`, on from the
start, since the coach sent the proof to be shown): consent can always be withdrawn, so the switch stays open
while the space is read-only for an unpaid bill, as a person's own setting (ADR 0028), and it changes nothing
else. A client reads the confirmed lines still up that the coach of their current profile shows in the client's
own space, with their coach on Me; the server decides every line. A switched-off line is not a take-down: it is
kept, since the coach can switch it back on.

The keeping period (CLI-008's retention): a taken-down line's words are kept for
`CoachCertificates:KeepMonthsAfterTakenDown` whole months after its own take-down, then erased by a daily Worker
sweep as an erasure on request is, with the reason `KeepingPeriod`, no person and no request day. The lawyer
sets the number; until then it is the plan's example, 12 ("12 months after the last line expires", read per
line, since lines no longer expire), and a host refuses to start outside 1 to 120, naming the setting. The
sweep reads every space past the filter, erases each in a scope of its own space, and logs counts only.
Nothing in the repository deletes an account, so the keeping rule looks at taken-down lines alone; "while the
account exists" needs no sweep of its own until an account can be deleted.

The sentence a reader sees is one constant, `CoachCertificateLineWording` version 1, "<what>, shown to
TB Gym on <date>", with the date in the space's language: a placeholder until the lawyer's words replace
it in one edit, pinned by one reference test.

## Consequences

- Only the platform admin writes the record's lines (`/api/platform-admin/coaches`), on the Coaches page,
  whose pill takes the server's word on what clients read of a confirmed line (shown, hidden by the coach, or
  not shown once the coach left the space); a coach writes only their own switch, and a client only reads.
- The lines reach no screen but the admin's Coaches page, the coach's Settings › Certificates and the
  client's Me: not Today, Messages, Team or any public page.
- Whether the trainer partner holds the platform admin role, which also opens billing and legal
  documents, stays the owner's call; the typed confirmer name serves either way.

## Migration and recovery

`CoachCertificateLines` adds the table, its checks, the one-line-per-words-and-day index and the trigger.
Rolling back drops them; once real lines are recorded, prefer a forward fix, since an erasure's history
lives in these rows. N4b adds no migration: the switch's column and the `KeepingPeriod` erasure's checks
came with N4a's.

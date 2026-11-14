# ADR 0041: The house and trainee sign-up

Status: accepted, 2026-11-12 (notes plan N9a1; decisions 24, 25, 33 and 34 of 5 Nov 2026, decision 2 of 7 Nov
2026, and the owner's word of 12 Nov 2026: build now, every part switched off until the owner turns it on)

## Context

TB Gym takes trainees who have no coach (decision 24) into a coaching space of its own, "the house" (25):
a person signs up with no invitation, becomes its client and is handled as their own coach. ADR 0002 made
clients invite-only, so this is a business decision, and it needs an owner for the new facts: which
workspace is the house, the figures that open sign-up, and the sign-up itself.

## Decision

**The house is one ordinary workspace with a mark.** `tenancy."Tenants"."IsHouse"`, at most one (a unique
index), set and cleared only by `platform-admin house set <slug or id>` and `house clear`, the command that
already alone grants the admin role (CLI-022). A configuration key was refused: a wrong deployment setting
could point it at a coach's space. No new tenancy model, no second database: a trainee is a `ClientProfile`
with its `TenantId`, the query filter and the write guard.

**The Tenancy module owns the mark, the settings and the sign-up**; the orchestration lives in
Infrastructure beside `RegisterCoachAsync` (`TraineeSignUpService`), which composes Identity (the account,
the legal gate, the confirmation mail), Clients (the profile) and the Website's form stamp. A module of its
own for the house is the other way, if it grows rules no other module owns.

**Its settings are data** (CLI-023): `tenancy."HouseSettingChanges"`, one append-only row per change with
who and when, the highest number of a setting in force, entered by the platform admin
(`/api/platform-admin/house`). Each starts empty and nothing is seeded. This row adds new sign-ups a week and
the age that may sign up (18 to 100: the platform is adults only, so the house's age is never lower); later
rows add theirs as values of the same table. Sign-up is closed while no space is marked or either is empty.
N9b5 added how far back a Free trainee's Progress reaches (empty: no limit, PRG-015) and the house's media
storage (empty: the platform's allowance, MED-019); sign-up reads its own two alone.

**Sign-up** (CLI-024) is `POST /api/auth/register/trainee`, anonymous, with Talk to us's honeypot and a
stamp of its own purpose, a rate limit of its own (20 an hour by address) and the age check before any
account is stored. A new person gets an unconfirmed account, their legal acceptances and one
`tenancy."TraineeSignUps"` row holding the name and date of birth they typed. **The membership and the
client profile are created when the email is confirmed**, in the confirmation's own transaction
(`IEmailConfirmationService`), not at sign-up as the plan's outline first said: the coach history, profile
changes and legal acceptances are append-only, so a profile made at sign-up could never be removed again,
and until confirmation the house's staff would read the name and email of somebody who may never have
asked. **A place of the house's week is taken at that confirmation too**, under one advisory lock: a
sign-up still waiting holds none, so made-up addresses cannot keep the week full, and a confirmation into
a week that has filled leaves the sign-up waiting for the signed-in form. Someone already signed in has a
confirmed account and joins at once, once in a week; an email that has an account signs in first (34).
Whoever the house itself turned away (it ended their coaching, or they left while blocked) is not let back
in by a sign-up: that stays the house's invitation. The consumer terms are a new
`LegalDocumentKind`, asked of the new `LegalAudience.Trainee` alone and published by the platform admin;
the health intake consent is not asked at sign-up, since a trainee's health is asked only on Max (33).

**A sign-up never confirmed is removed** by a Worker sweep after `TraineeSignUps:RemoveUnconfirmedAfterDays`
days (2, since a confirmation link works for a day and nothing sends a second one; housekeeping, not the
owner's figure): its row is deleted and its account emptied (no name, no
address anyone can reach, no password, every link spent), which frees the email. The emptied account row
stays, because its mail history and acceptances name it and are never deleted; it identifies nobody (CLI-025).

**Self-directed** (CLI-026) is a flag on the profile, the house's alone (a trigger). The record names the
house's Coach who joined first, or nobody while the house has none, and the trainee then waits until the Owner
gives them one (ADR 0026 as amended for C8, CLI-012, CLI-024; notes plan N9d1b). Coach attention v9 raises nothing for such a profile, and
their notes, their leaving and a coach's departure reach no inbox; both partners keep them on Clients. Their money
asks are the exception (N9c1, SUB-020): asking for a plan and saying its money was sent tell the Owner and their coach.
Since N9c5, while a trainee's Max plan grants the house coaches them as a coach's client (CLI-026): that is read from
the house's plans on each request (`HouseTierReader`, `HouseTierRule.CoachesTheTrainee`), never by clearing the mark,
which four triggers and the asks keep, so the trainee is their own coach again the day Max stops granting with nothing
written. Their Health step opens only then (CLI-028).

## Consequences

- Nothing opens by being deployed: the owner marks a space, then fills both settings in the app.
- The public read tells a closed sign-up apart from nothing else: not whether a house exists, nor its name.
- A coach's space never reads the house's rows, and database triggers keep the house's rows, and the
  self-directed mark, in the house alone; the mark cannot be cleared while the house holds anyone.
- N9a2 built the screens on these routes: `/train` and `/train/sign-up` for a visitor or someone signed in,
  the platform admin's House page (`/admin/house`), and a self-directed trainee's Today and Me, which read
  the trainee's own profile first and never ask for the staff member the record names. N9b1 starts Free at
  the same confirmation step and at the signed-in join, in their transaction; `house set` also makes the
  house's Free plan, and the house's hourly sweeps renew it (SUB-019). The pool and its demos are the house's
  alone (LIB-006, MED-017). N9b6's `house-library` command loads a bought library into the house alone, named by
  its slug or id and checked by the mark, as the house's Coach and through the library's own services (LIB-007).
  N9c1 adds the house's Whish number to its settings (empty keeps asks closed) and the asks for a paid plan
  (SUB-020): the Subscriptions module's records, routes and rule, composed in Infrastructure by `HousePlanAskService`,
  which reads the mark and the Whish number from Tenancy and books through the commercial records; a trigger keeps
  the asks in the house alone. A coach's Ask to renew is never a trainee's (SUB-014). N9c3 adds the house's programs
  for trainees (TRN-034): the Training module's list entries and started-program records, kept in the house alone by
  triggers and composed in Infrastructure with the Pro+ pass read from the commercial records; Start makes the same
  snapshot as Assign program. A trainee's own max (STR-021) is the Strength module's, behind the same pass. In the
  house a program's sessions follow the plan it sits under, since Free opens Training beside every plan.
  N9c5 adds Max's places to the settings (empty keeps Max closed) and their rule (SUB-021) to the Subscriptions module,
  kept by `HousePlanAskService` under a house-wide lock of its own; no migration.

## Migration and recovery

`HouseAndTraineeSignUp` adds the two columns with constant defaults (no row is rewritten), the two tables,
their checks and triggers, and `SignUp` as a first coach-history reason. It reverts cleanly while no space is
marked; once a house, a setting, a sign-up, a self-directed profile or a consumer terms document exists,
its `Down` stops with "roll forward", since those are facts the earlier schema cannot hold. Since N9b1, `house set`
also makes the house's Free plan, which `house clear` takes off sale but keeps, so `HouseFreePlan`'s own `Down` refuses
first once a space has been marked. N9c3's `HousePrograms` reverts while no trainee has started a program; after that
its `Down` stops with "roll forward" too.

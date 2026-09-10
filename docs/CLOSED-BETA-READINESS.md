# TB Gym Closed Beta Readiness

Status: execution plan, not a completion record. Nothing here is ticked, and nothing in this
document may be used as evidence that a gate has been passed.

Scope: an invite-only beta for **1-3 trusted coaches and 10-30 clients**. No public launch, no
public sign-up, no marketing, no app-store listing, no press. Every participant is somebody who can
be phoned.

This is not Phase 7, not Phase 8, and not a re-audit of completed work. Phase 6B-4C code is
accepted and committed (`ROADMAP.md`, "Phase 6B-4 code acceptance and production handoff"). The
repository is clean and code-accepted; it is **not deployed and not beta-ready**, and the difference
between those two statements is the whole subject of this document.

`LAUNCH-CHECKLIST.md` remains the full launch gate with all of its items. This plan links into its
sections and deliberately covers a smaller set: what an invite-only beta cannot run without. Do not
tick anything in `LAUNCH-CHECKLIST.md` on the strength of this file.

---

## 1. Decisions required from the product owner before work starts

These are decisions, not tasks. Each blocks work below it, and nothing in this repository can make
any of them. No legal position, payment approval, provider agreement or professional review is
assumed or invented anywhere in this document.

### D1 - Free beta, or manual paid beta

**Blocks:** Gate 7, and the shape of Gate 8's rollback.

A free beta needs no collection method, no invoice, no tax position and no refund policy. A manual
paid beta puts real money through Phase 2's append-only manual receipts and pulls in every item
under
[Lebanon payments and commercial operations](LAUNCH-CHECKLIST.md#lebanon-payments-and-commercial-operations)
- a question for Lebanese legal and accounting advisers, not for this repository. A free beta is
the smaller decision and the smaller risk. It is still a decision, and it is yours.

### D2 - Media: configure it, or switch it off for the beta

**Blocks:** Gate 5.

Option A is a private EU R2 bucket plus a private ClamAV daemon, proved in staging. Option B is an
explicitly unconfigured media stack: uploads refused before any bytes are accepted, which is the
designed state and not a fault. Option B removes roughly a week of external setup, and removes
progress photos and coach-uploaded exercise media from the beta.

### D3 - One environment, or two

**Blocks:** Gates 1, 2, 8.

A separate staging environment doubles the hosting and the setup, and it is the only place a restore
rehearsal, a media proof and a migration rehearsal can happen without touching participants' data.
Recommendation: one small staging environment that is torn down between rehearsals, plus the beta
environment.

### D4 - The beta domain, and the mail subdomain under it

**Blocks:** Gates 1, 4.

One origin serves the SPA and the API. The transactional mail subdomain is separate from it, so mail
reputation is isolated from the root domain's other mail. Both need DNS you control and a named
renewal contact.

### D5 - How participant consent is captured

**Blocks:** Gate 7.

The repository can record an acceptance against a published document version, but nothing in it can
publish one (section 13, gap R3). For a beta the realistic answer is a written, signed, out-of-band
participation agreement per coach and per client, held outside the application. Publishing real
in-app legal documents is Phase 8 work.

### D6 - Who is on call, on what hours, and what address participants write to

**Blocks:** Gate 6.

With 1-3 coaches this is a phone number and a mailbox, not a rota. It still has to exist, and it has
to be told to participants before the first invitation goes out.

### D7 - What you promise beta participants about their data

**Blocks:** Gates 2, 7.

Retention, deletion on request, and whether beta data survives into production. There is no export
or deletion workflow in the product; that is Phase 8. For beta this is a manual database procedure
the Database owner must be willing to run, and the promise must not exceed what you will actually do
by hand.

### D8 - Who calls the beta off, and on what signal

**Blocks:** Gate 8.

One named person, with the authority to stop invitations and roll back without a meeting.

---

## 2. Roles

A role is a hat, not a headcount. On this project one person will wear most of them; the point of
naming them is that each gate's evidence has an owner who signs it.

| Role | Owns |
| --- | --- |
| **Product owner** | D1-D8, the go/no-go, participant communication |
| **Deployment owner** | Domain, TLS, edge, images, configuration, releases, rollback |
| **Database owner** | Managed PostgreSQL, roles, migrations, backups, the restore rehearsal |
| **Security owner** | Secrets, key rings, rotation, the beta security verification pass |
| **Support owner** | The participant contact channel, incident triage, the queue reviews |
| **Legal/compliance owner** | D5, D7, the health-data and payment decision gates - **external, qualified, and not this repository** |

---

## 3. Classification vocabulary

Every gate below is classified as exactly one of:

- **code-complete** - the repository already does this. It needs configuration and proof, not code.
- **external setup** - a person with credentials this repository has never held must do it.
- **repository gap** - something is genuinely missing from the code. Listed with evidence in
  section 13.

A passing `scripts/check.ps1` is evidence for **code-complete** items only, and only that the code
is what it was. It is evidence for nothing external.

---

## 4. Execution order

Dependencies are real. Doing these out of order produces failures that read as bugs and are
deployments.

```text
D1-D8  decisions
  |
  v
G3a  secret store + workload identity
  |
  +--> G2a  managed PostgreSQL, roles, connection string into the secret store
  |      |
  |      v
  |    G2b  migrations as a deployment step  -->  G2c  backups + ONE restore rehearsal
  |
  +--> G1   domain, DNS, TLS, same-origin edge, public origin settings
         |
         v
       G3b  shared Data Protection key ring (API + Worker), verified
         |
         v
       G4   mail domain, SPF/DKIM/DMARC, webhook, Worker, end-to-end proof
         |
         v
       G5   media: Option A proved in staging, or Option B recorded and communicated
         |
         v
       G6   logs, uptime, alerts with an owner, support contact
         |
         v
       G7   consent, health-data and payment decision gates recorded (D1, D5, D7)
         |
         v
       G8   security verification  -->  rollout wave 1  -->  waves 2-3
```

---

## 5. Gate 1 - Staging domain, TLS, and same-origin deployment

**Owner:** Deployment owner.
**Classification:** external setup, over a **code-complete** same-origin topology - with one
**repository gap** (section 13, gap R1) that affects rate limiting and client addresses behind a
proxy.
**Depends on:** D3, D4, G3a. Blocks G3b, G4, G5, G8.

The same-origin model is already built: `src/web/nginx.conf` serves the SPA and proxies `/api`,
`/health`, `/hubs` and `/openapi` to the API container, so the browser sees one origin and the
cookie and antiforgery assumptions hold without CORS. Session and grant cookies are `HttpOnly`,
`SameSite=Lax` (the media grant is `Strict`), and `CookieSecurePolicy.Always` outside Development.
Security headers are set by the API and again at nginx, including CSP and `frame-ancestors 'none'`.

**`compose.yaml` is a development stack and must never be deployed as it stands.** It hard-codes
`ASPNETCORE_ENVIRONMENT: Development`, `DOTNET_ENVIRONMENT: Development`,
`Database__ApplyMigrationsOnStartup: "true"` and a seeding default. A beta deployment needs its own
configuration - an override file or platform configuration - and one does not exist in this
repository yet (section 13, gap R2).

### Required configuration

| Setting | Value for beta |
| --- | --- |
| `ASPNETCORE_ENVIRONMENT` (API), `DOTNET_ENVIRONMENT` (Worker) | `Production` |
| `TB_GYM_PUBLIC_ORIGIN` -> `Application__PublicBaseUrl` and `Application__PublicOriginAllowlist__0` | the bare HTTPS beta origin, for example `https://app.example.com`. Both processes validate it at startup and refuse credentials, a query, a fragment or any path |
| `TB_GYM_HUB_ORIGIN` -> `Messaging__Realtime__AllowedOrigins__0` | the same origin, exactly. A WebSocket upgrade is not protected by CORS |
| `TB_GYM_REALTIME_SCALE_OUT`, `TB_GYM_API_REPLICAS`, `REDIS_PORT` | `SingleProcess` and `1` for a beta of this size. Redis is required only when more than one replica is declared, and startup refuses the combination without it |
| `AllowedHosts` | the beta host, not the shipped `*` |

Do not set `ASPNETCORE_HTTPS_PORT` and do not publish an HTTPS URL on the API container. TLS
terminates at the edge; gap R1 explains why that combination would loop.

### Evidence required

- DNS records for the app host, with the registrar account, the renewal contact and the expiry date.
- A TLS certificate for the beta origin with automatic renewal, and one observed renewal or a
  documented forced-renewal dry run.
- `curl -I` against the beta origin and `/api/system/status` from outside the network, showing
  HTTPS, the security headers, and a redirect from HTTP.
- A browser session showing the session cookie with `Secure`, `HttpOnly` and `SameSite=Lax`, and one
  realtime message delivered over `wss://` on the same origin.
- The deployment configuration file or platform settings, with secrets referenced and not inlined.

Full list: [Domain, TLS, and edge](LAUNCH-CHECKLIST.md#domain-tls-and-edge). HSTS stays off until
every subdomain under the beta domain is HTTPS-ready.

### Failure / rollback consequence

A wrong `Application__PublicBaseUrl` sends every confirmation, reset and invitation link to the
wrong origin, and the startup validator will not catch a value that is well-formed and wrong. A
missing certificate renewal takes the whole beta offline until it is fixed. Rollback is a DNS change
plus redeploying the previous image digest; it does not undo mail already sent carrying a bad link,
which has to be resent after the fix.

---

## 6. Gate 2 - Managed PostgreSQL, migrations, backups, and one restore rehearsal

**Owner:** Database owner.
**Classification:** external setup. The schema, its constraints and its migrations are
**code-complete**; the migration *deployment step* has no artefact in this repository (section 13,
gap R4).
**Depends on:** G3a. Blocks everything that stores anything.

The database is the source of truth here in a stronger sense than usual: tenant isolation,
enrollment overlap, the immutable ledgers and the append-only history are enforced by PostgreSQL
constraints and triggers, not by application memory. A restore that brings back rows but not those
guarantees is not a restore.

### Required configuration

| Setting | Value for beta |
| --- | --- |
| `ConnectionStrings__Database` | from the secret store, least-privilege application role, TLS required, private networking |
| `Database__ApplyMigrationsOnStartup` | `false` in the beta environment. Migrations are a deployment step |
| `TB_GYM_SEED_ENABLED` -> `Seed__Enabled` | `false`. The API refuses seeding outside Development and throws at startup if this is true |
| `TB_GYM_ADMIN_EMAIL`, `TB_GYM_ADMIN_PASSWORD` | unset. These exist for development seeding only |

The migrations run `CREATE EXTENSION IF NOT EXISTS btree_gist` and `pg_trgm`, so the migration role
must be permitted to do that on the managed instance - several providers restrict it, and some
require the extension to be allow-listed on the instance first. The GiST exclusion constraints and
the trigram search indexes depend on both. Check this before the first migration, not during it.

### Order of work

1. Provision managed PostgreSQL 18 with encryption at rest, private networking and a supported patch
   policy. Create two roles: the application role and a separate migration role.
2. Apply migrations from the release commit as a deliberate, single, non-concurrent step, with a
   backup taken immediately before. Confirm `dotnet ef migrations has-pending-model-changes` is
   clean from that same commit - CI already runs exactly this check.
3. Turn on automated backups and point-in-time recovery. Write down the RPO and RTO you are actually
   prepared to accept for a beta; they are a decision, not a default.
4. **Rehearse one restore into an isolated environment.** This is the item most often skipped and the
   only one that proves the rest.

### Evidence required for the restore rehearsal

Dated, from an isolated environment, and kept:

- The backup identifier and timestamp restored from, and the wall-clock time the restore took.
- Row counts for identity users, tenants, client enrollments, payment records and media assets,
  compared against the source.
- A schema read-back showing the GiST exclusion constraints on enrollment entitlements and primary
  mesocycles are present, and that the immutable-ledger triggers exist.
- One successful identity sign-in against the restored database.
- One cross-tenant negative check: a member of workspace A cannot read workspace B's client.
- One media row's `(location, key)` locator read back intact - a restore that loses locators leaves
  objects nobody owns.

Full list:
[PostgreSQL, backups, and migrations](LAUNCH-CHECKLIST.md#postgresql-backups-and-migrations).

### Failure / rollback consequence

An unrehearsed backup is an assumption. If the restore has never been run, the honest recovery
position for the beta is "we lose the participants' data", which is a thing to know before you
invite people rather than after. Schema rollback is a tested restore or a forward-repair migration;
destructive down migrations are not a production strategy and are not available here.

---

## 7. Gate 3 - Secrets and persisted Data Protection keys

**Owner:** Security owner.
**Classification:** external setup; the Production key-path requirement is **code-complete**.
**Depends on:** nothing - G3a is first, and G3b's configuration depends on nothing either. Only
G3b's *proof* depends on G1 and G4. Both block G4.

### G3a - the secret store

Every credential the beta holds - database, email API key, email webhook signing secret, the address
fingerprint key, and the R2 keys if D2 chooses Option A - lives in a managed secret store reached by
workload identity, never in a committed file and never in a shell history. Write the rotation and
emergency revocation procedure at the same time, and test revocation on one credential.

Evidence: the store, the workload identity binding, the written rotation procedure, and one
credential actually revoked and observed to stop working.

### G3b - one Data Protection key ring, shared

`DataProtection__KeyPath` must point the API and the Worker at the **same persisted key ring**, and
both must be running with it. The Worker mints confirmation and reset tokens; the API unprotects
them. Two key rings make every link this system sends fail on click, with an error that reads as
"invalid token" and is really a deployment mistake. Production refuses to start without a key path;
it cannot detect two different ones.

The key ring must survive redeployment, and be readable by both processes and by nobody else.

Evidence: the storage location and its backup, the permissions on it, and both processes' startup
logs showing the same path.

The **proof** that the ring is genuinely shared is a password reset requested against the beta
origin, the link clicked, and the password changed - a token the Worker minted and the API
unprotected. Nothing else tests it. That is necessarily the same click as Gate 4's reset proof, so
it happens once, at Gate 4, and closes both gates. Configure the key ring first; do not defer
configuring it until you can prove it.

Full list:
[Secrets and production configuration](LAUNCH-CHECKLIST.md#secrets-and-production-configuration).

### Failure / rollback consequence

A lost or unshared key ring invalidates every outstanding confirmation, reset and invitation link
and every session cookie. Recovery is a redeploy with the correct shared path and a resend of the
affected mail; links already sitting in mailboxes cannot be rescued. Rotating the ring is deliberate
and has the same effect, so do it knowingly.

---

## 8. Gate 4 - Transactional email domain, webhook, worker, and end-to-end proof

**Owner:** Deployment owner, with the Security owner holding the secrets.
**Classification:** **code-complete** (Phase 6B-3B and 6B-3C: the provider adapter, event
verification, bounce and complaint handling, durable suppression, retries, idempotency, template
versioning, and the tokenless action-mail design). Everything remaining is **external setup**.
**Depends on:** G1 for the origin and G3b for the shared key ring. Blocks the first invitation.

Nothing about this beta works without mail. Confirmation, password reset and client invitation are
all materialized by the Worker; a deployment without a running Worker queues mail that nobody ever
receives, and unlike a commercial notification the person is blocked.

### Required configuration

| `.env.example` name | Config key | Value |
| --- | --- | --- |
| `TB_GYM_EMAIL_ENABLED` | `Notifications__Email__Enabled` | `true` |
| `TB_GYM_EMAIL_ADAPTER` | `Notifications__Email__Adapter` | `Resend` |
| `TB_GYM_EMAIL_API_KEY` | `Notifications__Email__Provider__ApiKey` | from the secret store |
| `TB_GYM_EMAIL_FROM` | `Notifications__Email__Provider__FromAddress` | the verified sending identity on the mail subdomain |
| `TB_GYM_EMAIL_WEBHOOK_SECRET` | `Notifications__Email__Provider__WebhookSigningSecret` | the `whsec_`-prefixed secret from the provider's webhook page |
| `TB_GYM_EMAIL_FINGERPRINT_KEY_ID` | `Notifications__Email__Provider__FingerprintKeyId` | the id new suppressions are written under |
| `TB_GYM_EMAIL_FINGERPRINT_KEY` | the matching entry under `Notifications__Email__Provider__FingerprintKeys` | a fresh base64 key over at least 32 random bytes, generated straight into the secret store |
| `TB_GYM_ACTION_MAIL_MAX_ATTEMPTS` | `Application__ActionMail__MaximumAttempts` | keep it small; every attempt mints a fresh live credential |
| - | `Notifications__Dispatch__MaximumAttempts` | must fit inside the provider's idempotency retention window; startup refuses a schedule that outruns it |

Both the API and the Worker need the email settings. Startup refuses a half-configured provider
whether or not the channel is enabled.

### Order of work

1. Verify the sending **subdomain** with the provider - `mail.<beta domain>`, not the root domain.
2. Publish SPF and DKIM for it, then DMARC at `p=none` with `rua` reporting. Read a week of reports
   before tightening. Test delivery to the mailbox providers your actual participants use.
3. Register the public webhook endpoint `/api/notifications/email/provider-events` on the beta origin
   with the provider, and store its signing secret.
4. Deploy the Worker and confirm it is sweeping.

### Evidence required

- The provider's domain verification screen, and the published SPF, DKIM and DMARC records read back
  from DNS.
- One week of DMARC aggregate reports before any tightening.
- The registered webhook URL and one delivered, signature-verified provider event visible as an
  updated `NotificationProviderMessage` row.
- The Worker's startup and sweep log lines from the beta environment.
- **End to end, in the beta environment, against a real mailbox you control:** a registration
  confirmation received and clicked; a password reset received and clicked; a client invitation
  received and accepted. Password recovery must return no link in the API response - that is by
  design, in every environment.
- A deliberate hard-bounce test to a provider-supplied bounce address, and the resulting suppression
  row.

Full lists: [Transactional email](LAUNCH-CHECKLIST.md#transactional-email),
[Action mail readiness](LAUNCH-CHECKLIST.md#action-mail-readiness), and
[Notification and provider readiness](LAUNCH-CHECKLIST.md#notification-and-provider-readiness).

### Failure / rollback consequence

Unverified DNS means mail is accepted by the provider and silently filtered by the recipient - nobody
can confirm an account or accept an invitation, and nothing in the application reports a fault. A
missing webhook means bounces and complaints are never recorded, so suppression never happens and
the sending reputation degrades quietly. Rolling back is setting `TB_GYM_EMAIL_ENABLED=false`, which
stops all outbound mail and therefore all onboarding; that is a beta pause, not a fix.

---

## 9. Gate 5 - Media: configure it, or switch it off

**Owner:** Deployment owner; the findings reader named below is a standing role.
**Classification:** the adapters, the authorized delivery path and the read-only reconciliation pass
are **code-complete** and accepted (Phase 6B-4A, 6B-4B, 6B-4C). Everything below is
**external setup**.
**Depends on:** D2, G1, G3a. Blocks nothing else; it can run in parallel with Gate 6.

### Option B - no real uploads for the beta (the smaller path)

Leave both adapters unnamed. `appsettings.json` already ships `Media:StorageAdapter` and
`Media:ScannerAdapter` as `None`, so this is the state a deployment reaches by doing nothing.

| `.env.example` name | Config key | Value |
| --- | --- | --- |
| `TB_GYM_MEDIA_STORAGE_ADAPTER` | `Media__StorageAdapter` | `None`, or unset |
| `TB_GYM_MEDIA_SCANNER_ADAPTER` | `Media__ScannerAdapter` | `None`, or unset |

Note the trap: `.env.example` ships these as `Local` and `Development`, because that is what a
development machine composes. Carried onto a beta host unchanged, **both refuse startup** - "Local
media storage may be selected only in Development" and "The development media scanner may be
selected only in Development". That is the guard working. Do not copy `.env.example` onto the beta
host and edit the parts you remember.

What that means, precisely:

- Every upload is refused **before any bytes are accepted**, with `503` and "Media uploads are
  unavailable." No partial object, no orphan row.
- `/health/ready` reports `media-storage` and `media-scanner` as **Degraded**, so the endpoint is not
  Healthy. This is the designed unconfigured state, not a fault - Gate 6 must encode that exception
  so it is not paged as an incident every night.
- Clients lose **progress photos**. Coaches lose **uploaded exercise media**.
- Coaches keep **external media embeds** (`POST /api/media/external`), which need no object store and
  no scanner. Exercise demonstration videos can be linked rather than uploaded for the beta.

Evidence: the deployed configuration; a dated `/health/ready` response showing the two Degraded
entries; one refused upload attempt captured; and **written confirmation that every beta coach was
told before their first client was invited.** A coach who discovers this by trying it in front of a
client is a support incident you chose.

### Option A - real media (the larger path)

Every item under
[Media storage, scanning and inventory](LAUNCH-CHECKLIST.md#media-storage-scanning-and-inventory)
applies, with the evidence each one names there. In summary, and in order:

1. Create the bucket **private, in the EU jurisdiction**, in the account whose 32-hex id is
   configured.
2. Issue a credential **scoped to that one bucket**, Object Read and Write only, never Admin, into
   the secret store as `Media__R2__AccessKeyId` and `Media__R2__SecretAccessKey`
   (`TB_GYM_R2_ACCESS_KEY_ID`, `TB_GYM_R2_SECRET_ACCESS_KEY`), alongside `TB_GYM_R2_ACCOUNT_ID`
   (`Media__R2__AccountId`) and `TB_GYM_R2_BUCKET` (`Media__R2__BucketName`).
3. Apply, by hand with an Admin credential the application never holds, **one** lifecycle rule: abort
   incomplete multipart uploads after 1 day.
4. Write down both agreements the code cannot enforce: **no object-expiration and no storage-class
   transition rule** on this bucket without a new ADR, and **`r2-eu-v1` is never repointed** at
   another account, jurisdiction or bucket. Both need a named owner. An expiration rule deletes
   somebody's photograph with no row change and no audit trail; a repoint makes every historical
   locator name bytes that are not theirs, silently.
5. Stand up the private `clamd` - reachable only on the private network at `Media__ClamAv__Host`,
   port 3310 published to no host interface, `StreamMaxLength` and `MaxFileSize` at or above 512 MB,
   `MaxScanSize` above `MaxFileSize`, roughly 4 GiB of memory (`TB_GYM_CLAMAV_MEMORY`), and outbound
   access for `freshclam` (`TB_GYM_CLAMAV_FRESHCLAM_CHECKS`). `compose.yaml` and
   `docker/clamav/clamd.conf` are the reference configuration.
6. Set `TB_GYM_MEDIA_STORAGE_ADAPTER=R2` and `TB_GYM_MEDIA_SCANNER_ADAPTER=ClamAv`. Naming a provider
   with a configuration it cannot use refuses startup, deliberately.
7. **Prove both adapters end to end in staging**, on production-equivalent topology carrying no
   development credentials and no seed data: an upload stored, scanned clean and readable; the EICAR
   test file refused with no signature name in any response, log or row; an oversized body refused at
   the allowance rather than buffered past it; a scanner outage producing `503` with no asset
   committed and nothing left behind; and a range read serving exactly its range.
8. **Prove one complete reconciliation run** - both passes finished, no outstanding page failure, the
   resolution phase finished - and keep the run row as the evidence. Confirm
   `Media__Reconciliation__ObjectsPerRun` and `Media__Reconciliation__OwnerProbesPerRun` are both at
   least 1 and sized so a run can actually finish; a zero owner-probe budget is refused at startup.
9. **Name the person who reads `media.InventoryFindings`**, the cadence, and what each of the seven
   finding kinds obliges them to do. There is no operator surface, no alert and no notification by
   design. An unread findings table is this phase going unread.

Also confirm the workspace media allowance (`Media__MaxWorkspaceStorageBytes`, 20 GiB by default in
`compose.yaml`) is what you intend for a beta coach.

The reconciliation and purge sweeps run in the **API** process, not the Worker.

### Failure / rollback consequence

Option A with a public bucket defeats the entire delivery model - every read is meant to be "the API
authorized this request", never "the holder of this URL may read these bytes". A `clamd` left at
default limits fails every video upload, and a limit is never a clean result. Rolling back from
Option A to Option B is a configuration change and refuses new uploads immediately, but objects
already stored stay in the bucket and their rows stay live; that is a migration to undo, not a
toggle.

---

## 10. Gate 6 - Monitoring, logs, alert ownership, and incident/support contact

**Owner:** Deployment owner for the pipeline; Support owner for the human end.
**Classification:** structured logging and the health endpoints are **code-complete**; metrics,
traces and error reporting have no integration in this repository (section 13, gap R5), which is
acceptable at beta scale and is not acceptable later.
**Depends on:** G1. Blocks G8.

### What exists

- The API and the Worker emit structured JSON console logs with UTC timestamps. Ship them to a
  hosted log service; do not rely on `docker logs`.
- `/health/live` - process liveness, no database dependency.
- `/health/ready` - entries named `postgres`, `media-storage` and `media-scanner`.
- Sensitive data is kept out of logs by design: no tokens, message bodies, media keys, bucket names,
  provider messages or detected signature names. Verify that on a real captured log anyway.

### Minimum alerting for a beta, each with a named owner

| Alert | Why it is on the beta list |
| --- | --- |
| API or Worker process not running | A stopped Worker queues confirmations and invitations nobody receives |
| `/health/ready` not Healthy | Except the media entries if D2 chose Option B - encode that exception explicitly rather than muting the endpoint |
| 5xx rate, and 401/403/409/429 rates | The shape of a beta failure, and 429 needs watching given gap R1 |
| `notification-email-provider-unauthorized`, logged at `Error` | A revoked or mistyped key. It retries and then dead-letters: visible, but not self-healing |
| Any `Status = 'DeadLettered'` row in `identity."ActionMailRequests"` or `invitations."ActionMailRequests"` | Somebody could not register, recover their account, or be invited |
| Backup failure | Gate 2 is worthless without this |
| Certificate expiry | Gate 1 is worthless without this |
| Database storage and connection saturation | Small deployments hit connection limits before they hit CPU |

Two reviews are deliberately **manual database queries**, because exposing them is a decision about
who may read that somebody asked to reset their password: the two action-mail queues above, and
`media.InventoryFindings` if D2 chose Option A. Name who runs them and how often.

### Evidence required

- The log destination, its retention period, and a redaction spot-check on a real captured log.
- The uptime check hitting `/health/ready` from outside the network, with its history.
- Each alert above configured, with a named owner and a **test firing**. An alert nobody has ever
  seen fire is a configuration you have not tested.
- The support contact address or number, its response-time promise, and the sentence that tells beta
  participants about it.
- An incident note template: what happened, who was affected, what was preserved, what was told to
  whom and when.

Full list: [Monitoring and operations](LAUNCH-CHECKLIST.md#monitoring-and-operations).

### Failure / rollback consequence

Without this gate the first beta failure is discovered by a coach telling you their client could not
sign in, some hours after it started, with no logs retained to explain it. There is no rollback from
missing evidence.

---

## 11. Gate 7 - Minimum privacy, legal, health-data and payment decision gates

**Owner:** Product owner, with a qualified external Legal/compliance owner. **Nothing in this
section may be answered by this repository, or by an agent working in it.**
**Classification:** decision gates. The consent *recording* path is code-complete; consent
*publication* is a repository gap (section 13, gap R3).
**Depends on:** D1, D5, D7. Blocks G8.

This is the minimum for an invite-only beta among people you can phone. It is not a compliance
programme, and passing it is not a launch position. The full obligations are
[Privacy, legal, and health-adjacent data](LAUNCH-CHECKLIST.md#privacy-legal-and-health-adjacent-data)
and
[Lebanon payments and commercial operations](LAUNCH-CHECKLIST.md#lebanon-payments-and-commercial-operations),
and both need qualified Lebanese professionals.

**Participation agreement.** A written, signed agreement per coach and per client, out of band
(D5). It must say this is a beta, what data is held, who can see it, how long it is kept, how to get
it deleted, and who to contact.
*Evidence:* the signed documents, held outside the application.

**Health-adjacent data.** An explicit statement that intake, measurements, photos and programming
are held, who reads them, and that they are not medical advice and not a medical record.
*Evidence:* the wording, reviewed by the Legal/compliance owner.

**No medical or nutritional guarantees.** TB Gym must not present allergy warnings, calorie
estimates or programming as medical guarantees. Confirm the beta wording participants actually see
does not.
*Evidence:* the reviewed participant-facing wording.

**Deletion on request.** A named person who will run the manual deletion, and a promise no larger
than what they will actually do. There is no export or deletion workflow in the product; that is
Phase 8.
*Evidence:* the written procedure and the named owner.

**Payment decision (D1).** For a free beta: record that no money is collected, and confirm no coach
invoices a beta client through the product. For a manual paid beta: the collection method, the
invoice and tax position, who may record a payment, and the reconciliation policy - all confirmed
with Lebanese legal and accounting advisers before the first receipt.
*Evidence:* the recorded decision, dated and signed by the Product owner; for a paid beta, the
advisers' written confirmations.

If D1 is a manual paid beta, note what Phase 2 does and does not do: a manual receipt must match the
enrollment currency exactly, a partial receipt grants no access, and there is no FX, credit, refund,
waiver or recurring billing behaviour. Those are absent deliberately. Do not promise a participant a
refund the system cannot record.

### Failure / rollback consequence

Collecting health-adjacent data from real people without a consent record is not a defect you can
roll back - the data has been collected. If this gate cannot be passed, the beta does not start. A
smaller beta is not a smaller obligation.

---

## 12. Gate 8 - Security verification and beta rollout/rollback

**Owner:** Security owner for the verification; Product owner for the go/no-go; the D8 person for
the stop.
**Classification:** the automated verification is **code-complete**; the beta pass and the runbook
are external work.
**Depends on:** G1 through G7.

### Beta security verification

This is a **beta-scope** pass. An independent penetration test is a launch gate, not a beta gate -
record it as deferred with a target date rather than pretending it happened.

- `scripts/check.ps1` green from the release commit: Release build, the full backend suite against
  real PostgreSQL and Redis, then Angular format, lint, build, Vitest and
  `npm audit --audit-level=high`. Docker must be running, or the Redis scale-out tests report
  inconclusive instead of executing.
- CI green on that same commit, which adds what the local script does not run: EF model-drift
  detection, and the container image smoke tests.
- Deployed images pinned **by digest**, with the digest recorded against the release.
- Confirm in the running beta environment: `Seed__Enabled=false` and no seeded accounts exist;
  `/openapi/v1.json` is **not** served - the API maps it in Development only, so verify the deployed
  environment name is what you think it is; and no development credential is present anywhere in the
  configuration.
- Verify at the real edge, not only in tests: CSP, `X-Frame-Options`, `nosniff`, referrer policy,
  permissions policy, and that no proxy in front of nginx is adding a CORS header.
- One manual cross-tenant spot check with two real workspaces and two real accounts: a coach in
  workspace A cannot read workspace B's client, enrollment, media or messages.
- One manual authorization spot check on a protected endpoint using a client account, confirming the
  server refuses rather than the UI merely hiding it.
- Read gap R1 in section 13 before tuning any rate limit, and record the accepted position for the
  beta either way.

Full list: [Security verification](LAUNCH-CHECKLIST.md#security-verification).

### Rollout

| Wave | Who | Entry condition | Hold for |
| --- | --- | --- | --- |
| **0** | Deployment owner only | Gate 1-7 evidence complete | 48 hours of the environment simply running: no restarts, no unexplained 5xx, backups taken, alerts quiet |
| **1** | 1 coach, 2-3 of their clients, all reachable by phone | Wave 0 clean; the coach briefed, including the media decision from D2 | 1 week, confirming the round trip below |
| **2** | The remaining coaches, up to 10 clients in total | Wave 1 week with no unresolved incident and no dead-lettered action mail | 1 week |
| **3** | Up to 30 clients in total | Wave 2 clean; database and storage headroom confirmed | - |

The wave 1 round trip, confirmed with the coach on the phone: onboarding mail arrives and is acted
on, a program is assigned and executed, a check-in submits and is reviewed, messaging delivers both
ways, and a payment is recorded if D1 is a paid beta.

### Rollback criteria - any one of these stops the beta

The D8 person decides; no meeting required.

- Any cross-tenant data exposure, actual or credibly suspected. Stop immediately, preserve evidence,
  do not redeploy over it.
- Any loss of participant data not recoverable from a backup.
- Authentication, confirmation or reset mail broken for more than 4 hours.
- A dead-lettered action-mail row that means a real person cannot get into their account, unresolved
  for more than 24 hours.
- Sustained 5xx above the rate you agreed to tolerate, or the database unavailable more than twice in
  one week.
- If D2 chose Option A: any media object served without authorization, or a scanner offline long
  enough that uploads are refused for more than a day without participants being told.

### Rollback mechanics

1. Stop new invitations first - that is the only irreversible half.
2. Redeploy the previous image digest. Both images are pinned; there is no "latest" to drift.
3. Schema goes forward, never down: a tested restore, or a forward-repair migration. Destructive down
   migrations are not a production strategy here.
4. Tell every participant within the window promised in Gate 6, in plain language, including what
   data was affected.
5. Write the incident note before fixing the cause, while it is still accurate.

Rehearse steps 1 to 3 once, in staging, before wave 1. A rollback first attempted during an incident
is not a rollback plan.

---

## 13. Repository gaps found during this handoff

Code-level findings from reading the current tree, reported here rather than fixed. None was fixed
as part of writing this document and none is speculative - each names its file and line. They are
labelled R1-R5 so a reference to a gap is never mistaken for a reference to a gate.

Only R1 is a defect. R2 through R5 are work that has not been done or has been deliberately
deferred, recorded here because a beta plan that did not name them would read as though they were
finished.

### R1 - Forwarded headers are accepted from nobody, so per-IP rate limiting collapses behind the proxy

**Evidence.** [Program.cs:46-49](../src/backend/TB.Gym.Api/Program.cs#L46-L49) calls
`UseForwardedHeaders` with an inline `ForwardedHeadersOptions` that sets only `ForwardedHeaders`. A
repository-wide search finds no `KnownProxies`, `KnownNetworks` or `ForwardLimit` anywhere under
`src`, and no test sends `X-Forwarded-For`. ASP.NET Core defaults `KnownProxies` and `KnownNetworks`
to IPv6 loopback only, so when a request arrives from a proxy on a container or private-subnet
address - exactly the topology `src/web/nginx.conf` and `compose.yaml` create - the forwarded values
are discarded and `Connection.RemoteIpAddress` stays the proxy's own address.

**Consequence.**
[DependencyInjection.cs:259](../src/backend/TB.Gym.Infrastructure/DependencyInjection.cs#L259)
partitions the public authentication limiter on `Connection.RemoteIpAddress`, and
[DependencyInjection.cs:284](../src/backend/TB.Gym.Infrastructure/DependencyInjection.cs#L284) does
the same for the provider webhook. Behind the proxy every caller shares one partition, so the
30-per-minute sign-in allowance becomes a single global bucket for the whole deployment: one noisy or
hostile client can lock every participant out of signing in, and per-address brute-force protection
does not exist. Client addresses in logs are the proxy's, so an incident cannot be attributed either.
Related: with the scheme also unforwarded, `UseHttpsRedirection` sees `http`; it is inert today only
because the container publishes no HTTPS port, which is why section 5 says not to set
`ASPNETCORE_HTTPS_PORT`.

**Not affected.** Cookies are `CookieSecurePolicy.Always` outside Development, so cookie security does
not depend on the forwarded scheme. Action links are built from configuration and never from a request
header, so link integrity is unaffected.

**Note.** [Domain, TLS, and edge](LAUNCH-CHECKLIST.md#domain-tls-and-edge) carries "Configure trusted
proxy networks before accepting forwarded headers" as an operator item, but there is no configuration
surface for it - the options are constructed in code with nothing bound to configuration. That
checklist item cannot currently be completed by an operator.

**Beta position.** Not a hard blocker at 30 users. It is a real degradation with a security
consequence, and it needs a decision recorded in Gate 8 either way.

### R2 - No deployment configuration exists for a non-development environment

**Evidence.** `compose.yaml` is the only compose file in the repository and hard-codes
`ASPNETCORE_ENVIRONMENT: Development`, `DOTNET_ENVIRONMENT: Development`,
`Database__ApplyMigrationsOnStartup: "true"` and `Seed__Enabled` defaulting to `true`. There is no
override file, no deployment manifest, and no production configuration under `docker/`.
`LAUNCH-CHECKLIST.md` already forbids deploying it as production configuration.

**Consequence.** Gate 1 cannot be executed by editing an existing file; the deployment configuration
has to be authored. Deliberately not written here: it depends on D3 and on the hosting platform, and
guessing either would be speculative.

### R3 - Legal document versions can be accepted but never published

**Evidence.** `LegalConsent.cs:61` defines `ApproveAndPublish`, and a repository-wide search finds no
caller - no endpoint, no application service, no seed. `LegalConsentEndpoints.cs` exposes only
`GET /api/legal/documents/current` and `POST /api/legal/consents`, and no Angular feature references
either.

**Consequence.** In-app consent cannot be captured for the beta, because there is nothing to accept.
This is consistent with CLI-010 and with Phase 8, which owns production legal-document publication and
consent enforcement, so it is a deferral rather than a defect. It is why D5 exists and why Gate 7
routes consent out of band.

### R4 - The migration deployment step has no artefact

**Evidence.** `DatabaseInitializer.cs:34-58` applies migrations in-process when
`Database:ApplyMigrationsOnStartup` is true, with no advisory lock. The runtime images carry no EF
tooling, CI produces no migration bundle, and `scripts/` contains no migration script.

**Consequence.** Gate 2's separate migration step is a procedure the Database owner must define -
running `dotnet ef database update` from a build host against the beta database, or producing a
migration bundle. At one API replica, `ApplyMigrationsOnStartup=true` would also work, but it makes
every restart a schema operation and there is no lock protecting a second replica later. Recorded,
not solved; the choice belongs to the Database owner and to D3.

### R5 - No metrics, traces or error reporting

**Evidence.** `Directory.Packages.props` contains no OpenTelemetry or error-reporting package, and
both hosts configure JSON console logging only.

**Consequence.** Gate 6 is log-and-uptime shaped for the beta. That is a reasonable trade at 30 users
and an unreasonable one later; it belongs to Phase 8's observability work, not to this beta.

### Minor: two compose variables are not in `.env.example`

`TB_GYM_MEDIA_WORKSPACE_QUOTA_BYTES` (`Media__MaxWorkspaceStorageBytes`) and the
`TB_GYM_NOTIFICATION_*` dispatch variables are read by `compose.yaml` but not documented in
`.env.example`. Not beta-blocking; noted so those defaults are chosen rather than inherited.

---

## 14. Explicitly out of scope for this beta

Not deferred by oversight - excluded, so that nobody adds them under time pressure:

- Phase 7 theming and gamification.
- Phase 8 SaaS productization, tenant billing, coach self-onboarding, quotas.
- WhatsApp, SMS and push channels.
- Marketing email, campaigns, bulk mail, and any unsubscribe surface.
- Recurring billing, FX, credits, refunds, waivers and installments.
- AI features.
- Public sign-up, public marketing, and any public launch.
- An independent penetration test, load testing and SLOs - launch gates, recorded with target dates,
  not beta gates.

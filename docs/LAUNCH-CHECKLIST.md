# TB Gym Launch Checklist

Status: launch gate, not proof of compliance. Owner and evidence must be attached to every
completed item. Final legal, privacy, tax, payment, and health-data obligations require
qualified Lebanese and target-market professionals.

Use [OWASP ASVS 5.0.0](https://github.com/OWASP/ASVS/releases/tag/v5.0.0) Level 2 as the
baseline verification catalogue for the authenticated SaaS. Record applicable requirement
IDs, test evidence, accepted exceptions, owner, and expiry; do not claim certification merely
because this checklist references ASVS.

## Transactional email

The provider, the adapter, event verification, bounce and complaint handling, suppression, retries
and idempotency ship with Phase 6B-3B; see `ARCHITECTURE.md` section 19 and ADR 0022. What remains
below is external setup and operations, none of which this repository automates.

- [x] Select a production transactional email provider and integrate it behind the owned transport
      port. Resend, via an owned `HttpClient` adapter with no provider SDK. (Phase 6B-3B)
- [x] Add provider event verification, bounce/complaint handling, durable suppression, retries,
      idempotency, template versioning and stable failure codes. (Phase 6B-3B)
- [ ] Verify sending domain ownership with the provider, on a dedicated subdomain such as
  `mail.example.com`, so transactional reputation is isolated from the root domain's other mail.
- [ ] Publish SPF and DKIM for that subdomain, then DMARC starting at `p=none` with `rua` reporting;
  read a week of reports before tightening. Test alignment and delivery to common Lebanese and global
  mailbox providers.
- [ ] Register the public webhook endpoint `/api/notifications/email/provider-events` with the
  provider and store its `whsec_` signing secret in the secret store. Nothing establishes
  recipient-server acceptance, bounce or complaint without it.
- [ ] Generate an address-fingerprint key (base64, at least 32 random bytes), set
  `Notifications:Email:Provider:FingerprintKeyId` and the matching entry under `FingerprintKeys`, and
  record the rotation procedure: add a new key id, repoint the active id, and keep every retired key
  configured. Removing a retired key drops the suppressions written under it and resumes mail to
  addresses that hard-bounced.
- [ ] Confirm `Notifications:Dispatch:MaximumAttempts` still fits inside the provider's idempotency
  retention window. Startup refuses a schedule that outruns it, so revisit whenever either changes.
- [x] Move account confirmation, password reset and invitation mail onto the tokenless design in
      ADR 0021, and remove action links from API responses outside Development. Development links now
      come from the captured adapter, which Production refuses; password recovery returns no link in
      any environment. (Phase 6B-3C)
- [ ] Set `Application:PublicBaseUrl` to the production origin and list it in
  `Application:PublicOriginAllowlist`. Both are validated at startup in the API **and** the Worker,
  and both refuse to start on anything that is not a bare HTTPS origin — a value carrying credentials,
  a query string, a fragment or a path is refused outright. No action link is ever built from a
  request header, so this setting is the only thing that decides where a reset link points.
- [ ] Point `DataProtection:KeyPath` at the **same** persisted key ring for the API and the Worker,
  and confirm both are running with it. The Worker mints confirmation and reset tokens and the API
  unprotects them; two key rings make every link this system sends fail on click, with an error that
  reads as "invalid token" and is really a deployment mistake.
- [ ] Confirm the Worker is deployed and sweeping. Action mail is materialized by the Worker, so a
  deployment without one queues confirmations and resets that nobody ever receives — and unlike a
  commercial notification, nobody can proceed without them.
- [ ] Review `Application:ActionMail:MaximumAttempts` against the provider's idempotency retention.
  Startup refuses a schedule that outruns it. Keep it small: every durable attempt mints a fresh live
  credential, and a link nobody used inside the schedule is one the person has already asked for again.
- [ ] Keep invitation/reset tokens, message bodies, and personal data out of logs.

## Domain, TLS, and edge

- [ ] Register the production domain and define API/web DNS ownership and renewal contacts.
- [ ] Terminate TLS 1.2+ with automatic certificate renewal; redirect HTTP and test renewal.
- [ ] Serve SPA and API under the approved same-origin model so cookie/XSRF assumptions hold.
- [ ] Configure trusted proxy networks before accepting forwarded headers. Set
  `ReverseProxy:Enabled` to true only with a reverse proxy in front of the API, and name it with
  `ReverseProxy:TrustedProxies` addresses, `ReverseProxy:TrustedNetworks` CIDR entries, or both;
  startup refuses an enabled deployment that names neither. Leave it false for a directly reachable
  deployment. Evidence: the configured values, and a request through the edge whose logged client
  address is the browser's rather than the proxy's. Loopback (`::1`, `127.0.0.0/8`) stays trusted by
  framework default, so also confirm the API is bound to a private interface and is not reachable
  directly.
- [ ] Enable HSTS only after all production subdomains are HTTPS-ready.
- [ ] Validate CSP, frame denial, `nosniff`, referrer policy, permissions policy, CORS, and
  WebSocket headers at the real edge/CDN, not only in application tests.

## Secrets and production configuration

- [ ] Store database, email, payment, object-storage, signing, monitoring, and future AI
  secrets in a managed secret store with least-privilege workload identity.
- [ ] Define rotation and emergency revocation procedures; verify old credentials stop working.
- [ ] Set `ASPNETCORE_ENVIRONMENT=Production`, explicit connection strings, public origin,
  cookie/domain settings, and approved proxy settings through deployment configuration.
- [ ] Keep `Seed__Enabled=false`. The API refuses seeding outside Development; retain a
  production startup test for this guard.
- [ ] Never deploy local Compose configuration or seeded development accounts as production
  configuration. Scan built artifacts and deployment manifests for local-only values.
- [ ] Disable production OpenAPI exposure unless deliberately authenticated/restricted.
- [ ] Persist and protect ASP.NET Core Data Protection keys across replicas and deployments.

## PostgreSQL, backups, and migrations

- [ ] Use managed PostgreSQL with encryption, private networking, least-privilege application
  and migration roles, connection limits, and supported version/patch policy.
- [ ] Enable automated backups and point-in-time recovery with an approved RPO/RTO.
- [ ] Perform and document a restore into an isolated environment; verify row counts,
  constraints, identity login, tenant isolation, and object references.
- [ ] Encrypt backups, restrict access, audit restores/downloads, and test retention expiry.
- [ ] Run migrations as a separate deployment job under an advisory/exclusive lock. Do not
  let every API replica migrate at startup in production.
- [ ] Review each migration for locks, table rewrites, extension permissions, forward/backward
  compatibility, backup requirement, and a forward-repair plan before deployment.
- [ ] Verify `btree_gist`, exclusion constraints, immutable-ledger triggers, and migration
  drift in staging with production-like PostgreSQL.

## Monitoring and operations

- [ ] Centralize structured logs, metrics, traces, uptime checks, and error reporting with
  environment/release correlation and tenant-safe identifiers.
- [ ] Alert on elevated 5xx/401/403/409/429 rates, login lockouts, email failures, outbox age,
  migration failure, database saturation, backup failure, and certificate expiry.
- [ ] Redact passwords, auth/invitation/reset tokens, cookies, health/intake data, payment
  secrets, legal-document acceptance payloads, and provider callback bodies.
- [ ] Define on-call ownership, severity levels, incident response, customer communication,
  evidence preservation, and post-incident review.
- [ ] Establish SLOs and capacity/load tests before launch; rehearse database and provider
  outage behavior.

## Security verification

- [ ] Complete threat models for identity/session, invitation takeover, tenant isolation,
  broken object authorization, payments, legal consent, media upload, SignalR, and provider
  callbacks.
- [ ] Map automated/manual tests to applicable OWASP ASVS Level 2 controls and remediate or
  time-bound every exception.
- [ ] Commission an independent penetration test focused on authentication, authorization,
  tenant crossover, CSRF, injection, SSRF, file handling, and business-logic races.
- [ ] Verify authorization and `ICoachingFeatureAccessService` on every protected endpoint;
  never rely on hidden Angular navigation.
- [ ] Tune per-IP authentication and per-user/workspace sensitive-write rate limits using
  observed traffic; add gateway/WAF abuse controls and safe 429 monitoring.
- [ ] Run dependency/container/secret/SAST scans, pin deployment artifacts by digest, produce
  an SBOM, and define security update SLAs.
- [ ] Review cookie flags, session lifetime/revocation, lockout, email confirmation, XSRF,
  content security policy, and account recovery against the production topology.

## Privacy, legal, and health-adjacent data

- [ ] Engage qualified counsel for Lebanese launch and every served jurisdiction. Approve
  Terms, Privacy Policy, processor/subprocessor disclosures, and health/intake consent.
- [ ] Publish reviewed, versioned documents with immutable content hashes. Never mark draft
  placeholder wording as approved.
- [ ] Decide lawful basis, data controller/processor roles, age policy, cross-border transfer,
  breach notification, and sensitive/health-adjacent handling obligations.
- [ ] Build and test user/tenant data export, correction, deletion/anonymization, account
  closure, legal hold, and auditable request workflows before accepting production clients.
- [ ] Approve a per-data-class retention schedule covering accounts, intake, measurements,
  programs, chat, media, payments, consent evidence, logs, backups, and provider records.
- [ ] Publish support/privacy contact channels and response SLAs.
- [ ] Review fitness/nutrition claims and disclaimers with qualified professionals. TB Gym
  must not present allergy warnings, calorie estimates, or programming as medical guarantees.

## Lebanon payments and commercial operations

- [ ] Confirm launch collection methods, merchant eligibility, settlement currencies, fees,
  tax/invoice/receipt obligations, chargeback/refund rules, and reconciliation with Lebanese
  legal/accounting advisers.
- [ ] Verify any Whish or other Lebanese/MENA provider directly with the provider: current
  API availability, merchant onboarding, supported currencies/countries, webhook signing,
  sandbox, settlement, refunds, disputes, data residency, and support SLA. Do not advertise a
  provider before a signed agreement and end-to-end test.
- [ ] Define manual-payment evidence and dual-control/reconciliation policy. Limit who may
  record, refund, reverse, waive, or export payment data.
- [ ] Decide installments, discounts, credits, waivers, overpayment, FX conversion, refunds,
  reversals, recurring renewal, grace periods, and historical-content access before enabling
  those workflows.
- [ ] Reconcile immutable TB Gym payment operations to bank/wallet/provider statements and
  investigate discrepancies without editing history.

## Notification and provider readiness

- [ ] Run a durable outbox worker with lease/claim semantics, retries, backoff, dead-letter
  visibility, and idempotent provider operations.
- [ ] Re-evaluate enrollment/access state immediately before delayed notification delivery.
- [ ] Approve localized templates, sender identity, quiet hours, user preferences, unsubscribe
  rules where applicable, and time-zone/DST tests.
- [ ] Do not enable WhatsApp until an approved provider, templates, consent policy, webhook
  verification, and data-processing terms exist.
- [ ] Alert on `notification-email-provider-unauthorized`, which is logged at `Error` and means the
  provider rejected this deployment's credentials or sending identity. It retries and then
  dead-letters, so it is visible but not self-healing.
- [ ] Watch permanent-bounce and complaint rates against the provider's and Gmail's published
  thresholds, and watch new suppression rows per day. A spike in either is a data-quality problem
  upstream rather than a mail problem.
- [ ] Rehearse provider-outage recovery: deliveries retry on the named schedule and dead-letter if the
  outage outlasts it, and missed webhooks are recovered by replaying events from the provider's
  dashboard. Ingestion is idempotent on the provider's event identifier, so a replay converges.
- [ ] Decide a retention policy for provider-event history and dead letters before either grows past
  what an operator can read. Neither holds personal data; both accumulate.

## Action mail readiness

Account confirmation, password reset and client invitations run on ADR 0021's tokenless
materialization since Phase 6B-3C; see `ARCHITECTURE.md` section 20 and `DOMAIN-RULES.md` NOT-025
through NOT-034. These are the operational checks that stay live afterwards.

| Ongoing check | What to watch | Why it matters |
| --- | --- | --- |
| Dead-lettered action mail | `identity."ActionMailRequests"` and `invitations."ActionMailRequests"` with `Status = 'DeadLettered'` | Somebody could not register, recover an account or be invited. Alert on any of these; unlike a commercial notification, the person is blocked |
| Suppression codes | `FailureCode` on suppressed requests | `already-confirmed` and `credential-changed` are normal and healthy. A rise in `origin-unavailable` is a configuration fault |
| Unresolved recovery requests | Requests with `SubjectUserId IS NULL` | Expected and harmless — this is the enumeration-resistant path. A sudden spike is somebody probing for accounts, and the rate limiter is the control |
| Generation growth | `LogicalSendGeneration` on pending invitations | Repeated resends mean a coach is not getting through; each one kills the previous link, so a client with an old tab will see it stop working |
| Token record growth | `invitations."TokenIssues"` | Grows with every send and retry. Holds no address and no credential, but it grows, and it has no retention policy yet |

There is deliberately **no operator view** for either queue. Exposing one is a decision about who may
read that somebody asked to reset their password, and reusing the tenant dead-letter surface would be
exactly the cross-workspace visibility ADR 0021 refuses. Until that decision is made, these are
database queries an operator runs deliberately.

## Media storage, scanning and inventory

The storage seam, the R2 and ClamAV adapters, the API-proxied authorized delivery path and the
read-only inventory reconciliation pass ship with Phase 6B-4A, 6B-4B and 6B-4C; see
`ARCHITECTURE.md` section 9, `DOMAIN-RULES.md` MED-004 through MED-012, and ADRs 0023, 0024 and 0025.
That code is accepted. Everything below it is external setup that no part of this repository
performs, verifies or can tick on its own, and a passing `scripts/check.ps1` is evidence for none of
it. Until these are done, a non-Development deployment refuses every upload before accepting bytes
and reports media as `Degraded` on `/health/ready` — the designed unconfigured state.

Two of these are agreements rather than settings. The code cannot detect either being broken, which
is precisely why they are written down here.

- [x] Compose object storage behind an owned provider-neutral port that is fail-closed outside
      Development, with durable `(location, key)` locators, checksum-bound scan evidence and leased
      purge. (Phase 6B-4A)
- [x] Implement the production storage and scanning adapters, explicit loud selection, and readiness
      that probes a composed provider rather than reading a flag. (Phase 6B-4B)
- [x] Implement a bounded read-only reconciliation pass with tenant-owned findings, run evidence that
      distinguishes a complete pass from a partial one, and no repair authority at all. (Phase 6B-4C)
- [ ] Create the production bucket **private, in the EU jurisdiction**, in the account whose 32-hex id
      is configured. A bucket created in another jurisdiction is not reachable on the EU endpoint, and
      a bucket that is public defeats the whole delivery model — every read is meant to be
      "the API authorized this request", never "the holder of this URL may read these bytes".
      Evidence: the bucket's jurisdiction and public-access setting, read back from the provider after
      creation, with the account id and the date.
- [ ] Issue the runtime credential **scoped to that one bucket**, with Object Read and Write only, and
      store it in the managed secret store as `Media:R2:AccessKeyId` and `Media:R2:SecretAccessKey`.
      Object Read and Write already permits the listing reconciliation needs; it is never widened, and
      in particular it must not be an Admin credential. Evidence: the token's scope and permissions as
      the provider reports them, plus the rotation and revocation procedure from the secrets section
      above, with a revocation actually tested.
- [ ] Apply, by hand, **one** bucket lifecycle rule: abort incomplete multipart uploads after **1
      day**. It needs an Admin Read & Write credential that the application never holds and no prefix,
      because an abort rule touches incomplete uploads and never an object. The adapter aborts its
      own interrupted uploads; what it cannot abort is an upload whose process died between the last
      part and the abort, and only the bucket can reclaim those parts. Evidence: the applied rule as
      the provider reports it, the date, and who applied it.
- [ ] Record a signed agreement that **no object-expiration rule and no storage-class transition rule
      is ever enabled on this bucket** without a new ADR and explicit approval. An expiration rule
      deletes an object with no row change, no quota release, no tombstone, no attempt count and no
      audit trail; the application would discover it at read time as a photograph a client still owns
      that will not load. Every deletion in this system belongs to the tombstone lifecycle. Evidence:
      the written agreement, its owner, and a periodic read-back of the bucket's lifecycle
      configuration showing the abort rule and nothing else.
- [ ] Record the second agreement beside it: **`r2-eu-v1` is never repointed** at another account,
      jurisdiction or bucket. That location name is written onto every stored object and is what a
      later read or purge resolves, so a substitution makes every historical locator name bytes that
      are not theirs, silently. Moving buckets is a migration with a new location name, never a
      configuration edit. Evidence: the written agreement and its owner. A reconciliation run
      reporting every object unowned and every row missing is a symptom of this, not a detector of it,
      and must never be described as one.
- [ ] Stand up the private `clamd`: reachable only on the private network at `Media:ClamAv:Host`, port
      3310 published to no host interface — it authenticates nobody — with `StreamMaxLength` and
      `MaxFileSize` at or above 512 MB and `MaxScanSize` above `MaxFileSize`, roughly 4 GiB of memory,
      and outbound access for `freshclam`. Defaults of 25 MB would fail every video upload, and a
      limit is never a clean result. `compose.yaml` and `docker/clamav/clamd.conf` are the reference
      configuration. Evidence: the effective daemon configuration, a successful `PING`, the signature
      database age, and confirmation that the port is not reachable from outside the private network.
- [ ] Verify the daemon's signature feed keeps working after launch, not only at it. A `clamd` whose
      signatures have stopped updating still answers `OK`. Evidence: a monitored signature-database
      age with an alert threshold, and the recorded engine and signature version on recent scan
      evidence rows.
- [ ] Prove both adapters end to end in staging against production-equivalent topology, then keep the
      evidence: an upload stored and scanned clean and readable; the EICAR test file refused without
      the signature name appearing in any response, log or persisted row; an oversized body refused at
      the allowance rather than buffered past it; a scanner outage producing `503` with no asset
      committed and no stored object left behind; and a range read serving exactly its range. Evidence:
      dated run output plus the resulting rows, from a staging deployment carrying no development
      credentials or seed data.
- [ ] Prove one **complete** reconciliation run in staging — both passes finished, no outstanding page
      failure, the resolution phase finished — and keep the run row as the evidence. A partial run is
      not a clean bill of health, and an empty finding set only means something behind a completed
      run. Confirm `Media:Reconciliation:ObjectsPerRun` and `OwnerProbesPerRun` are both at least one
      and sized so a run can actually finish; a zero owner-probe budget is refused at startup.
- [ ] Name the person or role who reads `media.InventoryFindings`, on what cadence, and what each of
      the seven finding kinds obliges them to do. There is deliberately no operator surface, no alert
      and no notification in this phase, so an unread findings table is the whole of what this phase
      delivers going unread. Nothing repairs a finding automatically and nothing should: every
      candidate repair is a deletion of somebody's data or a rewrite of somebody's history on the
      strength of one provider response. Evidence: the named owner, the review cadence, where the
      review is recorded, and one completed review.
- [ ] Decide a retention policy for reconciliation findings and runs before either grows past what a
      person can read. Both are kept indefinitely in v1 and neither holds personal data; this belongs
      with the same deferred decision as provider-event history and dead letters.
- [ ] Confirm media keys, bucket names, endpoints, provider messages and detected signature names stay
      out of logs, analytics, exceptions and notification payloads. A key identifies one workspace's
      private content, which is why a finding is a tenant-owned row rather than a log line.

## Release gate

- [ ] All .NET and Angular builds, tests, lint, formatting, dependency audits, migration drift,
  container builds, health checks, and production smoke tests pass from the release commit.
- [ ] Staging uses production-equivalent topology and no development credentials or seed data.
- [ ] Product owner approves unresolved domain decisions; security, legal, operations, and
  payment owners sign off with dated evidence.
- [ ] Rollout, rollback/forward-repair, feature-disable, support, and customer-communication
  runbooks are rehearsed.

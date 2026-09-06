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
- [ ] Configure trusted proxy networks before accepting forwarded headers.
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

## Release gate

- [ ] All .NET and Angular builds, tests, lint, formatting, dependency audits, migration drift,
  container builds, health checks, and production smoke tests pass from the release commit.
- [ ] Staging uses production-equivalent topology and no development credentials or seed data.
- [ ] Product owner approves unresolved domain decisions; security, legal, operations, and
  payment owners sign off with dated evidence.
- [ ] Rollout, rollback/forward-repair, feature-disable, support, and customer-communication
  runbooks are rehearsed.

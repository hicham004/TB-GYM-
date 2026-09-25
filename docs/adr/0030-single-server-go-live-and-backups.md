# ADR 0030: Single-server go-live and nightly encrypted backups

Status: accepted, 2026-09-25 (commercial Step 4)

## Context

The first 10 founding coaches need a production deployment the owner can run alone, without a
DevOps role and on a small budget. The owner pays from Lebanon with a Whish-loaded Visa card, so
hosting must be easy to leave if a provider refuses sign-up or payment.

## Decision

Decided by the product owner on 2026-09-25:

- **One Linux server running Docker Compose** (`compose.production.yaml`), about 8 GB of memory in
  the EU. Hetzner Cloud is the recommendation and Vultr the fallback; nothing in the setup is
  specific to either. No managed database, staging environment or second server at launch.
- **Progress photos are part of the launch**: Cloudflare R2 media storage and the ClamAV scanner
  (`photos` profile). Without them a 4 GB server works and uploads are refused, as the fallback.
- **Backups run nightly** as an encrypted `pg_dump` in a second, S3-compatible bucket off the server,
  kept 30 days. **Up to a day of data can be lost**; point-in-time recovery waits for a managed
  database after launch.
- **The owner holds the only backup key.** Backups are encrypted to an age public key; the private
  key never touches the server and is kept in a password manager plus a printed or offline copy. A
  stolen server or bucket token cannot read old backups; losing both copies of the key makes every
  backup unreadable.
- **Email is Resend, starting on its free tier**, with the support inbox as Reply-To. A missed-backup
  heartbeat (healthchecks.io) is optional.

Technical consequences: Caddy is the only container with published ports and the only proxy the API
trusts; migrations are a one-shot step before the API and Worker start; in Production both processes
refuse development settings (`ProductionSettingsGuard`). `docs/GO-LIVE.md` is the runbook and
`docs/LAUNCH-CHECKLIST.md` Part 1 the gate.

## Consequences

- A server loss means a new server, the saved `.env`, and a restore of last night's backup: about an
  hour of work and up to a day of lost changes. Sessions end and unused email links stop working,
  because the data-protection key ring is not backed up.
- Scaling past one server (replicas, Redis backplane, managed PostgreSQL) is unchanged from
  `ARCHITECTURE.md` section 10 and needs no rework of the modules.
- Revisit when a coach's data loss tolerance is shorter than a day, or when load or the founding
  cohort outgrows one server.

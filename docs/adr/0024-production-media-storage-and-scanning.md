# ADR 0024: Production Media Storage and Scanning

Status: accepted, 2026-09-08

Builds on: ADR 0023, which built the provider-neutral seam this fills. Its locator, evidence,
fail-closed composition and leased-purge decisions remain in force and are unchanged here.

## Context

ADR 0023 deliberately selected no provider. It left a Media module that owns `(location, key)`
identity, owned full and bounded-range read contracts, checksum-bound scan evidence, and a
composition that is explicitly unavailable outside Development. What it left with it was a
deployment that cannot accept a single upload: the only real adapter is process-local disk, which is
correct for one developer's machine and is not a design for more than one API replica.

Two provider decisions were therefore outstanding, and they are one decision in practice, because
neither is useful alone. Bytes with nowhere durable to live cannot be published; bytes nothing
inspects must not be.

## Decision

### A private Cloudflare R2 bucket in the EU jurisdiction, over S3

Object bytes live in one private R2 bucket, addressed through the account's own EU-jurisdiction
endpoint with the fixed signing region `auto`, using bucket-scoped Object Read and Write credentials
supplied by environment or secret store and never committed.

R2 rather than S3 itself: this is a small application whose media is served through its own API, and
R2 charges no egress. The bytes leave the bucket once per view because delivery is proxied and
authorized per request, which is precisely the access pattern S3 egress pricing punishes. EU
jurisdiction because the workspaces are people's progress photographs and coaching video; keeping
them inside one legal jurisdiction is easier to state and to keep true than to retrofit.

The bucket is private and stays private. No public bucket, no custom domain in front of it, no CDN,
no presigned URL and no direct browser upload. Every one of those replaces "the API authorized this
request" with "the holder of this URL may read these bytes", and the whole media model — membership
rechecked per request, a path-scoped HTTP-only grant, immediate revocation — exists because those
are not the same thing. Server-side encryption with customer keys and client-side encryption are
also out: they would put a key this deployment cannot rotate or escrow between the coach and their
own photographs, for a threat R2's own at-rest encryption already covers.

The durable location `r2-eu-v1` permanently binds one account, one jurisdiction and one bucket. It
is written onto every object stored under it and is what a later read or purge resolves. Repointing
the configuration at a different account or bucket while keeping the location name would make every
historical locator name bytes that are not theirs — silently, because nothing in the process can
detect the substitution. Moving buckets is a migration with a new location name, never a
configuration edit. This is the one operational rule of this ADR that the code cannot enforce.

The adapter serves that one location and refuses every other, `local-v1` included, before it makes
a provider request. It is not a router, and this ADR migrates no local object.

### Streaming, exact bounds, and a checksum this repository computes itself

A write reads the caller's stream into one pooled 8 MiB buffer and hashes exactly the bytes it
transmits. Content that fits the buffer is one request; anything larger becomes a multipart upload of
bounded sequential parts, which is what lets a non-seekable 500 MiB request body be stored without a
temporary file and without knowing its length in advance. One byte past the allowance is refused —
the read is capped at the allowance plus one, so an oversized body is never buffered further than the
point at which it is known to be oversized.

An interrupted upload is aborted from one place, on a cancellation token independent of the
request's, because the commonest reason to abort is that the request was cancelled and cleanup that
inherits the cancellation never runs.

The SHA-256 and the 16-byte signature are computed over exactly those transmitted bytes. The
provider's `ETag` is never consulted for either. It is not a content hash for a multipart object, it
is opaque by specification, and deriving integrity from it would let the provider decide what this
repository believes it stored. Payload signing and the SDK's default checksum flavours are disabled
per request because R2 does not implement them; what is not disabled, and never was, is the hash this
side computes.

### A private ClamAV clamd, over INSTREAM

Scanning is a private `clamd` reached over its INSTREAM protocol on a network nothing outside the
deployment can reach. The stored object is streamed to it in bounded chunks through the same owned
storage contract every other read uses, so a 500 MiB video is never buffered and never written to a
temporary file — a file that would be a second copy of the very bytes the scan exists to distrust.

Two answers are verdicts. `OK` allows the bytes; `FOUND` refuses them. Everything else — an `ERROR`
reply, a stream that exceeded a configured daemon limit, a timeout, a disconnect, a malformed or
unterminated frame — is an operational failure that reports `503`, commits no asset and cleans up
every stored object, exactly as ADR 0023 already required of a scanner that cannot produce a usable
verdict. A limit is never a clean result: a file the daemon declined to finish reading has not been
found clean, and treating a truncated pass as an allowance is how an unscanned file becomes a
published one. The daemon's limits are therefore configured above the application's own 500 MiB
ceiling rather than left at their 25 MB defaults, which would have failed every video upload.

The signature name in a detection is never returned, persisted or logged. The caller is told the file
was rejected. The scanner key and a normalized engine and signature-database version are persisted as
evidence, because a verdict this repository cannot attribute to an engine and a signature set is not
evidence.

The clamd client is owned rather than taken from a package. The protocol is a command, a
length-prefixed body and a status line; what is actually being decided here is bounds — a connect
timeout, a whole-exchange timeout, a capped reply, an unterminated frame that must fail closed, and a
daemon that may answer before the stream ends — and every one of those is a decision this repository
has to make rather than inherit.

### Selection is explicit, and its failures are loud

`Media:StorageAdapter` and `Media:ScannerAdapter` name a provider. Naming one with a configuration it
cannot use refuses startup, naming the wrong name refuses startup, and naming the Development scanner
outside Development refuses startup because that scanner allows every file. Naming nothing keeps ADR
0023's behaviour exactly: fail-closed adapters, refused uploads, and a Degraded media entry on
`/health/ready`.

Readiness now also asks a composed provider whether it answers — a bucket probe whose expected answer
is "no such object", and a `PING`. A configured but unreachable dependency refuses every upload just
as an unconfigured one does, and a check that only read a flag would call that healthy. It stays
Degraded rather than Unhealthy for the reason ADR 0023 gave: everything except media works, and one
dependency must not pull a functioning API out of its load balancer.

## Consequences

Media has a durable home and a real verdict behind it, and the API can run as more than one replica
without container-local files. A runtime outage of either dependency is a generic `503` that
preserves every existing invariant — cleanup, evidence, quota accounting, tombstones and retry — and
neither adapter logs a secret, a key, a bucket, an endpoint or a provider message.

The cost is two dependencies to operate: a bucket whose credential must be scoped and rotated, and a
daemon that wants roughly 4 GiB of memory and a signature feed. The `r2-eu-v1` binding is
operational discipline rather than an enforced invariant. Nothing here reconciles the bucket's actual
inventory against the database, sets a retention or lifecycle policy on it, or gives an operator a
surface for either; that remains Phase 6B-4C.

## Prerequisites

Before a deployment sets `Media:StorageAdapter` to `R2`:

- An R2 bucket created in the **EU jurisdiction**, private, in the account whose 32-hex id is
  configured. A bucket created in another jurisdiction is not reachable on the EU endpoint.
- An R2 API token scoped to **that bucket only**, with Object Read and Write. Supplied through
  `Media:R2:AccessKeyId` and `Media:R2:SecretAccessKey` from the environment or a secret manager.
- An agreement, written down, that `r2-eu-v1` is never repointed at another account or bucket.
- Optionally, a bucket lifecycle rule that abandons incomplete multipart uploads after a day. The
  adapter aborts its own, but a process killed between the last part and the abort leaves parts that
  only the bucket can reclaim.

Before a deployment sets `Media:ScannerAdapter` to `ClamAv`:

- A `clamd` reachable on the private network at `Media:ClamAv:Host`, with `StreamMaxLength` and
  `MaxFileSize` at or above 512 MB and `MaxScanSize` above `MaxFileSize`. `compose.yaml` and
  `docker/clamav/clamd.conf` are the reference configuration.
- Roughly 4 GiB of memory for it, and outbound access for `freshclam`.
- Port 3310 published to no host interface. clamd authenticates nobody.

## References

- ADR 0023: Production Media Foundation (the seam this fills)
- `docs/ARCHITECTURE.md` section 9, `DOMAIN-RULES.md` MED-004, MED-006 and MED-011
- `compose.yaml` and `docker/clamav/clamd.conf`

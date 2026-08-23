# ADR 0011: Progress Photos v1

Status: accepted, 2026-08-23

## Context

Phase 5B-2 adds dated client progress photos. Unlike exercise media, a progress photo is
health-adjacent personal data about one identifiable client, so it cannot inherit the coach
library's access rules.

## Decision

Progress photos reuse the Phase 3 media pipeline rather than a parallel one: streamed upload,
extension/declared-type/byte-signature validation, SHA-256 checksum, malware-scanner port that
fails closed in production, generated tenant-scoped object keys, and the path-scoped short-lived
grant cookie hardened in Phase 4. Only authorization and lifecycle are new.

`MediaAsset` gains a `MediaPurpose` discriminator (`ExerciseMedia`, `ProgressPhoto`). It is stored
explicitly and never inferred, because the two purposes have opposite access rules:

- exercise media stays exactly as before, readable by any Owner/Coach of the workspace and by a
  client whose current training prescription references it;
- a progress photo is readable by the client it depicts, and by an Owner/Coach of that workspace
  only while the coaching relationship is not blocked.

Routing photos through the exercise rules would have simultaneously exposed them to blocked
coaches and denied clients their own images, since that path requires a training entitlement and a
prescription reference. Progress photos are also excluded from the coach media library listing.

The Progress module owns only the coaching association (`ProgressPhoto`) and never references the
Media assembly; Infrastructure composes the two. A photo is one row per tenant, client, local date,
and pose (`Front`, `Side`, `Back`), enforced by a unique index. Uploads are images only, capped at
the image size limit while streaming rather than after buffering, and cannot be dated in the future
against the workspace clock.

Removal is one-way and audited: the row and its media association are retained, an append-only
`ProgressPhotoRemoval` records reason, actor and time, the photo leaves the coach view, and the
owning client keeps it in their own history. A database trigger keeps identity, date, pose, media
reference and creation audit immutable and permits only `Active -> Removed`. Optimistic concurrency
protects the transition. If two uploads race for the same date and pose, the loser's asset is
tombstoned so its bytes are reclaimed by the existing retention sweep rather than orphaned.

## Consequences and deferred work

Coaches and clients get private, auditable photos without a second media stack, and the blocking
rule that Phase 5A established for measurements now extends to images.

**Metadata is stripped before permanent storage.** A phone photo routinely carries GPS
coordinates, device identifiers, and capture timestamps in EXIF, none of which belongs in stored
client health-adjacent data. An uploaded progress photo is therefore decoded and re-encoded from
its pixels alone, which discards every metadata segment. Orientation is the one tag that must
survive, so it is applied to the pixels first; otherwise a portrait photo would display rotated
once the tag is gone.

This uses SkiaSharp, chosen because it is MIT licensed. ImageSharp was rejected: its Six Labors
Split License requires a paid commercial licence for closed-source for-profit use above USD 1M
annual revenue, and from v4 it enforces this at build time, which is an unacceptable liability for
a commercial SaaS. `SkiaSharp.NativeAssets.Linux.NoDependencies` is used so the container needs no
fontconfig or other third-party native libraries.

Sanitisation does not relax any existing protection. Ingest is still streamed under the image byte
cap, the original bytes are still signature-validated, the re-encoded output is signature-validated
again before it is kept, the malware scanner runs against the bytes that are actually stored, the
original object is deleted, and the recorded length and SHA-256 describe the sanitised object.
Decoding needs the whole image in memory, which is bounded by the 15 MB image limit and the
per-workspace upload concurrency gate. Re-encoding a JPEG is lossy; quality 90 is used.

Deferred: side-by-side photo comparison, the combined cross-domain progress dashboard, physical
purge of tombstoned bytes, per-client storage quotas, and device/wearable photo import. Server-side
thumbnails and downscaling were subsequently delivered; see
`docs/adr/0012-progress-photo-thumbnails-v1.md`.

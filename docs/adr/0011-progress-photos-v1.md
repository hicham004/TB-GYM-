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
protects the transition.

If two uploads race for the same date and pose, the unique index settles it: the winner commits, the
loser receives a stable `409`, and the loser's asset is tombstoned so its bytes are reclaimed by the
existing retention sweep rather than orphaned. The cleanup detaches the failed insert first. It was
still tracked as `Added`, so the tombstoning save replayed it, hit the same violation, and escaped
as a `500` — leaving exactly the ready orphan the cleanup existed to prevent. Only the PostgreSQL
unique violation is caught; any other database failure stays a failure rather than being reported as
a duplicate that does not exist.

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
Re-encoding a JPEG is lossy; quality 90 is used.

**The compressed byte cap does not bound decoded memory, and never did.** The original text of this
ADR claimed decoding was "bounded by the 15 MB image limit". It is not: PNG's filtering and JPEG's
DC-only encoding both describe an enormous uniform bitmap in a few kilobytes, so a file far inside
the 15 MB limit can demand gigabytes the instant a decoder expands it, and catching
`OutOfMemoryException` afterwards is not a boundary — by then the allocation has already been
demanded and the process may be unrecoverable.

The bound is now the encoded dimensions, read from the codec header and checked before any pixel
buffer is allocated. `MediaUploadPolicy.TryValidateDecodedImage` enforces exactly these:

| Limit | Value |
| --- | --- |
| `MaximumImageWidth` | 8 000 px |
| `MaximumImageHeight` | 8 000 px |
| `MaximumImagePixels` | 30 000 000 (30 MP) |
| `DecodedBytesPerPixel` | 4 (RGBA8888, the colour type the sanitiser decodes into) |
| `MaximumDecodedImageBytes` | 120 000 000 (30 MP x 4) |

30 megapixels is above 6720x4480 — more resolution than any current phone produces in its default
capture mode, and far more than a progress photo needs. The edge and pixel limits are both enforced
because either alone is insufficient: 8000x8000 satisfies both edges and is 64 MP, while a 20000x100
panorama is only 2 MP. The arithmetic is checked and the dimension guards run first, so a malformed
header claiming `int.MaxValue` is refused rather than multiplied into a small number that passes.

`MaximumDecodedImageBytes` bounds one full-resolution RGBA pixel buffer; it is not a process-peak
claim. Skia's codec path computes the destination byte size and allocates a bitmap before decoding
into it ([`SkCodec::getImage`](https://github.com/google/skia/blob/main/src/codec/SkCodec.cpp)), while
the bitmap implementation allocates pixel storage from the requested image information
([`SkBitmap::tryAllocPixels`](https://github.com/google/skia/blob/main/src/core/SkBitmap.cpp)). An
EXIF orientation that changes the pixels holds a second full bitmap, and codec/encoder working data,
encoded `SKData`, managed output streams, and the thumbnail bitmap add more. The limit therefore
means approximately 120 MB for each full-resolution buffer and approximately 240 MB for the two
full buffers in the rotated case, plus those other allocations; the exact peak is deliberately not
claimed from the pixel limit alone. An already-upright image is not copied.

The existing per-workspace gate still admits one upload at a time. Because different workspaces can
upload concurrently in one API process, the memory-heavy decode/re-encode section also has a
process-wide semaphore. `Media:MaxConcurrentProgressPhotoDecodes` is an engineering policy setting,
defaults to 2, and is startup-validated from 1 through 8. It is a concurrency bound, not a promise
that the process needs only `limit × 120 MB`; deployment memory sizing must include the additional
allocations above.

**A media asset that does not reach `Ready` is not a photo.** Scanning fails closed outside
Development, and the upload used to report success anyway: the asset was committed as `Rejected`,
its bytes stayed on disk, and `ProgressPhoto.Record` then created a row against it. That row held
the client's date-and-pose uniqueness slot for ever with no readable image behind it, so the retry
that should have worked was refused as a duplicate. A refused scan now commits no asset and returns
a failure: `503` when the installation has no scanner configured or the configured scanner fails
operationally, and `400` only when a scanner inspected the file and refused it. The scanner key,
version, failure code, storage keys, filename, and client data are absent from both client-visible
errors and application logs; the operational log records only the media purpose and failure shape.
`ProgressApplicationService` additionally refuses to associate a photo with any asset that is not
`Ready`. A new readiness check reports the scanner as `Degraded` — not
`Unhealthy` — on `/health/ready`, so an unconfigured deployment is visible to an operator without
pulling an otherwise working API out of rotation.

**Every accepted object key remains durably owned.** Ingestion creates a tenant-scoped
`MediaIngestObject` reservation before each object-store write, using the generated key and a
conservative byte reservation. A successful write confirms its actual bytes. Admission removes the
reservation in the same database transaction that creates the owning asset/derivative; before that
commit, non-purged reservations count toward both workspace and applicable client quota. Immediate
compensation uses an internal bounded token rather than an already-cancelled request token. A
confirmed delete marks the reservation `Purged` and clears its key; a failed delete leaves
`CleanupPending`, immediately due, with the key and stable failure code for reconciliation. The
existing purge sweep claims these rows with `FOR UPDATE SKIP LOCKED` before ordinary tombstones and
retries deletion idempotently. A process crash can leave a `Reserved` row, which becomes due after
the documented 15-minute ingest lease and is handled the same way. Thus a completed put is either
atomically attached, positively deleted, or durably discoverable for retry; partial cleanup of an
original and thumbnail cannot lose the remaining key.

**Access is reauthorized against membership on every request.** A progress-photo grant uses the
configured media lifetime (30 minutes by default, bounded from 60 seconds through four hours), and
the check for the subject of the photo used to return true on user identity
alone. A client whose membership was deactivated or removed therefore kept reading their own images
from that workspace until the cookie expired. Active membership of the asset's tenant is now the
first thing every media authorization decision establishes, for coaches and clients alike, on both
the original and the thumbnail route. Authentication plus an unexpired grant is not sufficient and
is not treated as such.

Deferred: side-by-side photo comparison and device/wearable photo import. The combined dashboard,
server-side thumbnails/downscaling, physical purge, per-client quotas, and durable incomplete-ingest
reconciliation were subsequently delivered; see ADRs 0012-0014 and this hardening amendment.

# ADR 0012: Progress Photo Thumbnails v1

Status: accepted, 2026-08-23

## Context

ADR 0011 deferred server-side thumbnails. A progress-photo list is browsed far more often than any
single image is studied, and every tile currently costs a full-resolution transfer of
health-adjacent personal data. The stored original can be up to 15 MB.

## Decision

A thumbnail is a **subordinate derivative of its parent `MediaAsset`, never a standalone asset**.
`MediaAssetDerivative` records one rendition per asset and variant, with no owner, no title, no scan
lifecycle, and no route of its own. It is addressed only as "the thumbnail of asset X", enforced by
a unique index on tenant, asset, and variant, so nothing needs to expose the derivative's identifier
and there is no second media-security system to keep in step with the first.

**Authorization is inherited, not re-implemented.** `OpenContentAsync` and `OpenThumbnailAsync` are
two entry points into one method: the grant is unprotected, the tenant is taken from the grant
payload, and `IsAuthorizedAsync` runs against the **parent asset** before the variant is chosen.
Resolving a thumbnail therefore applies the same tenant check, the same owning-client rule, the same
coach-blocking rule, and the same removal semantics as the original, because it is literally the
same code. A second copy of that check would be a second place for the rules to drift.

Serving reuses the existing grant-cookie content route rather than adding a public URL or a second
grant. The thumbnail path is `/api/media/{assetId}/content/thumbnail`, beneath the asset's content
path, so the existing path-scoped cookie already covers it under RFC 6265 path matching. One access
call returns both URLs, so showing a preview costs no extra round trip and mints no extra grant.

**The rendition is produced from the already-sanitised pixels.** ADR 0011 decodes the untrusted
upload once, applies EXIF orientation to the pixels, and re-encodes without metadata. The thumbnail
is rendered inside that same decode, from the uprighted bitmap, so the uploader's bytes are never
decoded a second time and the rendition inherits the sanitised pixels rather than the original file.
It carries no metadata for the same reason its parent does not: it is re-encoded from pixels.

Sizing is longest edge 480 px with the aspect ratio preserved, and a smaller original is emitted at
its own size rather than upscaled. 480 px covers a 240 px tile at 2x, and poses are compared across
dates, so a distorted outline would be worse than a small one. Resizing uses SkiaSharp with explicit
`SKSamplingOptions` (mipmap + linear); the deprecated quality-enum resize overloads are not used, and
plain bilinear filtering at this reduction ratio aliases fabric and skin texture into moire.

**A thumbnail is always JPEG at quality 80, including when the parent is a PNG.** Progress photos
are photographic, and PNG's lossless encoding of photographic content is several times larger than
JPEG at a size where the difference is invisible, which would defeat the point of the rendition.
Quality 80 rather than the 90 used for the stored original, because a preview is never zoomed. A
PNG's transparency cannot survive that conversion, so the rendition is drawn onto an opaque white
surface deterministically rather than left to whatever background the encoder would assume.

Length and SHA-256 are recorded per derivative so storage accounting and a later physical purge can
measure and verify these bytes without re-reading the object. Width and height are recorded because
the rendition dimensions are a decision the pipeline made, not a property of the original.

## Consequences and deferred work

No protection is relaxed. Ingest is still streamed under the image byte cap, the original bytes are
still signature-validated, the rendition is signature- and size-validated again before it is kept,
and the malware scanner runs against the thumbnail because those are bytes the workspace actually
stores and serves. A rendition the scanner refuses fails the whole upload closed rather than being
quietly dropped, since both objects share one source image. Exercise media is untouched: it gets no
rendition, and its authorization path is unchanged.

Thumbnail bytes are **not yet counted against the workspace storage quota**, which still sums
`MediaAsset.Length` only. The per-derivative length recorded here is what a later chunk needs to fix
that; quotas and purge were explicitly out of scope.

Deferred: physical purge of tombstoned bytes and their derivatives, per-client storage quotas,
counting derivative bytes toward the workspace quota, backfilling renditions for photos stored
before this change, additional variants, side-by-side photo comparison, and the combined
cross-domain progress dashboard.

import { HttpErrorResponse } from '@angular/common/http';
import {
  BRAND_PRESETS,
  type BrandColors,
  type BrandPresetId,
  brandTokens,
  TB_GYM_BRAND,
} from '../../core/theme/brand-theme';

/** What the owner picked: one of the four looks, or their own two colours. */
export type BrandChoice = BrandPresetId | 'custom';

/** The logo's limits, the server's own (MED-013): checked here only to answer before uploading. */
export const LOGO_TYPES = ['image/png', 'image/jpeg'] as const;
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;

/** The saved brand as the page starts from it: a workspace without one wears TB Gym's own look. */
export function choiceFor(colors: BrandColors | null): BrandChoice {
  const saved = colors ?? TB_GYM_BRAND;
  return (
    BRAND_PRESETS.find(
      (preset) =>
        preset.brand === saved.brand.toLowerCase() && preset.accent === saved.accent.toLowerCase(),
    )?.id ?? 'custom'
  );
}

/**
 * A typed colour as the one shape the server stores (`#rrggbb`, lower case), or null. The leading
 * `#` and the three-digit short form are accepted because people type them.
 */
export function normalizeHex(text: string): string | null {
  const value = text.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(value)) return `#${value}`;
  if (/^[0-9a-f]{3}$/.test(value)) return `#${[...value].map((digit) => digit + digit).join('')}`;
  return null;
}

/**
 * What the app does to keep a picked colour readable, in a sentence each (plan §3.1): the brand is
 * darkened until white text reads on it, the accent lightened until dark text does.
 */
export function contrastNotes(colors: BrandColors): string[] {
  const tokens = brandTokens(colors);
  const notes: string[] = [];
  if (tokens['--tb-brand'] !== colors.brand.toLowerCase()) {
    notes.push(
      $localize`Your brand colour is shown a little darker, so white text on it stays easy to read.`,
    );
  }
  if (tokens['--tb-accent'] !== colors.accent.toLowerCase()) {
    notes.push(
      $localize`Your accent is shown a little lighter, so dark text on it stays easy to read.`,
    );
  }
  return notes;
}

/** Whether the owner changed anything since the last save. */
export function brandChanged(
  saved: { colors: BrandColors | null; logoAssetId: string | null },
  draft: { colors: BrandColors; logoAssetId: string | null },
): boolean {
  const before = saved.colors ?? TB_GYM_BRAND;
  return (
    before.brand.toLowerCase() !== draft.colors.brand ||
    before.accent.toLowerCase() !== draft.colors.accent ||
    saved.logoAssetId !== draft.logoAssetId
  );
}

/** A file the server would refuse anyway, said before any bytes are sent. */
export function logoFileProblem(file: { type: string; size: number }): string | null {
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) {
    return $localize`Choose a PNG or JPEG image.`;
  }
  if (file.size > LOGO_MAX_BYTES) {
    return $localize`That image is over 5\u00a0MB. Choose a smaller one.`;
  }
  return null;
}

/** Why a logo upload failed, in the owner's words. */
export function logoUploadError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 400 || error.status === 413) {
      return $localize`That image couldn’t be used. Try another PNG or JPEG.`;
    }
    if (error.status === 403 && problemCode(error) === 'workspace_read_only') {
      return readOnlyMessage();
    }
    if (error.status === 409) {
      return $localize`Your coaching space’s storage is full, so the logo couldn’t be added.`;
    }
    if (error.status === 429) {
      return $localize`Another upload is still going. Try again in a moment.`;
    }
  }
  return $localize`The logo couldn’t be uploaded. Try again.`;
}

/** Why saving failed, in the owner's words. */
export function brandSaveError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 409) {
      return $localize`The brand was changed in another window. Reload the page to see it, then make your change again.`;
    }
    if (error.status === 403 && problemCode(error) === 'workspace_read_only') {
      return readOnlyMessage();
    }
    if (error.status === 400) {
      return $localize`These colours or this logo couldn’t be saved. Pick them again and save.`;
    }
  }
  return $localize`The brand couldn’t be saved. Try again.`;
}

function readOnlyMessage(): string {
  return $localize`Your coaching space is read-only until its TB Gym bill is paid, so the brand can’t change yet.`;
}

function problemCode(error: HttpErrorResponse): string | null {
  const body: unknown = error.error;
  return typeof body === 'object' &&
    body !== null &&
    'code' in body &&
    typeof body.code === 'string'
    ? body.code
    : null;
}

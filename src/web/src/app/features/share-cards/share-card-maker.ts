import { DOCUMENT } from '@angular/common';
import { computed, inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';
import { AA_TEXT, brandTokens, safeBrand, type BrandColors } from '../../core/theme/brand-theme';
import { contrast, mix } from '../../core/theme/color';
import { WorkspaceBrandStore } from '../../core/theme/workspace-brand.store';
import { initialsOf } from '../../shell/initials';
import { paintBeforeAfterCard, type SharePicture } from './before-after-paint';
import {
  paintShareCard,
  SHARE_IMAGE_HEIGHT,
  SHARE_IMAGE_WIDTH,
  SHARE_SANS,
  SHARE_SERIF,
  type ShareLook,
  type ShareMark,
} from './share-card-paint';
import { firstNameOf, type ShareCard, type ShareIdentity } from './share-card.models';

/** A card's picture, made on this device. */
export interface ShareImage {
  readonly file: File;
  /** The same picture as a `data:` address: the page's image policy shows those, not `blob:` ones. */
  readonly dataUrl: string;
}

/** How long the faces and the logo may take before a card is drawn without them. */
const WAIT_MS = 4000;
/** A before-and-after cannot be drawn without its photos, which are full size, so they get longer. */
const PHOTO_WAIT_MS = 30_000;

/**
 * Makes share cards (M9, R6.1a and R6.1b) in the coach's brand, on the client's own phone: the coaching
 * space's colours, its logo or initials, and the client's first name. Nothing is uploaded or kept; the
 * picture lives in the page until the client shares it, saves it, or closes the sheet.
 */
@Injectable({ providedIn: 'root' })
export class ShareCardMaker {
  private readonly document = inject(DOCUMENT);
  private readonly auth = inject(AuthStore);
  private readonly brand = inject(WorkspaceBrandStore);
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);

  /** Who the cards are from. */
  readonly identity = computed<ShareIdentity>(() => ({
    firstName: firstNameOf(this.auth.user()?.displayName),
    spaceName: this.brand.name() ?? '',
  }));

  /** The space's logo while it is granted, and its initials for when it is not. */
  readonly logoUrl = this.brand.logoUrl;
  readonly initials = computed(() => initialsOf(this.brand.name() ?? ''));

  /** The colours, readable in every pairing a card uses. */
  readonly look = computed(() => shareLook(this.brand.colors()));

  /** Draws the card and returns its picture as a PNG. */
  async make(card: ShareCard): Promise<ShareImage> {
    const canvas = this.document.createElement('canvas');
    canvas.width = SHARE_IMAGE_WIDTH;
    canvas.height = SHARE_IMAGE_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot draw the picture.');

    const [mark, pictures] = await Promise.all([
      this.mark(),
      this.pictures(card),
      this.loadFaces(card),
    ]);
    const rtl = this.document.documentElement.dir === 'rtl';
    if (pictures) paintBeforeAfterCard(context, card, this.look(), mark, pictures, rtl);
    else paintShareCard(context, card, this.look(), mark, rtl);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (made) => (made ? resolve(made) : reject(new Error('The picture could not be made.'))),
        'image/png',
      ),
    );
    return {
      file: new File([blob], card.fileName, { type: 'image/png' }),
      dataUrl: await dataUrlOf(blob),
    };
  }

  /**
   * A before-and-after's two photos, decoded from their granted addresses on TB Gym's own origin. Either
   * one failing fails the card: it is never drawn with a photo missing.
   */
  private async pictures(
    card: ShareCard,
  ): Promise<{ before: SharePicture; after: SharePicture } | null> {
    if (!card.photos) return null;
    const [before, after] = await Promise.all([
      loadPicture(this.document, card.photos.before.imageUrl, PHOTO_WAIT_MS),
      loadPicture(this.document, card.photos.after.imageUrl, PHOTO_WAIT_MS),
    ]);
    return { before, after };
  }

  /** The faces the card's words need, so the picture never falls back to another font by accident. */
  private async loadFaces(card: ShareCard): Promise<void> {
    const faces = this.document.fonts;
    if (!faces?.load) return;
    const labels = card.photos ? [card.photos.before.label, card.photos.after.label] : [];
    const words = [card.kicker, card.title, ...card.facts, card.byline, ...labels].join(' ');
    await within(
      Promise.all([
        faces.load(`italic 400 200px ${SHARE_SERIF}`, card.headline),
        faces.load(`600 64px ${SHARE_SANS}`, words),
        faces.load(`400 46px ${SHARE_SANS}`, words),
      ]),
    ).catch(() => undefined);
  }

  /**
   * The logo, read from the space's own address so the canvas stays readable. A grant that ran out
   * while the page stayed open is asked for again once; without a logo, the initials stand in.
   */
  private async mark(): Promise<ShareMark> {
    const initials: ShareMark = { kind: 'initials', text: this.initials() || '·' };
    const assetId = this.brand.logoAssetId();
    if (assetId === null) return initials;
    const granted = this.logoUrl();
    const logo = granted ? await loadImage(this.document, granted).catch(() => null) : null;
    if (logo) return logo;
    try {
      await this.csrf.refresh();
      const access = await firstValueFrom(this.api.createMediaAccess(assetId));
      return (await loadImage(this.document, access.url).catch(() => null)) ?? initials;
    } catch {
      return initials;
    }
  }
}

/** A card's colours from the coach's brand, with the derived tones that keep AA (GAM-005). */
export function shareLook(colors: BrandColors | null): ShareLook {
  const tokens = brandTokens(safeBrand(colors));
  const accent = tokens['--tb-accent'];
  const onAccent = tokens['--tb-on-accent'];
  return {
    brand: tokens['--tb-brand'],
    night: tokens['--tb-night'],
    accent,
    accentBright: tokens['--tb-accent-bright'],
    onAccent,
    onAccentSoft: softInk(onAccent, accent),
  };
}

/** The ink with as much of the ground mixed in as still reads at AA on it. */
function softInk(ink: string, ground: string): string {
  for (let share = 0.36; share > 0; share -= 0.04) {
    const candidate = mix(ink, ground, share);
    if (contrast(candidate, ground) >= AA_TEXT) return candidate;
  }
  return ink;
}

async function loadImage(document: Document, url: string): Promise<ShareMark> {
  return { kind: 'logo', ...(await loadPicture(document, url, WAIT_MS)) };
}

async function loadPicture(document: Document, url: string, wait: number): Promise<SharePicture> {
  const image = document.createElement('img');
  image.decoding = 'async';
  image.src = url;
  await within(image.decode(), wait);
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('The picture has no size.');
  return { image, width: image.naturalWidth, height: image.naturalHeight };
}

function within<T>(work: Promise<T>, wait = WAIT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out.')), wait);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('The picture could not be read.'));
    reader.readAsDataURL(blob);
  });
}

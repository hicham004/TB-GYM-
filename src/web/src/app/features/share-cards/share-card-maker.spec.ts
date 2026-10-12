import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';
import { AA_TEXT } from '../../core/theme/brand-theme';
import { contrast } from '../../core/theme/color';
import { WorkspaceBrandStore } from '../../core/theme/workspace-brand.store';
import { personalRecord, progressPhotos } from '../../../testing/share-card-fixtures';
import { ShareCardMaker, shareLook } from './share-card-maker';
import { photosCard, recordCard } from './share-card.models';

/** Pictures that decode, at 600 × 800, except those whose address names a broken one. */
function decodablePictures(broken: string | null = null) {
  const decoded: string[] = [];
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    value(this: HTMLImageElement) {
      decoded.push(this.getAttribute('src') ?? '');
      return broken && this.src.includes(broken)
        ? Promise.reject(new Error('Not an image.'))
        : Promise.resolve();
    },
  });
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(600);
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(800);
  return decoded;
}

function setUp(brand: { logoAssetId?: string | null; logoUrl?: string | null } = {}) {
  const api = { createMediaAccess: vi.fn(() => of({ url: '/api/media/logo-2/content' })) };
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthStore, useValue: { user: signal({ displayName: 'Maya Fakhoury' }) } },
      {
        provide: WorkspaceBrandStore,
        useValue: {
          name: signal('Atlas Performance'),
          colors: signal({ brand: '#15233f', accent: '#ffb48c' }),
          logoAssetId: signal(brand.logoAssetId ?? null),
          logoUrl: signal(brand.logoUrl ?? null),
        },
      },
      { provide: ApiClient, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
    ],
  });
  return { maker: TestBed.inject(ShareCardMaker), api };
}

/** jsdom draws nothing: a canvas hands back a context that accepts every call, and a one-byte PNG. */
function stubCanvas() {
  const context = new Proxy(
    { measureText: (text: string) => ({ width: text.length * 10 }) },
    {
      get: (target, key) =>
        key in target
          ? target[key as keyof typeof target]
          : key.toString().startsWith('create')
            ? () => ({ addColorStop: () => undefined })
            : () => undefined,
      set: () => true,
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) =>
    done(new Blob(['x'], { type: 'image/png' })),
  );
}

describe('ShareCardMaker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLImageElement.prototype as Partial<HTMLImageElement>).decode;
    TestBed.resetTestingModule();
  });

  it('says who a card is from: the client’s first name and their coaching space', () => {
    const { maker } = setUp();
    expect(maker.identity()).toEqual({ firstName: 'Maya', spaceName: 'Atlas Performance' });
    expect(maker.initials()).toBe('AP');
  });

  it('draws in the coach’s colours, every word readable on the card', () => {
    const look = shareLook({ brand: '#15233f', accent: '#ffb48c' });
    expect(look.brand).toBe('#15233f');
    expect(look.accent).toBe('#ffb48c');
    expect(contrast(look.onAccent, look.accent)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(look.onAccentSoft, look.accent)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(look.onAccentSoft).not.toBe(look.onAccent);
    // A colour too light for white text is darkened, as everywhere the brand is drawn.
    const pale = shareLook({ brand: '#a0c4ff', accent: '#ffffff' });
    expect(contrast(pale.brand, '#ffffff')).toBeGreaterThanOrEqual(7);
    // No brand of their own: TB Gym's forest and lime.
    expect(shareLook(null)).toMatchObject({ brand: '#153d33', accent: '#d9ed94' });
  });

  it('makes the picture on the phone as a PNG named for the card, shown through a data address', async () => {
    stubCanvas();
    const { maker } = setUp();
    const card = recordCard(personalRecord(), maker.identity(), 'en-LB');
    const image = await maker.make(card);

    expect(image.file.name).toBe('barbell-bench-press-personal-record.png');
    expect(image.file.type).toBe('image/png');
    expect(image.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('asks once for a fresh logo grant when the old one no longer reads, then uses the initials', async () => {
    stubCanvas();
    const { maker, api } = setUp({ logoAssetId: 'logo-2', logoUrl: '/api/media/logo-2/old' });
    await maker.make(recordCard(personalRecord(), maker.identity(), 'en-LB'));
    // jsdom loads no image, so both tries fail and the card still comes out.
    expect(api.createMediaAccess).toHaveBeenCalledTimes(1);
    expect(api.createMediaAccess).toHaveBeenCalledWith('logo-2');
  });

  it('draws a before and after from both photos, read from TB Gym’s own addresses', async () => {
    stubCanvas();
    const decoded = decodablePictures();
    const { maker } = setUp();
    const image = await maker.make(photosCard(progressPhotos(), maker.identity(), 'en-LB'));

    expect(decoded).toEqual([
      '/api/media/asset-Front-2026-09-05/content',
      '/api/media/asset-Front-2026-10-03/content',
    ]);
    expect(image.file.name).toBe('front-before-and-after.png');
    expect(image.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('never makes a before and after with a photo missing', async () => {
    stubCanvas();
    decodablePictures('asset-Front-2026-10-03');
    const { maker } = setUp();
    await expect(
      maker.make(photosCard(progressPhotos(), maker.identity(), 'en-LB')),
    ).rejects.toThrow('Not an image.');
  });

  it('refuses plainly where the browser cannot draw', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { maker } = setUp();
    await expect(
      maker.make(recordCard(personalRecord(), maker.identity(), 'en-LB')),
    ).rejects.toThrow('This browser cannot draw the picture.');
  });
});

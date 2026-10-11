import { computed, signal } from '@angular/core';
import { vi } from 'vitest';
import type { ShareCard } from '../app/features/share-cards/share-card.models';
import type { ShareCardMaker } from '../app/features/share-cards/share-card-maker';

/**
 * A `ShareCardMaker` that makes no canvas (jsdom has none): every picture is a one-byte PNG named as
 * the card's file, and `make` records which cards were asked for.
 */
export function fakeShareCardMaker(options: { fail?: boolean } = {}) {
  const logoUrl = signal<string | null>(null);
  return {
    identity: signal({ firstName: 'Maya', spaceName: 'Atlas Performance' }),
    logoUrl,
    initials: computed(() => 'AP'),
    make: vi.fn(async (card: ShareCard) => {
      if (options.fail) throw new Error('No canvas here.');
      return {
        file: new File(['x'], card.fileName, { type: 'image/png' }),
        dataUrl: `data:image/png;base64,eA==#${card.id}`,
      };
    }),
  } satisfies Partial<Record<keyof ShareCardMaker, unknown>>;
}

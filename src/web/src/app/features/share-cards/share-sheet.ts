import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  LOCALE_ID,
  signal,
  untracked,
} from '@angular/core';
import { Button } from '../../ui/button';
import { Icon } from '../../ui/icon';
import { SegmentedControl, type SegmentOption } from '../../ui/segmented-control';
import { ShareCardMaker, type ShareImage } from './share-card-maker';
import { shareCards, type ShareCard, type ShareFact } from './share-card.models';

/**
 * A share card as the client sees it before anything leaves the page (M9, R6.1a): the picture itself,
 * a choice when the workout gave several, then Share through the phone's share sheet or Save image.
 * The client taps every time; nothing is remembered, uploaded or posted. The picture is made when the
 * card is first shown and kept only while the sheet is open.
 */
@Component({
  selector: 'app-share-sheet',
  imports: [Button, Icon, SegmentedControl],
  templateUrl: './share-sheet.html',
  styleUrl: './share-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShareSheet {
  private readonly maker = inject(ShareCardMaker);
  private readonly locale = inject(LOCALE_ID);
  private readonly document = inject(DOCUMENT);

  readonly facts = input.required<readonly ShareFact[]>();

  protected readonly cards = computed(() =>
    shareCards(this.facts(), this.maker.identity(), this.locale),
  );
  protected readonly choices = computed<SegmentOption[]>(() =>
    this.cards().map((card) => ({ value: card.id, label: card.choice })),
  );
  private readonly chosenId = signal<string | null>(null);
  protected readonly card = computed<ShareCard | null>(
    () => this.cards().find((card) => card.id === this.chosenId()) ?? this.cards()[0] ?? null,
  );
  private readonly images = signal<ReadonlyMap<string, ShareImage>>(new Map());
  private readonly failures = signal<ReadonlySet<string>>(new Set());
  private readonly making = new Set<string>();
  protected readonly image = computed(() => {
    const card = this.card();
    return card ? (this.images().get(card.id) ?? null) : null;
  });
  protected readonly failed = computed(() => {
    const card = this.card();
    return card !== null && this.failures().has(card.id);
  });
  /** The phone can hand a picture to its share sheet; asked once, with a tiny picture of the same kind. */
  protected readonly canShare = canSharePictures(this.document);
  protected readonly status = signal('');
  protected readonly problem = signal<string | null>(null);

  constructor() {
    effect(() => {
      const card = this.card();
      if (card) untracked(() => void this.make(card));
    });
  }

  protected choose(id: string): void {
    this.chosenId.set(id);
    this.status.set('');
    this.problem.set(null);
  }

  protected retry(): void {
    const card = this.card();
    if (!card) return;
    this.failures.update((failed) => without(failed, card.id));
    void this.make(card);
  }

  /** Hands the picture to the phone's share sheet, still inside the tap that asked for it. */
  protected async share(): Promise<void> {
    const image = this.image();
    if (!image) return;
    this.status.set('');
    this.problem.set(null);
    try {
      await this.document.defaultView!.navigator.share({ files: [image.file] });
      this.status.set($localize`Shared.`);
    } catch (error) {
      // Closing the share sheet without choosing anywhere is the client's own answer, not a fault.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      this.problem.set(
        $localize`The picture couldn’t be shared from here. Save it instead, then share it from your photos.`,
      );
    }
  }

  /** Downloads the picture under the card's own file name. */
  protected save(): void {
    const image = this.image();
    const card = this.card();
    if (!image || !card) return;
    this.problem.set(null);
    const url = URL.createObjectURL(image.file);
    const link = this.document.createElement('a');
    link.href = url;
    link.download = card.fileName;
    this.document.body.append(link);
    link.click();
    link.remove();
    // The download has its own copy by then; the page lets go of the picture a little later.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    this.status.set($localize`Your picture is downloading.`);
  }

  private async make(card: ShareCard): Promise<void> {
    if (this.images().has(card.id) || this.failures().has(card.id) || this.making.has(card.id)) {
      return;
    }
    this.making.add(card.id);
    try {
      const image = await this.maker.make(card);
      this.images.update((made) => new Map(made).set(card.id, image));
    } catch {
      this.failures.update((failed) => new Set(failed).add(card.id));
    } finally {
      this.making.delete(card.id);
    }
  }
}

/** The sheet's name for what it offers. */
export function shareSheetTitle(facts: readonly ShareFact[]): string {
  const records = facts.filter((fact) => fact.kind === 'record').length;
  if (records === facts.length) {
    return records === 1 ? $localize`Share your record` : $localize`Share a record`;
  }
  return records === 0 ? $localize`Share your program` : $localize`Share your progress`;
}

function canSharePictures(document: Document): boolean {
  const navigator = document.defaultView?.navigator;
  if (typeof navigator?.canShare !== 'function' || typeof navigator.share !== 'function') {
    return false;
  }
  // A few bytes of a PNG's signature, so no browser turns the question down for an empty file.
  const probe = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'card.png', {
    type: 'image/png',
  });
  try {
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

function without(values: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(values);
  next.delete(value);
  return next;
}

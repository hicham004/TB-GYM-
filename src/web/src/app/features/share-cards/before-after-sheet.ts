import { formatDate, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  LOCALE_ID,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type { ProgressPhotoExportView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { addDays } from '../../ui/calendar';
import { SegmentedControl, type SegmentOption } from '../../ui/segmented-control';
import { Skeleton } from '../../ui/skeleton';
import type { ProgressPhoto, ProgressPhotoPose } from '../progress/progress.models';
import {
  firstAndLatest,
  fitsPair,
  photoName,
  posesToCompare,
  type PhotoPair,
  type PosePhotos,
} from './before-after.models';
import { timeBetween, type ShareFact } from './share-card.models';
import { ShareSheet } from './share-sheet';

type Step = 'loading' | 'error' | 'empty' | 'pick' | 'choose' | 'confirm' | 'share';
type Side = 'before' | 'after';

/** One read covers a year; older years are read only where the server says photos are. */
const WINDOW_DAYS = 366;
/** No client has photos over more years than this; it only stops a runaway loop. */
const MOST_WINDOWS = 30;
/** The server grants at most this many protected images in one request. */
const GRANT_CHUNK = 32;

/**
 * A before-and-after (M9, R6.1b): the client picks two of their own progress photos of one pose, the
 * first and the latest to begin with, then a confirmation names both photos and their dates before
 * anything is made. Confirming records the export on the server (PRG-013: who, when, which photos), and
 * only then is the picture made on this device, in the coach's brand, to share or save. Nothing is
 * remembered for next time; the sheet starts afresh each time it opens.
 */
@Component({
  selector: 'app-before-after-sheet',
  imports: [Button, NgTemplateOutlet, SegmentedControl, ShareSheet, Skeleton],
  templateUrl: './before-after-sheet.html',
  styleUrl: './before-after-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BeforeAfterSheet {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly locale = inject(LOCALE_ID);
  private readonly tenants = inject(TenantStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());

  protected readonly loadingLabel = $localize`Loading your photos…`;
  protected readonly poseLabel = $localize`Pose`;

  protected readonly step = signal<Step>('loading');
  private readonly choices = signal<readonly PosePhotos[]>([]);
  private readonly pose = signal<ProgressPhotoPose | null>(null);
  protected readonly pair = signal<PhotoPair | null>(null);
  protected readonly side = signal<Side>('before');
  private readonly thumbnails = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly busy = signal(false);
  protected readonly problem = signal<string | null>(null);
  protected readonly facts = signal<readonly ShareFact[]>([]);
  /** The export the server recorded for the pair confirmed last, so a retry never records it twice. */
  private recorded: { readonly key: string; readonly view: ProgressPhotoExportView } | null = null;

  protected readonly poseOptions = computed<SegmentOption[]>(() =>
    this.choices().map((choice) => ({ value: choice.pose, label: choice.name })),
  );
  protected readonly current = computed(
    () => this.choices().find((choice) => choice.pose === this.pose()) ?? null,
  );
  protected readonly apart = computed(() => {
    const pair = this.pair();
    return pair ? timeBetween(pair.before.photoDate, pair.after.photoDate) : '';
  });
  /** The photos to choose from, the earliest first, each said in words. */
  protected readonly grid = computed(() => {
    const pair = this.pair();
    const side = this.side();
    return (this.current()?.photos ?? []).map((photo) => ({
      photo,
      name: photoName(photo, this.locale),
      chosen: pair?.[side].id === photo.id,
      fits: pair ? fitsPair(photo, side, pair) : false,
    }));
  });

  constructor() {
    void this.load();
  }

  protected thumbnail(photo: ProgressPhoto): string | null {
    return this.thumbnails().get(photo.mediaAssetId) ?? null;
  }

  protected day(photo: ProgressPhoto): string {
    return formatDate(photo.photoDate, 'EEE d MMM y', this.locale);
  }

  protected named(photo: ProgressPhoto): string {
    return photoName(photo, this.locale);
  }

  protected choosePose(pose: string): void {
    const choice = this.choices().find((item) => item.pose === pose);
    if (!choice) return;
    this.pose.set(choice.pose);
    this.pair.set(firstAndLatest(choice));
    void this.grant(choice.photos);
  }

  /** Opens the photos of the pose to choose the photo for one side. */
  protected change(side: Side): void {
    this.side.set(side);
    this.go('choose');
  }

  protected pick(photo: ProgressPhoto): void {
    const pair = this.pair();
    if (!pair || !fitsPair(photo, this.side(), pair)) return;
    this.pair.set({ ...pair, [this.side()]: photo });
    this.go('pick', `[data-slot="${this.side()}"]`);
  }

  protected backToPick(): void {
    this.problem.set(null);
    this.go('pick', `[data-slot="${this.side()}"]`);
  }

  protected review(): void {
    this.problem.set(null);
    this.go('confirm');
  }

  /** Back to the photos; a picture made again, even of the same two, is another export. */
  protected changePhotos(): void {
    this.problem.set(null);
    this.facts.set([]);
    this.recorded = null;
    this.go('pick');
  }

  /**
   * The client's yes: the server records the export first, then the two photos are granted at full size
   * and the picture is made on this device. A photo removed meanwhile is refused, and the photos are read
   * again to choose from.
   */
  protected async make(): Promise<void> {
    const pair = this.pair();
    if (!pair || this.busy()) return;
    await this.scope.run('make', async (owner) => {
      this.busy.set(true);
      this.problem.set(null);
      try {
        const key = `${pair.before.id}:${pair.after.id}`;
        if (this.recorded?.key !== key) {
          await owner.wait(this.csrf.refresh());
          const view = await owner.wait(
            firstValueFrom(
              this.api.exportMyProgressPhotos({
                beforePhotoId: pair.before.id,
                afterPhotoId: pair.after.id,
              }),
            ),
          );
          this.recorded = { key, view };
        }
        const view = this.recorded!.view;
        await owner.wait(this.csrf.refresh());
        const batch = await owner.wait(
          firstValueFrom(
            this.api.createMediaAccessBatch([view.before.mediaAssetId, view.after.mediaAssetId]),
          ),
        );
        const urlOf = (assetId: string) =>
          batch.items.find((item) => item.assetId === assetId)?.url ?? null;
        const before = urlOf(view.before.mediaAssetId);
        const after = urlOf(view.after.mediaAssetId);
        if (!before || !after) throw new Error('The photos were not granted.');
        this.facts.set([
          {
            kind: 'photos',
            photos: {
              exportId: view.id,
              pose: view.pose,
              before: { date: view.before.photoDate, imageUrl: before },
              after: { date: view.after.photoDate, imageUrl: after },
            },
          },
        ]);
        this.go('share');
      } catch (error) {
        if (!owner.current) return;
        if (error instanceof HttpErrorResponse && (error.status === 404 || error.status === 409)) {
          this.recorded = null;
          this.problem.set($localize`One of these photos can no longer be used. Choose again.`);
          await this.read(owner);
          return;
        }
        this.problem.set(
          apiErrorMessage(error, $localize`Your picture couldn’t be started. Try again.`),
        );
      } finally {
        if (owner.current) this.busy.set(false);
      }
    });
  }

  protected load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.step.set('loading');
      this.problem.set(null);
      try {
        await this.read(owner);
      } catch {
        if (owner.current) this.step.set('error');
      }
    });
  }

  /**
   * Every one of the client's photos, a year at a time back to the first, then the first pose that has
   * two days to compare. A year with none is skipped: the server says where the earlier ones are.
   */
  private async read(owner: { wait<T>(pending: T | PromiseLike<T>): Promise<T> }): Promise<void> {
    let window = await owner.wait(firstValueFrom(this.api.getMyProgressPhotos()));
    const photos = [...window.photos];
    for (let reads = 1; window.earlierDate && reads < MOST_WINDOWS; reads++) {
      const to = addDays(window.earlierDate, 1);
      window = await owner.wait(
        firstValueFrom(this.api.getMyProgressPhotos(addDays(to, -WINDOW_DAYS), to)),
      );
      photos.push(...window.photos);
    }
    const choices = posesToCompare(photos);
    this.choices.set(choices);
    const choice = choices.find((item) => item.pose === this.pose()) ?? choices[0];
    if (!choice) {
      this.pose.set(null);
      this.pair.set(null);
      this.go('empty');
      return;
    }
    this.pose.set(choice.pose);
    this.pair.set(firstAndLatest(choice));
    this.go('pick');
    await this.grant(choice.photos);
  }

  /** One grant per screenful of the pose's photos, so the tiles show; a failure leaves them plain. */
  private async grant(photos: readonly ProgressPhoto[]): Promise<void> {
    const wanted = photos
      .map((photo) => photo.mediaAssetId)
      .filter((id) => !this.thumbnails().has(id));
    for (let start = 0; start < wanted.length; start += GRANT_CHUNK) {
      try {
        await this.csrf.refresh();
        const batch = await firstValueFrom(
          this.api.createMediaAccessBatch(wanted.slice(start, start + GRANT_CHUNK)),
        );
        this.thumbnails.update(
          (known) =>
            new Map([
              ...known,
              ...batch.items.map((item) => [item.assetId, item.thumbnailUrl ?? item.url] as const),
            ]),
        );
      } catch {
        return;
      }
    }
  }

  /** Moves to a step and puts focus where the person continues: its heading, or the slot they changed. */
  private go(step: Step, focus = '[data-step-heading]'): void {
    this.step.set(step);
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(focus)?.focus(), {
      injector: this.injector,
    });
  }
}

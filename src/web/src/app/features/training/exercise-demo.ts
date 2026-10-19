import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type { MediaAccessView } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { ButtonLink } from '../../ui/button';
import { Icon } from '../../ui/icon';
import { UiSheet } from '../../ui/sheet';
import { externalVideo } from './external-video';

/**
 * "Watch demo" for an exercise on a coach's screen (P4): the builder's grid and a client's session
 * sheet. Each opening asks the server for a short-lived grant (MED-003, MED-004), so the coach sees
 * the media only while the server still allows it. A YouTube or Vimeo demo opens on its own site, in
 * a new tab, as in the client's workout player (C18).
 */
@Component({
  selector: 'app-exercise-demo',
  imports: [ButtonLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (assetIds().length > 0) {
      <button
        type="button"
        class="demo"
        [class.compact]="compact()"
        [attr.aria-label]="compact() ? label() : null"
        [disabled]="opening()"
        (click)="open(0)"
      >
        <app-icon name="play" />
        @if (!compact()) {
          <span i18n>Watch demo</span>
        }
      </button>
    }

    <ng-template #demoSheet>
      <div class="viewer">
        @if (assetIds().length > 1) {
          <div class="pick" role="group" [attr.aria-label]="pickLabel()">
            @for (id of assetIds(); track id; let index = $index) {
              <button
                type="button"
                class="pick-one"
                [attr.aria-pressed]="index === shown()"
                [disabled]="opening()"
                (click)="open(index)"
                i18n
              >
                Demo {{ index + 1 }}
              </button>
            }
          </div>
        }
        @if (failure(); as message) {
          <p class="failure" role="alert">{{ message }}</p>
        } @else if (media(); as current) {
          @if (current.source === 'ExternalEmbed') {
            <!-- C18: nothing from YouTube or Vimeo loads inside TB Gym; the demo opens on its site. -->
            <div class="external">
              @if (externalVideo(current); as video) {
                <p i18n>
                  This demo is a video on {{ video.provider }}. It opens there, in a new tab.
                </p>
                <a
                  appButton
                  variant="outlined"
                  [href]="video.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  data-watch-external
                  ><ng-container i18n>Watch on {{ video.provider }}</ng-container
                  ><span class="tb-visually-hidden" i18n> (opens in a new tab)</span></a
                >
              } @else {
                <p class="failure" role="alert" i18n>This demo can’t be opened.</p>
              }
            </div>
          } @else if (current.kind === 'Image') {
            <img class="media" [src]="current.url" [alt]="altText()" />
          } @else {
            <video
              class="media"
              [src]="current.url"
              controls
              playsinline
              [attr.controlsList]="current.downloadAllowed ? null : 'nodownload'"
              [attr.aria-label]="altText()"
            ></video>
          }
        } @else {
          <p class="loading" role="status" i18n>Opening the demo…</p>
        }
      </div>
    </ng-template>
  `,
  styles: `
    :host {
      display: inline-flex;
    }

    .demo {
      align-items: center;
      background: none;
      border: 0;
      border-radius: 6px;
      color: var(--tb-accent-ink);
      cursor: pointer;
      display: inline-flex;
      font: inherit;
      font-size: 0.8125rem;
      font-weight: 600;
      gap: 0.25rem;
      min-block-size: 2rem;
      padding: 0.25rem 0.375rem;
    }

    .demo.compact {
      justify-content: center;
      min-inline-size: 2rem;
      padding: 0.25rem;
    }

    .demo:hover {
      background: var(--tb-surface-2);
    }

    .demo:focus-visible,
    .pick-one:focus-visible {
      outline: 2px solid var(--tb-focus);
      outline-offset: 1px;
    }

    .demo:disabled {
      cursor: progress;
      opacity: 0.6;
    }

    .viewer {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .pick {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
    }

    .pick-one {
      background: var(--tb-surface);
      border: 1px solid var(--tb-line-strong);
      border-radius: 999px;
      color: var(--tb-ink);
      cursor: pointer;
      font: inherit;
      font-size: 0.875rem;
      font-weight: 600;
      min-block-size: 2.25rem;
      padding: 0 0.875rem;
    }

    .pick-one[aria-pressed='true'] {
      background: var(--tb-brand);
      border-color: var(--tb-brand);
      color: var(--tb-on-brand);
    }

    .media {
      background: var(--tb-surface-2);
      border-radius: var(--tb-radius-card-small);
      display: block;
      inline-size: 100%;
      max-block-size: 60dvh;
      object-fit: contain;
    }

    .failure,
    .loading {
      color: var(--tb-ink);
      margin: 0;
    }

    .external {
      align-items: flex-start;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;

      p {
        color: var(--tb-ink);
        margin: 0;
      }
    }

    .failure {
      background: var(--tb-danger-soft);
      border-radius: var(--tb-radius-card-small);
      padding: 0.625rem 0.875rem;
    }
  `,
})
export class ExerciseDemo {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly sheets = inject(UiSheet);
  private readonly demoSheet = viewChild.required<TemplateRef<unknown>>('demoSheet');
  private sheetOpen = false;

  /** The exercise's media, in the order its demos are shown. */
  readonly assetIds = input<readonly string[]>([]);
  readonly exerciseName = input.required<string>();
  /** An icon alone, named for assistive technology, where a row has little room. */
  readonly compact = input(false, { transform: booleanAttribute });

  protected readonly opening = signal(false);
  protected readonly shown = signal(0);
  protected readonly media = signal<MediaAccessView | null>(null);
  protected readonly externalVideo = externalVideo;
  protected readonly failure = signal<string | null>(null);

  protected readonly label = computed(
    () => $localize`Watch the ${this.exerciseName()}:exercise: demo`,
  );
  protected readonly altText = computed(
    () => $localize`How to do ${this.exerciseName()}:exercise:`,
  );
  protected readonly pickLabel = computed(
    () => $localize`Demos of ${this.exerciseName()}:exercise:`,
  );

  protected async open(index: number): Promise<void> {
    const id = this.assetIds()[index];
    if (!id || this.opening()) return;
    this.shown.set(index);
    this.media.set(null);
    this.failure.set(null);
    this.opening.set(true);
    if (!this.sheetOpen) {
      this.sheetOpen = true;
      const sheet = this.sheets.open(this.demoSheet(), {
        title: this.exerciseName(),
        closeLabel: $localize`Close`,
      });
      sheet.closed.subscribe(() => {
        this.sheetOpen = false;
        this.media.set(null);
      });
    }
    try {
      await this.csrf.refresh();
      this.media.set(await firstValueFrom(this.api.createMediaAccess(id)));
    } catch (error) {
      this.failure.set(apiErrorMessage(error, $localize`The demo could not be opened. Try again.`));
    } finally {
      this.opening.set(false);
    }
  }
}

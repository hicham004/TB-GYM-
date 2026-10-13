import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  InjectionToken,
  input,
} from '@angular/core';
import type { StageId } from './home-content';
import { PLACEHOLDERS } from './home-placeholders';

/**
 * The private pre-launch build's stand-in photographs (UI plan R6.2h). The shoot's pictures are
 * not here yet; for a private showing the owner puts stand-ins in the placeholders folder beside
 * `src`, and `scripts/private-preview.mjs` builds the page with them: the hero, two of the week's
 * stages and the gyms story. The public build's module (`home-placeholders.ts`) says null, so none of this is
 * drawn on the public page. Every stand-in carries a visible "Placeholder" mark, and a file the
 * folder lacks is a grey stand-in with the same mark, so a showing can never pass for the real page.
 */
export type PlaceholderName = 'hero' | 'train' | 'talk' | 'team';

export interface PlaceholderPicture {
  readonly name: PlaceholderName;
  /** The file's name in the folder, printed on the mark. */
  readonly file: string;
  /** Where the private build serves it, or null when the folder had no such file. */
  readonly src: string | null;
}

export type PlaceholderSet = Readonly<Record<PlaceholderName, PlaceholderPicture>>;

/** The stand-ins the build was made with, or null on the public build. Tests provide their own. */
export const HOME_PLACEHOLDERS = new InjectionToken<PlaceholderSet | null>('HOME_PLACEHOLDERS', {
  providedIn: 'root',
  factory: () => PLACEHOLDERS,
});

/**
 * The week stages that carry a photograph: Monday evening's lift (a client between sets, phone in
 * hand) and Sunday's "You both see it" (the coach and the client looking at the phone together).
 */
export const STAGE_PLACEHOLDERS: Readonly<Partial<Record<StageId, PlaceholderName>>> = {
  train: 'train',
  see: 'talk',
};

export function stagePlaceholder(
  stage: StageId,
  set: PlaceholderSet | null,
): PlaceholderPicture | null {
  const name = STAGE_PLACEHOLDERS[stage];
  return set && name ? set[name] : null;
}

/**
 * One stand-in: the picture fills its host (the section sizes it, as a backdrop or a box with a
 * ratio), with the mark over it; without the file, the grey hatch the mockups drew in its place.
 */
@Component({
  selector: 'app-home-placeholder',
  template: `
    @if (picture().src; as src) {
      <img
        [src]="src"
        [alt]="alt()"
        [attr.loading]="eager() ? null : 'lazy'"
        [attr.fetchpriority]="eager() ? 'high' : null"
        decoding="async"
      />
    } @else {
      <div
        class="missing"
        [attr.role]="alt() ? 'img' : null"
        [attr.aria-label]="alt() || null"
        [attr.aria-hidden]="alt() ? null : 'true'"
      ></div>
    }
    <span class="mark" i18n>Placeholder · {{ picture().file }}</span>
    @if (!picture().src) {
      <span class="mark mark--missing" i18n>Not in the placeholders folder yet</span>
    }
  `,
  styleUrl: './home-placeholder.scss',
  host: { '[attr.data-placeholder]': 'picture().name' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePlaceholder {
  readonly picture = input.required<PlaceholderPicture>();
  /** What the stand-in shows; empty where the figure is decorative and a nearby text says it. */
  readonly alt = input('');
  /** The hero's photograph: fetched with the document, ahead of the rest. */
  readonly eager = input(false, { transform: booleanAttribute });
}

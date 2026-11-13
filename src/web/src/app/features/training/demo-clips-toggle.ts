import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Button } from '../../ui/button';
import { DemoClips } from './demo-clips';

/**
 * The one pause a list of looping demos offers for all of them (WCAG 2.2.2, notes plan N9b4): a
 * list's clips are thumbnails with no button of their own, so the page carries this one. It reads
 * and sets the pause every clip follows, so the player's and the exercise page's own buttons agree
 * with it.
 */
@Component({
  selector: 'app-demo-clips-toggle',
  imports: [Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      appButton
      type="button"
      variant="outlined"
      size="touch"
      data-clips-toggle
      (click)="clips.paused() ? clips.play() : clips.pause()"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        @if (clips.paused()) {
          <path class="fill" d="M7 4.75v10.5L15.5 10z" />
        } @else {
          <path d="M7 5v10M13 5v10" />
        }
      </svg>
      @if (clips.paused()) {
        <span i18n>Play demos</span>
      } @else {
        <span i18n>Pause demos</span>
      }
    </button>
  `,
  styles: `
    :host {
      display: inline-flex;
    }

    svg {
      block-size: 1.25rem;
      fill: none;
      flex: none;
      inline-size: 1.25rem;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-width: 2;
    }

    svg .fill {
      fill: currentColor;
      stroke-linejoin: round;
      stroke-width: 1;
    }
  `,
})
export class DemoClipsToggle {
  protected readonly clips = inject(DemoClips);
}

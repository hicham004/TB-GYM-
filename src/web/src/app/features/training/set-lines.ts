import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * An exercise's set lines on the grid (critique B7a), one run of sets to a line. A narrow day breaks
 * a line only between its parts, and the dot then starts the next line ("3 × 5 · 82.5% of training
 * max" over "· RPE 8.5"), so no part is split in two.
 */
@Component({
  selector: 'app-set-lines',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (line of parts(); track $index) {
      <span class="run">
        @for (part of line; track $index; let first = $first) {
          @if (!first) {
            <span class="sep"> ·&nbsp;</span>
          }
          <span class="part">{{ part }}</span>
        }
      </span>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 0.0625rem;
      min-inline-size: 0;
    }

    .part {
      white-space: nowrap;
    }
  `,
})
export class SetLines {
  readonly lines = input.required<readonly string[]>();
  protected readonly parts = computed(() => this.lines().map((line) => line.split(' · ')));
}

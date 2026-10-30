import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * "Needs a training max for: Back Squat, Overhead Press · set when you assign the program" (critique
 * B7a): the lifts Assign program will ask a max for, in the builder's head and the publish preview.
 * Each name is the coach's own words, in its own writing direction.
 */
@Component({
  selector: 'app-needs-max-line',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- The spaces stand between elements, where a block's own edges would drop them. -->
    <p class="line" data-needs-max>
      <span class="lead" i18n>Needs a training max for:</span>&ngsp;<span class="lifts">
        @for (lift of lifts(); track lift.exerciseId; let last = $last) {
          <bdi class="lift">{{ lift.name }}</bdi>
          @if (!last) {
            <span>, </span>
          }
        }</span
      >&ngsp;<span class="when" i18n>· set when you assign the program</span>
    </p>
  `,
  styles: `
    :host {
      display: block;
      min-inline-size: 0;
    }

    .line {
      color: var(--tb-muted);
      font-size: 0.875rem;
      line-height: 1.4;
      margin: 0;
      overflow-wrap: anywhere;
      text-wrap: pretty;
    }

    .lead,
    .lift {
      color: var(--tb-ink);
    }

    .lead {
      font-weight: 600;
    }
  `,
})
export class NeedsMaxLine {
  readonly lifts = input.required<readonly { exerciseId: string; name: string }[]>();
}

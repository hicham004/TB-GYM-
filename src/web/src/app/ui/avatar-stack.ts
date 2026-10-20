import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Avatar, AvatarPresentation } from './avatar';

export interface AvatarStackPerson {
  name: string;
  initials: string;
  presentation?: AvatarPresentation;
}

/** A compact visual group. The full names, including overflow, form its accessible label. */
@Component({
  selector: 'app-avatar-stack',
  imports: [Avatar],
  template: `
    @for (person of visiblePeople(); track $index) {
      <app-avatar [initials]="person.initials" [presentation]="person.presentation ?? 'client'" />
    }
    @if (remaining() > 0) {
      <span class="overflow" aria-hidden="true">+{{ remaining() }}</span>
    }
  `,
  styles: `
    /* Sized in rem with the initials inside, so larger text grows the faces instead of crowding letters
       into each other (UIQ-3); a row that cannot hold them wraps rather than squeezing them. */
    :host {
      align-items: center;
      display: inline-flex;
      flex: none;
      isolation: isolate;
      vertical-align: middle;
    }

    app-avatar,
    .overflow {
      border: 2px solid var(--tb-surface);
      box-sizing: border-box;
      flex: none;
      margin-inline-start: -0.5rem;
    }

    app-avatar:first-child {
      margin-inline-start: 0;
    }

    /* Existing Avatar presets are 40px; stacking should not enlarge the row. */
    app-avatar {
      --avatar-size: 2rem;
    }

    .overflow {
      align-items: center;
      background: var(--tb-surface-2);
      block-size: 2rem;
      border-radius: 50%;
      color: var(--tb-ink);
      display: inline-flex;
      font-size: var(--text-metadata-size);
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      inline-size: 2rem;
      justify-content: center;
    }
  `,
  host: {
    role: 'img',
    '[attr.aria-label]': 'accessibleLabel()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AvatarStack {
  readonly people = input.required<readonly AvatarStackPerson[]>();
  readonly label = input('People');
  readonly maxVisible = input(4);
  protected readonly visiblePeople = computed(() =>
    this.people().slice(0, Math.max(0, Math.floor(this.maxVisible()))),
  );
  protected readonly remaining = computed(() => this.people().length - this.visiblePeople().length);
  protected readonly accessibleLabel = computed(() =>
    this.people().length
      ? `${this.label()}: ${this.people()
          .map((person) => person.name)
          .join(', ')}`
      : `${this.label()}: none`,
  );
}

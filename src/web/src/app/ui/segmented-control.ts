import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

export interface SegmentOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

let nextGroupId = 0;

/** A small single choice control. Native radios provide the keyboard and screen reader behavior. */
@Component({
  selector: 'app-segmented-control',
  template: `
    <fieldset>
      <legend>{{ label() }}</legend>
      <div class="track">
        @for (option of options(); track option.value) {
          <label>
            <input
              type="radio"
              [name]="groupName"
              [value]="option.value"
              [checked]="selected() === option.value"
              [disabled]="option.disabled || false"
              (change)="selected.set(option.value)"
            />
            <span>{{ option.label }}</span>
          </label>
        }
      </div>
    </fieldset>
  `,
  styles: `
    :host {
      display: block;
      min-inline-size: 0;
    }

    fieldset {
      border: 0;
      margin: 0;
      min-inline-size: 0;
      padding: 0;
    }

    legend {
      color: var(--tb-muted);
      font-size: var(--text-metadata-size);
      font-weight: 600;
      margin-block-end: var(--space-8);
    }

    .track {
      background: var(--tb-surface-2);
      border: 1px solid var(--tb-line);
      border-radius: var(--tb-radius-control);
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-4);
      max-inline-size: 100%;
      padding: var(--space-4);
    }

    label {
      cursor: pointer;
      flex: 1 1 auto;
      min-inline-size: 0;
      position: relative;
      text-align: center;
    }

    input {
      block-size: 100%;
      inline-size: 100%;
      inset: 0;
      margin: 0;
      opacity: 0;
      position: absolute;
    }

    span {
      align-items: center;
      border-radius: calc(var(--tb-radius-control) - 3px);
      color: var(--tb-muted);
      display: flex;
      font-size: var(--text-compact-size);
      font-weight: 600;
      justify-content: center;
      min-block-size: 40px;
      padding: var(--space-4) var(--space-12);
      overflow-wrap: anywhere;
    }

    input:checked + span {
      background: var(--tb-surface);
      box-shadow: var(--tb-shadow-card);
      color: var(--tb-ink);
    }

    input:focus-visible + span {
      outline: 3px solid var(--tb-focus);
      outline-offset: -2px;
    }

    input:disabled + span {
      cursor: not-allowed;
      opacity: 0.5;
    }

    @media (forced-colors: active) {
      input:checked + span {
        border: 2px solid Highlight;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SegmentedControl {
  readonly label = input.required<string>();
  readonly options = input.required<readonly SegmentOption[]>();
  readonly selected = model<string>('');
  protected readonly groupName = `tb-segment-${++nextGroupId}`;
}

import { Component, input } from '@angular/core';

export interface ChartBar {
  label: string;
  value: number;
  total: number;
}

@Component({
  selector: 'app-bar-chart',
  template: `
    <div class="bars" role="img" [attr.aria-label]="label()">
      @for (bar of bars(); track bar.label) {
        <div class="bar-row">
          <span>{{ bar.label }}</span>
          <div class="track" aria-hidden="true">
            <i [style.width.%]="bar.total > 0 ? (100 * bar.value) / bar.total : 0"></i>
          </div>
          <strong>{{ bar.value }} / {{ bar.total }}</strong>
        </div>
      }
    </div>
    <details>
      <summary i18n>Training counts</summary>
      <table>
        <caption>
          {{
            label()
          }}
        </caption>
        <thead>
          <tr>
            <th i18n>Period</th>
            <th i18n>Completed</th>
            <th i18n>Scheduled</th>
          </tr>
        </thead>
        <tbody>
          @for (bar of bars(); track bar.label) {
            <tr>
              <th>{{ bar.label }}</th>
              <td>{{ bar.value }}</td>
              <td>{{ bar.total }}</td>
            </tr>
          }
        </tbody>
      </table>
    </details>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .bars {
        display: grid;
        gap: 1rem;
      }
      .bar-row {
        display: grid;
        grid-template-columns: minmax(5rem, 8rem) 1fr auto;
        align-items: center;
        gap: 0.75rem;
        font-size: 0.82rem;
      }
      .bar-row strong {
        font-variant-numeric: tabular-nums;
      }
      .track {
        block-size: 0.7rem;
        border-radius: 1rem;
        background: var(--tb-line, #d9dfd1);
        overflow: hidden;
      }
      .track i {
        display: block;
        block-size: 100%;
        border-radius: inherit;
        background: var(--tb-brand, #153d33);
      }
      details {
        margin-block-start: 0.75rem;
        font-size: 0.8rem;
        max-inline-size: 100%;
        overflow-x: auto;
      }
      summary {
        cursor: pointer;
        min-block-size: 2rem;
      }
      table {
        display: block;
        max-inline-size: 100%;
        overflow-x: auto;
        border-collapse: collapse;
      }
      th,
      td {
        padding: 0.25rem;
        text-align: start;
        border-block-end: 1px solid var(--tb-line, #d9dfd1);
      }
    `,
  ],
})
export class BarChart {
  readonly bars = input.required<readonly ChartBar[]>();
  readonly label = input('Completion counts');
}

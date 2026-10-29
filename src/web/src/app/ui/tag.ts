import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * A short reason in the warning tone, with its count where it has one: "2 check-ins to review"
 * (critique B4a). With a `link` it is a link to where the reason is handled, with a 24 px target and
 * the kit's focus ring; without one, the same look where the reason is only named, as in a sheet that
 * explains them. A state that is not a reason to act is a `StatusPill`.
 */
@Component({
  selector: 'app-tag',
  imports: [NgTemplateOutlet, RouterLink],
  template: `
    <ng-template #words><ng-content /></ng-template>
    @if (link(); as target) {
      <a class="tag" [routerLink]="target" [queryParams]="queryParams()"
        ><ng-container [ngTemplateOutlet]="words"
      /></a>
    } @else {
      <span class="tag"><ng-container [ngTemplateOutlet]="words" /></span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      max-inline-size: 100%;
    }

    .tag {
      align-items: center;
      background: var(--tb-warning-soft);
      border-radius: 999px;
      box-sizing: border-box;
      color: var(--tb-warning);
      display: inline-flex;
      font-size: 0.75rem;
      font-weight: 600;
      line-height: 1.25;
      max-inline-size: 100%;
      min-block-size: 1.5rem;
      overflow-wrap: anywhere;
      padding: 0.125rem 0.625rem;
      text-decoration: none;
    }

    a.tag:hover {
      text-decoration: underline;
    }

    a.tag:focus-visible {
      outline: 2px solid var(--tb-focus);
      outline-offset: 2px;
    }

    @media (forced-colors: active) {
      .tag {
        border: 1px solid CanvasText;
      }
    }
  `,
  host: { class: 'tb-tag' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Tag {
  /** Where the reason is handled; without it the tag only names the reason. */
  readonly link = input<string | null>(null);
  readonly queryParams = input<Record<string, string> | null>(null);
}

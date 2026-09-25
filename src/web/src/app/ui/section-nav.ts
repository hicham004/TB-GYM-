import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IsActiveMatchOptions, RouterLink, RouterLinkActive } from '@angular/router';

export interface SectionLink {
  readonly label: string;
  readonly link: string;
}

/**
 * The pages of one section, under a page heading (Figma "Training section navigation" 266:1484).
 *
 * These are links, not a tablist: each one is a separate route that can be opened, bookmarked and
 * opened in a new tab, and only the page that is open carries `aria-current="page"`. The selected
 * link is marked by weight and an underline as well as colour.
 */
@Component({
  selector: 'app-section-nav',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav [attr.aria-label]="label()">
      <ul>
        @for (item of links(); track item.link) {
          <li>
            <a
              [routerLink]="item.link"
              routerLinkActive="current"
              [routerLinkActiveOptions]="matchOptions"
              ariaCurrentWhenActive="page"
              >{{ item.label }}</a
            >
          </li>
        }
      </ul>
    </nav>
  `,
  styles: `
    :host {
      display: block;
    }

    ul {
      border-block-end: 1px solid var(--color-border-subtle);
      display: flex;
      flex-wrap: wrap;
      gap: 0 var(--space-24);
      list-style: none;
      margin: 0;
      padding: 0;
    }

    a {
      color: var(--color-text-secondary);
      display: block;
      font-size: var(--text-compact-size);
      font-weight: var(--font-weight-regular);
      line-height: var(--text-compact-line-height);
      overflow-wrap: anywhere;
      padding-block: var(--space-8);
      text-decoration: none;
    }

    a:hover {
      color: var(--color-text-primary);
      text-decoration: underline;
    }

    a:focus-visible {
      border-radius: var(--radius-4);
      outline: var(--focus-ring-width) solid var(--color-accent);
      outline-offset: var(--focus-separation-gap);
    }

    /* Selected: heavier text and a 2px accent indicator, so it never depends on colour alone. */
    a.current {
      box-shadow: inset 0 -2px var(--color-accent);
      color: var(--color-text-primary);
      font-weight: var(--font-weight-strong);
    }

    @media (forced-colors: active) {
      a.current {
        box-shadow: inset 0 -2px CanvasText;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SectionNav {
  /**
   * The page itself, whatever its query string: a link into a section with `?renew=…` or a filter
   * still marks that section as the current page.
   */
  protected readonly matchOptions: IsActiveMatchOptions = {
    paths: 'exact',
    queryParams: 'ignored',
    matrixParams: 'ignored',
    fragment: 'ignored',
  };

  /** Names the navigation region, for example "Training sections". */
  readonly label = input.required<string>();
  readonly links = input.required<readonly SectionLink[]>();
}

import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  viewChild,
} from '@angular/core';
import { IsActiveMatchOptions, RouterLink, RouterLinkActive } from '@angular/router';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { settingsGroups } from './settings-groups';

/**
 * The one Settings layout (C9, R5.2a): the page's own heading, then the Settings pages beside it in
 * two groups, the coaching space's (the owner's) and the person's own account. On a wide page the
 * groups are a column at the start; on a phone they are one row that scrolls sideways under the
 * heading, the open page scrolled into view.
 *
 * A client has no Settings section: their account pages open from Me and keep their own way back,
 * so the frame shows only the page.
 *
 * Presentation only. Each page keeps its own route, guard and API checks.
 */
@Component({
  selector: 'app-settings-frame',
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The kit's type scope (font, Arabic face) for every Settings page.
  host: { class: 'tb-theme' },
  template: `
    <div class="frame" [class.with-nav]="groups().length > 0">
      <div class="head"><ng-content select="[settingsHead]" /></div>
      @if (groups().length > 0) {
        <nav #nav class="nav" aria-label="Settings" i18n-aria-label>
          <p class="nav-title" aria-hidden="true" i18n>Settings</p>
          @for (group of groups(); track group.key) {
            <div class="group">
              <p class="group-label" [id]="'settings-group-' + group.key">{{ group.label }}</p>
              <ul role="list" [attr.aria-labelledby]="'settings-group-' + group.key">
                @for (item of group.items; track item.link) {
                  <li>
                    <a
                      #link
                      [routerLink]="item.link"
                      routerLinkActive="current"
                      [routerLinkActiveOptions]="matchOptions"
                      ariaCurrentWhenActive="page"
                      (isActiveChange)="$event && reveal(link)"
                      >{{ item.label }}</a
                    >
                  </li>
                }
              </ul>
            </div>
          }
        </nav>
      }
      <div class="body"><ng-content /></div>
    </div>
  `,
  styles: `
    :host {
      container-type: inline-size;
      display: block;
    }

    .frame {
      display: grid;
      gap: 1.125rem;
      grid-template-areas: 'head' 'nav' 'body';
      grid-template-columns: minmax(0, 1fr);
    }

    .head {
      grid-area: head;
      min-inline-size: 0;
    }

    .body {
      display: flex;
      flex-direction: column;
      gap: 1.125rem;
      grid-area: body;
      min-inline-size: 0;
    }

    .nav {
      grid-area: nav;
      min-inline-size: 0;
    }

    .nav-title {
      display: none;
    }

    /* A phone: both groups in one row that scrolls sideways, labels kept for screen readers. */
    .nav {
      border-block-end: 1px solid var(--tb-line);
      display: flex;
      gap: 0.25rem;
      /* Bleeds to the screen's edges through the page's own gutter, whatever the text size. */
      margin-inline: calc(-1 * var(--page-padding-mobile, 16px));
      overflow-x: auto;
      overscroll-behavior-inline: contain;
      padding-inline: var(--page-padding-mobile, 16px);
      /* Holds the hidden group names, which would otherwise widen the page. */
      position: relative;
      scrollbar-width: none;
    }

    .nav::-webkit-scrollbar {
      display: none;
    }

    .group {
      display: flex;
      flex: none;
    }

    .group + .group {
      border-inline-start: 1px solid var(--tb-line);
      margin-inline-start: 0.5rem;
      padding-inline-start: 0.5rem;
    }

    .group-label {
      block-size: 1px;
      clip-path: inset(50%);
      inline-size: 1px;
      margin: 0;
      overflow: hidden;
      position: absolute;
      white-space: nowrap;
    }

    ul {
      display: flex;
      gap: 0.25rem;
      list-style: none;
      margin: 0;
      padding: 0;
    }

    a {
      align-items: center;
      border-radius: var(--tb-radius-control);
      color: var(--tb-muted);
      display: flex;
      font-size: 0.9375rem;
      font-weight: 500;
      min-block-size: 2.75rem;
      padding-inline: 0.75rem;
      text-decoration: none;
      white-space: nowrap;
    }

    a:hover {
      color: var(--tb-ink);
    }

    a:focus-visible {
      outline: 2px solid var(--tb-focus);
      outline-offset: -2px;
    }

    /* The open page: ink, weight and a bar, never colour alone. */
    a.current {
      box-shadow: inset 0 -3px var(--tb-brand);
      color: var(--tb-ink);
      font-weight: 600;
    }

    @container (min-width: 50rem) {
      .frame.with-nav {
        column-gap: 2rem;
        grid-template-areas: 'nav head' 'nav body';
        grid-template-columns: 12.5rem minmax(0, 1fr);
        grid-template-rows: auto 1fr;
      }

      .nav {
        align-self: start;
        border: 0;
        flex-direction: column;
        gap: 1.25rem;
        margin: 0;
        overflow: visible;
        padding: 0;
        position: sticky;
        inset-block-start: calc(var(--tb-topbar-block-size, 0px) + 1rem);
      }

      .nav-title {
        color: var(--tb-ink);
        display: block;
        font-size: 1.125rem;
        font-weight: 600;
        margin: 0;
      }

      .group {
        flex-direction: column;
        gap: 0.25rem;
      }

      .group + .group {
        border: 0;
        margin: 0;
        padding: 0;
      }

      .group-label {
        block-size: auto;
        clip-path: none;
        color: var(--tb-muted);
        font-size: 0.75rem;
        font-weight: 600;
        inline-size: auto;
        letter-spacing: 0.06em;
        overflow: visible;
        padding-inline: 0.75rem;
        position: static;
        text-transform: uppercase;
        white-space: normal;
      }

      ul {
        flex-direction: column;
        gap: 0.125rem;
      }

      a {
        min-block-size: 2.5rem;
        white-space: normal;
      }

      a.current {
        background: var(--tb-surface);
        box-shadow:
          inset 3px 0 var(--tb-brand),
          var(--tb-shadow-card);
      }

      :host-context([dir='rtl']) a.current {
        box-shadow:
          inset -3px 0 var(--tb-brand),
          var(--tb-shadow-card);
      }
    }

    @media (forced-colors: active) {
      a.current {
        outline: 2px solid CanvasText;
      }
    }
  `,
})
export class SettingsFrame {
  private readonly tenants = inject(TenantStore);
  private readonly injector = inject(Injector);
  private readonly nav = viewChild<ElementRef<HTMLElement>>('nav');

  protected readonly matchOptions: IsActiveMatchOptions = {
    paths: 'exact',
    queryParams: 'ignored',
    matrixParams: 'ignored',
    fragment: 'ignored',
  };

  protected readonly groups = computed(() =>
    settingsGroups(this.tenants.selectedMembership()?.role ?? null),
  );

  /**
   * On a phone the open page may sit past the row's edge: once its link is marked current, bring it
   * into view. Only the row scrolls; on a wide page the column needs nothing.
   */
  protected reveal(link: HTMLElement): void {
    afterNextRender(
      () => {
        const nav = this.nav()?.nativeElement;
        if (!nav || nav.scrollWidth <= nav.clientWidth) return;
        // `nearest` on the block axis: the row is in view at the top, so the page itself stays put.
        // The browser works out the inline axis, right to left included.
        link.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'instant' });
      },
      { injector: this.injector },
    );
  }
}

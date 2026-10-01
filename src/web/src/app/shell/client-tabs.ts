import { DOCUMENT, formatNumber } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  LOCALE_ID,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { ClientAccessStore } from '../core/access/client-access.store';
import { MessageUnreadStore } from '../core/messaging/message-unread.store';
import { Icon } from '../ui/icon';
import { ClientTab, clientTabState, visibleClientTabs } from './client-navigation';
import { countDisplay } from './coach-navigation';

/**
 * The client's bottom navigation (339:2142): Today, Training, Nutrition, Progress and Messages. A
 * feature outside the client's plan has no tab; a paused or ended one keeps it, and its page says
 * why. Presentation only: every page keeps its guard and every API its own access decision.
 */
@Component({
  selector: 'app-client-tabs',
  imports: [Icon, RouterLink],
  templateUrl: './client-tabs.html',
  styleUrl: './client-tabs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientTabs {
  private readonly router = inject(Router);
  private readonly locale = inject(LOCALE_ID);
  private readonly access = inject(ClientAccessStore);
  private readonly messages = inject(MessageUnreadStore);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly tabs = computed(() =>
    visibleClientTabs((feature) => this.access.notInPlan(feature)),
  );
  protected readonly unread = computed(() =>
    this.messages.isAvailable() ? this.messages.unread() : 0,
  );
  protected readonly unreadText = computed(() => formatNumber(this.unread(), this.locale, '1.0-0'));
  protected readonly unreadCount = computed(() =>
    countDisplay(this.unread(), (value) => formatNumber(value, this.locale, '1.0-0')),
  );

  constructor() {
    publishBlockSize(inject(ElementRef).nativeElement, inject(DOCUMENT), inject(DestroyRef));
  }

  protected state(tab: ClientTab): 'page' | 'section' | null {
    return clientTabState(this.url(), tab);
  }
}

/** The custom property a page reads to keep a pinned element (the chat composer) above the tabs. */
export const CLIENT_TABS_BLOCK_SIZE = '--tb-client-tabs-block-size';

/**
 * Publishes the bar's height on the document, and keeps it current: enlarged or translated labels
 * wrap the tabs onto a second row. Removed again when the bar goes, so a coach shell reads zero.
 */
function publishBlockSize(host: HTMLElement, document: Document, destroyRef: DestroyRef): void {
  const root = document.documentElement;
  afterNextRender(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() =>
      root.style.setProperty(CLIENT_TABS_BLOCK_SIZE, `${host.getBoundingClientRect().height}px`),
    );
    observer.observe(host);
    destroyRef.onDestroy(() => observer.disconnect());
  });
  destroyRef.onDestroy(() => root.style.removeProperty(CLIENT_TABS_BLOCK_SIZE));
}

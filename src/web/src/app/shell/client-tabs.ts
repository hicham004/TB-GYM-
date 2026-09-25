import { formatNumber } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, LOCALE_ID } from '@angular/core';
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

  protected state(tab: ClientTab): 'page' | 'section' | null {
    return clientTabState(this.url(), tab);
  }
}

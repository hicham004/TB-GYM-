import { formatNumber } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  LOCALE_ID,
  output,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { MessageUnreadStore } from '../core/messaging/message-unread.store';
import { TenantStore } from '../core/tenancy/tenant.store';
import { Icon } from '../ui/icon';
import {
  COACH_NAVIGATION,
  CoachDestination,
  countDisplay,
  destinationState,
} from './coach-navigation';

/**
 * The grouped coach destinations (Navigation/Sidebar item 121:165), rendered once in the desktop
 * sidebar and once inside the narrow-width navigation dialog. Selection follows the router: a
 * destination whose own page is open is `aria-current="page"`; one whose section is open but on a
 * different page, such as Training while Exercises is open, is `aria-current="true"`.
 */
@Component({
  selector: 'app-coach-nav',
  imports: [Icon, RouterLink],
  templateUrl: './coach-nav.html',
  styleUrl: './coach-nav.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoachNav {
  private readonly router = inject(Router);
  private readonly locale = inject(LOCALE_ID);
  private readonly tenants = inject(TenantStore);
  protected readonly messages = inject(MessageUnreadStore);

  /** A destination was followed; the navigation dialog closes on it. */
  readonly navigated = output<void>();

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly groups = computed(() => {
    const owner = this.tenants.isOwner();
    const messaging = this.messages.isAvailable();
    return COACH_NAVIGATION.map((group) => ({
      label: group.label,
      destinations: group.destinations.filter(
        (destination) => (!destination.ownerOnly || owner) && (!destination.messaging || messaging),
      ),
    })).filter((group) => group.destinations.length > 0);
  });

  protected readonly unread = computed(() => this.messages.unread());
  protected readonly unreadText = computed(() =>
    formatNumber(this.messages.unread(), this.locale, '1.0-0'),
  );
  protected readonly unreadCount = computed(() =>
    countDisplay(this.messages.unread(), (value) => formatNumber(value, this.locale, '1.0-0')),
  );

  protected state(destination: CoachDestination): 'page' | 'section' | null {
    return destinationState(destination, this.url());
  }
}

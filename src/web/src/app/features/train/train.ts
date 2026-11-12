import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  LOCALE_ID,
  signal,
} from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthStore } from '../../core/auth/auth.store';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink } from '../../ui/button';
import { AuthFrame } from '../auth/auth-frame';
import { TrainApi } from './train-api';
import { fullSentence, houseClock, houseMembership, type TrainSignUp } from './train.models';

/**
 * `/train` (notes plan N9a2): TB Gym's own coaching, for people with no coach, and where its sign-up
 * stands this week. Open, it offers one button to the form; full, it says when it opens again; closed,
 * it says so and nothing about the house. The server decides each (CLI-024); the page only reads it.
 * Search engines are told to leave it out while sign-up is closed (the row's default), and it counts no
 * visit: it never starts the website's analytics.
 */
@Component({
  selector: 'app-train',
  imports: [AuthFrame, Button, ButtonLink, RouterLink],
  templateUrl: './train.html',
  styleUrls: ['../auth/auth.scss', './train.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Train {
  private readonly api = inject(TrainApi);
  private readonly auth = inject(AuthStore);
  private readonly meta = inject(Meta);
  private readonly tenants = inject(TenantStore);
  private readonly router = inject(Router);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);
  private robots: HTMLMetaElement | null = null;

  protected readonly state = signal<'loading' | 'failed' | 'ready'>('loading');
  protected readonly reading = signal(false);
  protected readonly signUp = signal<TrainSignUp | null>(null);
  /** A session that ended by itself is a visitor's to the server, so the page treats it as one. */
  protected readonly signedIn = computed(() => this.auth.user() !== null && !this.auth.ended());
  protected readonly full = computed(() =>
    fullSentence(this.signUp()?.opensAgainOn ?? null, this.locale),
  );
  protected readonly clock = computed(() =>
    houseClock(this.signUp()?.timeZoneId ?? null, this.locale),
  );

  constructor() {
    this.destroyRef.onDestroy(() => this.robots?.remove());
    void this.load();
  }

  protected async load(): Promise<void> {
    this.reading.set(true);
    try {
      const signUp = await firstValueFrom(this.api.status());
      if (this.destroyRef.destroyed) return;
      this.signUp.set(signUp);
      this.state.set('ready');
      if (signUp.status === 'Closed') this.leaveOutOfSearch();
      else this.backInSearch();
    } catch {
      if (this.destroyRef.destroyed) return;
      // Kept on screen during a retry: only a first read that fails shows the failure.
      if (this.signUp() === null) this.state.set('failed');
      this.leaveOutOfSearch();
    } finally {
      this.reading.set(false);
    }
  }

  /**
   * Today in TB Gym's own space, chosen first: someone who is also a coach's client (decision 34) may have
   * that space selected. A click meant for a new tab is the browser's.
   */
  protected async openToday(event: MouseEvent): Promise<void> {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    const name = this.signUp()?.workspaceName ?? null;
    try {
      if (!houseMembership(this.tenants.memberships(), name)) await this.tenants.load();
    } catch {
      // Today opens in the space already chosen.
    }
    const house = houseMembership(this.tenants.memberships(), name);
    if (house) this.tenants.select(house.tenantId);
    await this.router.navigateByUrl('/');
  }

  /** `noindex` while sign-up is closed; a robots tag the document already has (the private build's) stays. */
  private leaveOutOfSearch(): void {
    if (this.robots !== null || this.meta.getTag('name="robots"') !== null) return;
    this.robots = this.meta.addTag({ name: 'robots', content: 'noindex' });
  }

  /** A Try again that finds sign-up open takes back the tag a failed first read added, and only that one. */
  private backInSearch(): void {
    this.robots?.remove();
    this.robots = null;
  }
}

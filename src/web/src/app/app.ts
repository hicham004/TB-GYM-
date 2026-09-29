import { DOCUMENT } from '@angular/common';
import {
  Component,
  computed,
  ElementRef,
  inject,
  LOCALE_ID,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthStore } from './core/auth/auth.store';
import { SessionActions } from './core/auth/session-actions';
import { TenantStore } from './core/tenancy/tenant.store';
import { isRedesignedRoute } from './core/theme/redesigned-route';
import { BillingBanner } from './features/billing/billing-banner';
import { ClientTabs } from './shell/client-tabs';
import { CoachShell } from './shell/coach-shell';

/**
 * Which chrome surrounds the routed page. Presentation only: every route keeps its own guards and
 * the API authorises every request, so choosing a shell never grants or withholds anything.
 *
 * - `coach`: an Owner or Coach membership is selected — the design-system coach shell.
 * - `client`: a Client membership is selected — no top bar, the bottom tabs (339:2142); workspace
 *   switching and sign-out are on the Me page, notifications and Me are in Today's header.
 * - `member`: signed in without a workspace — the pre-existing top bar.
 * - `public`: nobody is signed in.
 * - `pending`: the session, or the first membership list after signing in, is still loading.
 */
export type ShellKind = 'coach' | 'client' | 'member' | 'public' | 'pending';

@Component({
  selector: 'app-root',
  imports: [BillingBanner, ClientTabs, CoachShell, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: {
    '[class.coach-layout]': "shell() === 'coach'",
    '[class.client-layout]': "shell() === 'client'",
  },
})
export class App implements OnInit {
  private readonly document = inject(DOCUMENT);
  private readonly locale = inject(LOCALE_ID);
  private readonly session = inject(SessionActions);
  private readonly router = inject(Router);
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');
  protected readonly auth = inject(AuthStore);
  protected readonly tenants = inject(TenantStore);
  protected readonly menuOpen = signal(false);

  protected readonly shell = computed<ShellKind>(() => {
    if (this.auth.user() === null) {
      return this.auth.loading() ? 'pending' : 'public';
    }
    // A reload of an already-known session keeps its shell; only a session whose memberships have
    // not arrived yet waits, so an owner never sees the member bar flash before the coach shell.
    if (this.auth.loading() && this.tenants.memberships().length === 0) {
      return 'pending';
    }
    if (this.tenants.canCoach()) return 'coach';
    return this.tenants.isClient() ? 'client' : 'member';
  });

  private readonly redesigned = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => isRedesignedRoute(this.router.routerState.snapshot.root)),
    ),
    { initialValue: false },
  );

  /**
   * The page keeps the light tokens whatever the person's mode until its screen is rebuilt on
   * brand v2 (REDESIGNED); the shells around it follow the mode.
   */
  protected readonly contentMode = computed(() => (this.redesigned() ? null : 'light'));

  ngOnInit(): void {
    this.document.documentElement.lang = this.locale;
    this.document.documentElement.dir = this.locale.toLowerCase().startsWith('ar') ? 'rtl' : 'ltr';
    void this.auth.initialize();
  }

  /**
   * The coach shell's workspace control. The coach shell closes its menus and navigation dialog on
   * the tenant change this causes.
   */
  protected switchWorkspace(tenantId: string | null): void {
    this.menuOpen.set(false);
    this.session.switchWorkspace(tenantId);
  }

  protected async logout(): Promise<void> {
    this.menuOpen.set(false);
    await this.session.signOut();
  }

  /**
   * A fragment link would resolve against `<base href="/">` and navigate home, so the skip link
   * moves focus itself.
   */
  protected skipToContent(event: Event): void {
    event.preventDefault();
    this.main().nativeElement.focus();
  }
}

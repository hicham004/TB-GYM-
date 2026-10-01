import { DOCUMENT, formatNumber, NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  LOCALE_ID,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';
import { AuthStore } from '../core/auth/auth.store';
import { tenantRoleLabel } from '../core/i18n/display-labels';
import { NotificationStore } from '../core/notifications/notification.store';
import { TenantContext } from '../core/tenancy/tenant-context';
import { TenantStore } from '../core/tenancy/tenant.store';
import { Avatar } from '../ui/avatar';
import { Button, IconButton } from '../ui/button';
import { Icon } from '../ui/icon';
import { CoachNav } from './coach-nav';
import { countDisplay } from './coach-navigation';
import { initialsOf } from './initials';

type ShellMenu = 'workspace' | 'account';

/** The desktop sidebar is shown from this width; below it the navigation opens in a dialog. */
const DESKTOP_QUERY = '(min-width: 1024px)';

/** The custom property a sticky page element (the chat thread header) reads to sit below the bar. */
export const TOPBAR_BLOCK_SIZE = '--tb-topbar-block-size';

/**
 * The coach and owner shell (Figma coach proof 15:2, Desktop Navigation v1 118:135): a 232px
 * sidebar with the locked navigation and the signed-in identity, and a top bar with the workspace,
 * notifications and account controls. Below 1024px the sidebar is replaced by a Menu button that
 * opens the same navigation in a modal dialog.
 *
 * Everything here is presentation. The shell never authorises anything: it reads the membership the
 * TenantStore validated, hands workspace and sign-out requests back to the app (which owns their
 * sequence), and closes every menu and the dialog whenever the tenant/session epoch moves, so a
 * menu opened for one workspace can never act on another.
 *
 * The host uses `display: contents`, so the sidebar and top bar are placed directly on the app's
 * grid next to its single `<main>` and router outlet.
 */
@Component({
  selector: 'app-coach-shell',
  imports: [
    Avatar,
    Button,
    CoachNav,
    Icon,
    IconButton,
    NgTemplateOutlet,
    RouterLink,
    RouterLinkActive,
  ],
  templateUrl: './coach-shell.html',
  styleUrls: ['./coach-shell.scss', './coach-topbar.scss'],
  // Escape is bound on the host rather than on the menu wrappers: a wrapper is not focusable, and
  // a key handler on something that cannot take focus is unreachable by keyboard.
  host: {
    '(document:click)': 'closeMenuOnOutsideClick($event)',
    '(keydown.escape)': 'closeMenuFromKeyboard($event)',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoachShell {
  private readonly document = inject(DOCUMENT);
  private readonly locale = inject(LOCALE_ID);
  protected readonly auth = inject(AuthStore);
  protected readonly tenants = inject(TenantStore);
  protected readonly notifications = inject(NotificationStore);

  /** A different workspace was chosen. The app selects it and owns what happens next. */
  readonly workspaceSelected = output<string>();
  /** Sign out was chosen. The app clears the badges, signs out and navigates. */
  readonly signOut = output<void>();

  protected readonly openMenu = signal<ShellMenu | null>(null);
  protected readonly navOpen = signal(false);

  // Optional queries: a context change can close everything before the view exists.
  private readonly navDialog = viewChild<ElementRef<HTMLDialogElement>>('navDialog');
  private readonly menuButton = viewChild<ElementRef<HTMLButtonElement>>('menuButton');
  private readonly topbar = viewChild<ElementRef<HTMLElement>>('topbar');
  private readonly workspaceArea = viewChild<ElementRef<HTMLElement>>('workspaceArea');
  private readonly workspaceButton = viewChild<ElementRef<HTMLButtonElement>>('workspaceButton');
  private readonly accountArea = viewChild<ElementRef<HTMLElement>>('accountArea');
  private readonly accountButton = viewChild<ElementRef<HTMLButtonElement>>('accountButton');

  protected readonly membership = computed(() => this.tenants.selectedMembership());
  protected readonly roleLabel = computed(() => tenantRoleLabel(this.membership()?.role));
  protected readonly roleOf = tenantRoleLabel;
  protected readonly canSwitch = computed(() => this.tenants.memberships().length > 1);
  protected readonly displayName = computed(() => {
    const user = this.auth.user();
    return user?.displayName?.trim() || user?.email || '';
  });
  protected readonly initials = computed(() =>
    initialsOf(this.auth.user()?.displayName ?? '', this.auth.user()?.email ?? ''),
  );
  protected readonly accountLabel = computed(
    () => $localize`Account menu, ${this.displayName()}:name:`,
  );

  protected readonly unreadNotifications = computed(() => this.notifications.unread());
  protected readonly unreadNotificationsText = computed(() =>
    formatNumber(this.notifications.unread(), this.locale, '1.0-0'),
  );
  protected readonly unreadNotificationsCount = computed(() =>
    countDisplay(this.notifications.unread(), (value) => formatNumber(value, this.locale, '1.0-0')),
  );

  constructor() {
    const destroyRef = inject(DestroyRef);

    // Selecting another workspace, signing in as someone else or signing out invalidates the
    // tenant context synchronously. Nothing opened for the previous context may stay open.
    destroyRef.onDestroy(inject(TenantContext).onChange(() => this.closeEverything()));

    const navigation = inject(Router)
      .events.pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => this.closeEverything());
    destroyRef.onDestroy(() => navigation.unsubscribe());

    // The dialog is only the narrow-width navigation. Growing past the breakpoint closes it, since
    // the sidebar is visible again and a modal would leave the page inert behind nothing.
    const desktop = this.document.defaultView?.matchMedia?.(DESKTOP_QUERY);
    if (desktop) {
      const onChange = (event: MediaQueryListEvent) => {
        if (event.matches) this.closeNav(false);
      };
      desktop.addEventListener('change', onChange);
      destroyRef.onDestroy(() => desktop.removeEventListener('change', onChange));
    }

    destroyRef.onDestroy(() => this.closeEverything());

    // The bar grows when text is enlarged or translated, so its height is measured, not assumed.
    // Removed again with the shell, so a client's pages read zero.
    const root = this.document.documentElement;
    afterNextRender(() => {
      const bar = this.topbar()?.nativeElement;
      if (bar === undefined || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() =>
        root.style.setProperty(TOPBAR_BLOCK_SIZE, `${bar.getBoundingClientRect().height}px`),
      );
      observer.observe(bar);
      destroyRef.onDestroy(() => observer.disconnect());
    });
    destroyRef.onDestroy(() => root.style.removeProperty(TOPBAR_BLOCK_SIZE));
  }

  // ---------- menus (disclosure pattern: a button that shows and hides a panel) ----------

  protected toggleMenu(menu: ShellMenu): void {
    this.openMenu.update((open) => (open === menu ? null : menu));
  }

  /** Escape closes the open menu and returns focus to the button that opened it. */
  protected closeMenuFromKeyboard(event: Event): void {
    const menu = this.openMenu();
    if (menu === null) return;
    event.stopPropagation();
    this.openMenu.set(null);
    this.triggerOf(menu)?.focus();
  }

  /** Tabbing out of an open menu closes it; focus has already moved on, so it is left there. */
  protected closeMenuOnFocusOut(event: FocusEvent, menu: ShellMenu): void {
    const next = event.relatedTarget as Node | null;
    if (this.openMenu() === menu && next !== null && !this.areaOf(menu)?.contains(next)) {
      this.openMenu.set(null);
    }
  }

  protected closeMenuOnOutsideClick(event: MouseEvent): void {
    const open = this.openMenu();
    if (open !== null && !this.areaOf(open)?.contains(event.target as Node)) {
      this.openMenu.set(null);
    }
  }

  protected chooseWorkspace(tenantId: string): void {
    this.openMenu.set(null);
    this.workspaceButton()?.nativeElement.focus();
    if (tenantId !== this.tenants.selectedTenantId()) {
      this.workspaceSelected.emit(tenantId);
    }
  }

  protected requestSignOut(): void {
    this.closeEverything();
    this.signOut.emit();
  }

  // ---------- narrow-width navigation dialog ----------

  protected openNav(): void {
    this.openMenu.set(null);
    const dialog = this.navDialog()?.nativeElement;
    if (dialog === undefined) return;
    if (!dialog.open) dialog.showModal();
    this.navOpen.set(true);
  }

  /** Escape: handled here rather than by the browser, so focus return is the same on every path. */
  protected cancelNav(event: Event): void {
    event.preventDefault();
    this.closeNav(true);
  }

  protected closeNav(restoreFocus: boolean): void {
    const dialog = this.navDialog()?.nativeElement;
    if (dialog?.open) dialog.close();
    this.navOpen.set(false);
    if (restoreFocus) this.menuButton()?.nativeElement.focus();
  }

  private closeEverything(): void {
    this.openMenu.set(null);
    this.closeNav(false);
  }

  private areaOf(menu: ShellMenu): HTMLElement | undefined {
    return (menu === 'workspace' ? this.workspaceArea() : this.accountArea())?.nativeElement;
  }

  private triggerOf(menu: ShellMenu): HTMLElement | undefined {
    return (menu === 'workspace' ? this.workspaceButton() : this.accountButton())?.nativeElement;
  }
}

import { DOCUMENT, formatNumber, NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  LOCALE_ID,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';
import { AuthStore } from '../core/auth/auth.store';
import { tenantRoleLabel } from '../core/i18n/role-labels';
import { NotificationStore } from '../core/notifications/notification.store';
import { TenantContext } from '../core/tenancy/tenant-context';
import { TenantStore } from '../core/tenancy/tenant.store';
import { WorkspaceBrandStore } from '../core/theme/workspace-brand.store';
import { Avatar } from '../ui/avatar';
import { Button, IconButton } from '../ui/button';
import { Icon } from '../ui/icon';
import { CoachNav } from './coach-nav';
import { countDisplay } from './coach-navigation';
// A type alone: the palette's code is loaded on the first Ctrl+K, never in the first download.
import type { PaletteHandle } from './command-palette';
import { initialsOf } from './initials';
import { ThemeSwitch, ThemeSwitchArt } from './theme-switch';

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
    // Only inside the account menu's @defer block, which keeps them out of the first download.
    ThemeSwitch,
    ThemeSwitchArt,
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
  private readonly injector = inject(Injector);
  protected readonly auth = inject(AuthStore);
  protected readonly tenants = inject(TenantStore);
  protected readonly notifications = inject(NotificationStore);
  protected readonly spaceBrand = inject(WorkspaceBrandStore);
  protected readonly brandInitials = computed(() => initialsOf(this.spaceBrand.name() ?? 'TB Gym'));

  /** A different workspace was chosen. The app selects it and owns what happens next. */
  readonly workspaceSelected = output<string>();
  /** Sign out was chosen. The app clears the badges, signs out and navigates. */
  readonly signOut = output<void>();

  protected readonly openMenu = signal<ShellMenu | null>(null);
  protected readonly navOpen = signal(false);

  /** Whether the sidebar is shown; the palette (motion plan W14) exists at that width alone. */
  private readonly desktop: MediaQueryList | undefined;
  /** The open palette, or null; a request number lets a close cancel an opening still loading. */
  private palette: PaletteHandle | null = null;
  private paletteRequest = 0;

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
    this.desktop = desktop;
    if (desktop) {
      const onChange = (event: MediaQueryListEvent) => {
        if (event.matches) this.closeNav(false);
      };
      desktop.addEventListener('change', onChange);
      destroyRef.onDestroy(() => desktop.removeEventListener('change', onChange));
    }

    // A plain listener rather than a host one, so a key pressed anywhere in the app does not run
    // the shell's change detection; the palette's own signals do that once it is open.
    const onKeydown = (event: KeyboardEvent) => this.togglePaletteOnShortcut(event);
    this.document.addEventListener('keydown', onKeydown);
    destroyRef.onDestroy(() => this.document.removeEventListener('keydown', onKeydown));

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

  /**
   * A press on one of the menu's links to TB Gym's own pages (notes plan N2): the menu closes at
   * once and focus goes back to its button. A page that asks before it is left then returns focus
   * there after "Stay", where the link itself would be gone; and a press on the page already open,
   * which navigates nowhere, still closes the menu.
   */
  protected closeForLink(): void {
    this.openMenu.set(null);
    this.accountButton()?.nativeElement.focus();
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

  // ---------- the palette (motion plan W14) ----------

  /**
   * Ctrl+K, or Cmd+K on a Mac, opens the palette where the sidebar shows (on a phone it does not
   * exist), and closes it again; the browser's own meaning of the key is taken. A modal dialog
   * already open keeps it (the page behind one is inert, the palette would be too). The palette's
   * code is fetched on the first press.
   */
  protected togglePaletteOnShortcut(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    if (event.key.toLowerCase() !== 'k') return;
    if (!this.desktop?.matches) return;
    event.preventDefault();
    if (this.palette) {
      this.palette.close();
      return;
    }
    if (this.document.querySelector('dialog[open]')) return;
    const request = ++this.paletteRequest;
    void import('./command-palette').then(({ openCommandPalette }) => {
      // Closed or moved on meanwhile (a workspace switch, a sign-out): nothing opens late.
      if (request !== this.paletteRequest || this.palette) return;
      this.palette = openCommandPalette(this.injector, () => {
        this.palette = null;
      });
    });
  }

  private closeEverything(): void {
    this.openMenu.set(null);
    this.closeNav(false);
    this.paletteRequest++;
    this.palette?.close();
  }

  private areaOf(menu: ShellMenu): HTMLElement | undefined {
    return (menu === 'workspace' ? this.workspaceArea() : this.accountArea())?.nativeElement;
  }

  private triggerOf(menu: ShellMenu): HTMLElement | undefined {
    return (menu === 'workspace' ? this.workspaceButton() : this.accountButton())?.nativeElement;
  }
}

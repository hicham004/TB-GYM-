import { ApplicationRef, signal } from '@angular/core';
import { type ComponentFixture, DeferBlockBehavior, TestBed } from '@angular/core/testing';
import { NavigationEnd, provideRouter, Router, type Routes } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientListView } from '../../testing/client-list-fixtures';
import { AuthStore } from '../core/auth/auth.store';
import { ClientListApi } from '../features/clients/client-list-api';
import { MessageUnreadStore } from '../core/messaging/message-unread.store';
import { NotificationStore } from '../core/notifications/notification.store';
import { TenantContext } from '../core/tenancy/tenant-context';
import { TenantStore } from '../core/tenancy/tenant.store';
import { WorkspaceBrandStore } from '../core/theme/workspace-brand.store';
import { button, query, settle } from '../../testing/dom';
import { installDialogSupport } from '../../testing/dialog';
import { CoachShell, TOPBAR_BLOCK_SIZE } from './coach-shell';

const USER = {
  id: 'user-1',
  email: 'hicham@example.test',
  displayName: 'Hicham Haddad',
  preferredCulture: 'en-LB',
  emailConfirmed: true,
  roles: [],
};

interface Membership {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: 'Owner' | 'Coach' | 'Client';
}

const ATLAS: Membership = {
  tenantId: 'tenant-atlas',
  tenantName: 'Atlas Performance',
  tenantSlug: 'atlas',
  role: 'Owner',
};

const BEIRUT: Membership = {
  tenantId: 'tenant-beirut',
  tenantName: 'Beirut Barbell',
  tenantSlug: 'beirut',
  role: 'Coach',
};

let uninstallDialog: () => void;

async function render(
  options: {
    memberships?: Membership[];
    unread?: number;
    logoUrl?: string | null;
    roles?: string[];
    /** Pages of a test's own, beside the shell's. */
    routes?: Routes;
  } = {},
) {
  const memberships = options.memberships ?? [ATLAS];
  const brand = {
    name: signal(memberships[0].tenantName),
    logoUrl: signal(options.logoUrl ?? null),
    logoFailed: vi.fn(),
  };
  const selectedTenantId = signal(memberships[0].tenantId);
  await TestBed.configureTestingModule({
    imports: [CoachShell],
    // The account menu is a deferred block, played through as a browser plays it.
    deferBlockBehavior: DeferBlockBehavior.Playthrough,
    providers: [
      provideRouter([
        { path: '', children: [] },
        { path: 'account/security', children: [] },
        { path: 'notifications', children: [] },
        { path: 'clients', children: [] },
        { path: 'training/programs', children: [] },
        { path: 'nutrition/plans', children: [] },
        { path: 'checkins/review', children: [] },
        { path: 'checkins/forms', children: [] },
        { path: 'messages', children: [] },
        { path: 'products', children: [] },
        { path: 'workspace', children: [] },
        // TB Gym's own pages, which the account menu links (notes plan N2).
        { path: 'about', children: [] },
        { path: 'changelog', children: [] },
        ...(options.routes ?? []),
      ]),
      {
        provide: AuthStore,
        useValue: { user: signal({ ...USER, roles: options.roles ?? [] }), loading: signal(false) },
      },
      {
        provide: TenantStore,
        useValue: {
          memberships: signal(memberships),
          selectedTenantId,
          selectedMembership: signal(memberships[0]),
          isOwner: signal(memberships[0].role === 'Owner'),
          canCoach: signal(true),
          isClient: signal(false),
        },
      },
      {
        provide: NotificationStore,
        useValue: { unread: signal(options.unread ?? 0), isAvailable: signal(true) },
      },
      {
        provide: MessageUnreadStore,
        useValue: { unread: signal(0), isAvailable: signal(true) },
      },
      { provide: WorkspaceBrandStore, useValue: brand },
      // The palette (W14) reads the client list once open.
      { provide: ClientListApi, useValue: { getOverview: () => of(clientListView()) } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CoachShell);
  const workspaceSelected = vi.fn();
  const signOut = vi.fn();
  fixture.componentInstance.workspaceSelected.subscribe(workspaceSelected);
  fixture.componentInstance.signOut.subscribe(signOut);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    workspaceSelected,
    signOut,
    context: TestBed.inject(TenantContext),
  };
}

describe('CoachShell', () => {
  beforeEach(() => {
    uninstallDialog = installDialogSupport();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    uninstallDialog();
  });

  it('names the signed-in person and their role from the membership, never a sample', async () => {
    const { host } = await render();

    expect(host.querySelector('.identity-name')?.textContent?.trim()).toBe('Hicham Haddad');
    expect(host.querySelector('.identity-role')?.textContent?.trim()).toBe('Owner');
    expect(host.querySelector('app-avatar')?.textContent?.trim()).toBe('HH');
  });

  it('heads the sidebar with the coaching space, its initials until it has a logo', async () => {
    const { host } = await render();

    const brand = host.querySelector('aside .brand');
    expect(brand?.querySelector('.brand-name')?.textContent?.trim()).toBe('Atlas Performance');
    expect(brand?.querySelector('.brand-descriptor')?.textContent?.trim()).toBe('on TB Gym');
    expect(brand?.querySelector('.brand-mark')?.textContent?.trim()).toBe('AP');
    expect(brand?.querySelector('.brand-mark')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the space’s logo, and asks for it again when the image breaks', async () => {
    const { host } = await render({ logoUrl: '/api/media/logo-1/content' });

    const logo = host.querySelector<HTMLImageElement>('aside .brand-mark.has-logo img');
    expect(logo?.getAttribute('src')).toBe('/api/media/logo-1/content');
    expect(logo?.getAttribute('alt')).toBe('');
    logo?.dispatchEvent(new Event('error'));
    expect(TestBed.inject(WorkspaceBrandStore).logoFailed).toHaveBeenCalledTimes(1);
  });

  it('shows the Coach role of a coach membership', async () => {
    const { host } = await render({ memberships: [BEIRUT] });

    expect(host.querySelector('.identity-role')?.textContent?.trim()).toBe('Coach');
  });

  /** The Figma quick search is not wired to anything, so it is not rendered. */
  it('renders no search box and no keyboard-shortcut hint', async () => {
    const { host } = await render();

    expect(host.querySelector('input[type="search"]')).toBeNull();
    expect(host.textContent).not.toContain('Search clients');
    expect(host.textContent).not.toContain('⌘K');
  });

  it('reaches the inbox, account security and sign-out from the top bar', async () => {
    const { fixture, host, signOut } = await render({ unread: 2 });

    const inbox = host.querySelector('a[href="/notifications"]');
    expect(inbox).not.toBeNull();
    expect(inbox?.textContent).toContain('2 unread');

    const account = host.querySelector<HTMLButtonElement>('.account-button')!;
    expect(account.getAttribute('aria-label')).toContain('Hicham Haddad');
    account.click();
    await settle(fixture);

    expect(host.querySelector('a[href="/account/security"]')).not.toBeNull();
    // Light or dark is switched in the menu, not on a page of its own.
    expect(host.querySelector('a[href="/account/appearance"]')).toBeNull();
    expect(button(host, 'Dark mode').getAttribute('role')).toBe('switch');
    button(host, 'Sign out').click();
    await settle(fixture);

    expect(signOut).toHaveBeenCalledTimes(1);
    // Nothing is left open behind the sign-out request.
    expect(host.querySelector('#account-menu')).toBeNull();
  });

  it('lists the platform admin’s pages in the account menu, Coaches last, only for the admin', async () => {
    const admin = await render({ roles: ['PlatformAdmin'] });
    admin.host.querySelector<HTMLButtonElement>('.account-button')!.click();
    await settle(admin.fixture);

    const links = Array.from(admin.host.querySelectorAll<HTMLAnchorElement>('#account-menu a'))
      .map((link) => [link.textContent?.trim(), link.getAttribute('href')])
      .filter(([, href]) => href?.startsWith('/admin/'));
    expect(links).toEqual([
      ['Platform billing', '/admin/billing'],
      ['Legal documents', '/admin/legal'],
      ['Coaches', '/admin/coaches'],
    ]);
    TestBed.resetTestingModule();

    const owner = await render();
    owner.host.querySelector<HTMLButtonElement>('.account-button')!.click();
    await settle(owner.fixture);
    expect(owner.host.querySelector('#account-menu')).not.toBeNull();
    expect(owner.host.querySelector('#account-menu a[href^="/admin/"]')).toBeNull();
  });

  it('opens the account menu as a disclosure and closes it on Escape, back to its button', async () => {
    const { fixture, host } = await render();
    const account = host.querySelector<HTMLButtonElement>('.account-button')!;

    account.click();
    await settle(fixture);
    expect(account.getAttribute('aria-expanded')).toBe('true');

    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(fixture);

    expect(host.querySelector('#account-menu')).toBeNull();
    expect(account.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(account);
  });

  it('opens a working account menu at the first press, before the page has been idle', async () => {
    // A page still busy: idle never comes, so the press itself fetches the menu's deferred part.
    vi.stubGlobal('requestIdleCallback', () => 0);
    vi.stubGlobal('cancelIdleCallback', () => undefined);
    try {
      const { fixture, host } = await render();
      const account = host.querySelector<HTMLButtonElement>('.account-button')!;

      account.click();
      await settle(fixture);

      expect(account.getAttribute('aria-expanded')).toBe('true');
      expect(button(host, 'Dark mode').getAttribute('role')).toBe('switch');
      expect(host.querySelector('#account-menu a[href="/account/security"]')).not.toBeNull();

      host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle(fixture);
      expect(host.querySelector('#account-menu')).toBeNull();
      expect(document.activeElement).toBe(account);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('closes an open menu when a click lands outside it', async () => {
    const { fixture, host } = await render();
    host.querySelector<HTMLButtonElement>('.account-button')!.click();
    await settle(fixture);

    document.body.click();
    await settle(fixture);

    expect(host.querySelector('#account-menu')).toBeNull();
  });

  /**
   * TB Gym's own pages from inside the app: the homepage at /about, which leads back with Back to
   * Today, and What changed. The coach shell is an owner's and a coach's alone, so a client's pages
   * gain nothing.
   */
  describe('N2: TB Gym’s own pages in the account menu', () => {
    const words = (element: Element | null | undefined) =>
      (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

    async function openAccountMenu(fixture: ComponentFixture<unknown>, host: HTMLElement) {
      const account = query<HTMLButtonElement>(host, '.account-button');
      account.click();
      await settle(fixture);
      return { account, menu: query<HTMLElement>(host, '#account-menu') };
    }

    /** The menu's rows from top to bottom, each by the words on it; the group by its heading. */
    function rows(menu: HTMLElement): string[] {
      return Array.from(menu.querySelectorAll(':scope > ul.menu-list > li')).map((row) =>
        words(row.querySelector(':scope > a, :scope > button, :scope > .menu-heading')),
      );
    }

    function link(menu: HTMLElement, label: string): HTMLAnchorElement {
      const found = Array.from(menu.querySelectorAll<HTMLAnchorElement>('a')).filter(
        (candidate) => words(candidate) === label,
      );
      if (found.length !== 1) throw new Error(`${found.length} links read "${label}".`);
      return found[0];
    }

    /** The addresses the router has arrived at since now. */
    function arrivals(): string[] {
      const ended: string[] = [];
      TestBed.inject(Router).events.subscribe((event) => {
        if (event instanceof NavigationEnd) ended.push(event.urlAfterRedirects);
      });
      return ended;
    }

    /** A navigation its page holds never lets settle() return: a few turns and a redraw instead. */
    async function turns(fixture: ComponentFixture<unknown>): Promise<void> {
      for (let round = 0; round < 5; round++) {
        await new Promise((resolve) => setTimeout(resolve));
        fixture.detectChanges();
      }
    }

    for (const { who, membership } of [
      { who: 'an owner', membership: ATLAS },
      { who: 'a coach', membership: BEIRUT },
    ]) {
      it(`gives ${who} a TB Gym group after Dark mode, with the website and What changed, before Sign out`, async () => {
        const { fixture, host } = await render({ memberships: [membership] });
        expect(words(host.querySelector('.identity-role'))).toBe(membership.role);
        const { menu } = await openAccountMenu(fixture, host);

        expect(rows(menu)).toEqual(['Password and security', 'Dark mode', 'TB Gym', 'Sign out']);

        // A heading and the list it names, as the workspace panel's "Coaching spaces" is.
        const group = query<HTMLElement>(menu, ':scope > ul.menu-list > li.menu-group');
        const heading = query<HTMLElement>(group, ':scope > .menu-heading');
        expect(heading.id).toBe('website-menu-heading');
        expect(words(heading)).toBe('TB Gym');
        expect(host.querySelectorAll('#website-menu-heading')).toHaveLength(1);
        const list = query<HTMLElement>(group, ':scope > ul.menu-list');
        expect(list.getAttribute('aria-labelledby')).toBe(heading.id);

        // Exactly two rows, each one link.
        expect(Array.from(list.children).map((row) => row.tagName)).toEqual(['LI', 'LI']);
        expect(
          Array.from(list.querySelectorAll('a, button')).map((control) => [
            control.tagName,
            words(control),
            control.getAttribute('href'),
          ]),
        ).toEqual([
          ['A', 'TB Gym website', '/about'],
          ['A', 'What changed', '/changelog'],
        ]);

        // What a keyboard walks through, in order.
        expect(Array.from(menu.querySelectorAll('a, button')).map(words)).toEqual([
          'Password and security',
          'Dark mode',
          'TB Gym website',
          'What changed',
          'Sign out',
        ]);
      });
    }

    it('keeps the group between Dark mode and the platform admin’s rows, Sign out still last', async () => {
      const { fixture, host } = await render({ roles: ['PlatformAdmin'] });
      const { menu } = await openAccountMenu(fixture, host);

      expect(rows(menu)).toEqual([
        'Password and security',
        'Dark mode',
        'TB Gym',
        'Platform billing',
        'Legal documents',
        'Coaches',
        'Sign out',
      ]);
      // The admin's rows are the menu's own, not the group's.
      expect(
        Array.from(menu.querySelectorAll('[aria-labelledby="website-menu-heading"] a')).map(
          (anchor) => [words(anchor), anchor.getAttribute('href')],
        ),
      ).toEqual([
        ['TB Gym website', '/about'],
        ['What changed', '/changelog'],
      ]);
    });

    for (const { label, address } of [
      { label: 'TB Gym website', address: '/about' },
      { label: 'What changed', address: '/changelog' },
    ]) {
      it(`closes the menu and puts focus on the account button the moment “${label}” is pressed, then opens ${address}`, async () => {
        const { fixture, host } = await render();
        const { account, menu } = await openAccountMenu(fixture, host);
        const ended = arrivals();
        expect(document.activeElement).not.toBe(account);

        link(menu, label).click();

        // At once, by the press itself: no page has been reached yet.
        expect(ended).toEqual([]);
        expect(document.activeElement).toBe(account);
        fixture.detectChanges();
        expect(host.querySelector('#account-menu')).toBeNull();
        expect(account.getAttribute('aria-expanded')).toBe('false');

        await settle(fixture);
        expect(ended).toEqual([address]);
        expect(TestBed.inject(Router).url).toBe(address);
        expect(host.querySelector('#account-menu')).toBeNull();
        expect(document.activeElement).toBe(account);
      });
    }

    it('closes the menu on a press of the page already open, which goes nowhere', async () => {
      const { fixture, host } = await render();
      const router = TestBed.inject(Router);
      await router.navigateByUrl('/changelog');
      await settle(fixture);
      const { account, menu } = await openAccountMenu(fixture, host);
      const ended = arrivals();

      link(menu, 'What changed').click();
      await settle(fixture);

      // No navigation ended to close it, as one closes every menu.
      expect(ended).toEqual([]);
      expect(router.url).toBe('/changelog');
      expect(host.querySelector('#account-menu')).toBeNull();
      expect(account.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(account);
    });

    it('leaves the menu closed and focus on its button when the page being left asks first', async () => {
      let answer!: (leave: boolean) => void;
      const asked = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
      const { fixture, host } = await render({
        routes: [{ path: 'editor', canDeactivate: [asked], children: [] }],
      });
      const router = TestBed.inject(Router);
      await router.navigateByUrl('/editor');
      await settle(fixture);

      const first = await openAccountMenu(fixture, host);
      link(first.menu, 'TB Gym website').click();
      await turns(fixture);

      // The page is asking: the menu is not left open over its question.
      expect(asked).toHaveBeenCalledTimes(1);
      expect(router.url).toBe('/editor');
      expect(host.querySelector('#account-menu')).toBeNull();
      expect(document.activeElement).toBe(first.account);

      // Stay: the person is where they were, with focus on the button whose link is gone.
      answer(false);
      await settle(fixture);
      expect(router.url).toBe('/editor');
      expect(host.querySelector('#account-menu')).toBeNull();
      expect(first.account.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(first.account);

      // Pressed again, then Leave.
      const second = await openAccountMenu(fixture, host);
      link(second.menu, 'TB Gym website').click();
      await turns(fixture);
      expect(asked).toHaveBeenCalledTimes(2);
      answer(true);
      await settle(fixture);
      expect(router.url).toBe('/about');
      expect(host.querySelector('#account-menu')).toBeNull();
    });

    it('closes on Escape from one of the group’s links, back to the account button, going nowhere', async () => {
      const { fixture, host } = await render();
      const { account, menu } = await openAccountMenu(fixture, host);
      const ended = arrivals();
      const changed = link(menu, 'What changed');
      changed.focus();
      expect(document.activeElement).toBe(changed);

      changed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle(fixture);

      expect(host.querySelector('#account-menu')).toBeNull();
      expect(account.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(account);
      expect(ended).toEqual([]);
    });
  });

  it('shows the workspace as plain text when there is only one', async () => {
    const { host } = await render();

    expect(host.querySelector('.workspace-context')?.textContent).toContain('Atlas Performance');
    expect(host.querySelector('.workspace-button')).toBeNull();
  });

  it('offers every workspace and asks the app to switch to the chosen one', async () => {
    const { fixture, host, workspaceSelected } = await render({ memberships: [ATLAS, BEIRUT] });
    const switcher = host.querySelector<HTMLButtonElement>('.workspace-button')!;

    switcher.click();
    await settle(fixture);
    const options = Array.from(host.querySelectorAll('#workspace-menu .menu-item'));
    expect(options.map((option) => option.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Atlas PerformanceOwner(current)',
      'Beirut BarbellCoach',
    ]);
    // The current workspace is marked, and not by colour alone.
    expect(options[0].getAttribute('aria-current')).toBe('true');
    expect(options[0].querySelector('app-icon')).not.toBeNull();

    (options[1] as HTMLButtonElement).click();
    await settle(fixture);

    expect(workspaceSelected).toHaveBeenCalledWith('tenant-beirut');
    expect(host.querySelector('#workspace-menu')).toBeNull();
    expect(document.activeElement).toBe(switcher);
  });

  it('asks for nothing when the workspace already selected is chosen again', async () => {
    const { fixture, host, workspaceSelected } = await render({ memberships: [ATLAS, BEIRUT] });
    host.querySelector<HTMLButtonElement>('.workspace-button')!.click();
    await settle(fixture);

    host.querySelector<HTMLButtonElement>('#workspace-menu .menu-item')!.click();
    await settle(fixture);

    expect(workspaceSelected).not.toHaveBeenCalled();
  });

  /**
   * A menu belongs to one workspace. When the tenant context is invalidated — a switch, a sign-out,
   * a membership that has gone — anything open for the previous one is closed immediately rather
   * than left on screen to be acted on.
   */
  it('closes menus and the navigation dialog when the tenant context changes', async () => {
    const { fixture, host, context } = await render({ memberships: [ATLAS, BEIRUT] });
    host.querySelector<HTMLButtonElement>('.workspace-button')!.click();
    await settle(fixture);
    expect(host.querySelector('#workspace-menu')).not.toBeNull();

    context.invalidate();
    await settle(fixture);

    expect(host.querySelector('#workspace-menu')).toBeNull();
  });

  it('opens the navigation dialog from the Menu button and closes it on Escape', async () => {
    const { fixture, host } = await render();
    const menu = host.querySelector<HTMLButtonElement>('.menu-button')!;
    const dialog = host.querySelector<HTMLDialogElement>('dialog')!;

    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(dialog.open).toBe(false);

    menu.click();
    await settle(fixture);
    expect(dialog.open).toBe(true);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    // The same navigation, rendered only while the dialog is open.
    expect(dialog.querySelectorAll('app-coach-nav')).toHaveLength(1);

    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    await settle(fixture);

    expect(dialog.open).toBe(false);
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(menu);
  });

  it('closes the navigation dialog when a destination inside it is followed', async () => {
    const { fixture, host } = await render();
    host.querySelector<HTMLButtonElement>('.menu-button')!.click();
    await settle(fixture);

    const dialog = host.querySelector<HTMLDialogElement>('dialog')!;
    dialog.querySelector<HTMLAnchorElement>('a[href="/clients"]')!.click();
    await settle(fixture);

    expect(dialog.open).toBe(false);
  });

  it('publishes its height for sticky page elements, and takes it away when it goes', async () => {
    // jsdom has no layout, so the observer reports once on observe and the height reads as 0px.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly report: () => void) {}
        observe(): void {
          this.report();
        }
        disconnect(): void {
          // Nothing to release.
        }
      },
    );
    const root = document.documentElement.style;
    try {
      const { fixture } = await render();
      expect(root.getPropertyValue(TOPBAR_BLOCK_SIZE)).toBe('0px');

      fixture.destroy();
      expect(root.getPropertyValue(TOPBAR_BLOCK_SIZE)).toBe('');
    } finally {
      vi.unstubAllGlobals();
      root.removeProperty(TOPBAR_BLOCK_SIZE);
    }
  });

  it('holds no second navigation while the dialog is closed', async () => {
    const { host } = await render();

    expect(host.querySelectorAll('app-coach-nav')).toHaveLength(1);
    expect(host.querySelectorAll('nav[aria-label="Primary navigation"]')).toHaveLength(1);
  });

  describe('W14: the palette on Ctrl+K', () => {
    /** The shell reads whether the sidebar shows; jsdom has no matchMedia of its own. */
    function sidebar(shown: boolean): void {
      Object.defineProperty(document.defaultView, 'matchMedia', {
        configurable: true,
        writable: true,
        value: vi.fn(() => ({
          matches: shown,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      });
    }

    const palette = () =>
      document.querySelector<HTMLElement>('[role="dialog"][aria-label="Go to a page or a client"]');

    function shortcut(init: KeyboardEventInit = {}): KeyboardEvent {
      const event = new KeyboardEvent('keydown', {
        key: 'k',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        ...init,
      });
      document.dispatchEvent(event);
      return event;
    }

    /** The palette's code is fetched on the press; a few turns let it land and draw. */
    async function loaded(): Promise<void> {
      for (let round = 0; round < 10; round++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        TestBed.inject(ApplicationRef).tick();
      }
    }

    afterEach(() => {
      delete (document.defaultView as { matchMedia?: unknown }).matchMedia;
      document.querySelector('.cdk-overlay-container')?.remove();
    });

    it('opens where the sidebar shows, takes the key, focuses its field, and a second press closes it', async () => {
      sidebar(true);
      await render();

      const press = shortcut();
      await loaded();

      expect(press.defaultPrevented).toBe(true);
      expect(palette()).not.toBeNull();
      expect(document.activeElement?.getAttribute('role')).toBe('combobox');

      shortcut();
      await loaded();
      expect(palette()).toBeNull();
    });

    it('opens on Cmd+K too, and not on Ctrl+Shift+K or a plain K', async () => {
      sidebar(true);
      await render();

      expect(shortcut({ ctrlKey: false, shiftKey: true }).defaultPrevented).toBe(false);
      expect(shortcut({ ctrlKey: false }).defaultPrevented).toBe(false);
      await loaded();
      expect(palette()).toBeNull();

      expect(shortcut({ ctrlKey: false, metaKey: true }).defaultPrevented).toBe(true);
      await loaded();
      expect(palette()).not.toBeNull();
    });

    it('does not exist below the sidebar’s width', async () => {
      sidebar(false);
      await render();

      expect(shortcut().defaultPrevented).toBe(false);
      await loaded();
      expect(palette()).toBeNull();
    });

    it('closes when the tenant context changes', async () => {
      sidebar(true);
      const { context } = await render({ memberships: [ATLAS, BEIRUT] });
      shortcut();
      await loaded();
      expect(palette()).not.toBeNull();

      context.invalidate();
      await loaded();

      expect(palette()).toBeNull();
    });
  });
});

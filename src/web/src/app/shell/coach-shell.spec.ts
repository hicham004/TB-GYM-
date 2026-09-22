import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthStore } from '../core/auth/auth.store';
import { MessageUnreadStore } from '../core/messaging/message-unread.store';
import { NotificationStore } from '../core/notifications/notification.store';
import { TenantContext } from '../core/tenancy/tenant-context';
import { TenantStore } from '../core/tenancy/tenant.store';
import { button, settle } from '../../testing/dom';
import { installDialogSupport } from '../../testing/dialog';
import { CoachShell } from './coach-shell';

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

async function render(options: { memberships?: Membership[]; unread?: number } = {}) {
  const memberships = options.memberships ?? [ATLAS];
  const selectedTenantId = signal(memberships[0].tenantId);
  await TestBed.configureTestingModule({
    imports: [CoachShell],
    providers: [
      provideRouter([
        { path: '', children: [] },
        { path: 'account/security', children: [] },
        { path: 'notifications', children: [] },
        { path: 'clients', children: [] },
        { path: 'training/programs', children: [] },
        { path: 'nutrition/library', children: [] },
        { path: 'checkins/forms', children: [] },
        { path: 'messages', children: [] },
        { path: 'products', children: [] },
        { path: 'workspace', children: [] },
      ]),
      {
        provide: AuthStore,
        useValue: { user: signal(USER), loading: signal(false) },
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
    button(host, 'Sign out').click();
    await settle(fixture);

    expect(signOut).toHaveBeenCalledTimes(1);
    // Nothing is left open behind the sign-out request.
    expect(host.querySelector('#account-menu')).toBeNull();
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

  it('closes an open menu when a click lands outside it', async () => {
    const { fixture, host } = await render();
    host.querySelector<HTMLButtonElement>('.account-button')!.click();
    await settle(fixture);

    document.body.click();
    await settle(fixture);

    expect(host.querySelector('#account-menu')).toBeNull();
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

  it('holds no second navigation while the dialog is closed', async () => {
    const { host } = await render();

    expect(host.querySelectorAll('app-coach-nav')).toHaveLength(1);
    expect(host.querySelectorAll('nav[aria-label="Primary navigation"]')).toHaveLength(1);
  });
});

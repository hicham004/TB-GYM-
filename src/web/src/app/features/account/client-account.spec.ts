import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientAccessStore } from '../../core/access/client-access.store';
import { ApiClient } from '../../core/api/api-client';
import type { CurrentUser, TenantMembership } from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { SessionActions } from '../../core/auth/session-actions';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { click, press, settle } from '../../../testing/dom';
import { fakeClientAccess } from '../../../testing/today-fixtures';
import { ClientAccount } from './client-account';

// `/api/tenants` orders by workspace name, so the selected workspace is deliberately not the first.
const ALPHA = {
  tenantId: 'tenant-alpha',
  tenantName: 'Alpha Strength',
  role: 'Client',
} as TenantMembership;
const ATLAS = {
  tenantId: 'tenant-atlas',
  tenantName: 'Atlas Performance',
  role: 'Client',
} as TenantMembership;

const MAYA = {
  id: 'maya',
  displayName: 'Maya Rahman',
  email: 'maya@example.test',
  roles: [] as string[],
  preferredThemeMode: 'system',
  preferredWeightUnit: 'Kilogram',
} as CurrentUser;

async function render(
  options: {
    memberships?: TenantMembership[];
    roles?: string[];
    coach?: 'Lea Haddad' | 'unreadable';
    messaging?: 'Granted' | 'NoEntitlement';
    updateWeightUnit?: (unit: CurrentUser['preferredWeightUnit']) => Promise<void>;
    updateThemeMode?: (mode: CurrentUser['preferredThemeMode']) => Promise<void>;
  } = {},
) {
  const user = signal<CurrentUser>({ ...MAYA, roles: options.roles ?? [] });
  const weightUnit = computed(() => user().preferredWeightUnit);
  const auth = {
    user,
    weightUnit,
    updateWeightUnit: vi.fn(async (unit: CurrentUser['preferredWeightUnit']) => {
      await options.updateWeightUnit?.(unit);
      user.update((current) => ({ ...current, preferredWeightUnit: unit }));
    }),
    updateThemeMode: vi.fn(async (mode: CurrentUser['preferredThemeMode']) => {
      await options.updateThemeMode?.(mode);
      user.update((current) => ({ ...current, preferredThemeMode: mode }));
    }),
  };
  const session = { switchWorkspace: vi.fn(), signOut: vi.fn().mockResolvedValue(undefined) };
  const selectedTenantId = signal('tenant-atlas');
  const api = {
    getOwnCoach: vi.fn(() =>
      options.coach === 'unreadable'
        ? throwError(() => new Error('forbidden'))
        : of({ name: 'Lea Haddad' }),
    ),
  };
  await TestBed.configureTestingModule({
    imports: [ClientAccount],
    providers: [
      provideRouter([]),
      { provide: SessionActions, useValue: session },
      { provide: AuthStore, useValue: auth },
      { provide: ApiClient, useValue: api },
      {
        provide: ClientAccessStore,
        useValue: fakeClientAccess(
          options.messaging === 'NoEntitlement' ? { Messaging: 'NoEntitlement' } : {},
        ),
      },
      {
        provide: TenantStore,
        useValue: {
          memberships: signal(options.memberships ?? [ATLAS]),
          selectedTenantId,
        },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(ClientAccount);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    session,
    auth,
    api,
    selectedTenantId,
  };
}

const radio = (host: HTMLElement, value: string) =>
  host.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)!;
const alert = (host: HTMLElement) => host.querySelector('[role="alert"]')?.textContent?.trim();

describe('ClientAccount', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('names the account and links the screens that are about it', async () => {
    const { host } = await render();

    expect(host.querySelector('h1')?.textContent?.trim()).toBe('Me');
    expect(host.querySelector('h2')?.textContent?.trim()).toBe('Maya Rahman');
    expect(host.textContent).toContain('maya@example.test');
    expect(host.querySelector('app-avatar')?.textContent?.trim()).toBe('MR');
    const links = [...host.querySelectorAll('.rows a')].map((link) => link.getAttribute('href'));
    expect(links).toEqual(['/profile', '/notifications/settings', '/account/security']);
    // The weight history is reached from Progress, not from here.
    expect(host.querySelector('a[href="/progress"]')).toBeNull();
  });

  it('says only what it means: no workspace, no system words', async () => {
    const { host } = await render({ memberships: [ALPHA, ATLAS] });

    expect(host.textContent).not.toMatch(/workspace|tenant|enrollment|account menu/i);
  });

  it('shows the coach as a link to the chat when messaging is in the plan', async () => {
    const { host, api } = await render();

    expect(api.getOwnCoach).toHaveBeenCalledTimes(1);
    const coach = host.querySelector('a.coach');
    expect(coach?.getAttribute('href')).toBe('/messages');
    expect(coach?.textContent).toContain('Your coach');
    expect(coach?.textContent).toContain('Lea Haddad');
    expect(coach?.querySelector('app-avatar')?.textContent?.trim()).toBe('LH');
  });

  it('shows the coach as plain text when messaging is not in the plan', async () => {
    const { host } = await render({ messaging: 'NoEntitlement' });

    expect(host.querySelector('a.coach')).toBeNull();
    expect(host.querySelector('.coach')?.textContent).toContain('Lea Haddad');
  });

  it('leaves the coach line out, with no error, when the coach cannot be read', async () => {
    const { host } = await render({ coach: 'unreadable' });

    expect(host.querySelector('.coach')).toBeNull();
    expect(alert(host)).toBe('');
  });

  it('reads the coach again for another workspace, and never shows the old one meanwhile', async () => {
    const { fixture, host, api, selectedTenantId } = await render();
    expect(host.querySelector('.coach')).not.toBeNull();

    selectedTenantId.set('tenant-alpha');
    fixture.detectChanges();
    expect(host.querySelector('.coach')).toBeNull();
    await settle(fixture);

    expect(api.getOwnCoach).toHaveBeenCalledTimes(2);
    expect(host.querySelector('.coach')).not.toBeNull();
  });

  it('offers no coach list to a client with one coach', async () => {
    const { host } = await render();
    expect(host.textContent).not.toContain('Your coaches');
  });

  it('marks the open coach and switches to another through the shared path', async () => {
    const { fixture, host, session } = await render({ memberships: [ALPHA, ATLAS] });

    const current = host.querySelector('[aria-current="true"]');
    expect(current?.textContent).toContain('Atlas Performance');
    expect(current?.tagName).toBe('P');
    // The name a screen reader gives the button: its text, without the decorative initials.
    const other = [...host.querySelectorAll<HTMLButtonElement>('button.row')].find(
      (row) =>
        row.querySelector('.row-text')?.textContent?.replace(/\s+/g, ' ').trim() ===
        'Switch to Alpha Strength, Client',
    );
    expect(other).toBeDefined();
    other?.click();
    await settle(fixture);

    expect(session.switchWorkspace).toHaveBeenCalledWith('tenant-alpha');
  });

  it('signs out through the shared sequence', async () => {
    const { fixture, host, session } = await render();

    press(host, 'Sign out');
    await settle(fixture);

    expect(session.signOut).toHaveBeenCalledTimes(1);
  });

  it('links platform billing only for a platform admin', async () => {
    const admin = await render({ roles: ['PlatformAdmin'] });
    expect(admin.host.querySelector('a[href="/admin/billing"]')).not.toBeNull();
    TestBed.resetTestingModule();

    const client = await render();
    expect(client.host.querySelector('a[href="/admin/billing"]')).toBeNull();
  });
});

describe('ClientAccount preferences', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows what the account has saved', async () => {
    const { host } = await render();

    expect(radio(host, 'system').checked).toBe(true);
    expect(radio(host, 'Kilogram').checked).toBe(true);
    expect(host.querySelector('fieldset legend')?.textContent).toBe('Appearance');
  });

  it('saves the weight unit as it is chosen', async () => {
    const { fixture, host, auth } = await render();

    click(host, 'input[value="Pound"]');
    await settle(fixture);

    expect(auth.updateWeightUnit).toHaveBeenCalledWith('Pound');
    expect(radio(host, 'Pound').checked).toBe(true);
    expect(alert(host)).toBe('');
  });

  it('saves light or dark as it is chosen', async () => {
    const { fixture, host, auth } = await render();

    click(host, 'input[value="dark"]');
    await settle(fixture);

    expect(auth.updateThemeMode).toHaveBeenCalledWith('dark');
    expect(radio(host, 'dark').checked).toBe(true);
  });

  it('shows a choice at once, before the account has answered', async () => {
    let answer!: () => void;
    const { fixture, host } = await render({
      updateWeightUnit: () => new Promise<void>((resolve) => (answer = resolve)),
    });

    click(host, 'input[value="Pound"]');
    await settle(fixture);
    expect(radio(host, 'Pound').checked).toBe(true);

    answer();
    await settle(fixture);
    expect(radio(host, 'Pound').checked).toBe(true);
  });

  it('puts the control back where the account has it, and says so, when a save is refused', async () => {
    const { fixture, host } = await render({
      updateWeightUnit: () => Promise.reject(new Error('refused')),
    });

    click(host, 'input[value="Pound"]');
    await settle(fixture);

    expect(radio(host, 'Kilogram').checked).toBe(true);
    expect(radio(host, 'Pound').checked).toBe(false);
    expect(alert(host)).toBe('Couldn’t save your choice. Try again.');
  });

  it('clears the message when the next save works', async () => {
    let refuse = true;
    const { fixture, host } = await render({
      updateWeightUnit: () => (refuse ? Promise.reject(new Error('refused')) : Promise.resolve()),
    });
    click(host, 'input[value="Pound"]');
    await settle(fixture);
    expect(alert(host)).not.toBe('');

    refuse = false;
    click(host, 'input[value="Pound"]');
    await settle(fixture);

    expect(alert(host)).toBe('');
    expect(radio(host, 'Pound').checked).toBe(true);
  });

  it('keeps the latest choice on screen while an earlier save of the same setting is still answering', async () => {
    const answers: (() => void)[] = [];
    const { fixture, host, auth } = await render({
      updateThemeMode: () => new Promise<void>((resolve) => answers.push(resolve)),
    });

    click(host, 'input[value="dark"]');
    await settle(fixture);
    click(host, 'input[value="light"]');
    await settle(fixture);
    expect(radio(host, 'light').checked).toBe(true);

    // The first answer lands, so the account says dark; the screen has moved on to light.
    answers[0]();
    await settle(fixture);
    expect(radio(host, 'light').checked).toBe(true);
    expect(radio(host, 'dark').checked).toBe(false);

    answers[1]();
    await settle(fixture);
    expect(radio(host, 'light').checked).toBe(true);
    expect(auth.updateThemeMode.mock.calls.map(([mode]) => mode)).toEqual(['dark', 'light']);
  });

  it('saves a choice that undoes the one before it, even though the account has not changed yet', async () => {
    const answers: (() => void)[] = [];
    const { fixture, host, auth } = await render({
      updateWeightUnit: () => new Promise<void>((resolve) => answers.push(resolve)),
    });

    click(host, 'input[value="Pound"]');
    await settle(fixture);
    click(host, 'input[value="Kilogram"]');
    await settle(fixture);

    expect(auth.updateWeightUnit.mock.calls.map(([unit]) => unit)).toEqual(['Pound', 'Kilogram']);
    answers.forEach((answer) => answer());
    await settle(fixture);
    expect(radio(host, 'Kilogram').checked).toBe(true);
  });

  it('does not let a refused save undo a later choice that is still on its way', async () => {
    const answers: { ok: () => void; fail: () => void }[] = [];
    const { fixture, host } = await render({
      updateThemeMode: () =>
        new Promise<void>((resolve, reject) =>
          answers.push({ ok: resolve, fail: () => reject(new Error('refused')) }),
        ),
    });

    click(host, 'input[value="dark"]');
    await settle(fixture);
    click(host, 'input[value="light"]');
    await settle(fixture);

    answers[0].fail();
    await settle(fixture);
    expect(radio(host, 'light').checked).toBe(true);
    expect(alert(host)).toBe('Couldn’t save your choice. Try again.');

    answers[1].ok();
    await settle(fixture);
    expect(radio(host, 'light').checked).toBe(true);
  });

  it('does not let the answer to one setting move a choice of the other that is still on its way', async () => {
    let answerTheme!: () => void;
    const { fixture, host } = await render({
      updateThemeMode: () => new Promise<void>((resolve) => (answerTheme = resolve)),
    });

    click(host, 'input[value="dark"]');
    await settle(fixture);
    click(host, 'input[value="Pound"]');
    await settle(fixture);
    // The unit is saved only after the theme answers; meanwhile the theme choice must stand.
    expect(radio(host, 'dark').checked).toBe(true);
    expect(radio(host, 'Pound').checked).toBe(true);

    answerTheme();
    await settle(fixture);
    expect(radio(host, 'dark').checked).toBe(true);
    expect(radio(host, 'Pound').checked).toBe(true);
  });
});

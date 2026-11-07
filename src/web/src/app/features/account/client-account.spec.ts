import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientAccessStore } from '../../core/access/client-access.store';
import { ApiClient } from '../../core/api/api-client';
import type { CurrentUser, TenantMembership } from '../../core/api/api.models';
import type { OwnCoachLineView } from '../../core/api/generated';
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
    /** The server's word on the coach's Founding coach badge (notes plan N3b); left out when undefined. */
    founding?: boolean;
    /** The coach's certificate lines the server shows this client (notes plan N4b); left out when undefined. */
    lines?: readonly OwnCoachLineView[];
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
        : of({
            name: 'Lea Haddad',
            ...(options.founding === undefined ? {} : { foundingCoach: options.founding }),
            ...(options.lines === undefined ? {} : { lines: options.lines }),
          }),
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
    expect(links).toEqual(['/plan', '/profile', '/notifications/settings', '/account/security']);
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
    // Only the card's place is kept while the new coach is read (audit UIQ-5), never the old name.
    expect(host.querySelector('.coach:not(.coach--waiting)')).toBeNull();
    expect(host.querySelector('.coach--waiting')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.textContent).not.toContain('Lea Haddad');
    await settle(fixture);

    expect(api.getOwnCoach).toHaveBeenCalledTimes(2);
    expect(host.querySelector('.coach:not(.coach--waiting)')).not.toBeNull();
    expect(host.querySelector('.coach--waiting')).toBeNull();
  });

  describe('the coach’s Founding coach badge (notes plan N3b)', () => {
    const NEVER = /\b(verified|certified|qualified|licensed|approved)\b/i;
    const textOf = (element: Element | null | undefined) =>
      (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

    it('shows the badge after the name and its line under it, inside the Message link', async () => {
      const { host } = await render({ founding: true });

      const coach = host.querySelector('a.coach')!;
      expect(coach.getAttribute('href')).toBe('/messages');
      const name = coach.querySelector('[data-founding-coach]')!;
      expect(textOf(name.querySelector('strong'))).toBe('Lea Haddad');
      const pill = name.querySelector('app-status-pill')!;
      expect(textOf(pill)).toBe('Founding coach');
      expect(pill.classList).toContain('success');
      expect(
        name.querySelector('strong')!.compareDocumentPosition(pill) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(textOf(coach.querySelector('.coach-founding'))).toBe(
        'One of the first coaches on TB Gym. Not a check of qualifications',
      );
      // What a screen reader hears, with the commas the card already puts between its parts.
      expect(textOf(coach.querySelector('.coach-text'))).toBe(
        'Your coach, Lea Haddad, Founding coach, One of the first coaches on TB Gym. Not a check of qualifications',
      );
      expect(coach.querySelector('app-avatar')?.textContent?.trim()).toBe('LH');
      expect(textOf(coach)).not.toMatch(NEVER);
    });

    it('shows the same on the plain card when messaging is not in the plan', async () => {
      const { host } = await render({ founding: true, messaging: 'NoEntitlement' });

      expect(host.querySelector('a.coach')).toBeNull();
      const coach = host.querySelector('.coach')!;
      expect(textOf(coach.querySelector('app-status-pill'))).toBe('Founding coach');
      expect(textOf(coach.querySelector('.coach-founding'))).toBe(
        'One of the first coaches on TB Gym. Not a check of qualifications',
      );
    });

    it('draws the card exactly as before when the server says no, or says nothing', async () => {
      for (const founding of [false, undefined]) {
        const { host } = await render({ founding });
        const text = host.querySelector('a.coach .coach-text')!;
        expect(Array.from(text.children, (child) => `${child.tagName}.${child.className}`)).toEqual(
          ['SPAN.coach-label', 'SPAN.tb-visually-hidden', 'STRONG.'],
        );
        expect(host.querySelector('app-status-pill')).toBeNull();
        expect(host.querySelector('.coach-founding')).toBeNull();
        TestBed.resetTestingModule();
      }
    });

    it('never carries one coach’s badge to the next while it is read', async () => {
      const { fixture, host, api, selectedTenantId } = await render({ founding: true });
      expect(host.querySelector('app-status-pill')).not.toBeNull();

      api.getOwnCoach.mockReturnValue(of({ name: 'Omar Saad', foundingCoach: false }));
      selectedTenantId.set('tenant-alpha');
      fixture.detectChanges();
      expect(host.querySelector('app-status-pill')).toBeNull();
      expect(host.querySelector('.coach--waiting app-status-pill')).toBeNull();
      await settle(fixture);

      expect(textOf(host.querySelector('.coach strong'))).toBe('Omar Saad');
      expect(host.querySelector('app-status-pill')).toBeNull();
    });
  });

  describe('the coach’s certificate lines (notes plan N4b)', () => {
    const NEVER = /\b(verified|certified|qualified|licensed|approved)\b/i;
    const textOf = (element: Element | null | undefined) =>
      (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
    /** What a screen reader takes from an element: its text, without what is hidden from it. */
    const heard = (element: Element) => {
      const copy = element.cloneNode(true) as Element;
      copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
      return textOf(copy);
    };
    const childrenOf = (element: Element) =>
      Array.from(element.children, (child) => `${child.tagName}.${child.className}`);
    const linesIn = (element: ParentNode) =>
      Array.from(element.querySelectorAll('[data-coach-line]'), (line) => textOf(line));

    // The server's order, oldest first: neither by their words nor by their days shown.
    const LINES: OwnCoachLineView[] = [
      {
        text: 'Owns Iron House gym in Hamra, shown to TB Gym on 8 Oct 2026',
        what: 'Owns Iron House gym in Hamra',
        shownOn: '2026-10-08',
      },
      {
        text: 'BSc Sport Science, AUB, shown to TB Gym on 1 Oct 2026',
        what: 'BSc Sport Science, AUB',
        shownOn: '2026-10-01',
      },
    ];

    it('shows each line under the coach’s name in the server’s order, in quiet text and nothing else', async () => {
      const { host } = await render({ lines: LINES });

      const coach = host.querySelector('a.coach')!;
      const text = coach.querySelector('.coach-text')!;
      expect(linesIn(coach)).toEqual(LINES.map((line) => line.text));
      // A card with lines may wrap at large text; a card without them stays as it was (below).
      expect(coach.classList.contains('coach--lines')).toBe(true);
      // Each line is a row of its own after the name, with the card's commas between its parts.
      expect(childrenOf(text)).toEqual([
        'SPAN.coach-label',
        'SPAN.tb-visually-hidden',
        'STRONG.',
        'SPAN.tb-visually-hidden',
        'SMALL.coach-line',
        'SPAN.tb-visually-hidden',
        'SMALL.coach-line',
      ]);
      for (const [index, line] of Array.from(
        text.querySelectorAll('[data-coach-line]'),
      ).entries()) {
        expect(childrenOf(line)).toEqual(['BDI.']);
        expect(textOf(line.querySelector('bdi'))).toBe(LINES[index].text);
      }
      // No pill, no icon and no count: the card's only pill is the badge's, and it is not shown.
      expect(coach.querySelector('app-status-pill')).toBeNull();
      expect(text.querySelector('app-icon, app-status-pill, app-tag, img, svg')).toBeNull();
      expect(heard(text)).toBe(
        'Your coach, Lea Haddad, Owns Iron House gym in Hamra, shown to TB Gym on 8 Oct 2026, BSc Sport Science, AUB, shown to TB Gym on 1 Oct 2026',
      );
      expect(heard(coach)).not.toMatch(NEVER);
    });

    it('keeps the card a link to Messages, with the lines inside it and in its name', async () => {
      const { host } = await render({ lines: LINES });

      const coach = host.querySelector<HTMLAnchorElement>('a.coach')!;
      expect(coach.getAttribute('href')).toBe('/messages');
      for (const line of Array.from(host.querySelectorAll('[data-coach-line]'))) {
        expect(coach.contains(line)).toBe(true);
      }
      // One link, nothing to press inside it.
      expect(coach.querySelector('a, button')).toBeNull();
      expect(heard(coach)).toBe(
        'Your coach, Lea Haddad, Owns Iron House gym in Hamra, shown to TB Gym on 8 Oct 2026, BSc Sport Science, AUB, shown to TB Gym on 1 Oct 2026, Message',
      );
    });

    it('lists every line the read carries, without folding any away', async () => {
      const many: OwnCoachLineView[] = [
        ...LINES,
        {
          text: 'Six years coaching, shown to TB Gym on 10 Aug 2026',
          what: 'Six years coaching',
          shownOn: '2026-08-10',
        },
        {
          text: 'NASM CPT, 2019, shown to TB Gym on 2 Oct 2026',
          what: 'NASM CPT, 2019',
          shownOn: '2026-10-02',
        },
      ];
      const { host } = await render({ lines: many });

      expect(linesIn(host)).toEqual(many.map((line) => line.text));
      expect(host.querySelector('.coach button, .coach details')).toBeNull();
    });

    it('shows the same lines on the plain card when messaging is not in the plan', async () => {
      const { host } = await render({ lines: LINES, messaging: 'NoEntitlement' });

      expect(host.querySelector('a.coach')).toBeNull();
      const coach = host.querySelector('div.coach')!;
      expect(linesIn(coach)).toEqual(LINES.map((line) => line.text));
      expect(coach.classList.contains('coach--lines')).toBe(true);
      expect(heard(coach)).toBe(
        'Your coach, Lea Haddad, Owns Iron House gym in Hamra, shown to TB Gym on 8 Oct 2026, BSc Sport Science, AUB, shown to TB Gym on 1 Oct 2026',
      );
    });

    it('puts the lines after the badge’s line when the coach shows the Founding coach badge too', async () => {
      const { host } = await render({ founding: true, lines: LINES });

      const text = host.querySelector('a.coach .coach-text')!;
      expect(childrenOf(text)).toEqual([
        'SPAN.coach-label',
        'SPAN.tb-visually-hidden',
        'SPAN.coach-name',
        'SPAN.tb-visually-hidden',
        'SMALL.coach-founding',
        'SPAN.tb-visually-hidden',
        'SMALL.coach-line',
        'SPAN.tb-visually-hidden',
        'SMALL.coach-line',
      ]);
      expect(host.querySelectorAll('app-status-pill')).toHaveLength(1);
      expect(heard(text)).toBe(
        'Your coach, Lea Haddad, Founding coach, One of the first coaches on TB Gym. Not a check of qualifications, Owns Iron House gym in Hamra, shown to TB Gym on 8 Oct 2026, BSc Sport Science, AUB, shown to TB Gym on 1 Oct 2026',
      );
    });

    it('draws the card exactly as before when the read carries no lines, or no lines field at all', async () => {
      for (const lines of [[], undefined]) {
        for (const founding of [false, undefined]) {
          const { host } = await render({ founding, lines });
          const text = host.querySelector('a.coach .coach-text')!;
          expect(childrenOf(text)).toEqual([
            'SPAN.coach-label',
            'SPAN.tb-visually-hidden',
            'STRONG.',
          ]);
          expect(heard(text)).toBe('Your coach, Lea Haddad');
          expect(host.querySelector('[data-coach-line], .coach-line, bdi')).toBeNull();
          // No class of N4b's either, so no rule of N4b's reaches the card at any text size.
          expect(Array.from(host.querySelector('a.coach')!.classList)).toEqual(['coach']);
          TestBed.resetTestingModule();
        }
        // The badge's card is N3b's, with nothing after its line.
        const { host } = await render({ founding: true, lines });
        expect(childrenOf(host.querySelector('a.coach .coach-text')!)).toEqual([
          'SPAN.coach-label',
          'SPAN.tb-visually-hidden',
          'SPAN.coach-name',
          'SPAN.tb-visually-hidden',
          'SMALL.coach-founding',
        ]);
        expect(host.querySelector('[data-coach-line]')).toBeNull();
        TestBed.resetTestingModule();
      }
    });

    it('never carries one coach’s lines to the next while it is read, nor past a read that fails', async () => {
      const { fixture, host, api, selectedTenantId } = await render({ lines: LINES });
      expect(linesIn(host)).toHaveLength(2);

      const omar: OwnCoachLineView = {
        text: 'Coaches at Beirut Barbell since 2021, shown to TB Gym on 5 Nov 2026',
        what: 'Coaches at Beirut Barbell since 2021',
        shownOn: '2026-11-05',
      };
      api.getOwnCoach.mockReturnValue(
        of({ name: 'Omar Saad', foundingCoach: false, lines: [omar] }),
      );
      selectedTenantId.set('tenant-alpha');
      fixture.detectChanges();
      // Only the card's place is kept while the next coach is read, and it holds no line.
      expect(host.querySelector('[data-coach-line]')).toBeNull();
      expect(host.querySelector('.coach--waiting')).not.toBeNull();
      expect(host.textContent).not.toContain('Iron House');
      await settle(fixture);
      expect(textOf(host.querySelector('.coach strong'))).toBe('Omar Saad');
      expect(linesIn(host)).toEqual([omar.text]);

      // A coach who cannot be read leaves the card out, lines and all, and says nothing.
      api.getOwnCoach.mockReturnValue(throwError(() => new Error('forbidden')));
      selectedTenantId.set('tenant-atlas');
      await settle(fixture);
      expect(host.querySelector('.coach')).toBeNull();
      expect(host.querySelector('[data-coach-line]')).toBeNull();
      expect(host.textContent).not.toContain('Beirut Barbell');
      expect(alert(host)).toBe('');

      // And the next coach read draws only their own lines, none of the first two's.
      api.getOwnCoach.mockReturnValue(of({ name: 'Lea Haddad', foundingCoach: false, lines: [] }));
      selectedTenantId.set('tenant-alpha');
      await settle(fixture);
      expect(textOf(host.querySelector('.coach strong'))).toBe('Lea Haddad');
      expect(host.querySelector('[data-coach-line]')).toBeNull();
    });
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

  it('links platform billing and the legal documents only for a platform admin', async () => {
    const admin = await render({ roles: ['PlatformAdmin'] });
    expect(admin.host.querySelector('a[href="/admin/billing"]')).not.toBeNull();
    expect(admin.host.querySelector('a[href="/admin/legal"]')?.textContent?.trim()).toBe(
      'Legal documents',
    );
    TestBed.resetTestingModule();

    const client = await render();
    expect(client.host.querySelector('a[href="/admin/billing"]')).toBeNull();
    expect(client.host.querySelector('a[href="/admin/legal"]')).toBeNull();
  });

  it('links the coaches’ certificate record, after the legal documents, only for a platform admin', async () => {
    const admin = await render({ roles: ['PlatformAdmin'] });
    const coaches = admin.host.querySelector<HTMLAnchorElement>('a[href="/admin/coaches"]');
    expect(coaches?.querySelector('.row-text')?.textContent?.trim()).toBe('Coaches');
    expect(coaches?.querySelector('.row-icon app-icon')?.getAttribute('name')).toBe('team');
    const adminRows = Array.from(admin.host.querySelectorAll('a.row'))
      .map((row) => row.getAttribute('href'))
      .filter((href) => href?.startsWith('/admin/'));
    expect(adminRows).toEqual(['/admin/billing', '/admin/legal', '/admin/coaches']);
    TestBed.resetTestingModule();

    const client = await render();
    expect(client.host.querySelector('a[href="/admin/coaches"]')).toBeNull();
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

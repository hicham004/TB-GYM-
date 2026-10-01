import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/api-client';
import type { CurrentUser } from '../api/api.models';
import { PersonalModeStore } from '../theme/personal-mode.store';
import { AuthStore } from './auth.store';

const maya: CurrentUser = {
  id: 'user-maya',
  email: 'maya@example.test',
  displayName: 'Maya Rahman',
  preferredCulture: 'en-LB',
  preferredThemeMode: 'system',
  preferredWeightUnit: 'Kilogram',
  emailConfirmed: true,
  roles: [],
};

/** The API, with a server behind it: each save changes the account and answers with all of it. */
function configure(account: CurrentUser = maya) {
  const server: CurrentUser = { ...account };
  const api = {
    getCsrfToken: vi.fn(() => of({ token: 'csrf' })),
    getCurrentUser: vi.fn(() => of({ ...server })),
    getTenants: vi.fn(() => of([])),
    logout: vi.fn(() => of(undefined)),
    updateOwnThemeMode: vi.fn((mode: CurrentUser['preferredThemeMode']) => {
      server.preferredThemeMode = mode;
      return of({ ...server });
    }),
    updateOwnWeightUnit: vi.fn((unit: CurrentUser['preferredWeightUnit']) => {
      server.preferredWeightUnit = unit;
      return of({ ...server });
    }),
  };
  TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: api }] });
  return { api, server };
}

/** Lets the queued save reach the call it is waiting to make. */
async function drain(): Promise<void> {
  for (let turn = 0; turn < 4; turn++) await Promise.resolve();
}

describe('AuthStore personal settings', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('shows kilograms until the account says otherwise', async () => {
    configure({ ...maya, preferredWeightUnit: 'Pound' });
    const auth = TestBed.inject(AuthStore);
    expect(auth.weightUnit()).toBe('Kilogram');

    await auth.initialize();

    expect(auth.weightUnit()).toBe('Pound');
  });

  it('keeps the unit on the account: the reply to saving it is the account as it now is', async () => {
    const { api } = configure();
    const auth = TestBed.inject(AuthStore);
    await auth.initialize();

    await auth.updateWeightUnit('Pound');

    expect(api.updateOwnWeightUnit).toHaveBeenCalledWith('Pound');
    expect(auth.weightUnit()).toBe('Pound');
    expect(auth.user()?.preferredWeightUnit).toBe('Pound');
    // The other personal setting rides along in the same reply and is not disturbed.
    expect(auth.user()?.preferredThemeMode).toBe('system');
  });

  it('applies a saved light or dark mode to the page', async () => {
    configure();
    const auth = TestBed.inject(AuthStore);
    await auth.initialize();

    await auth.updateThemeMode('dark');

    expect(auth.user()?.preferredThemeMode).toBe('dark');
    expect(TestBed.inject(PersonalModeStore).mode()).toBe('dark');
  });

  // Sign-in fetches the security token before anyone is signed in, and the server binds a token to
  // the signed-in person: the first save after signing in is refused (400) without a fresh one.
  it('fetches a fresh security token before every save, so the first write after sign-in is accepted', async () => {
    const { api } = configure();
    const auth = TestBed.inject(AuthStore);
    await auth.initialize();
    api.getCsrfToken.mockClear();

    await auth.updateWeightUnit('Pound');
    await auth.updateThemeMode('dark');

    expect(api.getCsrfToken).toHaveBeenCalledTimes(2);
    const [firstToken, secondToken] = api.getCsrfToken.mock.invocationCallOrder;
    expect(firstToken).toBeLessThan(api.updateOwnWeightUnit.mock.invocationCallOrder[0]);
    expect(secondToken).toBeGreaterThan(api.updateOwnWeightUnit.mock.invocationCallOrder[0]);
    expect(secondToken).toBeLessThan(api.updateOwnThemeMode.mock.invocationCallOrder[0]);
  });

  it('sends nothing when the token cannot be fetched, and tells the caller', async () => {
    const { api } = configure();
    const auth = TestBed.inject(AuthStore);
    await auth.initialize();
    api.getCsrfToken.mockImplementation(() => throwError(() => new Error('offline')));

    await expect(auth.updateWeightUnit('Pound')).rejects.toThrow('offline');

    expect(api.updateOwnWeightUnit).not.toHaveBeenCalled();
    expect(auth.weightUnit()).toBe('Kilogram');
  });

  it('sends nothing when the session ends while the token is being fetched', async () => {
    const { api } = configure();
    const auth = TestBed.inject(AuthStore);
    await auth.initialize();
    const token = new Subject<{ token: string }>();
    api.getCsrfToken.mockImplementation(() => token);

    const saving = auth.updateWeightUnit('Pound');
    await drain();
    api.getCsrfToken.mockImplementation(() => of({ token: 'csrf' }));
    await auth.logout();
    token.next({ token: 'late' });
    token.complete();
    await saving;

    expect(api.updateOwnWeightUnit).not.toHaveBeenCalled();
    expect(auth.user()).toBeNull();
  });

  it('saves one setting at a time, in the order they were chosen', async () => {
    const theme = new Subject<CurrentUser>();
    const { api, server } = configure();
    api.updateOwnThemeMode.mockImplementation((mode) => {
      server.preferredThemeMode = mode;
      return theme;
    });
    const auth = TestBed.inject(AuthStore);
    await auth.initialize();

    const first = auth.updateThemeMode('dark');
    const second = auth.updateWeightUnit('Pound');
    await drain();

    expect(api.updateOwnThemeMode).toHaveBeenCalledTimes(1);
    expect(api.updateOwnWeightUnit).not.toHaveBeenCalled();

    theme.next({ ...server });
    theme.complete();
    await first;
    await second;

    expect(api.updateOwnWeightUnit).toHaveBeenCalledWith('Pound');
    expect(auth.user()).toMatchObject({ preferredThemeMode: 'dark', preferredWeightUnit: 'Pound' });
  });

  it('tells the caller of a refused save, and the next save still goes', async () => {
    const { api } = configure();
    api.updateOwnThemeMode.mockImplementation(() => throwError(() => new Error('refused')));
    const auth = TestBed.inject(AuthStore);
    await auth.initialize();

    const refused = auth.updateThemeMode('dark');
    const next = auth.updateWeightUnit('Pound');

    await expect(refused).rejects.toThrow('refused');
    await expect(next).resolves.toBeUndefined();
    expect(api.updateOwnWeightUnit).toHaveBeenCalledWith('Pound');
    expect(auth.weightUnit()).toBe('Pound');
    expect(auth.user()?.preferredThemeMode).toBe('system');
  });

  it('ignores a reply that arrives after sign-out, so the next session is not touched', async () => {
    const reply = new Subject<CurrentUser>();
    const { api, server } = configure();
    api.updateOwnWeightUnit.mockImplementation(() => reply);
    const auth = TestBed.inject(AuthStore);
    await auth.initialize();

    const saving = auth.updateWeightUnit('Pound');
    await drain();
    await auth.logout();
    reply.next({ ...server, preferredWeightUnit: 'Pound' });
    reply.complete();
    await saving;

    expect(auth.user()).toBeNull();
    expect(auth.weightUnit()).toBe('Kilogram');
  });

  it('does not send a save that was waiting its turn when the session ended', async () => {
    const theme = new Subject<CurrentUser>();
    const { api, server } = configure();
    api.updateOwnThemeMode.mockImplementation(() => theme);
    const auth = TestBed.inject(AuthStore);
    await auth.initialize();

    const first = auth.updateThemeMode('dark');
    const queued = auth.updateWeightUnit('Pound');
    await drain();
    await auth.logout();
    theme.next({ ...server, preferredThemeMode: 'dark' });
    theme.complete();
    await first;
    await queued;

    expect(api.updateOwnWeightUnit).not.toHaveBeenCalled();
    expect(auth.user()).toBeNull();
  });

  it('ignores a reply that describes another account', async () => {
    const { api, server } = configure();
    api.updateOwnWeightUnit.mockImplementation(() =>
      of({ ...server, id: 'user-someone-else', preferredWeightUnit: 'Pound' }),
    );
    const auth = TestBed.inject(AuthStore);
    await auth.initialize();

    await auth.updateWeightUnit('Pound');

    expect(auth.user()?.id).toBe('user-maya');
    expect(auth.weightUnit()).toBe('Kilogram');
  });
});

import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { CurrentUser, TenantMembership } from '../../core/api/api.models';
import { AuthStore } from '../../core/auth/auth.store';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { field, press, query, settle, tick } from '../../../testing/dom';
import type { NotificationPreferences } from './notification.models';
import { NotificationPreferencesPage } from './notification-preferences';

const USER: CurrentUser = {
  id: 'user-1',
  email: 'client@example.test',
  displayName: 'Client One',
  preferredCulture: 'en-LB',
  emailConfirmed: true,
  roles: [],
};

const ALPHA: TenantMembership = {
  tenantId: 'tenant-alpha',
  tenantName: 'Alpha Gym',
  tenantSlug: 'alpha-gym',
  role: 'Client',
};

const BETA: TenantMembership = {
  tenantId: 'tenant-beta',
  tenantName: 'Beta Gym',
  tenantSlug: 'beta-gym',
  role: 'Client',
};

function preferences(overrides: Partial<NotificationPreferences> = {}): NotificationPreferences {
  return {
    inAppEnabled: true,
    emailServiceEnabled: false,
    emailChannelAvailable: true,
    emailSuppressed: false,
    emailSuppressionReason: null,
    quietHoursEnabled: false,
    quietHoursStartLocal: null,
    quietHoursEndLocal: null,
    tenantTimeZoneId: 'Asia/Beirut',
    version: 3,
    ...overrides,
  };
}

interface ApiMocks {
  get: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

interface Harness extends ApiMocks {
  host: HTMLElement;
  fixture: Awaited<ReturnType<typeof TestBed.createComponent<NotificationPreferencesPage>>>;
  membership: WritableSignal<TenantMembership | undefined>;
}

async function render(configure?: (api: ApiMocks) => void): Promise<Harness> {
  const user = signal<CurrentUser | null>(USER);
  const membership = signal<TenantMembership | undefined>(ALPHA);
  const get = vi.fn(() => of(preferences()));
  const update = vi.fn(() => of(preferences()));
  configure?.({ get, update });

  await TestBed.configureTestingModule({
    imports: [NotificationPreferencesPage],
    providers: [
      {
        provide: ApiClient,
        useValue: {
          getNotificationPreferences: get,
          updateNotificationPreferences: update,
        },
      },
      { provide: CsrfService, useValue: { refresh: vi.fn().mockResolvedValue(undefined) } },
      { provide: AuthStore, useValue: { user, loading: signal(false) } },
      {
        provide: TenantStore,
        useValue: {
          selectedMembership: membership,
          selectedTenantId: signal(ALPHA.tenantId),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(NotificationPreferencesPage);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    membership,
    get,
    update,
  };
}

function conflict(): HttpErrorResponse {
  return new HttpErrorResponse({
    status: 409,
    error: { title: 'Your notification settings were changed by another request.' },
  });
}

describe('NotificationPreferencesPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('states that in-app notifications are on and cannot be switched off here', async () => {
    const { host } = await render();

    expect(host.textContent).toContain('In-app notifications are always on');
    // Stated, not implied: there is no in-app control to find.
    expect(() => field(host, 'In-app notifications')).toThrow();
    // The live regions exist from first render and say nothing yet.
    expect(query(host, '[role="alert"]').textContent?.trim()).toBe('');
    expect(query(host, '[role="status"]').textContent?.trim()).toBe('');
  });

  it('renders the current settings and names the workspace time zone', async () => {
    const { host } = await render(({ get }) => {
      get.mockReturnValue(
        of(
          preferences({
            emailServiceEnabled: true,
            quietHoursEnabled: true,
            quietHoursStartLocal: '22:00',
            quietHoursEndLocal: '07:00',
          }),
        ),
      );
    });

    expect(field<HTMLInputElement>(host, 'Email me about my coaching service').checked).toBe(true);
    expect(field<HTMLInputElement>(host, 'Hold emails during quiet hours').checked).toBe(true);
    expect(field<HTMLInputElement>(host, 'Quiet hours start').value).toBe('22:00');
    expect(field<HTMLInputElement>(host, 'Quiet hours end').value).toBe('07:00');
    // A local time is meaningless without the zone it is local to.
    expect(host.textContent).toContain('Asia/Beirut');
  });

  it('saves the member’s own choices with an idempotency key and the version it read', async () => {
    const { host, fixture, update } = await render();

    tick(host, 'Email me about my coaching service');
    await settle(fixture);
    press(host, 'Save settings');
    await settle(fixture);

    expect(update).toHaveBeenCalledTimes(1);
    const sent = update.mock.calls[0][0];
    expect(sent.emailServiceEnabled).toBe(true);
    expect(sent.quietHoursEnabled).toBe(false);
    // Leftover times are not part of a disabled window; two requests that both mean "off" must be
    // the same command.
    expect(sent.quietHoursStartLocal).toBeNull();
    expect(sent.quietHoursEndLocal).toBeNull();
    expect(sent.version).toBe(3);
    expect(typeof sent.idempotencyKey).toBe('string');
    // There is no subject in the request: nobody changes anybody else's settings.
    expect(Object.keys(sent)).not.toContain('userId');
    expect(query(host, '[role="status"]').textContent).toContain('saved');
  });

  it('prevents edits while a save response is in flight', async () => {
    const pending = new Subject<NotificationPreferences>();
    const { host, fixture } = await render(({ update }) => {
      update.mockReturnValue(pending.asObservable());
    });

    press(host, 'Save settings');
    await settle(fixture);

    // The in-flight save disables the surrounding fieldset rather than each control, so this asks
    // the question the user experiences — is this control actually inert — with `:disabled`, which
    // a disabled ancestor fieldset satisfies. Reading the input's own `disabled` property would
    // not: that reflects the attribute on the input, which nothing here sets.
    expect(
      field<HTMLInputElement>(host, 'Email me about my coaching service').matches(':disabled'),
    ).toBe(true);
    expect(
      field<HTMLInputElement>(host, 'Hold emails during quiet hours').matches(':disabled'),
    ).toBe(true);

    pending.next(preferences({ version: 4 }));
    pending.complete();
    await settle(fixture);

    expect(
      field<HTMLInputElement>(host, 'Email me about my coaching service').matches(':disabled'),
    ).toBe(false);
    expect(
      field<HTMLInputElement>(host, 'Hold emails during quiet hours').matches(':disabled'),
    ).toBe(false);
  });

  it('enables the quiet-hours times only while the window is switched on', async () => {
    const { host, fixture } = await render();

    expect(field<HTMLInputElement>(host, 'Quiet hours start').disabled).toBe(true);

    tick(host, 'Hold emails during quiet hours');
    await settle(fixture);
    expect(field<HTMLInputElement>(host, 'Quiet hours start').disabled).toBe(false);
    expect(field<HTMLInputElement>(host, 'Quiet hours end').disabled).toBe(false);

    tick(host, 'Hold emails during quiet hours', false);
    await settle(fixture);
    expect(field<HTMLInputElement>(host, 'Quiet hours start').disabled).toBe(true);
  });

  it('sends the quiet-hours window when it is switched on', async () => {
    const { host, fixture, update } = await render();

    tick(host, 'Hold emails during quiet hours');
    await settle(fixture);
    press(host, 'Save settings');
    await settle(fixture);

    const sent = update.mock.calls[0][0];
    expect(sent.quietHoursEnabled).toBe(true);
    expect(sent.quietHoursStartLocal).toBe('22:00');
    expect(sent.quietHoursEndLocal).toBe('07:00');
  });

  it('refuses a zero-length quiet window before troubling the server', async () => {
    const { host, fixture, update } = await render();

    tick(host, 'Hold emails during quiet hours');
    await settle(fixture);
    const end = field<HTMLInputElement>(host, 'Quiet hours end');
    end.value = '22:00';
    end.dispatchEvent(new Event('input'));
    await settle(fixture);
    press(host, 'Save settings');
    await settle(fixture);

    expect(update).not.toHaveBeenCalled();
    expect(query(host, '[role="alert"]').textContent).toContain('different times');
  });

  it('keeps the unsaved choices when the save is refused', async () => {
    const { host, fixture, update } = await render(({ update: save }) => {
      save.mockReturnValue(throwError(() => conflict()));
    });

    tick(host, 'Email me about my coaching service');
    tick(host, 'Hold emails during quiet hours');
    await settle(fixture);
    const end = field<HTMLInputElement>(host, 'Quiet hours end');
    end.value = '06:30';
    end.dispatchEvent(new Event('input'));
    await settle(fixture);

    press(host, 'Save settings');
    await settle(fixture);

    expect(update).toHaveBeenCalledTimes(1);
    // The server refused; the edit is still on screen, so the fix is one press away rather than a
    // retype.
    expect(field<HTMLInputElement>(host, 'Email me about my coaching service').checked).toBe(true);
    expect(field<HTMLInputElement>(host, 'Hold emails during quiet hours').checked).toBe(true);
    expect(field<HTMLInputElement>(host, 'Quiet hours end').value).toBe('06:30');
    expect(query(host, '[role="alert"]').textContent).toContain('changed by another request');
    expect(query(host, '[role="status"]').textContent?.trim()).toBe('');
  });

  it('reuses one idempotency key across a retry and a new one after it settles', async () => {
    const { host, fixture, update } = await render(({ update: save }) => {
      save.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
      save.mockReturnValue(of(preferences({ emailServiceEnabled: true, version: 4 })));
    });

    tick(host, 'Email me about my coaching service');
    await settle(fixture);
    press(host, 'Save settings');
    await settle(fixture);
    press(host, 'Save settings');
    await settle(fixture);

    const [first, second] = update.mock.calls.map((call) => call[0]);
    // The attempt did not change, so it is the same command and not a second decision.
    expect(second.idempotencyKey).toBe(first.idempotencyKey);

    // Once one settles, the next edit is a new command against the version the server returned.
    tick(host, 'Email me about my coaching service', false);
    await settle(fixture);
    press(host, 'Save settings');
    await settle(fixture);
    const third = update.mock.calls[2][0];
    expect(third.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(third.version).toBe(4);
  });

  it('uses a new idempotency key when the choices change after a failed request', async () => {
    const { host, fixture, update } = await render(({ update: save }) => {
      save.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    });

    tick(host, 'Email me about my coaching service');
    await settle(fixture);
    press(host, 'Save settings');
    await settle(fixture);
    const first = update.mock.calls[0][0];

    tick(host, 'Hold emails during quiet hours');
    await settle(fixture);
    press(host, 'Save settings');
    await settle(fixture);
    const edited = update.mock.calls[1][0];

    expect(edited.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(edited.quietHoursEnabled).toBe(true);
  });

  it('recovers after a failed save without reloading', async () => {
    const { host, fixture, update } = await render(({ update: save }) => {
      save.mockReturnValueOnce(throwError(() => conflict()));
      save.mockReturnValue(of(preferences({ emailServiceEnabled: true })));
    });

    tick(host, 'Email me about my coaching service');
    await settle(fixture);
    press(host, 'Save settings');
    await settle(fixture);
    expect(query(host, '[role="alert"]').textContent).toContain('changed by another request');

    press(host, 'Save settings');
    await settle(fixture);

    expect(update).toHaveBeenCalledTimes(2);
    expect(query(host, '[role="status"]').textContent).toContain('saved');
    expect(query(host, '[role="alert"]').textContent?.trim()).toBe('');
  });

  /**
   * The stale-context rule. A reply for the workspace the user has just left must never land on the
   * current one, because these are settings somebody is about to save.
   */
  it('never applies a settings reply for a workspace the user has left', async () => {
    const slow = new Subject<NotificationPreferences>();
    const { host, fixture, membership, get } = await render(({ get: read }) => {
      read.mockReturnValueOnce(slow.asObservable());
      read.mockReturnValue(of(preferences({ emailServiceEnabled: false, version: 9 })));
    });

    // Alpha's reply is still in flight when the user switches workspace.
    membership.set(BETA);
    await settle(fixture);
    expect(get).toHaveBeenCalledTimes(2);

    slow.next(preferences({ emailServiceEnabled: true, version: 1, tenantTimeZoneId: 'UTC' }));
    slow.complete();
    await settle(fixture);

    // Beta's answer is what is on screen, and Alpha's cannot overwrite it.
    expect(field<HTMLInputElement>(host, 'Email me about my coaching service').checked).toBe(false);
    expect(host.textContent).toContain('Asia/Beirut');
    expect(host.textContent).not.toContain('UTC');
  });

  it('never applies a save reply for a workspace the user has left', async () => {
    const pending = new Subject<NotificationPreferences>();
    const { host, fixture, membership, update } = await render(({ update: save }) => {
      save.mockReturnValue(pending.asObservable());
    });

    tick(host, 'Email me about my coaching service');
    await settle(fixture);
    press(host, 'Save settings');
    await settle(fixture);
    expect(update).toHaveBeenCalledTimes(1);

    membership.set(BETA);
    await settle(fixture);
    pending.next(preferences({ emailServiceEnabled: true, tenantTimeZoneId: 'UTC', version: 44 }));
    pending.complete();
    await settle(fixture);

    expect(field<HTMLInputElement>(host, 'Email me about my coaching service').checked).toBe(false);
    expect(host.textContent).toContain('Asia/Beirut');
    expect(host.textContent).not.toContain('Your notification settings were saved');
  });

  it('clears the screen before loading a newly selected workspace', async () => {
    const held = new Subject<NotificationPreferences>();
    const { host, fixture, membership } = await render(({ get: read }) => {
      read.mockReturnValueOnce(of(preferences({ emailServiceEnabled: true })));
      read.mockReturnValue(held.asObservable());
    });

    expect(field<HTMLInputElement>(host, 'Email me about my coaching service').checked).toBe(true);

    membership.set(BETA);
    await settle(fixture);

    // Nothing from the previous workspace is on screen while the new one is loading, so nothing
    // from it can be saved by accident either.
    expect(() => field(host, 'Email me about my coaching service')).toThrow();
    expect(host.textContent).toContain('Loading your notification settings');
    held.complete();
  });

  it('saves against the version the current workspace returned, not the previous one', async () => {
    const { host, fixture, membership, update } = await render(({ get: read }) => {
      read.mockReturnValueOnce(of(preferences({ version: 3 })));
      read.mockReturnValue(of(preferences({ version: 77 })));
    });

    membership.set(BETA);
    await settle(fixture);
    tick(host, 'Email me about my coaching service');
    await settle(fixture);
    press(host, 'Save settings');
    await settle(fixture);

    expect(update.mock.calls[0][0].version).toBe(77);
  });

  it('says so when the workspace has no email transport configured', async () => {
    const { host } = await render(({ get }) => {
      get.mockReturnValue(of(preferences({ emailChannelAvailable: false })));
    });

    expect(host.textContent).toContain('Email delivery is not switched on');
    // The setting is still offered, because it is the member's decision either way.
    expect(field<HTMLInputElement>(host, 'Email me about my coaching service').disabled).toBe(
      false,
    );
  });

  /**
   * A suppressed mailbox is stated, not hidden.
   *
   * The alternative is a switch that is on beside a channel that has quietly stopped, which is the
   * one outcome worse than saying so: the member believes they are being emailed, stops checking the
   * app, and finds out when they miss a payment notice.
   */
  it('says when email to the member is paused, in their own words, with no way to clear it', async () => {
    const { host } = await render(({ get }) => {
      get.mockReturnValue(
        of(
          preferences({
            emailServiceEnabled: true,
            emailSuppressed: true,
            emailSuppressionReason: 'PermanentBounce',
          }),
        ),
      );
    });

    const notice = query(host, '[data-testid="email-suppressed"]');
    expect(notice.textContent).toContain('Email to your address is paused');
    expect(notice.textContent).toContain('rejected our last message');
    expect(notice.textContent).toContain('in-app notifications are unaffected');

    // The member's own decision is not rewritten by a bounce, and the switch stays theirs to set.
    expect(field<HTMLInputElement>(host, 'Email me about my coaching service').checked).toBe(true);
    expect(field<HTMLInputElement>(host, 'Email me about my coaching service').disabled).toBe(
      false,
    );

    // And there is deliberately no control that resumes mail to an address that bounced.
    expect(host.textContent).not.toContain('Resume');
    expect(host.textContent).not.toContain('Unsuppress');
  });

  it('explains a complaint differently from a bounce', async () => {
    const { host } = await render(({ get }) => {
      get.mockReturnValue(
        of(preferences({ emailSuppressed: true, emailSuppressionReason: 'Complaint' })),
      );
    });

    expect(query(host, '[data-testid="email-suppressed"]').textContent).toContain(
      'reported as spam',
    );
  });

  it('says nothing about suppression when the mailbox is healthy', async () => {
    const { host } = await render(({ get }) => {
      get.mockReturnValue(of(preferences()));
    });

    expect(host.querySelector('[data-testid="email-suppressed"]')).toBeNull();
    expect(host.textContent).not.toContain('is paused');
  });

  it('reports a failed load without leaving a half-rendered form', async () => {
    const { host } = await render(({ get }) => {
      get.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    });

    expect(query(host, '[role="alert"]').textContent).toContain('could not be loaded');
    expect(host.querySelector('form')).toBeNull();
  });

  /**
   * Every control is reachable and named. A checkbox whose caption is not its label, or a time input
   * with no accessible name, is a control a screen-reader user cannot find.
   */
  it('labels and describes every control it renders', async () => {
    const { host } = await render();

    for (const label of [
      'Email me about my coaching service',
      'Hold emails during quiet hours',
      'Quiet hours start',
      'Quiet hours end',
    ]) {
      expect(() => field(host, label)).not.toThrow();
    }

    const email = field<HTMLInputElement>(host, 'Email me about my coaching service');
    const emailHelp = email.getAttribute('aria-describedby');
    expect(emailHelp).toBe('emailServiceHelp');
    expect(query(host, `#${emailHelp}`).textContent).toContain('sign in to read it');

    const start = field<HTMLInputElement>(host, 'Quiet hours start');
    expect(start.getAttribute('aria-describedby')).toBe('quietHoursZone');
    expect(query(host, '#quietHoursZone').textContent).toContain('Asia/Beirut');

    // Submitting is a real submit button inside a real form, so Enter works from any field.
    const submit = query<HTMLButtonElement>(host, 'button[type="submit"]');
    expect(submit.form).toBe(host.querySelector('form'));
  });

  /**
   * Asserted against the stores themselves rather than by spying on `setItem`: jsdom's `Storage` is
   * a proxy that turns an unknown property assignment into a stored item, so installing a spy on it
   * writes an entry and the assertion would then be measuring its own side effect.
   */
  it('writes nothing to browser storage', async () => {
    const { host, fixture } = await render();

    tick(host, 'Email me about my coaching service');
    await settle(fixture);
    press(host, 'Save settings');
    await settle(fixture);

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

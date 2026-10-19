import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { fill, press, settle, type } from '../../../testing/dom';
import { provideEmailDelivery } from '../../../testing/email-delivery';
import { atlasInvitations, invitation, NOW } from '../../../testing/invitation-fixtures';
import { Invitations } from './invitations';

type Api = Partial<Record<keyof ApiClient, ReturnType<typeof vi.fn>>>;

async function render(overrides: Api = {}, options: { emailOff?: boolean } = {}) {
  const api: Api = {
    getInvitations: vi.fn(() => of([])),
    createInvitation: vi.fn(() => of(invitation())),
    resendInvitation: vi.fn(() =>
      of(invitation({ sendCount: 2, logicalSendGeneration: 2, version: 8 })),
    ),
    revokeInvitation: vi.fn(() => of(invitation({ status: 'Revoked', version: 8 }))),
    ...overrides,
  };
  await TestBed.configureTestingModule({
    imports: [Invitations],
    providers: [
      provideRouter([]),
      { provide: ApiClient, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
      provideEmailDelivery(options.emailOff),
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(Invitations);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, api };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const dialog = () => {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return open.length ? open[open.length - 1] : null;
};

const toast = () => textOf(document.querySelector('.tb-toast-host, app-toast-host'));

const names = (host: HTMLElement, scope: string) =>
  Array.from(host.querySelectorAll(`${scope} .invitation .name`)).map(textOf);

describe('Invitations', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  it('lists who is waiting to join first, with what happens next, and the rest behind a closed disclosure', async () => {
    const { host } = await render({ getInvitations: vi.fn(() => of(atlasInvitations())) });

    expect(textOf(host.querySelector('h1'))).toBe('Invitations');
    expect(textOf(host.querySelector('[data-waiting] h2'))).toBe('Waiting to join 2');
    expect(names(host, '[data-waiting]')).toEqual(['Rana Haddad', 'Karl Bou Saab']);
    const rana = host.querySelector('[data-invitation="invitation-1"]')!;
    expect(textOf(rana.querySelector('.email'))).toBe('rana@example.test');
    expect(textOf(rana.querySelector('app-status-pill'))).toBe('Waiting to join');
    expect(textOf(rana.querySelector('.line'))).toBe(
      'Sent once · the newest link works until Oct 14',
    );
    expect(textOf(host.querySelector('[data-invitation="invitation-2"] .line'))).toBe(
      'Sent twice · the newest link works until Oct 13',
    );

    const earlier = host.querySelector<HTMLDetailsElement>('[data-earlier]')!;
    expect(earlier.open).toBe(false);
    expect(textOf(earlier.querySelector('summary'))).toBe('Earlier invitations (3)');
    expect(names(host, '[data-earlier]')).toEqual(['Lynn Bou Khalil', 'Maya Fakhoury', 'Ali Nasr']);
    expect(Array.from(earlier.querySelectorAll('app-status-pill')).map(textOf)).toEqual([
      'Link ran out',
      'Joined',
      'Cancelled',
    ]);
  });

  it('invites the first client from an empty page', async () => {
    const { fixture, host, api } = await render();

    expect(textOf(host.querySelector('app-empty-state h2'))).toBe('No invitations yet');
    press(host, 'Invite your first client');
    await settle(fixture);
    const sheet = dialog()!;
    expect(textOf(sheet.querySelector('h2'))).toBe('Invite a client');

    fill(sheet, 'First name', 'Rana');
    fill(sheet, 'Last name', 'Haddad');
    fill(sheet, 'Email', ' rana@example.test ');
    fill(sheet, 'Phone number (optional)', '+96170123456');
    type(sheet, 'input.day', '2');
    type(sheet, 'input.month', '4');
    type(sheet, 'input.year', '1996');
    await settle(fixture);
    press(sheet, 'Send invitation');
    await settle(fixture);

    expect(api.createInvitation).toHaveBeenCalledWith({
      email: 'rana@example.test',
      firstName: 'Rana',
      lastName: 'Haddad',
      phoneNumber: '+96170123456',
      birthDate: '1996-04-02',
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    });
    expect(dialog()).toBeNull();
    expect(toast()).toContain('Invitation created. We will email rana@example.test shortly.');
    expect(api.getInvitations).toHaveBeenCalledTimes(2);
  });

  it('says that no invitation reaches anyone while this server sends no email', async () => {
    const { fixture, host } = await render({}, { emailOff: true });

    // Audit LOST-1: nothing on the page promises an email the server cannot send.
    expect(textOf(host.querySelector('.lede'))).toBe(
      'Email is off on this server, so an invitation reaches nobody yet. You can still make them; once email is on, send each one again.',
    );
    expect(textOf(host.querySelector('app-empty-state p'))).toBe(
      'Invite your first client. Email is off on this server, so they won’t get the link to set up their profile yet.',
    );
    press(host, 'Invite your first client');
    await settle(fixture);
    const sheet = dialog()!;
    expect(textOf(sheet.querySelector('[data-email-off]'))).toBe(
      'Email is off on this server, so they won’t get the link to set up their account. The invitation is saved; once email is on, send it again.',
    );
    expect(sheet.textContent).not.toContain('We email them');

    fill(sheet, 'First name', 'Rana');
    fill(sheet, 'Last name', 'Haddad');
    fill(sheet, 'Email', 'rana@example.test');
    await settle(fixture);
    press(sheet, 'Send invitation');
    await settle(fixture);

    expect(toast()).toContain(
      'Invitation saved. Email is off on this server, so rana@example.test doesn’t get it yet.',
    );
    expect(toast()).not.toContain('We will email');
  });

  it('says a new link was not sent while this server sends no email', async () => {
    const { fixture, host } = await render(
      { getInvitations: vi.fn(() => of([invitation()])) },
      { emailOff: true },
    );

    press(host, 'Send again to Rana Haddad');
    await settle(fixture);

    expect(toast()).toContain(
      'A new link was made for rana@example.test, but email is off on this server, so it wasn’t sent. The earlier link no longer works.',
    );
  });

  it('sends the optional fields as absent rather than as empty strings', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Invite a client');
    await settle(fixture);
    const sheet = dialog()!;
    fill(sheet, 'First name', 'Rana');
    fill(sheet, 'Last name', 'Haddad');
    fill(sheet, 'Email', 'rana@example.test');
    await settle(fixture);
    press(sheet, 'Send invitation');
    await settle(fixture);

    expect(api.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumber: null, birthDate: null }),
    );
  });

  it('asks for what is missing before sending, and puts focus on the first thing wrong', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Invite a client');
    await settle(fixture);
    const sheet = dialog()!;
    fill(sheet, 'First name', 'Rana');
    await settle(fixture);
    press(sheet, 'Send invitation');
    await settle(fixture);

    expect(api.createInvitation).not.toHaveBeenCalled();
    expect(textOf(sheet)).toContain('Type their last name.');
    expect(textOf(sheet)).toContain('Type their email address.');
    expect(textOf(sheet.querySelector('[role="alert"]'))).toBe('Check the fields marked above.');
    expect(document.activeElement).toBe(sheet.querySelector('input[name="lastName"]'));
  });

  it('keeps the sheet open and says why when the server refuses', async () => {
    const duplicate = new HttpErrorResponse({
      status: 409,
      error: { title: 'That client already has a pending invitation.' },
    });
    const { fixture, host, api } = await render({
      createInvitation: vi.fn(() => throwError(() => duplicate)),
    });
    const scrolled = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrolled;

    try {
      press(host, 'Invite a client');
      await settle(fixture);
      const sheet = dialog()!;
      fill(sheet, 'First name', 'Rana');
      fill(sheet, 'Last name', 'Haddad');
      fill(sheet, 'Email', 'rana@example.test');
      await settle(fixture);
      press(sheet, 'Send invitation');
      await settle(fixture);

      expect(api.createInvitation).toHaveBeenCalled();
      expect(dialog()).toBe(sheet);
      expect(textOf(sheet.querySelector('[role="alert"]'))).toBe(
        'That client already has a pending invitation.',
      );
      expect(sheet.querySelector<HTMLInputElement>('input[name="email"]')!.value).toBe(
        'rana@example.test',
      );
      // The message is at the foot of a scrolling sheet, so it is brought into view above the bar.
      expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' });
      expect(scrolled.mock.contexts[0]).toBe(sheet.querySelector('.refusal'));
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('retries the same entry with the same key, and a changed entry with a new one', async () => {
    const refused = new HttpErrorResponse({ status: 500 });
    let attempts = 0;
    const { fixture, host, api } = await render({
      createInvitation: vi.fn(() =>
        ++attempts < 3 ? throwError(() => refused) : of(invitation()),
      ),
    });
    press(host, 'Invite a client');
    await settle(fixture);
    const sheet = dialog()!;
    fill(sheet, 'First name', 'Rana');
    fill(sheet, 'Last name', 'Haddad');
    fill(sheet, 'Email', 'rana@example.test');
    await settle(fixture);

    press(sheet, 'Send invitation');
    await settle(fixture);
    press(sheet, 'Send invitation');
    await settle(fixture);
    fill(sheet, 'First name', 'Ranya');
    await settle(fixture);
    press(sheet, 'Send invitation');
    await settle(fixture);

    const keys = vi.mocked(api.createInvitation!).mock.calls.map((call) => call[0].idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('asks before closing an invitation that is half typed', async () => {
    const { fixture, host } = await render();
    press(host, 'Invite a client');
    await settle(fixture);
    fill(dialog()!, 'First name', 'Rana');
    await settle(fixture);

    dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
    await settle(fixture);
    expect(textOf(dialog()!.querySelector('h2'))).toBe('Discard what you typed?');
    press(dialog()!, 'Keep editing');
    await settle(fixture);
    expect(textOf(dialog()!.querySelector('h2'))).toBe('Invite a client');
  });

  it('asks before Not now closes an invitation that is half typed, as the close button does', async () => {
    const { fixture, host } = await render();
    press(host, 'Invite a client');
    await settle(fixture);
    const sheet = dialog()!;

    press(sheet, 'Not now');
    await settle(fixture);
    // Nothing was typed, so nothing is asked.
    expect(dialog()).toBeNull();

    press(host, 'Invite a client');
    await settle(fixture);
    fill(dialog()!, 'First name', 'Rana');
    await settle(fixture);
    press(dialog()!, 'Not now');
    await settle(fixture);
    expect(textOf(dialog()!.querySelector('h2'))).toBe('Discard what you typed?');
    press(dialog()!, 'Close');
    await settle(fixture);
    expect(dialog()).toBeNull();
  });

  it('sends a new link with an idempotency key and the version it last saw, and says the old link is dead', async () => {
    const { fixture, host, api } = await render({
      getInvitations: vi.fn(() => of([invitation()])),
    });

    press(host, 'Send again to Rana Haddad');
    await settle(fixture);

    expect(api.resendInvitation).toHaveBeenCalledTimes(1);
    const [invitationId, idempotencyKey, version] = vi.mocked(api.resendInvitation!).mock.calls[0];
    expect(invitationId).toBe('invitation-1');
    expect(version).toBe(7);
    expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(toast()).toContain('A new link was sent to rana@example.test.');
    expect(toast()).toContain('The earlier link no longer works.');
    expect(textOf(host.querySelector('.line'))).toContain('Sent twice');
  });

  it('sends a fresh key per press, so two presses are two commands', async () => {
    const { fixture, host, api } = await render({
      getInvitations: vi.fn(() => of([invitation()])),
    });

    press(host, 'Send again to Rana Haddad');
    await settle(fixture);
    press(host, 'Send again to Rana Haddad');
    await settle(fixture);

    const calls = vi.mocked(api.resendInvitation!).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).not.toBe(calls[1][1]);
  });

  it('cancels an invitation only after asking, and keeps it as cancelled', async () => {
    const { fixture, host, api } = await render({
      getInvitations: vi.fn(() => of([invitation()])),
    });

    press(host, 'Cancel the invitation for Rana Haddad');
    await settle(fixture);
    expect(textOf(dialog()!)).toContain('Cancel the invitation for Rana Haddad?');
    press(dialog()!, 'Keep it');
    await settle(fixture);
    expect(api.revokeInvitation).not.toHaveBeenCalled();

    press(host, 'Cancel the invitation for Rana Haddad');
    await settle(fixture);
    press(dialog()!, 'Cancel invitation');
    await settle(fixture);

    expect(api.revokeInvitation).toHaveBeenCalledWith('invitation-1', 7);
    expect(toast()).toContain('The invitation for Rana Haddad was cancelled.');
    // A cancelled invitation can no longer be sent again or cancelled, so the actions go with it.
    expect(host.querySelector('[data-send-again]')).toBeNull();
    expect(host.querySelector('[data-cancel]')).toBeNull();
  });

  it('offers no new link or cancel for someone who joined, and invites again someone whose link ran out', async () => {
    const { fixture, host } = await render({
      getInvitations: vi.fn(() => of(atlasInvitations())),
    });
    const joined = host.querySelector('[data-invitation="invitation-3"]')!;
    expect(joined.querySelector('button')).toBeNull();

    press(host, 'Invite again Lynn Bou Khalil');
    await settle(fixture);
    const sheet = dialog()!;
    expect(textOf(sheet.querySelector('h2'))).toBe('Invite Lynn Bou Khalil again');
    expect(sheet.querySelector<HTMLInputElement>('input[name="firstName"]')!.value).toBe('Lynn');
    expect(sheet.querySelector<HTMLInputElement>('input[name="lastName"]')!.value).toBe(
      'Bou Khalil',
    );
    expect(sheet.querySelector<HTMLInputElement>('input[name="email"]')!.value).toBe(
      'lynn@mail.example',
    );
    // Nothing new has been typed, so closing needs no question.
    sheet.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
    await settle(fixture);
    expect(dialog()).toBeNull();
  });

  it('shows the development link only where the API holds one', async () => {
    const { host } = await render({
      getInvitations: vi.fn(() =>
        of([
          invitation({ developmentActionUrl: 'http://localhost:4200/invite?token=x' }),
          invitation({ id: 'invitation-2', email: 'karl@mail.example' }),
        ]),
      ),
    });

    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('.dev-link'));
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('http://localhost:4200/invite?token=x');
  });

  it('reports a failed load instead of claiming there are no invitations, and tries again', async () => {
    let failing = true;
    const { fixture, host, api } = await render({
      getInvitations: vi.fn(() =>
        failing ? throwError(() => new HttpErrorResponse({ status: 500 })) : of([invitation()]),
      ),
    });

    expect(textOf(host.querySelector('[role="alert"]'))).toBe('Invitations couldn’t be loaded.');
    expect(host.querySelector('app-empty-state')).toBeNull();
    failing = false;
    press(host, 'Try again');
    await settle(fixture);

    expect(api.getInvitations).toHaveBeenCalledTimes(2);
    expect(names(host, '[data-waiting]')).toEqual(['Rana Haddad']);
  });
});

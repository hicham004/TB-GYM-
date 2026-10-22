import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { ClientInvitation, CreateClientInvitationRequest } from '../../core/api/api.models';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { announced, button, field, fill, leave, press, settle, type } from '../../../testing/dom';
import { invitation, TODAY } from '../../../testing/invitation-fixtures';
import { InviteClient, type InvitePrefill } from './invite-client';

interface Options {
  readonly today?: string;
  readonly prefill?: InvitePrefill | null;
  readonly emailOff?: boolean;
  readonly create?: (request: CreateClientInvitationRequest) => Observable<ClientInvitation>;
  readonly refresh?: () => Promise<void>;
}

async function render(options: Options = {}) {
  const createInvitation = vi.fn<ApiClient['createInvitation']>(
    options.create ?? (() => of(invitation())),
  );
  const refresh = vi.fn(options.refresh ?? (() => Promise.resolve()));
  const tenant = signal('tenant-1');
  TestBed.configureTestingModule({
    imports: [InviteClient],
    providers: [
      { provide: ApiClient, useValue: { createInvitation } },
      { provide: CsrfService, useValue: { refresh } },
      { provide: TenantStore, useValue: { selectedTenantId: tenant } },
    ],
  });
  const fixture = TestBed.createComponent(InviteClient);
  fixture.componentRef.setInput('today', options.today ?? TODAY);
  fixture.componentRef.setInput('prefill', options.prefill ?? null);
  fixture.componentRef.setInput('emailOff', options.emailOff ?? false);
  const closed: (ClientInvitation | null)[] = [];
  const dirty: boolean[] = [];
  fixture.componentInstance.closed.subscribe((value) => closed.push(value));
  fixture.componentInstance.dirtyChange.subscribe((value) => dirty.push(value));
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    createInvitation,
    refresh,
    tenant,
    closed,
    /** Whether closing now would lose something typed, as the sheet last told its page. */
    dirty: () => dirty.at(-1),
  };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The reason shown under a box marked wrong, read where the box points a screen reader. */
function reasonFor(input: HTMLInputElement): string {
  if (input.getAttribute('aria-invalid') !== 'true') return '';
  const ids = (input.getAttribute('aria-describedby') ?? '').split(/\s+/);
  return ids
    .map((id) => document.getElementById(id))
    .filter((element) => element?.classList.contains('tb-field__support--error'))
    .map(textOf)
    .join(' ');
}

async function typeRana(fixture: Parameters<typeof settle>[0], host: HTMLElement) {
  fill(host, 'First name', 'Rana');
  fill(host, 'Last name', 'Haddad');
  fill(host, 'Email', 'rana@example.test');
  await settle(fixture);
}

const UUID = /^[0-9a-f-]{36}$/i;

describe('InviteClient', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('promises an email with the link only while this server sends email', async () => {
    const sending = await render();
    expect(textOf(sending.host.querySelector('p.muted'))).toBe(
      'We email them a link to set up their account. Send it again if it gets lost; each new link replaces the one before.',
    );
    expect(sending.host.querySelector('[data-email-off]')).toBeNull();
    TestBed.resetTestingModule();

    const off = await render({ emailOff: true });
    expect(textOf(off.host.querySelector('[data-email-off]'))).toBe(
      'Email is off on this server, so they won’t get the link to set up their account. The invitation is saved; once email is on, send it again.',
    );
    expect(off.host.textContent).not.toContain('We email them');
  });

  it('marks only the box that was left, and says what it needs', async () => {
    const { fixture, host } = await render();

    expect(announced(host)).toBe('');
    expect(field(host, 'Email').hasAttribute('aria-invalid')).toBe(false);
    leave(host, 'Email');
    await settle(fixture);

    expect(reasonFor(field(host, 'Email'))).toBe('Type their email address.');
    expect(field(host, 'First name').hasAttribute('aria-invalid')).toBe(false);
    expect(announced(host)).toBe('');

    fill(host, 'Email', 'rana@');
    await settle(fixture);
    expect(reasonFor(field(host, 'Email'))).toBe('Type an email address like name@example.com.');
  });

  it('refuses an empty invitation out loud, marks what is missing and focuses the first of it', async () => {
    const { fixture, host, createInvitation, closed } = await render();

    press(host, 'Send invitation');
    await settle(fixture);

    expect(createInvitation).not.toHaveBeenCalled();
    expect(closed).toEqual([]);
    expect(announced(host)).toBe('Check the fields marked above.');
    expect(reasonFor(field(host, 'First name'))).toBe('Type their first name.');
    expect(reasonFor(field(host, 'Last name'))).toBe('Type their last name.');
    expect(reasonFor(field(host, 'Email'))).toBe('Type their email address.');
    // The optional fields are not wrong for being empty.
    expect(field(host, 'Phone number (optional)').hasAttribute('aria-invalid')).toBe(false);
    expect(document.activeElement).toBe(field(host, 'First name'));
  });

  it('judges the adult rule against the day it is given', async () => {
    // Born 10 October 2008: 18 on 10 October 2026, not on the 9th.
    const before = await render({ today: '2026-10-09' });
    await typeRana(before.fixture, before.host);
    type(before.host, 'input.day', '10');
    type(before.host, 'input.month', '10');
    type(before.host, 'input.year', '2008');
    await settle(before.fixture);
    press(before.host, 'Send invitation');
    await settle(before.fixture);
    expect(before.createInvitation).not.toHaveBeenCalled();
    expect(textOf(before.host.querySelector('app-date-input .tb-field__support--error'))).toBe(
      'Clients have to be 18 or older.',
    );
    TestBed.resetTestingModule();

    const birthday = await render({ today: '2026-10-10' });
    await typeRana(birthday.fixture, birthday.host);
    type(birthday.host, 'input.day', '10');
    type(birthday.host, 'input.month', '10');
    type(birthday.host, 'input.year', '2008');
    await settle(birthday.fixture);
    press(birthday.host, 'Send invitation');
    await settle(birthday.fixture);
    expect(birthday.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ birthDate: '2008-10-10' }),
    );
  });

  it('sends the entry trimmed, with no phone or birth date as absent, and closes with the invitation', async () => {
    const created = invitation({ id: 'invitation-9' });
    const { fixture, host, createInvitation, refresh, closed } = await render({
      create: () => of(created),
    });
    fill(host, 'First name', '  Rana ');
    fill(host, 'Last name', ' Haddad  ');
    fill(host, 'Email', ' rana@example.test ');
    await settle(fixture);

    press(host, 'Send invitation');
    await settle(fixture);

    expect(createInvitation).toHaveBeenCalledTimes(1);
    expect(createInvitation).toHaveBeenCalledWith({
      email: 'rana@example.test',
      firstName: 'Rana',
      lastName: 'Haddad',
      phoneNumber: null,
      birthDate: null,
      idempotencyKey: expect.stringMatching(UUID),
    });
    // The write asks for a fresh antiforgery token first.
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(
      createInvitation.mock.invocationCallOrder[0],
    );
    expect(closed).toEqual([created]);
  });

  it('sends a phone number and a typed birth date as the server takes them', async () => {
    const { fixture, host, createInvitation } = await render();
    await typeRana(fixture, host);
    fill(host, 'Phone number (optional)', ' +961 70 123 456 ');
    type(host, 'input.day', '27');
    type(host, 'input.month', '3');
    type(host, 'input.year', '1990');
    await settle(fixture);

    press(host, 'Send invitation');
    await settle(fixture);

    expect(createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumber: '+961 70 123 456', birthDate: '1990-03-27' }),
    );
  });

  it('keeps a refusal on screen in the server’s words, with what was typed, and stays open', async () => {
    // As POST /api/invitations answers a refusal: a code and the sentence to show.
    const duplicate = new HttpErrorResponse({
      status: 409,
      error: {
        code: 'invitation_pending',
        message:
          'You already invited this email, and that invitation is still waiting. Send it again from Invitations instead.',
      },
    });
    const { fixture, host, closed } = await render({ create: () => throwError(() => duplicate) });
    // On HTMLElement, nearer than Element, and taken away after: jsdom has no scrollIntoView of its own.
    const scrolled = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrolled;
    try {
      await typeRana(fixture, host);
      press(host, 'Send invitation');
      await settle(fixture);

      expect(announced(host)).toBe(
        'You already invited this email, and that invitation is still waiting. Send it again from Invitations instead.',
      );
      expect(closed).toEqual([]);
      expect(field(host, 'Email').value).toBe('rana@example.test');
      expect(button(host, 'Send invitation').hasAttribute('aria-disabled')).toBe(false);
      // The refusal sits at the foot of the sheet, under its sticky actions, so it is brought into view.
      expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' });
      expect(scrolled.mock.contexts[0]).toBe(host.querySelector('.refusal'));
    } finally {
      if (original) HTMLElement.prototype.scrollIntoView = original;
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  });

  it('says in its own words that a server fault stopped the invitation', async () => {
    const { fixture, host, closed } = await render({
      create: () => throwError(() => new HttpErrorResponse({ status: 500 })),
    });
    await typeRana(fixture, host);

    press(host, 'Send invitation');
    await settle(fixture);

    expect(announced(host)).toBe('The invitation could not be created. Try again.');
    expect(closed).toEqual([]);
  });

  it('retries the same entry under the same key, a changed one under a new key, and never reuses a sent one', async () => {
    let attempts = 0;
    const { fixture, host, createInvitation, closed } = await render({
      create: () =>
        ++attempts <= 2 ? throwError(() => new HttpErrorResponse({ status: 0 })) : of(invitation()),
    });
    await typeRana(fixture, host);

    press(host, 'Send invitation');
    await settle(fixture);
    press(host, 'Send invitation');
    await settle(fixture);
    fill(host, 'First name', 'Ranya');
    await settle(fixture);
    press(host, 'Send invitation');
    await settle(fixture);
    // Sent: the same entry again is a new invitation, not a replay of the one just made.
    press(host, 'Send invitation');
    await settle(fixture);

    const keys = createInvitation.mock.calls.map(([request]) => request.idempotencyKey);
    expect(keys).toHaveLength(4);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[3]).not.toBe(keys[2]);
    expect(closed).toHaveLength(2);
  });

  it('closes with nothing on Not now, sending nothing', async () => {
    const { fixture, host, createInvitation, closed } = await render();
    await typeRana(fixture, host);

    press(host, 'Not now');
    await settle(fixture);

    expect(closed).toEqual([null]);
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it('tells the page whether closing would lose something typed', async () => {
    const { fixture, host, dirty } = await render();
    expect(dirty()).toBe(false);

    fill(host, 'First name', 'Rana');
    await settle(fixture);
    expect(dirty()).toBe(true);
    fill(host, 'First name', '   ');
    await settle(fixture);
    expect(dirty()).toBe(false);

    fill(host, 'Phone number (optional)', '+961');
    await settle(fixture);
    expect(dirty()).toBe(true);
    fill(host, 'Phone number (optional)', '');
    await settle(fixture);
    expect(dirty()).toBe(false);

    // Half a birth date is something typed too.
    type(host, 'input.day', '2');
    await settle(fixture);
    expect(dirty()).toBe(true);
    type(host, 'input.day', '');
    await settle(fixture);
    expect(dirty()).toBe(false);
  });

  it('starts an Invite again from the person it names, untouched until something differs', async () => {
    const { fixture, host, dirty, createInvitation } = await render({
      prefill: { firstName: 'Lynn', lastName: 'Bou Khalil', email: 'lynn@mail.example' },
    });

    expect(field(host, 'First name').value).toBe('Lynn');
    expect(field(host, 'Last name').value).toBe('Bou Khalil');
    expect(field(host, 'Email').value).toBe('lynn@mail.example');
    expect(dirty()).toBe(false);

    fill(host, 'Email', 'lynn@new.example');
    await settle(fixture);
    expect(dirty()).toBe(true);
    // Only spaces around what was there before change nothing.
    fill(host, 'Email', ' lynn@mail.example ');
    await settle(fixture);
    expect(dirty()).toBe(false);

    press(host, 'Send invitation');
    await settle(fixture);
    expect(createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Lynn',
        lastName: 'Bou Khalil',
        email: 'lynn@mail.example',
      }),
    );
  });

  it('drops the write when the workspace changes while it waits for its token', async () => {
    let release!: () => void;
    const token = new Promise<void>((resolve) => (release = resolve));
    const { fixture, host, createInvitation, tenant, closed } = await render({
      refresh: () => token,
    });
    await typeRana(fixture, host);
    press(host, 'Send invitation');
    await settle(fixture);

    tenant.set('tenant-2');
    release();
    await token;
    await settle(fixture);

    // Never sent to the workspace now selected, and nothing said about it.
    expect(createInvitation).not.toHaveBeenCalled();
    expect(closed).toEqual([]);
    expect(announced(host)).toBe('');
  });

  it('drops the answer when the workspace changes while the server is answering', async () => {
    const answer = new Subject<ClientInvitation>();
    const { fixture, host, tenant, closed } = await render({ create: () => answer });
    await typeRana(fixture, host);
    press(host, 'Send invitation');
    await settle(fixture);

    tenant.set('tenant-2');
    answer.next(invitation());
    answer.complete();
    await settle(fixture);

    expect(closed).toEqual([]);
    expect(announced(host)).toBe('');
  });

  it('says it is sending while it sends, and a second press sends nothing more', async () => {
    const answer = new Subject<ClientInvitation>();
    const { fixture, host, createInvitation, closed } = await render({ create: () => answer });
    await typeRana(fixture, host);

    press(host, 'Send invitation');
    await settle(fixture);
    const sending = button(host, 'Sending…');
    expect(sending.getAttribute('aria-disabled')).toBe('true');
    press(host, 'Sending…');
    await settle(fixture);
    expect(createInvitation).toHaveBeenCalledTimes(1);

    answer.next(invitation());
    answer.complete();
    await settle(fixture);
    expect(closed).toHaveLength(1);
    expect(button(host, 'Send invitation').hasAttribute('aria-disabled')).toBe(false);
  });
});

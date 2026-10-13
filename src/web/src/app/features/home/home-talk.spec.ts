import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { WebsiteSettingsStore } from '../../core/website/website-settings';
import { announced, fill, leave, press, query, settle } from '../../../testing/dom';
import { HomeTalk, looksLikeContact, SENT_HOLD_MS, sentHold } from './home-talk';

/** A browser that answers the reduced-motion question; jsdom has no `matchMedia` of its own. */
function stubMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: reduce && media.includes('reduce'),
    media,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

class IntersectionObserverStub {
  static instances: IntersectionObserverStub[] = [];
  readonly observed: Element[] = [];
  constructor(private readonly callback: IntersectionObserverCallback) {
    IntersectionObserverStub.instances.push(this);
  }
  observe(element: Element): void {
    this.observed.push(element);
  }
  disconnect(): void {
    // Nothing to release.
  }
  /** The section scrolled into view. */
  intersect(): void {
    this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

async function render(
  api: Partial<ApiClient> = {},
  settings: { whatsAppLink?: string | null } = {},
) {
  const whatsAppLink = signal(settings.whatsAppLink ?? null);
  const apiDouble = {
    getContactForm: vi.fn(() => of({ stamp: 'stamp-1' })),
    submitContactRequest: vi.fn(() => of(undefined)),
    ...api,
  };
  await TestBed.configureTestingModule({
    imports: [HomeTalk],
    providers: [
      { provide: ApiClient, useValue: apiDouble },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: WebsiteSettingsStore, useValue: { whatsAppLink, load: vi.fn() } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(HomeTalk);
  await settle(fixture);
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    api: apiDouble,
    csrf: TestBed.inject(CsrfService),
  };
}

function fillTheForm(host: HTMLElement): void {
  fill(host, 'Your name', 'Rami Tabet');
  fill(host, 'Your gym', 'Oakline Strength');
  fill(host, 'Email or WhatsApp number', '+961 70 123 456');
  fill(host, 'About your gym (optional)', 'Six coaches.');
}

describe('HomeTalk', () => {
  beforeEach(() => {
    IntersectionObserverStub.instances = [];
    vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('asks for the stamp when the section comes into view, and sends it with the form', async () => {
    const { fixture, host, api, csrf } = await render();
    expect(api.getContactForm).not.toHaveBeenCalled();
    expect(IntersectionObserverStub.instances[0].observed[0]).toBe(query(host, '#talk'));

    IntersectionObserverStub.instances[0].intersect();
    await settle(fixture);
    expect(api.getContactForm).toHaveBeenCalledTimes(1);

    fillTheForm(host);
    await settle(fixture);
    press(host, 'Send');
    await settle(fixture);

    expect(csrf.refresh).toHaveBeenCalledTimes(1);
    expect(api.submitContactRequest).toHaveBeenCalledWith({
      name: 'Rami Tabet',
      gymName: 'Oakline Strength',
      contact: '+961 70 123 456',
      message: 'Six coaches.',
      website: '',
      formStamp: 'stamp-1',
    });
    expect(api.getContactForm).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Thanks, Rami Tabet.');
    expect(host.textContent).toContain('+961 70 123 456');
    expect(host.querySelector('form')).toBeNull();
    expect(document.activeElement).toBe(query(host, '[role="status"]'));
  });

  it('asks for the stamp on the first touch where nothing scrolled it into view', async () => {
    const { fixture, host, api } = await render();

    query<HTMLInputElement>(host, 'input[name="name"]').dispatchEvent(
      new FocusEvent('focusin', { bubbles: true }),
    );
    await settle(fixture);

    expect(api.getContactForm).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty or malformed form with its reasons, announced once, and sends nothing', async () => {
    const { fixture, host, api } = await render();
    expect(announced(host)).toBe('');

    fill(host, 'Email or WhatsApp number', 'rami');
    await settle(fixture);
    press(host, 'Send');
    await settle(fixture);

    expect(api.submitContactRequest).not.toHaveBeenCalled();
    const summary = announced(host);
    expect(summary).toContain("Your message can't be sent yet:");
    expect(summary).toContain('Enter your name.');
    expect(summary).toContain('Enter the name of your gym.');
    expect(summary).toContain('Enter an email address or a WhatsApp number');
    expect(document.activeElement).toBe(query(host, '#talk-summary'));
    expect(
      query<HTMLInputElement>(host, 'input[name="contact"]').getAttribute('aria-invalid'),
    ).toBe('true');
  });

  it('draws each field as a line whose label floats once it is in use, with the help in its note until the reasons are due', async () => {
    const { fixture, host } = await render();
    const nameField = query(host, '[for="talk-name"]').closest('.talk__field')!;
    const contact = query<HTMLInputElement>(host, '#talk-contact');
    const contactNote = query(host, '#talk-contact-note');

    // At rest the label sits in its field; the note under the contact field is its help.
    expect(nameField.classList).not.toContain('talk__field--filled');
    expect(contact.getAttribute('aria-describedby')).toBe('talk-contact-note');
    expect(contactNote.textContent?.trim()).toBe('Either works; we reply there.');
    expect(contactNote.classList).not.toContain('talk__note--error');

    fill(host, 'Your name', 'Rami Tabet');
    await settle(fixture);
    expect(nameField.classList).toContain('talk__field--filled');

    // Left wrong, a field says why in its own note, which its control is described by.
    fill(host, 'Email or WhatsApp number', 'rami');
    leave(host, 'Email or WhatsApp number');
    await settle(fixture);
    expect(contact.getAttribute('aria-invalid')).toBe('true');
    expect(contactNote.classList).toContain('talk__note--error');
    expect(contactNote.textContent).toContain('Enter an email address or a WhatsApp number');

    // A field with no help has no note until it has a reason to show.
    const gym = query<HTMLInputElement>(host, '#talk-gym');
    expect(host.querySelector('#talk-gym-note')).toBeNull();
    expect(gym.hasAttribute('aria-describedby')).toBe(false);
    leave(host, 'Your gym');
    await settle(fixture);
    expect(query(host, '#talk-gym-note').textContent).toContain('Enter the name of your gym.');
    expect(gym.getAttribute('aria-describedby')).toBe('talk-gym-note');
  });

  it('holds a check on Send for a moment before the thanks takes the form’s place', async () => {
    stubMotion(false);
    const { fixture, host } = await render();
    fillTheForm(host);
    await settle(fixture);
    press(host, 'Send');
    await settle(fixture);

    const send = query<HTMLButtonElement>(host, '.talk__send');
    expect(send.classList).toContain('talk__send--sent');
    expect(send.textContent?.trim()).toBe('Sent');
    expect(send.disabled).toBe(true);
    expect(host.textContent).not.toContain('Thanks,');

    await new Promise((resolve) => setTimeout(resolve, SENT_HOLD_MS + 50));
    await settle(fixture);
    expect(host.querySelector('form')).toBeNull();
    expect(host.textContent).toContain('Thanks, Rami Tabet.');
    expect(document.activeElement).toBe(query(host, '[role="status"]'));
  });

  it('skips the check’s moment for a reader who asked for less motion, or where nothing can ask', () => {
    expect(sentHold()).toBe(0);
    stubMotion(true);
    expect(sentHold()).toBe(0);
    stubMotion(false);
    expect(sentHold()).toBe(SENT_HOLD_MS);
  });

  it('keeps the hidden field out of reach and sends it empty', async () => {
    const { host } = await render();
    const honeypot = query<HTMLInputElement>(host, '#talk-website');

    expect(honeypot.tabIndex).toBe(-1);
    expect(honeypot.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(honeypot.getAttribute('autocomplete')).toBe('off');
  });

  it('waits out the minimum and sends again when the server says it was too fast', async () => {
    // Every reading of the clock is ten seconds after the last, so whenever the retry measures
    // the time since the stamp, the minimum has passed and it waits nothing.
    let clock = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => (clock += 10_000));
    const submitContactRequest = vi
      .fn()
      .mockReturnValueOnce(
        throwError(
          () => new HttpErrorResponse({ status: 400, error: { code: 'contact_form_too_fast' } }),
        ),
      )
      .mockReturnValueOnce(of(undefined));
    const { fixture, host, api } = await render({ submitContactRequest });

    IntersectionObserverStub.instances[0].intersect();
    await settle(fixture);
    fillTheForm(host);
    await settle(fixture);
    press(host, 'Send');
    await settle(fixture);

    expect(submitContactRequest).toHaveBeenCalledTimes(2);
    expect(api.getContactForm).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Thanks, Rami Tabet.');
  });

  it('fetches a new stamp and sends again when the server no longer takes the old one', async () => {
    let clock = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => (clock += 10_000));
    const submitContactRequest = vi
      .fn()
      .mockReturnValueOnce(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 400,
              error: { code: 'contact_form_stamp_invalid' },
            }),
        ),
      )
      .mockReturnValueOnce(of(undefined));
    const getContactForm = vi
      .fn()
      .mockReturnValueOnce(of({ stamp: 'old' }))
      .mockReturnValueOnce(of({ stamp: 'fresh' }));
    const { fixture, host } = await render({ submitContactRequest, getContactForm });

    IntersectionObserverStub.instances[0].intersect();
    await settle(fixture);
    fillTheForm(host);
    await settle(fixture);
    press(host, 'Send');
    await settle(fixture);

    expect(getContactForm).toHaveBeenCalledTimes(2);
    expect(submitContactRequest).toHaveBeenCalledTimes(2);
    expect(submitContactRequest.mock.calls[1][0]).toMatchObject({ formStamp: 'fresh' });
    expect(host.textContent).toContain('Thanks, Rami Tabet.');
  });

  it('says so, and keeps the form, when the connection has sent too many or the server failed', async () => {
    const { fixture, host } = await render({
      submitContactRequest: vi.fn(() =>
        throwError(() => new HttpErrorResponse({ status: 429, error: null })),
      ),
    });

    fillTheForm(host);
    await settle(fixture);
    press(host, 'Send');
    await settle(fixture);

    expect(announced(host)).toContain('Too many messages from this connection for now.');
    expect(host.querySelector('form')).not.toBeNull();
    expect(host.textContent).not.toContain('Thanks,');

    TestBed.resetTestingModule();
    const failed = await render({
      submitContactRequest: vi.fn(() =>
        throwError(() => new HttpErrorResponse({ status: 500, error: null })),
      ),
    });
    fillTheForm(failed.host);
    await settle(failed.fixture);
    press(failed.host, 'Send');
    await settle(failed.fixture);
    expect(announced(failed.host)).toContain('Your message could not be sent.');
  });

  it('offers WhatsApp only when the deployment has a number', async () => {
    const without = await render();
    expect(without.host.querySelector('.talk__whatsapp')).toBeNull();
    TestBed.resetTestingModule();

    const withNumber = await render({}, { whatsAppLink: 'https://wa.me/96170123456' });
    const link = query<HTMLAnchorElement>(withNumber.host, '.talk__whatsapp');
    expect(link.getAttribute('href')).toBe('https://wa.me/96170123456');
    expect(link.getAttribute('rel')).toBe('noopener');
    expect(link.textContent).toContain('Write to us on WhatsApp');
  });

  it('judges a contact the way the server does', () => {
    expect(looksLikeContact('rami@example.com')).toBe(true);
    expect(looksLikeContact('+961 70 123 456')).toBe(true);
    expect(looksLikeContact('(03) 123-456')).toBe(true);
    expect(looksLikeContact('rami')).toBe(false);
    expect(looksLikeContact('rami@')).toBe(false);
    expect(looksLikeContact('123')).toBe(false);
  });
});

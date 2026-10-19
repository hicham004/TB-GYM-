import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { press, settle } from '../../../testing/dom';
import { gymRequests } from '../../../testing/platform-admin-fixtures';
import { PlatformAdminApi } from './platform-admin-api';
import { PlatformRequests, toGymRequestRow } from './platform-requests';

async function render(getGymRequests: ReturnType<typeof vi.fn>) {
  TestBed.configureTestingModule({
    imports: [PlatformRequests],
    providers: [{ provide: PlatformAdminApi, useValue: { getGymRequests } }],
  });
  const fixture = TestBed.createComponent(PlatformRequests);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('Requests from gyms', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('lists each request not yet emailed, newest first, with how to reach the gym and what it wrote', async () => {
    const { host } = await render(vi.fn(() => of(gymRequests())));

    const rows = Array.from(host.querySelectorAll('.request'));
    expect(rows.map((row) => textOf(row.querySelector('.gym')))).toEqual([
      'Oakline Strength Rami Tabet',
      'Cedar Barbell Club Nadine Saliba',
    ]);
    expect(rows.map((row) => textOf(row.querySelector('app-status-pill')))).toEqual([
      'Waiting for email',
      'Email failed',
    ]);

    // A WhatsApp number opens WhatsApp in a new tab; an address opens the mail app.
    const whatsApp = rows[0].querySelector<HTMLAnchorElement>('a.contact')!;
    expect(textOf(rows[0].querySelector('.reach'))).toBe('WhatsApp +96170123456');
    expect(whatsApp.getAttribute('href')).toBe('https://wa.me/96170123456');
    expect(whatsApp.getAttribute('target')).toBe('_blank');
    expect(whatsApp.getAttribute('rel')).toBe('noopener noreferrer');
    const email = rows[1].querySelector<HTMLAnchorElement>('a.contact')!;
    expect(email.getAttribute('href')).toBe('mailto:nadine@cedar.example');
    expect(email.getAttribute('target')).toBeNull();

    expect(rows[0].querySelector('.message')?.textContent).toBe(
      'Six coaches, about 90 clients.\nWe start in January.',
    );
    expect(rows[1].querySelector('.message')).toBeNull();
  });

  it('says so when every request has reached the inbox', async () => {
    const { host } = await render(vi.fn(() => of([])));

    expect(textOf(host.querySelector('[data-no-requests]'))).toBe(
      'None waiting. Every request reached your inbox.',
    );
    expect(host.querySelector('.request')).toBeNull();
  });

  it('says the requests could not be loaded, and tries again', async () => {
    const getGymRequests = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('offline')))
      .mockReturnValue(of(gymRequests()));
    const { fixture, host } = await render(getGymRequests);

    expect(textOf(host.querySelector('[role="alert"]'))).toBe(
      'Requests from gyms couldn’t be loaded.',
    );
    press(host, 'Try again');
    await settle(fixture);

    expect(getGymRequests).toHaveBeenCalledTimes(2);
    expect(host.querySelectorAll('.request')).toHaveLength(2);
  });

  it('names where a request stands, and leaves a number that makes no link as text', () => {
    const [waiting, failed] = gymRequests();
    expect(toGymRequestRow({ ...waiting, sending: true }, 'en-US')).toMatchObject({
      status: 'Sending',
      tone: 'info',
    });
    expect(toGymRequestRow(failed, 'en-US')).toMatchObject({
      status: 'Email failed',
      tone: 'danger',
    });
    expect(toGymRequestRow({ ...waiting, contact: '12' }, 'en-US').href).toBeNull();
    expect(toGymRequestRow(waiting, 'en-US').received).toMatch(/^Received Thu, Oct 8/);
  });
});

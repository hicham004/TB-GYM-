import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProgramTemplateSummary } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantContext } from '../../core/tenancy/tenant-context';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { button, chooseOption, fill, press, settle } from '../../../testing/dom';
import { houseListing, templateSummary } from '../../../testing/program-builder-fixtures';
import { HouseListings } from './house-listings';
import { HouseListingsApi, HouseListingsMemo } from './house-listings-api';
import { toHouseListing, type HouseListing } from './house-listings.models';

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The sheet or dialog on top, which the CDK draws outside the page. */
const dialog = () => {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return open.length ? open[open.length - 1] : null;
};

const toast = () => textOf(document.querySelector('.tb-toast-host, app-toast-host'));

const TEMPLATES: ProgramTemplateSummary[] = [
  templateSummary(),
  templateSummary({ id: 'template-2', name: 'Upper lower' }),
  templateSummary({ id: 'template-3', name: 'Powerbuilding', isArchived: true }),
];

const OFFERED = toHouseListing(houseListing());
const WITHDRAWN = toHouseListing(
  houseListing({
    listingId: 'listing-3',
    templateId: 'template-3',
    templateName: 'Powerbuilding',
    isOffered: false,
    runName: null,
    runPosition: null,
    weeks: 6,
    loadUnit: null,
    mixesUnits: true,
    timesStarted: 0,
    version: 7,
  }),
);

interface Options {
  list?: () => Observable<HouseListing[]>;
  templates?: ProgramTemplateSummary[];
  withdraw?: () => Observable<HouseListing>;
  offer?: () => Observable<HouseListing>;
  tenant?: string;
}

async function render(options: Options = {}) {
  const api = {
    list: vi.fn(options.list ?? (() => of([OFFERED, WITHDRAWN]))),
    withdraw: vi.fn(
      options.withdraw ??
        (() => of({ ...OFFERED, isOffered: false, version: OFFERED.version + 1 })),
    ),
    offer: vi.fn(
      options.offer ??
        (() =>
          of(
            toHouseListing(
              houseListing({
                listingId: 'listing-2',
                templateId: 'template-2',
                templateName: 'Upper lower',
                version: 1,
              }),
            ),
          )),
    ),
  };
  const csrf = { refresh: vi.fn().mockResolvedValue(undefined) };
  const selectedTenantId = signal<string | null>(options.tenant ?? 'tenant-house');
  TestBed.configureTestingModule({
    imports: [HouseListings],
    providers: [
      provideRouter([]),
      { provide: HouseListingsApi, useValue: api },
      { provide: CsrfService, useValue: csrf },
      { provide: TenantStore, useValue: { selectedTenantId } },
    ],
  });
  const fixture = TestBed.createComponent(HouseListings);
  fixture.componentRef.setInput('templates', options.templates ?? TEMPLATES);
  await settle(fixture);
  document.body.appendChild(fixture.nativeElement);
  /**
   * As `TenantStore` does: the selection changes, then the change is announced. Another workspace
   * selects it at once; signing out or another account selects none first.
   */
  const select = async (tenantId: string | null) => {
    selectedTenantId.set(tenantId);
    TestBed.inject(TenantContext).invalidate();
    await settle(fixture);
  };
  return { fixture, host: fixture.nativeElement as HTMLElement, api, csrf, select };
}

const rowParts = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('.row')).map((row) =>
    ['app-status-pill', '.block', 'h3', '.suits', '.facts', '.note', '.warning'].map((part) =>
      textOf(row.querySelector(part)),
    ),
  );

const rowOf = (host: HTMLElement, name: string) => {
  const row = Array.from(host.querySelectorAll<HTMLElement>('.row')).find(
    (candidate) => textOf(candidate.querySelector('h3')) === name,
  );
  if (!row) throw new Error(`No row for "${name}".`);
  return row;
};

describe('Programs trainees can start (notes plan N9c4)', () => {
  afterEach(() => {
    document.querySelectorAll('app-house-listings').forEach((node) => node.remove());
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  it('lists each program with its state, block, line, weeks, rounding, starts and warnings', async () => {
    const { host } = await render();

    expect(textOf(host.querySelector('h2'))).toBe('Programs trainees can start');
    expect(textOf(host.querySelector('.lede'))).toBe(
      'TB Gym’s trainees on Pro+ start these themselves, one at a time. A trainee’s copy shows every week, even weeks not shared with clients.',
    );
    expect(rowParts(host)).toEqual([
      [
        'Offered',
        'Block 1 of Foundations',
        'Strength base',
        'For: New to the barbell, two days a week.',
        '2 weeks · kg Loads rounded to 2.5 kg, nearest Started 2 times',
        '',
        '',
      ],
      [
        'Withdrawn',
        '',
        'Powerbuilding',
        'For: New to the barbell, two days a week.',
        '6 weeks Loads rounded to 2.5, nearest Not started yet',
        'Archived: trainees don’t see it.',
        'Mixes kg and lb: trainees can’t start it until every load uses one unit.',
      ],
    ]);
    expect(rowOf(host, 'Strength base').querySelector('h3 a')?.getAttribute('href')).toBe(
      '/training/programs/template-1',
    );
    expect(rowOf(host, 'Strength base').querySelector('bdi')?.getAttribute('dir')).toBe('auto');
    const offered = rowOf(host, 'Strength base');
    expect(
      Array.from(offered.querySelectorAll('.actions button')).map((item) => [
        textOf(item),
        item.getAttribute('aria-label'),
      ]),
    ).toEqual([
      ['Edit', 'Edit for trainees, Strength base'],
      ['Withdraw', 'Withdraw, Strength base'],
    ]);
    expect(textOf(rowOf(host, 'Powerbuilding').querySelector('.actions'))).toBe('Offer again');
    // The section never adds a filled button: New program stays the page's one.
    expect(host.querySelectorAll('.tb-button--filled')).toHaveLength(0);
    expect(textOf(button(host, 'Offer a program'))).toBe('Offer a program');
  });

  it('shows nothing outside TB Gym’s own space, and asks that space once a session', async () => {
    const { host, api } = await render({
      list: () => throwError(() => new HttpErrorResponse({ status: 404 })),
    });

    expect(host.textContent?.trim()).toBe('');
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(HouseListingsMemo).isNotTheHouse('tenant-house')).toBe(true);

    // Programs opened again in the same space and session: the memo answers, no read is made.
    const again = TestBed.createComponent(HouseListings);
    again.componentRef.setInput('templates', TEMPLATES);
    await settle(again);
    expect(api.list).toHaveBeenCalledTimes(1);
    expect((again.nativeElement as HTMLElement).textContent?.trim()).toBe('');
    again.destroy();
  });

  it('asks each space once a session, switching away and back included', async () => {
    const { host, api, select } = await render({
      list: () => throwError(() => new HttpErrorResponse({ status: 404 })),
    });
    const memo = TestBed.inject(HouseListingsMemo);
    expect(api.list).toHaveBeenCalledTimes(1);

    await select('tenant-b');
    expect(api.list).toHaveBeenCalledTimes(2);
    await select('tenant-house');
    await select('tenant-b');
    await select('tenant-house');

    // Each workspace was asked once; the switches bumped the session's epoch three more times.
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(TestBed.inject(TenantContext).epoch()).toBe(4);
    expect(memo.isNotTheHouse('tenant-house')).toBe(true);
    expect(memo.isNotTheHouse('tenant-b')).toBe(true);
    expect(host.textContent?.trim()).toBe('');
  });

  it('asks again in a new session', async () => {
    const { api, select } = await render({
      list: () => throwError(() => new HttpErrorResponse({ status: 404 })),
    });
    const memo = TestBed.inject(HouseListingsMemo);

    // Signing out, a session that ended, or another account: no workspace is selected first.
    await select(null);
    expect(memo.isNotTheHouse('tenant-house')).toBe(false);
    expect(api.list).toHaveBeenCalledTimes(1);

    await select('tenant-house');
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(memo.isNotTheHouse('tenant-house')).toBe(true);
  });

  it('fails the section alone and reads again on Try again', async () => {
    let calls = 0;
    const { fixture, host, api } = await render({
      list: () =>
        ++calls === 1 ? throwError(() => new HttpErrorResponse({ status: 500 })) : of([OFFERED]),
    });

    expect(textOf(host.querySelector('[role="alert"]'))).toBe(
      'Couldn’t load the programs for trainees.',
    );
    expect(host.querySelector('.offer')).toBeNull();
    press(host, 'Try again');
    await settle(fixture);
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(rowParts(host).map((parts) => parts[2])).toEqual(['Strength base']);
    expect(TestBed.inject(HouseListingsMemo).isNotTheHouse('tenant-house')).toBe(false);
  });

  it('invites a first offer when nothing is listed, or says why there is nothing to offer', async () => {
    const { host } = await render({ list: () => of([]) });
    expect(textOf(host.querySelector('.empty'))).toBe('No program is offered to trainees yet.');
    expect(button(host, 'Offer a program').disabled).toBe(false);
    host.remove();
    TestBed.resetTestingModule();

    const unpublished = templateSummary({
      versions: [
        {
          id: 'v',
          versionNumber: 1,
          name: 'Strength base',
          isPublished: false,
          weekCount: 1,
          createdAtUtc: '2026-10-01T09:00:00Z',
        },
      ],
    });
    const blocked = await render({ list: () => of([]), templates: [unpublished] });
    const offer = button(blocked.host, 'Offer a program');
    expect(offer.disabled).toBe(true);
    expect(textOf(document.getElementById(offer.getAttribute('aria-describedby')!))).toBe(
      'Publish a program first.',
    );
  });

  it('withdraws at once, says trainees keep their copy and turns the row Withdrawn', async () => {
    const { fixture, host, api, csrf } = await render();

    press(rowOf(host, 'Strength base'), 'Withdraw');
    await settle(fixture);

    expect(csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      api.withdraw.mock.invocationCallOrder[0],
    );
    expect(api.withdraw).toHaveBeenCalledWith('template-1', { version: 3 });
    expect(toast()).toContain('Strength base withdrawn. Trainees who started it keep their copy.');
    const row = rowOf(host, 'Strength base');
    expect(textOf(row.querySelector('app-status-pill'))).toBe('Withdrawn');
    expect(document.activeElement).toBe(button(row, 'Offer again'));
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('withdraws once for a second press while the first is on its way', async () => {
    const answer = new Subject<HouseListing>();
    const { fixture, host, api } = await render({ withdraw: () => answer });

    const withdraw = button(rowOf(host, 'Strength base'), 'Withdraw');
    withdraw.click();
    await settle(fixture);
    withdraw.click();
    await settle(fixture);
    expect(api.withdraw).toHaveBeenCalledTimes(1);
    answer.next({ ...OFFERED, isOffered: false, version: 4 });
    answer.complete();
    await settle(fixture);
  });

  it('says a withdraw refused for a change made meanwhile, and reads the list again', async () => {
    const { fixture, host, api } = await render({
      withdraw: () =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { code: 'concurrency_conflict', message: 'Training data was changed.' },
            }),
        ),
    });

    press(rowOf(host, 'Strength base'), 'Withdraw');
    await settle(fixture);

    expect(toast()).toContain('Someone changed this program’s terms meanwhile. Read them again.');
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('offers a new program from the sheet, says so and reads the list again', async () => {
    const { fixture, host, api } = await render();

    press(host, 'Offer a program');
    await settle(fixture);
    const sheet = dialog()!;
    expect(textOf(sheet.querySelector('h2'))).toBe('Offer to trainees');
    await chooseOption(fixture, sheet, 'Program', 'Upper lower');
    fill(sheet, 'Whom it suits', 'Two days a week, any level.');
    await settle(fixture);
    press(sheet, 'Offer to trainees');
    await settle(fixture);

    expect(api.offer).toHaveBeenCalledWith(
      'template-2',
      expect.objectContaining({ version: null }),
    );
    expect(dialog()).toBeNull();
    expect(toast()).toContain('Upper lower is offered to trainees.');
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('edits an offered program’s terms with the program fixed, and says Saved', async () => {
    const { fixture, host, api } = await render({ offer: () => of({ ...OFFERED, version: 4 }) });

    press(rowOf(host, 'Strength base'), 'Edit');
    await settle(fixture);
    const sheet = dialog()!;
    expect(textOf(sheet.querySelector('h2'))).toBe('Edit for trainees');
    expect(sheet.querySelector('app-select')).toBeNull();
    fill(sheet, 'Whom it suits', 'After the basics.');
    await settle(fixture);
    press(sheet, 'Save');
    await settle(fixture);

    expect(api.offer).toHaveBeenCalledWith(
      'template-1',
      expect.objectContaining({ suits: 'After the basics.', version: 3 }),
    );
    expect(toast()).toContain('Saved.');
  });

  it('offers a withdrawn program again from its row, prefilled', async () => {
    const { fixture, host, api } = await render();

    press(rowOf(host, 'Powerbuilding'), 'Offer again');
    await settle(fixture);
    const sheet = dialog()!;
    expect(textOf(sheet.querySelector('h2'))).toBe('Offer to trainees');
    press(sheet, 'Offer to trainees');
    await settle(fixture);

    expect(api.offer).toHaveBeenCalledWith(
      'template-3',
      expect.objectContaining({ suits: 'New to the barbell, two days a week.', version: 7 }),
    );
  });

  it('gives focus to the row’s Edit once Offer again is saved, its own button gone with the row’s state', async () => {
    const offeredAgain: HouseListing = { ...WITHDRAWN, isOffered: true, version: 8 };
    let reads = 0;
    const { fixture, host } = await render({
      list: () => of(++reads === 1 ? [OFFERED, WITHDRAWN] : [OFFERED, offeredAgain]),
      offer: () => of(offeredAgain),
    });

    const offerAgain = button(rowOf(host, 'Powerbuilding'), 'Offer again');
    offerAgain.focus();
    offerAgain.click();
    await settle(fixture);
    press(dialog()!, 'Offer to trainees');
    await settle(fixture);

    expect(dialog()).toBeNull();
    expect(toast()).toContain('Powerbuilding is offered to trainees.');
    const row = rowOf(host, 'Powerbuilding');
    expect(textOf(row.querySelector('app-status-pill'))).toBe('Offered');
    expect(row.querySelector('[data-offer-again]')).toBeNull();
    expect(document.activeElement).toBe(button(row, 'Edit'));
    expect(reads).toBe(2);
  });

  it('gives focus to the new row’s Edit once the last program is offered, Offer a program disabled', async () => {
    const upperLower = toHouseListing(
      houseListing({
        listingId: 'listing-2',
        templateId: 'template-2',
        templateName: 'Upper lower',
        version: 1,
      }),
    );
    let reads = 0;
    const { fixture, host } = await render({
      list: () => of(++reads === 1 ? [OFFERED, WITHDRAWN] : [OFFERED, upperLower, WITHDRAWN]),
      offer: () => of(upperLower),
    });

    const offer = button(host, 'Offer a program');
    offer.focus();
    offer.click();
    await settle(fixture);
    const sheet = dialog()!;
    await chooseOption(fixture, sheet, 'Program', 'Upper lower');
    fill(sheet, 'Whom it suits', 'Two days a week, any level.');
    await settle(fixture);
    press(sheet, 'Offer to trainees');
    await settle(fixture);

    expect(dialog()).toBeNull();
    expect(button(host, 'Offer a program').disabled).toBe(true);
    expect(document.activeElement).toBe(button(rowOf(host, 'Upper lower'), 'Edit'));
  });

  it('leaves focus where the sheet put it back when the button that opened it stays', async () => {
    const { fixture, host } = await render({ offer: () => of({ ...OFFERED, version: 4 }) });

    const edit = button(rowOf(host, 'Strength base'), 'Edit');
    edit.focus();
    edit.click();
    await settle(fixture);
    press(dialog()!, 'Save');
    await settle(fixture);

    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(button(rowOf(host, 'Strength base'), 'Edit'));
  });

  it('asks before closing a sheet with typed work, and never while its save is on its way', async () => {
    const answer = new Subject<HouseListing>();
    const { fixture, host } = await render({ offer: () => answer });

    press(rowOf(host, 'Strength base'), 'Edit');
    await settle(fixture);
    const sheet = dialog()!;
    fill(sheet, 'Whom it suits', 'Changed');
    await settle(fixture);
    press(sheet, 'Not now');
    await settle(fixture);
    expect(textOf(dialog()?.querySelector('h2'))).toBe('Close without saving?');
    press(dialog()!, 'Keep editing');
    await settle(fixture);
    expect(dialog()).toBe(sheet);

    press(sheet, 'Save');
    await settle(fixture);
    sheet.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click();
    await settle(fixture);
    expect(dialog()).toBe(sheet);
    answer.next(OFFERED);
    answer.complete();
    await settle(fixture);
    expect(dialog()).toBeNull();
  });

  it('reads the list again when the sheet hears of a change made meanwhile', async () => {
    const { fixture, host, api } = await render({
      offer: () =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { code: 'concurrency_conflict', message: 'Training data was changed.' },
            }),
        ),
    });

    press(rowOf(host, 'Strength base'), 'Edit');
    await settle(fixture);
    press(dialog()!, 'Save');
    await settle(fixture);

    expect(api.list).toHaveBeenCalledTimes(2);
    expect(dialog()).not.toBeNull();
  });
});

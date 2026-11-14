import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import {
  announced,
  button,
  chooseOption,
  field,
  fill,
  fold,
  formSummary,
  press,
  segment,
  selectOptionsOf,
  settle,
  toggleFold,
} from '../../../testing/dom';
import { houseListing, templateSummary } from '../../../testing/program-builder-fixtures';
import type { OfferHouseProgramRequest, ProgramTemplateSummary } from '../../core/api/generated';
import { HouseListingSheet } from './house-listing-sheet';
import { HouseListingsApi } from './house-listings-api';
import { toHouseListing, type HouseListing } from './house-listings.models';

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The words under the field captioned `label`: its error, or its help when it has none. */
const under = (host: HTMLElement, label: string) =>
  textOf(field(host, label).closest('app-field')?.querySelector('.tb-field__support'));

const TEMPLATES: ProgramTemplateSummary[] = [
  templateSummary(),
  templateSummary({ id: 'template-2', name: 'Upper lower' }),
  templateSummary({ id: 'template-3', name: 'Old block', isArchived: true }),
];
const LISTED = toHouseListing(houseListing());

interface Options {
  fixed?: string | null;
  listings?: HouseListing[];
  offer?: (templateId: string, body: OfferHouseProgramRequest) => Observable<HouseListing>;
}

async function render(options: Options = {}) {
  const offer = vi.fn(
    options.offer ??
      ((templateId: string, body: OfferHouseProgramRequest) =>
        of(
          toHouseListing(
            houseListing({
              listingId: `listing-${templateId}`,
              templateId,
              suits: body.suits ?? '',
              version: 1,
            }),
          ),
        )),
  );
  const csrf = { refresh: vi.fn().mockResolvedValue(undefined) };
  TestBed.configureTestingModule({
    imports: [HouseListingSheet],
    providers: [
      { provide: HouseListingsApi, useValue: { offer } },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-house') } },
      { provide: CsrfService, useValue: csrf },
    ],
  });
  const fixture = TestBed.createComponent(HouseListingSheet);
  fixture.componentRef.setInput('templates', TEMPLATES);
  fixture.componentRef.setInput('listings', options.listings ?? [LISTED]);
  fixture.componentRef.setInput('fixed', options.fixed ?? null);
  const closed = vi.fn();
  const dirty = vi.fn();
  const busy = vi.fn();
  const stale = vi.fn();
  fixture.componentInstance.closed.subscribe(closed);
  fixture.componentInstance.dirtyChange.subscribe(dirty);
  fixture.componentInstance.busyChange.subscribe(busy);
  fixture.componentInstance.stale.subscribe(stale);
  await settle(fixture);
  document.body.appendChild(fixture.nativeElement);
  const host = fixture.nativeElement as HTMLElement;
  return { fixture, host, offer, csrf, closed, dirty, busy, stale };
}

describe('Offer to trainees (notes plan N9c4)', () => {
  afterEach(() => {
    document.querySelectorAll('app-house-listing-sheet').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  it('offers a choice of published programs not archived and not listed, and says what trainees get', async () => {
    const { fixture, host } = await render();

    expect(await selectOptionsOf(fixture, host, 'Program')).toEqual(['Upper lower']);
    expect(textOf(host.querySelector('.copy-note'))).toBe(
      'A trainee’s copy shows every week, even weeks not shared with clients. Trainees also read the program’s description.',
    );
    const suits = field(host, 'Whom it suits');
    expect(suits.maxLength).toBe(200);
    expect(under(host, 'Whom it suits')).toBe(
      'For example: Beginners who can train three days a week.',
    );
    expect(field(host, 'Run (optional)').maxLength).toBe(80);
    expect(under(host, 'Run (optional)')).toBe(
      'Programs that follow each other share a run’s name.',
    );
    const block = field(host, 'Block number');
    expect([block.type, block.min, block.max, block.step, block.getAttribute('inputmode')]).toEqual(
      ['number', '1', '52', '1', 'numeric'],
    );
    // The rounding waits folded at its defaults.
    const rounding = fold(host, 'Rounding');
    expect(rounding.open).toBe(false);
    expect(textOf(rounding.querySelector('summary .hint'))).toBe('rounded to the nearest 2.5');
    expect(textOf(button(host, 'Offer to trainees'))).toBe('Offer to trainees');
    expect(announced(host)).toBe('');
  });

  it('refuses a save with no program and no line, saying where, and sends nothing', async () => {
    const { fixture, host, offer } = await render();

    press(host, 'Offer to trainees');
    await settle(fixture);

    expect(offer).not.toHaveBeenCalled();
    expect(textOf(host.querySelector('app-select .tb-field__support--error'))).toBe(
      'Choose the program to offer.',
    );
    expect(under(host, 'Whom it suits')).toBe('Say in one line whom this program suits.');
    expect(textOf(formSummary(host))).toBe('Check the fields marked above.');
  });

  it('offers a chosen program with its run single-spaced, its block and the default rounding', async () => {
    const { fixture, host, offer, csrf, closed, dirty } = await render();

    await chooseOption(fixture, host, 'Program', 'Upper lower');
    fill(host, 'Whom it suits', '  Two days a week, any level. ');
    fill(host, 'Run (optional)', '  Strength   Base ');
    fill(host, 'Block number', '2');
    await settle(fixture);
    expect(dirty).toHaveBeenLastCalledWith(true);
    press(host, 'Offer to trainees');
    await settle(fixture);

    expect(csrf.refresh).toHaveBeenCalledTimes(1);
    expect(csrf.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      offer.mock.invocationCallOrder[0],
    );
    expect(offer).toHaveBeenCalledWith('template-2', {
      suits: 'Two days a week, any level.',
      runName: 'Strength Base',
      runPosition: 2,
      loadIncrement: 2.5,
      loadRoundingMode: 'Nearest',
      version: null,
    });
    expect(closed).toHaveBeenCalledWith(expect.objectContaining({ templateId: 'template-2' }));
  });

  it('asks for a whole block number beside a run, and a run beside a block number', async () => {
    const { fixture, host, offer } = await render();
    await chooseOption(fixture, host, 'Program', 'Upper lower');
    fill(host, 'Whom it suits', 'Beginners');
    fill(host, 'Run (optional)', 'Foundations');
    await settle(fixture);

    press(host, 'Offer to trainees');
    await settle(fixture);
    expect(under(host, 'Block number')).toBe(
      'Say which block of the run this is: 1 for the first.',
    );
    expect(document.activeElement).toBe(field(host, 'Block number'));

    fill(host, 'Block number', '1.5');
    await settle(fixture);
    expect(under(host, 'Block number')).toBe(
      'A block’s place in its run is a whole number from 1 to 52.',
    );

    fill(host, 'Run (optional)', '   ');
    await settle(fixture);
    expect(under(host, 'Run (optional)')).toBe(
      'Name the run this block belongs to, or leave its place empty.',
    );
    expect(offer).not.toHaveBeenCalled();
  });

  it('opens the rounding to say a step it refuses, and sends Down by its name', async () => {
    const { fixture, host, offer } = await render();
    await chooseOption(fixture, host, 'Program', 'Upper lower');
    fill(host, 'Whom it suits', 'Beginners');
    await toggleFold(fixture, host, 'Rounding');
    fill(host, 'Round loads to', '1.255');
    await toggleFold(fixture, host, 'Rounding', false);

    press(host, 'Offer to trainees');
    await settle(fixture);
    expect(fold(host, 'Rounding').open).toBe(true);
    expect(under(host, 'Round loads to')).toBe(
      'Round loads to a step above 0 and at most 50, with two decimals at most.',
    );
    expect(offer).not.toHaveBeenCalled();

    fill(host, 'Round loads to', '1.25');
    segment(host, 'Round', 'Down').click();
    await settle(fixture);
    expect(textOf(fold(host, 'Rounding').querySelector('summary .hint'))).toBe('rounded down 1.25');
    press(host, 'Offer to trainees');
    await settle(fixture);
    expect(offer).toHaveBeenCalledWith(
      'template-2',
      expect.objectContaining({ loadIncrement: 1.25, loadRoundingMode: 'Down' }),
    );
  });

  it('changes an offered program’s terms from its row, with its version, and says Save', async () => {
    const { fixture, host, offer } = await render({ fixed: 'template-1' });

    expect(host.querySelector('app-select')).toBeNull();
    expect(textOf(host.querySelector('.program-line'))).toBe('Strength base 2 weeks · kg');
    expect(field(host, 'Whom it suits').value).toBe('New to the barbell, two days a week.');
    expect(field(host, 'Run (optional)').value).toBe('Foundations');
    expect(field(host, 'Block number').value).toBe('1');
    expect(textOf(fold(host, 'Rounding').querySelector('summary .hint'))).toBe(
      'kg · rounded to the nearest 2.5',
    );
    await toggleFold(fixture, host, 'Rounding');
    expect(textOf(host.querySelector('.value-unit .unit'))).toBe('kg');

    fill(host, 'Block number', '3');
    press(host, 'Save');
    await settle(fixture);

    expect(offer).toHaveBeenCalledWith('template-1', {
      suits: 'New to the barbell, two days a week.',
      runName: 'Foundations',
      runPosition: 3,
      loadIncrement: 2.5,
      loadRoundingMode: 'Nearest',
      version: 3,
    });
  });

  it('offers a withdrawn program again with its version', async () => {
    const withdrawn = toHouseListing(houseListing({ isOffered: false, version: 5 }));
    const { fixture, host, offer } = await render({ fixed: 'template-1', listings: [withdrawn] });

    press(host, 'Offer to trainees');
    await settle(fixture);

    expect(offer).toHaveBeenCalledWith('template-1', expect.objectContaining({ version: 5 }));
  });

  it('says a place already taken under Block number until it is changed', async () => {
    const message =
      '"Upper lower" is already block 1 of Foundations. Give this one another place, or withdraw that one first.';
    const { fixture, host, stale, closed } = await render({
      fixed: 'template-1',
      offer: () =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { code: 'house_program_run_position_taken', message },
            }),
        ),
    });

    fill(host, 'Whom it suits', 'Beginners');
    press(host, 'Save');
    await settle(fixture);
    expect(under(host, 'Block number')).toBe(message);
    expect(textOf(formSummary(host))).toBe('Check the fields marked above.');
    expect([stale, closed].map((spy) => spy.mock.calls.length)).toEqual([0, 0]);

    fill(host, 'Block number', '2');
    await settle(fixture);
    expect(under(host, 'Block number')).toBe(
      'Its place in the run: 1 for the first block. Empty for a program on its own.',
    );
  });

  it('puts the server’s word on a field under it, and forgets it once that field is changed', async () => {
    const { fixture, host } = await render({
      fixed: 'template-1',
      offer: () =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 400,
              error: { errors: { suits: ['Keep whom it suits to one line.'] } },
            }),
        ),
    });

    press(host, 'Save');
    await settle(fixture);
    expect(under(host, 'Whom it suits')).toBe('Keep whom it suits to one line.');

    fill(host, 'Whom it suits', 'Beginners');
    await settle(fixture);
    expect(under(host, 'Whom it suits')).toBe(
      'For example: Beginners who can train three days a week.',
    );
  });

  it('says a refused program in the summary when it is fixed', async () => {
    const { fixture, host } = await render({
      fixed: 'template-1',
      offer: () =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 400,
              error: {
                errors: { templateId: ['This program is archived, so trainees can’t start it.'] },
              },
            }),
        ),
    });

    press(host, 'Save');
    await settle(fixture);
    expect(textOf(formSummary(host))).toBe('This program is archived, so trainees can’t start it.');
  });

  it('says a change made meanwhile in its own words and asks for a fresh read', async () => {
    const { fixture, host, stale, closed } = await render({
      fixed: 'template-1',
      offer: () =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: {
                code: 'concurrency_conflict',
                message: 'Training data was changed by another request.',
              },
            }),
        ),
    });

    press(host, 'Save');
    await settle(fixture);
    expect(textOf(formSummary(host))).toBe(
      'Someone changed this program’s terms meanwhile. Read them again.',
    );
    expect(stale).toHaveBeenCalledTimes(1);
    expect(closed).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(formSummary(host));
  });

  it('takes the fresh version and terms once the list is read again, keeping what was typed', async () => {
    const { fixture, host, offer } = await render({ fixed: 'template-1' });
    fill(host, 'Run (optional)', 'Strength Base');
    await settle(fixture);

    fixture.componentRef.setInput('listings', [
      toHouseListing(houseListing({ suits: 'After block 1.', version: 4 })),
    ]);
    await settle(fixture);
    expect(field(host, 'Whom it suits').value).toBe('After block 1.');
    expect(field(host, 'Run (optional)').value).toBe('Strength Base');

    press(host, 'Save');
    await settle(fixture);
    expect(offer).toHaveBeenCalledWith(
      'template-1',
      expect.objectContaining({ suits: 'After block 1.', runName: 'Strength Base', version: 4 }),
    );
  });

  it('says a read-only space in the summary', async () => {
    const { fixture, host } = await render({
      fixed: 'template-1',
      offer: () =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 403,
              error: { code: 'workspace_read_only', message: 'Read only.' },
            }),
        ),
    });

    press(host, 'Save');
    await settle(fixture);
    expect(textOf(formSummary(host))).toBe(
      'Your coaching space is read-only until its TB Gym bill is paid. You can still view everything.',
    );
  });

  it('stays busy while the save is on its way: one save, and Not now waits', async () => {
    const answer = new Subject<HouseListing>();
    const { fixture, host, offer, busy, closed } = await render({
      fixed: 'template-1',
      offer: () => answer,
    });

    press(host, 'Save');
    await settle(fixture);
    expect(busy).toHaveBeenLastCalledWith(true);
    const saving = button(host, 'Saving…');
    expect(saving.getAttribute('aria-disabled') ?? String(saving.disabled)).toMatch(/true/);
    saving.click();
    expect(button(host, 'Not now').disabled).toBe(true);
    await settle(fixture);
    expect(offer).toHaveBeenCalledTimes(1);

    answer.next(LISTED);
    answer.complete();
    await settle(fixture);
    expect(busy).toHaveBeenLastCalledWith(false);
    expect(closed).toHaveBeenCalledWith(LISTED);
  });

  it('closes on Not now with nothing saved', async () => {
    const { fixture, host, closed, dirty } = await render({ fixed: 'template-1' });

    expect(dirty).toHaveBeenLastCalledWith(false);
    press(host, 'Not now');
    await settle(fixture);
    expect(closed).toHaveBeenCalledWith(null);
  });
});

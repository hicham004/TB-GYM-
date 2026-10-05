import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api-client';
import type { ProgramTemplatePage } from '../../core/api/generated';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { press, settle } from '../../../testing/dom';
import { templateSummary } from '../../../testing/program-builder-fixtures';
import { ProgramList } from './program-list';

async function render(list: () => Observable<ProgramTemplatePage>) {
  const api = { listProgramTemplates: vi.fn(list) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'training/programs', component: ProgramList }]),
      { provide: ApiClient, useValue: api },
      { provide: TenantStore, useValue: { selectedTenantId: signal('tenant-1') } },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/training/programs', ProgramList);
  await settle(harness.fixture);
  return { harness, host: harness.routeNativeElement as HTMLElement, api };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const page = (items: ProgramTemplatePage['items']): ProgramTemplatePage => ({
  items,
  total: items.length,
  skip: 0,
  take: 100,
});

describe('Programs', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows each program as a card that opens it in the builder', async () => {
    const draftOnly = templateSummary({
      id: 'template-2',
      name: 'Hypertrophy block',
      versions: [
        {
          id: 'draft-1',
          versionNumber: 1,
          name: 'Hypertrophy block',
          isPublished: false,
          weekCount: 1,
          createdAtUtc: '2026-10-04T09:00:00Z',
        },
      ],
    });
    const { host } = await render(() => of(page([templateSummary(), draftOnly])));

    expect(textOf(host.querySelector('h1'))).toBe('Programs');
    expect(textOf(host.querySelector('.lede'))).toBe('2 programs, 1 ready to assign');
    const cards = Array.from(host.querySelectorAll('.card'));
    expect(
      cards.map((card) =>
        ['app-status-pill', '.weeks', '.card-name', '.card-meta'].map((part) =>
          textOf(card.querySelector(part)),
        ),
      ),
    ).toEqual([
      ['Ready to assign', '2 weeks', 'Strength base', 'Changed Fri 2 Oct'],
      ['Draft', '1 week', 'Hypertrophy block', 'Changed Sun 4 Oct'],
    ]);
    expect(cards[0].querySelector('a')?.getAttribute('href')).toBe('/training/programs/template-1');
    expect(host.querySelector('a[href="/training/programs/new"]')).not.toBeNull();
  });

  it('invites a coach with no program to build the first one', async () => {
    const { host } = await render(() => of(page([])));

    expect(textOf(host.querySelector('app-empty-state h2'))).toBe('No programs yet');
    expect(textOf(host.querySelector('app-empty-state a'))).toBe('Build your first program');
  });

  it('says when the programs could not be read, and tries again', async () => {
    let calls = 0;
    const { host, harness, api } = await render(() =>
      ++calls === 1
        ? throwError(() => new HttpErrorResponse({ status: 500 }))
        : of(page([templateSummary()])),
    );

    expect(textOf(host.querySelector('[role="alert"]'))).toBe('Your programs could not be loaded.');
    press(host, 'Try again');
    await settle(harness.fixture);
    expect(api.listProgramTemplates).toHaveBeenCalledTimes(2);
    expect(host.querySelectorAll('.card')).toHaveLength(1);
  });
});

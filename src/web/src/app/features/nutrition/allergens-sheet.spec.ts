import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allergens } from '../../../testing/client-nutrition-fixtures';
import { press, settle, tick } from '../../../testing/dom';
import type { AllergenCode } from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { EditAllergens } from './allergens-sheet';
import { ClientNutritionApi } from './client-nutrition-api';

interface Api {
  allergens?: ReturnType<typeof vi.fn>;
  replaceAllergens?: ReturnType<typeof vi.fn>;
}

async function render(
  declared: AllergenCode[],
  api: Api = {},
  inputs: Record<string, unknown> = {},
  tenant = signal('t-1'),
) {
  await TestBed.configureTestingModule({
    imports: [EditAllergens],
    providers: [
      { provide: ClientNutritionApi, useValue: api },
      { provide: CsrfService, useValue: { refresh: vi.fn(() => Promise.resolve()) } },
      { provide: TenantStore, useValue: { selectedTenantId: tenant } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(EditAllergens);
  for (const [name, value] of Object.entries({
    clientId: 'client-1',
    firstName: 'Rana',
    declared,
    ...inputs,
  })) {
    fixture.componentRef.setInput(name, value);
  }
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, tenant };
}

const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const ticked = (host: ParentNode) =>
  Array.from(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')).map(
    (box) => box.name,
  );

describe('Edit allergens', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('opens with what is declared now ticked, and what the client wrote about it', async () => {
    const { host } = await render(
      ['Milk', 'Peanuts'],
      {},
      { theirWords: 'Peanuts, and milk when sick' },
    );

    expect(ticked(host)).toEqual(['Peanuts', 'Milk']);
    expect(host.querySelectorAll('input[type="checkbox"]').length).toBe(14);
    expect(textOf(host.querySelector('[data-theirs]'))).toBe(
      'What Rana wrote about allergies Peanuts, and milk when sick',
    );
    expect(textOf(host)).toContain('An allergen left unticked never proves a recipe is safe.');
  });

  it('shows no quote when the client wrote nothing', async () => {
    const { host } = await render([]);
    expect(host.querySelector('[data-theirs]')).toBeNull();
    expect(ticked(host)).toEqual([]);
  });

  it('saves the whole list in the list’s order, after reading it once more', async () => {
    const read = vi.fn(() => of(allergens('Milk')));
    const replaceAllergens = vi.fn(() => of(undefined));
    const { fixture, host } = await render(['Milk'], { allergens: read, replaceAllergens });
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    tick(host, 'Sesame');
    tick(host, 'Eggs');
    tick(host, 'Milk', false);
    await settle(fixture);
    press(host, 'Save allergens');
    await settle(fixture);

    expect(read).toHaveBeenCalledWith('client-1');
    expect(replaceAllergens).toHaveBeenCalledWith('client-1', ['Eggs', 'Sesame']);
    expect(closed).toHaveBeenCalledWith(['Eggs', 'Sesame']);
  });

  it('can declare none, which clears the list', async () => {
    const replaceAllergens = vi.fn(() => of(undefined));
    const { fixture, host } = await render(['Milk'], {
      allergens: vi.fn(() => of(allergens('Milk'))),
      replaceAllergens,
    });
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    tick(host, 'Milk', false);
    await settle(fixture);
    press(host, 'Save allergens');
    await settle(fixture);
    expect(replaceAllergens).toHaveBeenCalledWith('client-1', []);
    expect(closed).toHaveBeenCalledWith([]);
  });

  it('closes without saving when nothing changed', async () => {
    const replaceAllergens = vi.fn();
    const { fixture, host } = await render(['Milk'], { replaceAllergens });
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    press(host, 'Save allergens');
    await settle(fixture);
    expect(replaceAllergens).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledWith(null);
  });

  it('does not replace a list someone else changed meanwhile, and says what it is now', async () => {
    const read = vi.fn(() => of(allergens('Milk', 'Eggs')));
    const replaceAllergens = vi.fn();
    const { fixture, host } = await render(['Milk'], { allergens: read, replaceAllergens });
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    tick(host, 'Sesame');
    await settle(fixture);
    press(host, 'Save allergens');
    await settle(fixture);

    expect(replaceAllergens).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
    expect(textOf(host.querySelector('.refusal'))).toBe(
      'The list was changed while you were editing: Eggs and milk declared now. Check the boxes and save again.',
    );
    // What was ticked is kept, and the next save goes through against the list just read.
    expect(ticked(host)).toEqual(['Milk', 'Sesame']);
    press(host, 'Save allergens');
    await settle(fixture);
    expect(replaceAllergens).toHaveBeenCalledWith('client-1', ['Milk', 'Sesame']);
  });

  it('says in words when the list could not be saved, and keeps the ticks', async () => {
    const replaceAllergens = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 })));
    const { fixture, host } = await render([], {
      allergens: vi.fn(() => of(allergens())),
      replaceAllergens,
    });
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    tick(host, 'Fish');
    await settle(fixture);
    press(host, 'Save allergens');
    await settle(fixture);

    expect(textOf(host.querySelector('.refusal'))).toBe(
      'The allergens could not be saved. Try again.',
    );
    expect(ticked(host)).toEqual(['Fish']);
    expect(closed).not.toHaveBeenCalled();
  });

  it('tells the page it holds typed work, and stops when the boxes match again', async () => {
    const { fixture, host } = await render(['Milk']);
    const dirty = vi.fn();
    fixture.componentInstance.dirtyChange.subscribe(dirty);

    tick(host, 'Eggs');
    await settle(fixture);
    expect(dirty).toHaveBeenLastCalledWith(true);
    tick(host, 'Eggs', false);
    await settle(fixture);
    expect(dirty).toHaveBeenLastCalledWith(false);
  });

  it('drops the answer when the workspace changes while it is saved', async () => {
    const answer = new Subject<void>();
    const { fixture, host, tenant } = await render([], {
      allergens: vi.fn(() => of(allergens())),
      replaceAllergens: vi.fn(() => answer),
    });
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    tick(host, 'Fish');
    await settle(fixture);
    press(host, 'Save allergens');
    await settle(fixture);
    tenant.set('t-2');
    answer.next();
    answer.complete();
    await settle(fixture);

    expect(closed).not.toHaveBeenCalled();
  });

  it('closes without a list when the coach says not now', async () => {
    const { fixture, host } = await render(['Milk']);
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    press(host, 'Not now');
    await settle(fixture);
    expect(closed).toHaveBeenCalledWith(null);
  });
});

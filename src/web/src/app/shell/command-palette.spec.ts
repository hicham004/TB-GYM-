import { ApplicationRef, Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientListView } from '../../testing/client-list-fixtures';
import { MessageUnreadStore } from '../core/messaging/message-unread.store';
import { TenantStore } from '../core/tenancy/tenant.store';
import { ClientListApi } from '../features/clients/client-list-api';
import { matchesQuery, openCommandPalette, pageItems } from './command-palette';

/** Lets the read land and the overlay's component draw (it is attached to the application, not a fixture). */
async function flush(): Promise<void> {
  for (let round = 0; round < 3; round++) {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.inject(ApplicationRef).tick();
  }
}

async function open(
  options: {
    owner?: boolean;
    messaging?: boolean;
    tenantId?: string;
    getOverview?: () => unknown;
  } = {},
) {
  const listApi = { getOverview: vi.fn(options.getOverview ?? (() => of(clientListView()))) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      { provide: ClientListApi, useValue: listApi },
      {
        provide: TenantStore,
        useValue: {
          selectedTenantId: signal(options.tenantId ?? 'tenant-1'),
          isOwner: signal(options.owner ?? true),
        },
      },
      { provide: MessageUnreadStore, useValue: { isAvailable: signal(options.messaging ?? true) } },
    ],
  });
  const before = document.createElement('button');
  before.id = 'before';
  document.body.append(before);
  before.focus();
  const onClosed = vi.fn();
  const handle = openCommandPalette(TestBed.inject(Injector), onClosed);
  await flush();
  return { handle, onClosed, before, listApi, router: TestBed.inject(Router) };
}

const dialog = () =>
  document.querySelector<HTMLElement>('[role="dialog"][aria-label="Go to a page or a client"]');
const input = () => document.querySelector<HTMLInputElement>('[role="combobox"]');
const labels = () =>
  Array.from(document.querySelectorAll('[role="option"] .label')).map((label) =>
    label.textContent?.trim(),
  );
const activeLabel = () =>
  document.querySelector('[role="option"][aria-selected="true"] .label')?.textContent?.trim();
const groups = () =>
  Array.from(document.querySelectorAll('[role="group"]')).map((group) =>
    group.getAttribute('aria-label'),
  );

function key(name: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  input()?.dispatchEvent(event);
  return event;
}

async function type(text: string): Promise<void> {
  const field = input();
  if (!field) throw new Error('The palette is not open.');
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await flush();
}

describe('the coach’s palette (motion plan W14)', () => {
  afterEach(() => {
    document.getElementById('before')?.remove();
    document.querySelector('.cdk-overlay-container')?.remove();
  });

  it('opens on the pages in the plan’s order, the first one active and focus in the field', async () => {
    await open();

    expect(dialog()).not.toBeNull();
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(input());
    expect(groups()).toEqual(['Pages']);
    expect(labels()).toEqual([
      'Today',
      'Clients',
      'Training',
      'Nutrition',
      'Check-ins',
      'Messages',
      'Products',
      'Team',
      'This month',
      'Settings',
    ]);
    expect(activeLabel()).toBe('Today');
    expect(input()?.getAttribute('aria-activedescendant')).toBe('tb-palette-overview');
    // The page a name alone does not say, as the plan words it ("Programs").
    expect(document.querySelector('#tb-palette-training .hint')?.textContent?.trim()).toBe(
      'Programs',
    );
  });

  it('narrows the pages as letters are typed, by their hint too; Enter opens the active one', async () => {
    const { router, onClosed } = await open();

    await type('prog');
    expect(labels()).toEqual(['Training']);
    expect(activeLabel()).toBe('Training');

    key('Enter');
    await flush();

    expect(router.url).toBe('/training/programs');
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it('lists clients by any word of their name from two letters on, and opens one', async () => {
    const { router } = await open();

    await type('r');
    expect(groups()).toEqual(['Pages']);

    await type('ri');
    expect(groups()).toEqual(['Clients']);
    expect(labels()).toContain('Tala Rizk');
    expect(labels()).toContain('Rita Daher');

    await type('tala');
    expect(labels()).toEqual(['Tala Rizk']);
    expect(activeLabel()).toBe('Tala Rizk');

    key('Enter');
    await flush();
    expect(router.url).toBe('/clients/c-tala');
  });

  it('loops with the arrow keys and follows the pointer', async () => {
    await open();

    key('ArrowUp');
    await flush();
    expect(activeLabel()).toBe('Settings');

    key('ArrowDown');
    await flush();
    expect(activeLabel()).toBe('Today');

    key('ArrowDown');
    await flush();
    expect(activeLabel()).toBe('Clients');

    document
      .getElementById('tb-palette-team')
      ?.dispatchEvent(new Event('pointermove', { bubbles: true }));
    await flush();
    expect(activeLabel()).toBe('Team');
  });

  it('closes on Escape and gives focus back where it was', async () => {
    const { before, onClosed } = await open();

    const escape = key('Escape');
    await flush();

    expect(escape.defaultPrevented).toBe(true);
    expect(dialog()).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(before);
  });

  it('closes on the backdrop and on Tab, once each', async () => {
    const { onClosed, handle } = await open();

    document.querySelector<HTMLElement>('.cdk-overlay-backdrop')?.click();
    await flush();
    expect(dialog()).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(1);

    handle.close();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('a click on a line opens it', async () => {
    const { router } = await open();

    document.getElementById('tb-palette-clients')?.click();
    await flush();

    expect(router.url).toBe('/clients');
    expect(dialog()).toBeNull();
  });

  it('a coach’s Settings opens their own pages, and without messaging there is no Messages', async () => {
    const { router } = await open({ owner: false, messaging: false });

    expect(labels()).not.toContain('Messages');
    key('ArrowUp');
    key('Enter');
    await flush();

    expect(router.url).toBe('/notifications/settings');
  });

  it('a failed read leaves the pages working and shows no client (none read before here)', async () => {
    await open({ tenantId: 'tenant-2', getOverview: () => throwError(() => new Error('down')) });

    await type('tala');

    expect(labels()).toEqual([]);
    expect(document.querySelector('.none')?.textContent?.trim()).toBe('Nothing matches');
    await type('');
    expect(labels()).toHaveLength(10);
  });
});

describe('matchesQuery', () => {
  it('matches every typed word against the start of a word, without case or accents', () => {
    expect(matchesQuery('Maya Fakhoury', 'may')).toBe(true);
    expect(matchesQuery('Maya Fakhoury', 'fakh')).toBe(true);
    expect(matchesQuery('Maya Fakhoury', 'ma fa')).toBe(true);
    expect(matchesQuery('Élie Khoury', 'elie')).toBe(true);
    expect(matchesQuery('Maya Fakhoury', 'aya')).toBe(false);
    expect(matchesQuery('Training Programs', 'prog')).toBe(true);
  });
});

describe('pageItems', () => {
  it('sends a coach to their own Settings and keeps Team, This month before Settings', () => {
    const coach = pageItems(false, true);
    expect(coach.map((page) => page.label).slice(-3)).toEqual(['Team', 'This month', 'Settings']);
    expect(coach.find((page) => page.label === 'Settings')?.link).toBe('/notifications/settings');
    expect(coach.find((page) => page.label === 'Team')?.link).toBe('/team');
    expect(pageItems(true, true).find((page) => page.label === 'Settings')?.link).toBe(
      '/workspace',
    );
  });
});

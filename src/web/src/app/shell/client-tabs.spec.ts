import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientAccessStore } from '../core/access/client-access.store';
import { MessageUnreadStore } from '../core/messaging/message-unread.store';
import { settle } from '../../testing/dom';
import { fakeClientAccess } from '../../testing/today-fixtures';
import { CLIENT_TABS, clientTabState } from './client-navigation';
import { CLIENT_TABS_BLOCK_SIZE, ClientTabs } from './client-tabs';

async function render(access = fakeClientAccess(), unread = 0, url = '/') {
  await TestBed.configureTestingModule({
    imports: [ClientTabs],
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      { provide: ClientAccessStore, useValue: access },
      {
        provide: MessageUnreadStore,
        useValue: { unread: signal(unread), isAvailable: signal(true) },
      },
    ],
  }).compileComponents();
  await TestBed.inject(Router).navigateByUrl(url);
  const fixture = TestBed.createComponent(ClientTabs);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  const tabs = () => [...host.querySelectorAll<HTMLAnchorElement>('nav a')];
  return { fixture, host, tabs, access };
}

describe('ClientTabs', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('offers Today, Training, Nutrition, Progress and Messages in a labelled navigation', async () => {
    const { host, tabs } = await render();

    expect(host.querySelector('nav')?.getAttribute('aria-label')).toBe('Client navigation');
    expect(tabs().map((tab) => tab.querySelector('.label')?.textContent?.trim())).toEqual([
      'Today',
      'Training',
      'Nutrition',
      'Progress',
      'Messages',
    ]);
    expect(tabs().map((tab) => tab.getAttribute('href'))).toEqual([
      '/',
      '/training/program',
      '/nutrition/today',
      '/progress/dashboard',
      '/messages',
    ]);
  });

  it('hides only a feature that is not in the plan', async () => {
    const { tabs } = await render(
      fakeClientAccess({ Nutrition: 'NoEntitlement', Messaging: 'NoEntitlement' }),
    );
    expect(tabs().map((tab) => tab.getAttribute('href'))).toEqual([
      '/',
      '/training/program',
      '/progress/dashboard',
    ]);
  });

  it('keeps a paused or ended feature so its page can explain why', async () => {
    const { tabs } = await render(
      fakeClientAccess({ Training: 'Paused', Nutrition: 'Expired', Messaging: 'Cancelled' }),
    );
    expect(tabs()).toHaveLength(5);
  });

  it('shows every tab while the plan is unknown, and follows the answer when it arrives', async () => {
    const access = fakeClientAccess({}, 'failed');
    const { fixture, tabs } = await render(access);
    expect(tabs()).toHaveLength(5);

    access.set({ Training: 'NoEntitlement' });
    await settle(fixture);
    expect(tabs().map((tab) => tab.getAttribute('href'))).not.toContain('/training/program');
  });

  it('marks the open page, and its section from another page of it', async () => {
    const today = await render();
    expect(today.tabs()[0].getAttribute('aria-current')).toBe('page');
    expect(today.tabs()[0].classList).toContain('selected');
    expect(
      today
        .tabs()
        .slice(1)
        .every((tab) => tab.getAttribute('aria-current') === null),
    ).toBe(true);
    TestBed.resetTestingModule();

    const bodyweight = await render(fakeClientAccess(), 0, '/progress');
    expect(bodyweight.tabs()[3].getAttribute('aria-current')).toBe('true');
    expect(bodyweight.tabs()[0].getAttribute('aria-current')).toBeNull();
  });

  it('counts unread messages in words as well as in the badge', async () => {
    const one = await render(fakeClientAccess(), 1);
    const messages = one.tabs()[4];
    expect(messages.querySelector('.count')?.textContent?.trim()).toBe('1');
    expect(messages.querySelector('.count')?.getAttribute('aria-hidden')).toBe('true');
    expect(messages.textContent?.replace(/\s+/g, ' ').trim()).toMatch(
      /Messages\s?, 1 unread message$/,
    );
    TestBed.resetTestingModule();

    const many = await render(fakeClientAccess(), 120);
    expect(many.tabs()[4].querySelector('.count')?.textContent?.trim()).toBe('99+');
    expect(many.tabs()[4].textContent).toContain('120 unread messages');
  });

  it('has no badge when nothing is unread', async () => {
    const { tabs } = await render();
    expect(tabs()[4].querySelector('.count')).toBeNull();
    expect(tabs()[4].textContent).not.toContain('unread');
  });

  it('publishes its height for pinned page elements, and takes it away when it goes', async () => {
    // jsdom has no layout, so the observer reports once on observe and the height reads as 0px.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly report: () => void) {}
        observe(): void {
          this.report();
        }
        disconnect(): void {
          // Nothing to release.
        }
      },
    );
    const root = document.documentElement.style;
    try {
      const { fixture } = await render();
      expect(root.getPropertyValue(CLIENT_TABS_BLOCK_SIZE)).toBe('0px');

      fixture.destroy();
      expect(root.getPropertyValue(CLIENT_TABS_BLOCK_SIZE)).toBe('');
    } finally {
      vi.unstubAllGlobals();
      root.removeProperty(CLIENT_TABS_BLOCK_SIZE);
    }
  });
});

describe('clientTabState', () => {
  const [today, training, , progress] = CLIENT_TABS;

  it('selects a tab as the page on its own link, ignoring the query', () => {
    expect(clientTabState('/', today)).toBe('page');
    expect(clientTabState('/training/program?week=2', training)).toBe('page');
  });

  it('selects a section for another page of it, and nothing elsewhere', () => {
    expect(clientTabState('/progress', progress)).toBe('section');
    expect(clientTabState('/training/today?sessionId=a', training)).toBe('section');
    expect(clientTabState('/me', today)).toBeNull();
    expect(clientTabState('/checkins/me', today)).toBeNull();
  });
});

describe('the unread pill ticks (motion plan W8)', () => {
  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('draws the count afresh for each number, carrying the tick class', async () => {
    const unread = signal(1);
    await TestBed.configureTestingModule({
      imports: [ClientTabs],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: ClientAccessStore, useValue: fakeClientAccess() },
        { provide: MessageUnreadStore, useValue: { unread, isAvailable: signal(true) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ClientTabs);
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;
    const first = host.querySelector('.count');
    expect(first?.classList.contains('tb-pill-tick')).toBe(true);
    expect(first?.textContent?.trim()).toBe('1');

    unread.set(2);
    await settle(fixture);
    const second = host.querySelector('.count');
    expect(second?.textContent?.trim()).toBe('2');
    expect(second).not.toBe(first);
  });

  it('leaves the tick off while the row is switched off', async () => {
    localStorage.setItem('tb-motion-off', 'W3, W8');
    await TestBed.configureTestingModule({
      imports: [ClientTabs],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: ClientAccessStore, useValue: fakeClientAccess() },
        { provide: MessageUnreadStore, useValue: { unread: signal(3), isAvailable: signal(true) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ClientTabs);
    await settle(fixture);
    const count = (fixture.nativeElement as HTMLElement).querySelector('.count');
    expect(count?.textContent?.trim()).toBe('3');
    expect(count?.classList.contains('tb-pill-tick')).toBe(false);
  });
});

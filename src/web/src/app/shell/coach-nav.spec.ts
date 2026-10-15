import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageUnreadStore } from '../core/messaging/message-unread.store';
import { TenantStore } from '../core/tenancy/tenant.store';
import { settingsGroups } from '../features/settings/settings-groups';
import { settle } from '../../testing/dom';
import { CoachNav } from './coach-nav';
import { COACH_NAVIGATION, destinationState, urlPath } from './coach-navigation';

const ROUTES = [
  '',
  'clients',
  'invitations',
  'training/programs',
  'training/exercises',
  'nutrition/plans',
  'nutrition/foods',
  'checkins/forms',
  'checkins/clients',
  'messages',
  'products',
  'workspace',
  'notifications',
  'notifications/settings',
  'account/appearance',
].map((path) => ({ path, children: [] }));

async function render(options: { owner?: boolean; unread?: number; messaging?: boolean } = {}) {
  await TestBed.configureTestingModule({
    imports: [CoachNav],
    providers: [
      provideRouter(ROUTES),
      {
        provide: TenantStore,
        useValue: { isOwner: signal(Boolean(options.owner)) },
      },
      {
        provide: MessageUnreadStore,
        useValue: {
          unread: signal(options.unread ?? 0),
          isAvailable: signal(options.messaging ?? true),
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CoachNav);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    host,
    async go(url: string) {
      await TestBed.inject(Router).navigateByUrl(url);
      await settle(fixture);
    },
    links: () => Array.from(host.querySelectorAll<HTMLAnchorElement>('a.item')),
    labels: () =>
      Array.from(host.querySelectorAll('a.item .label')).map((label) => label.textContent?.trim()),
  };
}

describe('coach navigation', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('is the locked list, in order, in three headed groups', async () => {
    const { host, labels } = await render({ owner: true });

    expect(labels()).toEqual([
      'Today',
      'Clients',
      'Training',
      'Nutrition',
      'Check-ins',
      'Messages',
      'Products',
      'Settings',
    ]);
    expect(
      Array.from(host.querySelectorAll('.group-label')).map((label) => label.textContent?.trim()),
    ).toEqual(['Coaching', 'Operations', 'Business']);
    // Group labels are headings, never controls.
    for (const label of Array.from(host.querySelectorAll('.group-label'))) {
      expect(label.tagName).toBe('H2');
      expect(label.querySelector('a, button')).toBeNull();
    }
  });

  it('points every destination at a real route', async () => {
    const { links } = await render({ owner: true });

    expect(links().map((link) => link.getAttribute('href'))).toEqual([
      '/',
      '/clients',
      '/training/programs',
      '/nutrition/plans',
      '/checkins/forms',
      '/messages',
      '/products',
      '/workspace',
    ]);
  });

  /** Every coach has Settings; theirs opens on their own account pages, never the owner's (C13). */
  it('gives a coach Settings on their own account pages, and the owner on the coaching space', async () => {
    const coach = await render({ owner: false });
    expect(coach.labels()).toEqual([
      'Today',
      'Clients',
      'Training',
      'Nutrition',
      'Check-ins',
      'Messages',
      'Products',
      'Settings',
    ]);
    expect(coach.links().at(-1)?.getAttribute('href')).toBe('/notifications/settings');
    expect(coach.host.querySelector('a[href="/workspace"]')).toBeNull();
    TestBed.resetTestingModule();

    const owner = await render({ owner: true });
    expect(owner.links().at(-1)?.getAttribute('href')).toBe('/workspace');
  });

  it('keeps a coach’s Settings current on each of their account pages', async () => {
    const { host, go } = await render({ owner: false });
    const settings = () => host.querySelector('a[data-destination="settings"]');

    await go('/notifications/settings');
    expect(settings()?.getAttribute('aria-current')).toBe('page');

    await go('/account/appearance');
    expect(settings()?.getAttribute('aria-current')).toBe('true');
    expect(settings()?.classList.contains('selected')).toBe(true);
  });

  it('drops Messages when messaging is not available to this member', async () => {
    const { labels } = await render({ messaging: false });

    expect(labels()).not.toContain('Messages');
  });

  /**
   * The distinction the sidebar has to get right: Training links to Programs, so on the Exercises
   * page it stands for the section that is open, not for the page. Saying `aria-current="page"`
   * there would tell a screen-reader user they are already on the link's page.
   */
  it('marks the exact page as the current page', async () => {
    const { host, go } = await render({ owner: true });
    await go('/training/programs');

    expect(host.querySelector('a[href="/training/programs"]')?.getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('marks a section it only contains as current, not as the current page', async () => {
    const { host, go } = await render({ owner: true });
    await go('/training/exercises');

    const training = host.querySelector('a[href="/training/programs"]');
    expect(training?.getAttribute('aria-current')).toBe('true');
    expect(training?.classList.contains('selected')).toBe(true);
  });

  it('marks nothing outside the navigation, such as the inbox', async () => {
    const { host, go } = await render({ owner: true });
    await go('/notifications');

    expect(host.querySelector('a.item[aria-current]')).toBeNull();
  });

  it('keeps Today for the root page alone', async () => {
    const { host, go } = await render({ owner: true });
    await go('/clients');

    expect(host.querySelector('a[href="/"]')?.getAttribute('aria-current')).toBeNull();
    expect(host.querySelector('a[href="/clients"]')?.getAttribute('aria-current')).toBe('page');
  });

  it('keeps Clients selected on the invitations page it leads to', async () => {
    const { host, go } = await render({ owner: true });
    await go('/invitations');

    expect(host.querySelector('a[href="/clients"]')?.getAttribute('aria-current')).toBe('true');
  });

  it('states the unread message count in words beside the pill', async () => {
    const { host } = await render({ unread: 3 });

    const messages = host.querySelector('a[href="/messages"]');
    expect(messages?.querySelector('.count')?.textContent?.trim()).toBe('3');
    expect(messages?.textContent).toContain('3 unread messages');
    expect(messages?.querySelector('.count')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows one unread message in the singular', async () => {
    const { host } = await render({ unread: 1 });

    expect(host.querySelector('a[href="/messages"]')?.textContent).toContain('1 unread message');
  });

  it('shows no pill at all when nothing is unread', async () => {
    const { host } = await render({ unread: 0 });

    expect(host.querySelector('a[href="/messages"] .count')).toBeNull();
    expect(host.querySelector('a[href="/messages"]')?.textContent).not.toContain('unread');
  });

  it('caps a very large count at 99+ in the pill but not in words', async () => {
    const { host } = await render({ unread: 130 });

    expect(host.querySelector('a[href="/messages"] .count')?.textContent?.trim()).toBe('99+');
    expect(host.querySelector('a[href="/messages"]')?.textContent).toContain('130 unread messages');
  });
});

describe('destination state', () => {
  const training = COACH_NAVIGATION[0].destinations[2];
  const overview = COACH_NAVIGATION[0].destinations[0];

  it('ignores the query string and a trailing slash', () => {
    expect(urlPath('/training/exercises?query=squat#row')).toBe('/training/exercises');
    expect(urlPath('/clients/')).toBe('/clients');
    expect(urlPath('/')).toBe('/');
  });

  it('separates the page from the section it belongs to', () => {
    expect(destinationState(training, '/training/programs')).toBe('page');
    expect(destinationState(training, '/training/exercises')).toBe('section');
    expect(destinationState(training, '/trainingsomething')).toBeNull();
  });

  it('never lets the root page stand for everything below it', () => {
    expect(destinationState(overview, '/')).toBe('page');
    expect(destinationState(overview, '/clients')).toBeNull();
  });
});

describe('coach navigation definition', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('opens Settings at the top of each role’s Settings menu', () => {
    const settings = COACH_NAVIGATION.flatMap((group) => group.destinations).find(
      (destination) => destination.key === 'settings',
    )!;

    expect(settings.link).toBe(settingsGroups('Owner')[0].items[0].link);
    expect(settings.coachLink).toBe(settingsGroups('Coach')[0].items[0].link);
    // The coach's page is inside the section, so it keeps Settings selected for the owner too.
    expect(destinationState(settings, settings.coachLink!)).toBe('section');
  });
});

import { describe, expect, it } from 'vitest';
import { settingsGroups } from './settings-groups';

const labels = (role: Parameters<typeof settingsGroups>[0]) =>
  settingsGroups(role).map((group) => [group.label, group.items.map((item) => item.label)]);

describe('Settings pages by role', () => {
  it('gives the owner the coaching space’s pages, then their own account’s', () => {
    // Team is the owner's own sidebar row since critique B3a, out of this column.
    expect(labels('Owner')).toEqual([
      [
        'Coaching space',
        ['Name and region', 'Brand', 'Nutrition', 'Billing', 'Undelivered notices'],
      ],
      ['Your account', ['Notifications', 'Appearance', 'Password and security']],
    ]);
  });

  it('gives a coach the team to read and their own account’s pages, as the API allows them nothing else here', () => {
    // Their own account first, where their Settings opens (C13); the team they read after it.
    expect(labels('Coach')).toEqual([
      ['Your account', ['Notifications', 'Appearance', 'Password and security']],
      ['Coaching space', ['Team']],
    ]);
    expect(settingsGroups('Coach')[1].items[0].link).toBe('/team');
  });

  it('gives a client no Settings section: their pages open from Me', () => {
    expect(settingsGroups('Client')).toEqual([]);
    expect(settingsGroups(null)).toEqual([]);
  });

  it('lists the founding owner’s badge page last in their account while it waits or once earned', () => {
    for (const state of ['Waiting', 'Earned'] as const) {
      const account = settingsGroups('Owner', state)[1];
      expect(account.items.map((item) => item.label)).toEqual([
        'Notifications',
        'Appearance',
        'Password and security',
        'Founding coach',
      ]);
      expect(account.items.at(-1)!.link).toBe('/account/founding');
    }
    // Ended, never marked, or not known: nothing new (notes plan N3b).
    for (const state of ['Ended', 'NotFounding', null, undefined] as const) {
      expect(labels('Owner')).toEqual(
        settingsGroups('Owner', state).map((group) => [
          group.label,
          group.items.map((item) => item.label),
        ]),
      );
    }
  });

  it('never lists the badge page for a coach or a client, whatever they are told', () => {
    expect(settingsGroups('Coach', 'Earned')).toEqual(settingsGroups('Coach'));
    expect(settingsGroups('Client', 'Earned')).toEqual([]);
  });

  it('links each page at the address it already had, which emails and banners use', () => {
    expect(
      settingsGroups('Owner').flatMap((group) => group.items.map((item) => item.link)),
    ).toEqual([
      '/workspace',
      '/workspace/brand',
      '/workspace/nutrition',
      '/billing',
      '/workspace/undelivered-notices',
      '/notifications/settings',
      '/account/appearance',
      '/account/security',
    ]);
  });
});

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

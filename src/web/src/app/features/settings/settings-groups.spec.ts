import { describe, expect, it } from 'vitest';
import { settingsGroups } from './settings-groups';

const labels = (role: Parameters<typeof settingsGroups>[0]) =>
  settingsGroups(role).map((group) => [group.label, group.items.map((item) => item.label)]);

describe('Settings pages by role', () => {
  it('gives the owner the coaching space’s pages, then their own account’s', () => {
    expect(labels('Owner')).toEqual([
      ['Coaching space', ['Name and region', 'Brand', 'Nutrition', 'Team', 'Billing']],
      ['Your account', ['Notifications', 'Appearance', 'Password and security']],
    ]);
  });

  it('gives a coach their own account’s pages only, as the API allows them nothing else here', () => {
    expect(labels('Coach')).toEqual([
      ['Your account', ['Notifications', 'Appearance', 'Password and security']],
    ]);
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
      '/team',
      '/billing',
      '/notifications/settings',
      '/account/appearance',
      '/account/security',
    ]);
  });
});

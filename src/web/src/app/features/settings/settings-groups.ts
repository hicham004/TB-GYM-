import type { TenantRole } from '../../core/api/api.models';

export interface SettingsItem {
  readonly label: string;
  readonly link: string;
}

export interface SettingsGroup {
  readonly key: 'space' | 'account';
  readonly label: string;
  readonly items: readonly SettingsItem[];
}

/**
 * The Settings pages a person reaches, by their role in the open workspace (C9). The coaching space's
 * pages are the owner's alone, as their APIs are; every member of staff has their own account pages.
 * A client's account pages open from Me, so a client gets no Settings section at all. Team is the
 * owner's own sidebar row, and a coach reads it from here (critique B3a).
 */
export function settingsGroups(role: TenantRole | null): readonly SettingsGroup[] {
  if (role === null || role === 'Client') return [];

  const account: SettingsGroup = {
    key: 'account',
    label: $localize`Your account`,
    items: [
      { label: $localize`Notifications`, link: '/notifications/settings' },
      { label: $localize`Appearance`, link: '/account/appearance' },
      { label: $localize`Password and security`, link: '/account/security' },
    ],
  };
  // A coach's Settings still opens on their own account (C13); the team they read comes after.
  if (role !== 'Owner') {
    return [
      account,
      {
        key: 'space',
        label: $localize`Coaching space`,
        items: [{ label: $localize`Team`, link: '/team' }],
      },
    ];
  }

  return [
    {
      key: 'space',
      label: $localize`Coaching space`,
      items: [
        { label: $localize`Name and region`, link: '/workspace' },
        { label: $localize`Brand`, link: '/workspace/brand' },
        { label: $localize`Nutrition`, link: '/workspace/nutrition' },
        { label: $localize`Billing`, link: '/billing' },
        { label: $localize`Undelivered notices`, link: '/workspace/undelivered-notices' },
      ],
    },
    account,
  ];
}

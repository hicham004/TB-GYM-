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
 * A client's account pages open from Me, so a client gets no Settings section at all.
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
  if (role !== 'Owner') return [account];

  return [
    {
      key: 'space',
      label: $localize`Coaching space`,
      items: [
        { label: $localize`Name and region`, link: '/workspace' },
        { label: $localize`Brand`, link: '/workspace/brand' },
        { label: $localize`Nutrition`, link: '/workspace/nutrition' },
        { label: $localize`Team`, link: '/team' },
        { label: $localize`Billing`, link: '/billing' },
      ],
    },
    account,
  ];
}

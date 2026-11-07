import type { TenantRole } from '../../core/api/api.models';
import type { FoundingBadgeState } from '../../core/api/generated';
import { FOUNDING_COACH, showsFoundingPage } from '../billing/founding.models';

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
 *
 * `foundingCoach` is the server's word on the space's Founding coach badge (`GET /api/billing/access`,
 * notes plan N3b): the owner of a founding space finds their badge's page last in their own account,
 * while it waits or once earned. The server answers it for the owner alone; a coach never gets it.
 */
export function settingsGroups(
  role: TenantRole | null,
  foundingCoach: FoundingBadgeState | null | undefined = null,
): readonly SettingsGroup[] {
  if (role === null || role === 'Client') return [];

  const accountItems: SettingsItem[] = [
    { label: $localize`Notifications`, link: '/notifications/settings' },
    { label: $localize`Appearance`, link: '/account/appearance' },
    { label: $localize`Password and security`, link: '/account/security' },
  ];
  if (role === 'Owner' && showsFoundingPage(foundingCoach)) {
    accountItems.push({ label: FOUNDING_COACH, link: '/account/founding' });
  }
  const account: SettingsGroup = {
    key: 'account',
    label: $localize`Your account`,
    items: accountItems,
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

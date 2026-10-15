import type { IconName } from '../ui/icon';

/**
 * The locked coach navigation (Figma "Desktop Navigation v1", 118:135): three groups and eight
 * workspace-wide destinations, in this order. Group labels are headings, never controls.
 *
 * Every destination is an existing lazy route behind its existing guard. Hiding a destination, or
 * pointing a coach's at another page, is presentation only: `ownerGuard` still protects the owner's
 * Settings pages, and the API authorises every request.
 */
export type CoachDestinationKey =
  | 'overview'
  | 'clients'
  | 'training'
  | 'nutrition'
  | 'check-ins'
  | 'messages'
  | 'products'
  | 'settings';

export interface CoachDestination {
  readonly key: CoachDestinationKey;
  readonly label: string;
  readonly icon: IconName;
  /** Where the link goes: the section's landing page. */
  readonly link: string;
  /** Path prefixes the destination stands for. A path inside any of them selects it. */
  readonly section: readonly string[];
  /** Where the link goes for a coach, when that differs from the owner's page. */
  readonly coachLink?: string;
  /** Messaging has its own availability and its own unread count. */
  readonly messaging?: boolean;
}

export interface CoachNavigationGroup {
  readonly label: string;
  readonly destinations: readonly CoachDestination[];
}

export const COACH_NAVIGATION: readonly CoachNavigationGroup[] = [
  {
    label: $localize`Coaching`,
    destinations: [
      { key: 'overview', label: $localize`Today`, icon: 'overview', link: '/', section: [] },
      {
        key: 'clients',
        label: $localize`Clients`,
        icon: 'clients',
        link: '/clients',
        // Invitations are opened from the Clients page ("Invite client"), so they stay in its section.
        section: ['/clients', '/invitations'],
      },
      {
        key: 'training',
        label: $localize`Training`,
        icon: 'training',
        link: '/training/programs',
        section: ['/training'],
      },
      {
        key: 'nutrition',
        label: $localize`Nutrition`,
        icon: 'nutrition',
        link: '/nutrition/plans',
        section: ['/nutrition'],
      },
    ],
  },
  {
    label: $localize`Operations`,
    destinations: [
      {
        key: 'check-ins',
        label: $localize`Check-ins`,
        icon: 'check-ins',
        link: '/checkins/forms',
        section: ['/checkins'],
      },
      {
        key: 'messages',
        label: $localize`Messages`,
        icon: 'messages',
        link: '/messages',
        section: ['/messages'],
        messaging: true,
      },
    ],
  },
  {
    label: $localize`Business`,
    destinations: [
      {
        key: 'products',
        label: $localize`Products`,
        icon: 'products',
        link: '/products',
        section: ['/products'],
      },
      {
        key: 'settings',
        label: $localize`Settings`,
        icon: 'settings',
        // The top of each role's Settings menu (settings-groups.ts): the owner's opens on the
        // coaching space, a coach's on their own account pages, the only ones they may change (C13).
        link: '/workspace',
        coachLink: '/notifications/settings',
        // Every page of the Settings layout (R5.2a), the account pages included.
        section: ['/workspace', '/team', '/billing', '/account', '/notifications/settings'],
      },
    ],
  },
];

/** The path of a router URL, without query string or fragment, and without a trailing slash. */
export function urlPath(url: string): string {
  const path = url.split(/[?#]/, 1)[0] || '/';
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * How a destination relates to where the user is. `page` only when the link's own page is open;
 * `section` when a different page inside its section is open, such as the Exercises library under
 * Training. The distinction is what `aria-current` must say: a Training link pointing at Programs
 * is not the current page while Exercises is open.
 */
export function destinationState(
  destination: CoachDestination,
  url: string,
): 'page' | 'section' | null {
  const path = urlPath(url);
  if (path === destination.link) {
    return 'page';
  }

  return destination.section.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
    ? 'section'
    : null;
}

/** Counts show the number up to 99, then "99+" (Figma Count property). */
export function countDisplay(count: number, format: (value: number) => string): string {
  return count > 99 ? `${format(99)}+` : format(count);
}

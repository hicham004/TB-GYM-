import type { CoachingFeature } from '../core/api/api.models';
import type { IconName } from '../ui/icon';

export type ClientTabKey = 'today' | 'training' | 'nutrition' | 'progress' | 'messages';

export interface ClientTab {
  readonly key: ClientTabKey;
  readonly label: string;
  readonly link: string;
  readonly icon: IconName;
  /** The first path segment of every page this tab stands for ('' is Today alone). */
  readonly section: string;
  /** Hidden when this feature is not in the client's plan; Today and Progress always show. */
  readonly feature: CoachingFeature | null;
}

/**
 * The client's five destinations (Today 339:2140, bottom navigation 339:2142). Labels have a budget
 * of about ten characters (64px at 12px in a 72px tab); French uses "Séances" for Training.
 */
export const CLIENT_TABS: readonly ClientTab[] = [
  {
    key: 'today',
    label: $localize`:Bottom tab; about 10 characters at most:Today`,
    link: '/',
    icon: 'overview',
    section: '',
    feature: null,
  },
  {
    key: 'training',
    label: $localize`:Bottom tab; about 10 characters at most:Training`,
    link: '/training/program',
    icon: 'training',
    section: 'training',
    feature: 'Training',
  },
  {
    key: 'nutrition',
    label: $localize`:Bottom tab; about 10 characters at most:Nutrition`,
    link: '/nutrition/today',
    icon: 'nutrition',
    section: 'nutrition',
    feature: 'Nutrition',
  },
  {
    key: 'progress',
    label: $localize`:Bottom tab; about 10 characters at most:Progress`,
    link: '/progress/dashboard',
    icon: 'progress',
    section: 'progress',
    feature: null,
  },
  {
    key: 'messages',
    label: $localize`:Bottom tab; about 10 characters at most:Messages`,
    link: '/messages',
    icon: 'messages',
    section: 'messages',
    feature: 'Messaging',
  },
];

/**
 * `page` when the open path is the tab's own link, `section` when it is another page the tab
 * stands for (such as the bodyweight page under Progress), otherwise null. Query and fragment are
 * ignored, so `/training/today?sessionId=…` still selects Training as the page.
 */
export function clientTabState(url: string, tab: ClientTab): 'page' | 'section' | null {
  const path = url.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  if (path === tab.link) return 'page';
  const segment = path.split('/')[1] ?? '';
  return tab.section !== '' && segment === tab.section ? 'section' : null;
}

/** The tabs to show: a feature outside the client's plan has none. */
export function visibleClientTabs(notInPlan: (feature: CoachingFeature) => boolean): ClientTab[] {
  return CLIENT_TABS.filter((tab) => tab.feature === null || !notInPlan(tab.feature));
}

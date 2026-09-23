import type { SectionLink } from '../../ui/section-nav';

/** The owner's settings pages, shown as section links on each of them. */
export const SETTINGS_SECTIONS: readonly SectionLink[] = [
  { label: $localize`Workspace`, link: '/workspace' },
  { label: $localize`Team`, link: '/team' },
];

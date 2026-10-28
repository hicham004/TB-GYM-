import type { SectionLink } from '../../ui/section-nav';

/** To review and Forms, the two pages of Check-ins (critique B3b); the sidebar opens To review. */
export const CHECK_IN_SECTIONS: readonly SectionLink[] = [
  { label: $localize`To review`, link: '/checkins/review' },
  { label: $localize`Forms`, link: '/checkins/forms' },
];

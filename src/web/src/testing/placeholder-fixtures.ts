import type { PlaceholderSet } from '../app/features/home/home-placeholder';

/**
 * The private pre-launch build's stand-ins as its generated module describes them (UI plan R6.2h):
 * three files found in the folder, one missing, so a spec sees both the photograph and the grey
 * stand-in.
 */
export const TEST_PLACEHOLDERS: PlaceholderSet = {
  hero: { name: 'hero', file: 'hero.jpg', src: '/placeholders/hero.jpg' },
  train: { name: 'train', file: 'train.jpg', src: '/placeholders/train.jpg' },
  talk: { name: 'talk', file: 'talk.jpg', src: null },
  team: { name: 'team', file: 'team.jpg', src: '/placeholders/team.jpg' },
};

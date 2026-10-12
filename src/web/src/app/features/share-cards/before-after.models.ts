import { formatDate } from '@angular/common';
import { POSES, poseName } from '../progress/progress-entries.models';
import type { ProgressPhoto, ProgressPhotoPose } from '../progress/progress.models';

/** One pose's active photos, the earliest first: what a before-and-after can be made of. */
export interface PosePhotos {
  readonly pose: ProgressPhotoPose;
  readonly name: string;
  readonly photos: readonly ProgressPhoto[];
}

/** The two photos of a before-and-after, the earlier one first. */
export interface PhotoPair {
  readonly before: ProgressPhoto;
  readonly after: ProgressPhoto;
}

/**
 * The poses a before-and-after can show (R6.1b, PRG-013): those with active photos on two days or more,
 * as Front, Side and Back. A removed photo stays in the client's history but is never offered.
 */
export function posesToCompare(photos: readonly ProgressPhoto[]): PosePhotos[] {
  return POSES.map((pose) => ({
    pose,
    name: poseName(pose),
    photos: photos
      .filter((photo) => photo.pose === pose && photo.status === 'Active')
      .sort((a, b) => (a.photoDate < b.photoDate ? -1 : a.photoDate > b.photoDate ? 1 : 0)),
  })).filter((choice) => choice.photos.length >= 2);
}

/** Where a pose starts: its first photo and its latest. Each time afresh; nothing is remembered. */
export function firstAndLatest(choice: PosePhotos): PhotoPair {
  return { before: choice.photos[0], after: choice.photos[choice.photos.length - 1] };
}

/** Whether a photo can stand on that side of the pair: the before is earlier than the after. */
export function fitsPair(photo: ProgressPhoto, side: 'before' | 'after', pair: PhotoPair): boolean {
  return side === 'before'
    ? photo.photoDate < pair.after.photoDate
    : photo.photoDate > pair.before.photoDate;
}

/** "Front photo, 5 September 2026": how the confirmation names a photo. */
export function photoName(photo: ProgressPhoto, locale: string): string {
  const date = formatDate(photo.photoDate, 'd MMMM y', locale);
  return $localize`${poseName(photo.pose)}:pose: photo, ${date}:date:`;
}

import { describe, expect, it } from 'vitest';
import { mayaPhotos, photo } from '../../../testing/progress-fixtures';
import { firstAndLatest, fitsPair, photoName, posesToCompare } from './before-after.models';

describe('choosing a before and after (R6.1b)', () => {
  it('offers only the poses with active photos on two days, in the order Front, Side, Back', () => {
    // Maya has two front photos; one side photo of two was removed, and one back photo.
    expect(
      posesToCompare(mayaPhotos()).map((choice) => [choice.name, choice.photos.length]),
    ).toEqual([['Front', 2]]);
    const more = [
      ...mayaPhotos(),
      photo({ pose: 'Back', photoDate: '2026-08-01' }),
      photo({ pose: 'Side', photoDate: '2026-08-01' }),
    ];
    expect(posesToCompare(more).map((choice) => choice.pose)).toEqual(['Front', 'Side', 'Back']);
  });

  it('never offers a removed photo, and lists a pose’s photos from the first', () => {
    const photos = [
      photo({ pose: 'Side', photoDate: '2026-10-03' }),
      photo({ pose: 'Side', photoDate: '2026-07-01', status: 'Removed' }),
      photo({ pose: 'Side', photoDate: '2026-08-01' }),
    ];
    const [side] = posesToCompare(photos);
    expect(side.photos.map((item) => item.photoDate)).toEqual(['2026-08-01', '2026-10-03']);
    expect(posesToCompare(photos.slice(0, 2))).toEqual([]);
  });

  it('starts at the first photo and the latest, afresh each time', () => {
    const [front] = posesToCompare([
      photo({ photoDate: '2026-09-05' }),
      photo({ photoDate: '2026-07-04' }),
      photo({ photoDate: '2026-10-03' }),
    ]);
    const pair = firstAndLatest(front);
    expect([pair.before.photoDate, pair.after.photoDate]).toEqual(['2026-07-04', '2026-10-03']);
  });

  it('keeps the before earlier than the after', () => {
    const pair = {
      before: photo({ photoDate: '2026-07-04' }),
      after: photo({ photoDate: '2026-09-05' }),
    };
    expect(fitsPair(photo({ photoDate: '2026-08-01' }), 'before', pair)).toBe(true);
    expect(fitsPair(photo({ photoDate: '2026-09-05' }), 'before', pair)).toBe(false);
    expect(fitsPair(photo({ photoDate: '2026-10-03' }), 'before', pair)).toBe(false);
    expect(fitsPair(photo({ photoDate: '2026-08-01' }), 'after', pair)).toBe(true);
    expect(fitsPair(photo({ photoDate: '2026-07-04' }), 'after', pair)).toBe(false);
  });

  it('names a photo by its pose and its whole date, as the confirmation says it', () => {
    expect(photoName(photo({ pose: 'Side', photoDate: '2026-09-05' }), 'en-LB')).toBe(
      'Side photo, 5 September 2026',
    );
  });
});

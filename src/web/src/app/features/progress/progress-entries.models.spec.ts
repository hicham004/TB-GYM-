import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import {
  mayaMeasurements,
  mayaPhotos,
  mayaWeighIns,
  observation,
  photo,
  progressView,
  TODAY,
  weightHistory,
} from '../../../testing/progress-fixtures';
import {
  addedBy,
  dayErrors,
  dayWords,
  entryRefusal,
  entryTab,
  isStale,
  measurementDays,
  measurementErrors,
  measurementName,
  measurementUnit,
  moveErrors,
  numberOrNull,
  photoFileError,
  photoLists,
  reasonErrors,
  reasonPicks,
  reasonValue,
  trendFacts,
  weighInChanges,
  weighInRows,
  weightErrors,
  type Audience,
} from './progress-entries.models';

const client: Audience = { coach: false, firstName: null, locale: 'en' };
const coach: Audience = { coach: true, firstName: 'Maya', locale: 'en' };

const refusal = (status: number, code: string, title = 'Refused') =>
  new HttpErrorResponse({ status, error: { code, title } });

describe('who added an entry', () => {
  it('says "you" and "your coach" to a client, and "Maya" and "a coach" to a coach', () => {
    expect(addedBy('Client', client)).toBe('Added by you');
    expect(addedBy('Coach', client)).toBe('Added by your coach');
    expect(addedBy('Client', coach)).toBe('Added by Maya');
    expect(addedBy('Client', { ...coach, firstName: null })).toBe('Added by the client');
    expect(addedBy('Coach', coach)).toBe('Added by a coach');
    expect(addedBy('DeviceImport', client)).toBe('Imported from a device');
  });
});

describe('the tabs', () => {
  it('opens the one named in the address and the first for anything else', () => {
    expect(entryTab('photos')).toBe('photos');
    expect(entryTab('measurements')).toBe('measurements');
    expect(entryTab('weight')).toBe('weight');
    expect(entryTab('nonsense')).toBe('weight');
    expect(entryTab(null)).toBe('weight');
  });
});

describe('the weigh-ins list', () => {
  it('lists only days with a weigh-in, newest first, in the unit the page shows', () => {
    const rows = weighInRows(progressView(mayaWeighIns()), client);

    expect(rows.map((row) => row.date)).toEqual([
      '2026-10-09',
      '2026-10-08',
      '2026-10-07',
      '2026-10-05',
    ]);
    expect(rows.map((row) => row.value)).toEqual(['80.2 kg', '79.8 kg', '80.1 kg', '80.6 kg']);
  });

  it('notes a weight typed in the other unit, and who added it', () => {
    const rows = weighInRows(progressView(mayaWeighIns()), client);

    expect(rows[1].entered).toBe('Entered as 175.9 lb');
    expect(rows[0].entered).toBeNull();
    expect(rows[0].addedBy).toBe('Added by your coach');
    expect(rows[2].addedBy).toBe('Added by you');
    expect(weighInRows(progressView(mayaWeighIns()), coach)[2].addedBy).toBe('Added by Maya');
  });

  it('shows pounds when the page is in pounds, and notes the kilograms typed', () => {
    const rows = weighInRows(
      progressView(
        [observation({ measurementDate: '2026-10-09', valueKilograms: 80, enteredValue: 80 })],
        {
          displayUnit: 'Pound',
        },
      ),
      client,
    );

    expect(rows[0].value).toBe('176.37 lb');
    expect(rows[0].entered).toBe('Entered as 80 kg');
  });

  it('is empty before anything is read', () => {
    expect(weighInRows(null, client)).toEqual([]);
  });
});

describe('dates in words', () => {
  it('leaves the year out for this year and puts it in for another', () => {
    expect(dayWords('2026-10-09', TODAY, 'en')).toBe('Fri 9 Oct');
    expect(dayWords('2025-12-31', TODAY, 'en')).toBe('Wed 31 Dec 2025');
  });
});

describe('a weigh-in’s changes', () => {
  it('puts the moves and the corrections carried with them in one list, newest first (CLIENT-14)', () => {
    const history = weightHistory({
      previousValues: [
        { ...weightHistory().previousValues[0], id: 'c2', supersededAtUtc: '2026-10-09T10:00:00Z' },
        { ...weightHistory().previousValues[0], id: 'c1', supersededAtUtc: '2026-10-08T07:00:00Z' },
      ],
      moves: [
        {
          fromObservationId: 'o2',
          fromDate: '2026-10-08',
          toDate: '2026-10-09',
          reason: 'Weighed on the 9th',
          movedByUserId: 'coach',
          movedAtUtc: '2026-10-09T12:00:00Z',
        },
        {
          fromObservationId: 'o1',
          fromDate: '2026-10-07',
          toDate: '2026-10-08',
          reason: 'Logged on the wrong day',
          movedByUserId: 'maya',
          movedAtUtc: '2026-10-08T09:00:00Z',
        },
      ],
    });
    expect(weighInChanges(history).map((change) => `${change.kind}:${change.id}`)).toEqual([
      'move:o2',
      'correction:c2',
      'move:o1',
      'correction:c1',
    ]);
    expect(weighInChanges(weightHistory({ previousValues: [] }))).toEqual([]);
  });
});

describe('a weight', () => {
  it('needs a number', () => {
    expect(weightErrors(null, 'Kilogram')).toEqual(['Enter a weight.']);
    expect(weightErrors(Number.NaN, 'Kilogram')).toEqual(['Enter a weight.']);
    expect(weightErrors(80.2, 'Kilogram')).toEqual([]);
  });

  it('is held to the server’s 20 to 500 kg, in the unit the person typed', () => {
    expect(weightErrors(19.9, 'Kilogram')).toEqual(['Weight has to be between 20 and 500 kg.']);
    expect(weightErrors(500.1, 'Kilogram')).toEqual(['Weight has to be between 20 and 500 kg.']);
    expect(weightErrors(20, 'Kilogram')).toEqual([]);
    expect(weightErrors(500, 'Kilogram')).toEqual([]);
    expect(weightErrors(44, 'Pound')).toEqual(['Weight has to be between 44.1 and 1,102.3 lb.']);
    expect(weightErrors(44.1, 'Pound')).toEqual([]);
    expect(weightErrors(1102.3, 'Pound')).toEqual([]);
    expect(weightErrors(1102.4, 'Pound')).toEqual([
      'Weight has to be between 44.1 and 1,102.3 lb.',
    ]);
  });
});

describe('a day', () => {
  it('has to be a real day that has already begun in the coaching space', () => {
    expect(dayErrors('', TODAY, 'weighed')).toEqual(['Choose the day you weighed.']);
    expect(dayErrors('2026-02-30', TODAY, 'measured')).toEqual(['Choose the day you measured.']);
    expect(dayErrors('', TODAY, 'photographed')).toEqual(['Choose the day the photo was taken.']);
    expect(dayErrors('2026-10-11', TODAY, 'weighed')).toEqual([
      'That day has not happened yet. Choose today or an earlier day.',
    ]);
    expect(dayErrors(TODAY, TODAY, 'weighed')).toEqual([]);
    expect(dayErrors('2025-01-01', TODAY, 'weighed')).toEqual([]);
  });

  it('can only move a weigh-in to another day without one', () => {
    const taken = new Set(['2026-10-07']);

    expect(moveErrors('2026-10-09', '2026-10-09', TODAY, taken)).toEqual([
      'That is the day it is on now. Choose the day it was really weighed.',
    ]);
    expect(moveErrors('2026-10-07', '2026-10-09', TODAY, taken)).toEqual([
      'A weight is already logged for that day. Correct that one instead of moving this one onto it.',
    ]);
    expect(moveErrors('2026-10-06', '2026-10-09', TODAY, taken)).toEqual([]);
    expect(moveErrors('2026-10-12', '2026-10-09', TODAY, taken)[0]).toContain(
      'has not happened yet',
    );
    expect(moveErrors('', '2026-10-09', TODAY, taken)).toEqual([
      'Choose the day it was really weighed.',
    ]);
  });
});

describe('measurements', () => {
  it('lists each day newest first, in the order a tape is taken, only what was recorded', () => {
    const days = measurementDays(
      { ...progressMeasurements(), days: progressMeasurements().days },
      client,
    );

    expect(days.map((day) => day.date)).toEqual(['2026-10-03', '2026-09-05']);
    expect(days[0].rows.map((row) => row.name)).toEqual(['Waist', 'Hips', 'Body fat']);
    expect(days[0].rows.map((row) => row.value)).toEqual(['82 cm', '96 cm', '22 %']);
    expect(days[1].rows[0].entered).toBe('Entered as 32.9 in');
    expect(days[1].rows[0].addedBy).toBe('Added by your coach');
  });

  it('is empty before anything is read, and drops a day with nothing on it', () => {
    expect(measurementDays(null, client)).toEqual([]);
    expect(
      measurementDays(
        { ...progressMeasurements(), days: [{ date: '2026-10-03', measurements: [] }] },
        client,
      ),
    ).toEqual([]);
  });

  it('names every line and gives body fat a percent whatever the tape shows', () => {
    expect(measurementName('BodyFatPercentage')).toBe('Body fat');
    expect(measurementName('Arm')).toBe('Arm');
    expect(measurementUnit('BodyFatPercentage', 'Inch')).toBe('Percent');
    expect(measurementUnit('Waist', 'Inch')).toBe('Inch');
    expect(measurementUnit('Waist', 'Centimetre')).toBe('Centimetre');
  });

  it('leaves an empty line alone and holds a typed one to the server’s limits', () => {
    expect(measurementErrors('Waist', null, 'Centimetre')).toEqual([]);
    expect(measurementErrors('Waist', 82, 'Centimetre')).toEqual([]);
    expect(measurementErrors('Waist', 9.9, 'Centimetre')).toEqual([
      'Waist has to be between 10 and 300 cm.',
    ]);
    expect(measurementErrors('Waist', 301, 'Centimetre')).toEqual([
      'Waist has to be between 10 and 300 cm.',
    ]);
    expect(measurementErrors('Waist', 3.9, 'Inch')).toEqual([
      'Waist has to be between 4 and 118.1 in.',
    ]);
    expect(measurementErrors('Waist', 4, 'Inch')).toEqual([]);
    expect(measurementErrors('BodyFatPercentage', 0.5, 'Centimetre')).toEqual([
      'Body fat has to be between 1 and 75 %.',
    ]);
    expect(measurementErrors('BodyFatPercentage', 76, 'Centimetre')).toEqual([
      'Body fat has to be between 1 and 75 %.',
    ]);
    expect(measurementErrors('BodyFatPercentage', 22, 'Inch')).toEqual([]);
    expect(measurementErrors('Arm', Number.POSITIVE_INFINITY, 'Centimetre')).toEqual([
      'Enter a number.',
    ]);
  });
});

function progressMeasurements() {
  return {
    clientProfileId: 'client-1',
    timeZoneId: 'Asia/Beirut',
    displayUnit: 'Centimetre' as const,
    from: '2025-10-10',
    toExclusive: '2026-10-11',
    days: [
      {
        date: '2026-09-05',
        measurements: mayaMeasurements().filter((item) => item.measurementDate === '2026-09-05'),
      },
      {
        date: '2026-10-03',
        measurements: mayaMeasurements().filter((item) => item.measurementDate === '2026-10-03'),
      },
    ],
  };
}

describe('photos', () => {
  it('groups active photos by day, newest first, Front then Side then Back', () => {
    const lists = photoLists(mayaPhotos(), client);

    expect(lists.days.map((day) => day.date)).toEqual(['2026-10-03', '2026-09-05']);
    expect(lists.days[0].tiles.map((tile) => tile.pose)).toEqual(['Front', 'Side', 'Back']);
    expect(lists.days[0].tiles[2].addedBy).toBe('Added by your coach');
    expect(lists.days[1].tiles.map((tile) => tile.pose)).toEqual(['Front']);
  });

  it('keeps what the client removed apart, as their own history', () => {
    const lists = photoLists(mayaPhotos(), client);

    expect(lists.removed.map((tile) => `${tile.pose} ${tile.photo.photoDate}`)).toEqual([
      'Side 2026-09-05',
    ]);
    expect(photoLists([], client)).toEqual({ days: [], removed: [] });
  });

  it('keeps the older of two photos on one day and pose first once a retake follows a removal', () => {
    const lists = photoLists(
      [photo({ id: 'old', status: 'Removed' }), photo({ id: 'new', status: 'Active' })],
      client,
    );

    expect(lists.days[0].tiles.map((tile) => tile.photo.id)).toEqual(['new']);
    expect(lists.removed.map((tile) => tile.photo.id)).toEqual(['old']);
  });

  it('accepts a JPEG or PNG under 15 MB and says why it does not take anything else', () => {
    expect(photoFileError({ type: 'image/jpeg', size: 3_000_000 })).toBeNull();
    expect(photoFileError({ type: 'image/png', size: 15 * 1024 * 1024 })).toBeNull();
    expect(photoFileError({ type: 'image/heic', size: 1000 })).toBe('Choose a JPEG or PNG photo.');
    expect(photoFileError({ type: 'video/mp4', size: 1000 })).toBe('Choose a JPEG or PNG photo.');
    expect(photoFileError({ type: 'image/jpeg', size: 0 })).toBe(
      'That file is empty. Choose the photo again.',
    );
    expect(photoFileError({ type: 'image/jpeg', size: 15 * 1024 * 1024 + 1 })).toBe(
      'That photo is larger than 15 MB. Choose a smaller one.',
    );
  });
});

describe('the reason the server always asks for', () => {
  it('offers the commonest reasons for each kind of change, and "Something else" last', () => {
    expect(reasonPicks('weight', client).map((pick) => pick.label)).toEqual([
      'Typed the wrong number',
      'Misread the scale',
      'Something else',
    ]);
    expect(reasonPicks('date', client).map((pick) => pick.label)).toEqual([
      'Logged on the wrong day',
      'Something else',
    ]);
    expect(reasonPicks('measurement', client).map((pick) => pick.label)).toEqual([
      'Typed the wrong number',
      'Measured in the wrong place',
      'Something else',
    ]);
  });

  it('words the photo reasons for whoever is removing it', () => {
    expect(reasonPicks('photo', client).map((pick) => pick.label)).toEqual([
      'Wrong photo',
      'Wrong pose',
      'I do not want it shared',
      'Something else',
    ]);
    expect(reasonPicks('photo', coach).map((pick) => pick.label)).toEqual([
      'Wrong photo',
      'Wrong pose',
      'The client asked for it to be removed',
      'Something else',
    ]);
  });

  it('keeps the pick’s own words, or what was typed, trimmed', () => {
    const [typo, , other] = reasonPicks('weight', client);

    expect(reasonValue(typo, 'ignored')).toBe('Typed the wrong number');
    expect(reasonValue(other, '  Scale was on carpet.  ')).toBe('Scale was on carpet.');
    expect(reasonValue(null, 'x')).toBe('');
  });

  it('needs a choice, and words when "Something else" is chosen, within 500 characters', () => {
    const [typo, , other] = reasonPicks('weight', client);

    expect(reasonErrors(null, '')).toEqual(['Choose what was wrong.']);
    expect(reasonErrors(typo, '')).toEqual([]);
    expect(reasonErrors(other, '   ')).toEqual(['Write what was wrong.']);
    expect(reasonErrors(other, 'x'.repeat(500))).toEqual([]);
    expect(reasonErrors(other, 'x'.repeat(501))).toEqual(['Keep it to 500 characters.']);
  });
});

describe('what the server says back', () => {
  it('says which entry exists already, in words', () => {
    expect(
      entryRefusal(refusal(409, 'BodyweightDateAlreadyExists'), 'x', { day: 'Fri 9 Oct' }),
    ).toBe('A weight is already logged for Fri 9 Oct. Correct that one instead.');
    expect(
      entryRefusal(refusal(409, 'BodyMeasurementDateAndTypeAlreadyExists'), 'x', {
        day: 'Sat 3 Oct',
        what: 'Waist',
      }),
    ).toBe('Waist is already recorded for Sat 3 Oct. Correct that one instead.');
    expect(
      entryRefusal(refusal(409, 'ProgressPhotoAlreadyExists'), 'x', {
        day: 'Sat 3 Oct',
        what: 'Front',
      }),
    ).toBe('A front photo is already saved for Sat 3 Oct. Remove it first, or choose another day.');
  });

  it('knows an entry that changed under the person, and says to try again', () => {
    for (const code of [
      'BodyweightVersionConflict',
      'BodyweightObservationVoided',
      'BodyMeasurementVersionConflict',
      'ProgressPhotoVersionConflict',
      'ProgressPhotoAlreadyRemoved',
    ]) {
      expect(isStale(refusal(409, code))).toBe(true);
      expect(entryRefusal(refusal(409, code), 'x')).toContain('changed while it was open');
    }
    expect(isStale(refusal(409, 'BodyweightDateAlreadyExists'))).toBe(false);
    expect(isStale(new Error('x'))).toBe(false);
  });

  it('otherwise gives the server’s own sentence, or the fallback when it gave none', () => {
    expect(
      entryRefusal(refusal(400, 'x', 'Bodyweight cannot be dated in the future.'), 'fallback'),
    ).toBe('Bodyweight cannot be dated in the future.');
    expect(entryRefusal(new Error('network'), 'The weight could not be saved.')).toBe(
      'The weight could not be saved.',
    );
  });
});

describe('how the trend is worked out', () => {
  it('names the method in words with its version, settings and the days it covers', () => {
    const facts = trendFacts(progressView(mayaWeighIns()).trend, TODAY, 'en');

    expect(facts.method).toBe('Smoothed average, version 2.0');
    expect(facts.how).toBe(
      'Each weigh-in counts less as it gets older (time constant 10 days, 90-day warm-up). A trend needs 3 weigh-ins.',
    );
    expect(facts.window).toBe('Fri 10 Oct 2025 to Sat 10 Oct');
    expect(facts.method).not.toContain('BodyweightTrendEwma');
  });

  it('leaves the days covered out, and still explains the rest, when the server named none', () => {
    const trend = { ...progressView(mayaWeighIns()).trend } as Record<string, unknown>;
    delete trend['windowStart'];
    delete trend['windowEndExclusive'];

    const facts = trendFacts(trend as never, TODAY, 'en');
    expect(facts.window).toBeNull();
    expect(facts.method).toBe('Smoothed average, version 2.0');
  });
});

describe('a number box', () => {
  it('gives a number, or nothing while the box is empty or not a number yet', () => {
    expect(numberOrNull(80.2)).toBe(80.2);
    expect(numberOrNull(Number.NaN)).toBeNull();
  });
});

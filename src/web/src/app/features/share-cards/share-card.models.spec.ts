import { describe, expect, it } from 'vitest';
import { personalRecord, programSummary } from '../../../testing/share-card-fixtures';
import {
  bylineOf,
  firstNameOf,
  programCard,
  recordCard,
  shareCards,
  type ShareIdentity,
} from './share-card.models';

const maya: ShareIdentity = { firstName: 'Maya', spaceName: 'Atlas Performance' };

describe('share card words', () => {
  it('tells a record as lifted: the load in its own unit, the reps, the lift and who lifted it', () => {
    expect(recordCard(personalRecord(), maya, 'en-LB')).toEqual({
      id: 'record-set-bench',
      kind: 'record',
      choice: 'Barbell bench press',
      kicker: 'New personal record',
      headline: '62.5 kg × 6',
      title: 'Barbell bench press',
      facts: [],
      byline: 'Maya · coached by Atlas Performance',
      description:
        'New personal record. Barbell bench press, 62.5 kg × 6. Maya · coached by Atlas Performance',
      fileName: 'barbell-bench-press-personal-record.png',
    });
  });

  it('never converts a unit, and reads numbers the server sent as text', () => {
    const card = recordCard(
      personalRecord({ load: '135', unit: 'Pound', repetitions: '5' }),
      maya,
      'en-LB',
    );
    expect(card.headline).toBe('135 lb × 5');
    expect(recordCard(personalRecord({ load: 102.25 }), maya, 'en-LB').headline).toBe(
      '102.25 kg × 6',
    );
  });

  it('tells a finished program by its weeks, workouts and the records they set', () => {
    const card = programCard(programSummary(), maya);
    expect(card).toMatchObject({
      id: 'program-block-1',
      kind: 'program',
      choice: 'Your program',
      kicker: 'Program complete',
      headline: '8 weeks',
      title: 'Strength Foundations',
      facts: ['30 workouts', '7 personal records'],
      fileName: 'strength-foundations-complete.png',
    });
    expect(card.description).toBe(
      'Program complete. Strength Foundations, 8 weeks. 30 workouts, 7 personal records. ' +
        'Maya · coached by Atlas Performance',
    );
  });

  it('says one of each in the singular, and leaves out records when there were none', () => {
    const one = programCard(
      programSummary({ weekCount: 1, workoutCount: 1, personalRecordCount: 1 }),
      maya,
    );
    expect([one.headline, ...one.facts]).toEqual(['1 week', '1 workout', '1 personal record']);
    expect(programCard(programSummary({ personalRecordCount: 0 }), maya).facts).toEqual([
      '30 workouts',
    ]);
  });

  it('names the coaching space alone when the client has no name on their account', () => {
    expect(bylineOf({ firstName: '', spaceName: 'Atlas Performance' })).toBe(
      'Coached by Atlas Performance',
    );
    expect(firstNameOf('  Maya   Fakhoury ')).toBe('Maya');
    expect(firstNameOf(null)).toBe('');
  });

  it('keeps the order given, and tells two records on one lift apart by their numbers', () => {
    const cards = shareCards(
      [
        { kind: 'program', program: programSummary() },
        { kind: 'record', record: personalRecord() },
        {
          kind: 'record',
          record: personalRecord({ setPerformanceId: 'set-bench-8', load: 55, repetitions: 8 }),
        },
        {
          kind: 'record',
          record: personalRecord({ setPerformanceId: 'set-row', exerciseName: 'Barbell row' }),
        },
      ],
      maya,
      'en-LB',
    );
    expect(cards.map((card) => card.choice)).toEqual([
      'Your program',
      'Barbell bench press, 62.5 kg × 6',
      'Barbell bench press, 55 kg × 8',
      'Barbell row',
    ]);
  });

  it('names the file after a lift written in Latin letters, and plainly otherwise', () => {
    expect(
      recordCard(personalRecord({ exerciseName: 'Développé couché' }), maya, 'en-LB').fileName,
    ).toBe('developpe-couche-personal-record.png');
    expect(recordCard(personalRecord({ exerciseName: 'سكوات' }), maya, 'en-LB').fileName).toBe(
      'record-personal-record.png',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { standingReason, weightNote } from '../../../testing/lift-weight-fixtures';
import { weightNoteLine } from './weight-note-words';

// The client opens Lower A on Tue 10 Nov 2026; last time was Thu 5 Nov.
const TODAY = '2026-11-10';
const line = (note: Parameters<typeof weightNoteLine>[0], today = TODAY) =>
  weightNoteLine(note, today, 'en-US');

describe('the client’s line for an applied weight (N6c, STR-020)', () => {
  it('names the step and last time’s working sets, the step in the lead', () => {
    const result = line(weightNote());
    expect(result.text).toBe('Up 2 kg · all 3 × 10 done on Thu');
    expect(result.parts.filter((part) => part.strong).map((part) => part.text)).toEqual([
      'Up 2 kg',
    ]);
  });

  it('says the day as the coach’s line does: today, yesterday, a weekday, then the date', () => {
    expect(line(weightNote({ lastTimeDay: '2026-11-10' })).text).toBe(
      'Up 2 kg · all 3 × 10 done today',
    );
    expect(line(weightNote({ lastTimeDay: '2026-11-09' })).text).toBe(
      'Up 2 kg · all 3 × 10 done yesterday',
    );
    expect(line(weightNote({ lastTimeDay: '2026-10-30' })).text).toBe(
      'Up 2 kg · all 3 × 10 done on Fri 30 Oct',
    );
  });

  it('gives a range when the sets rose by different steps, and counts sets when their reps differ', () => {
    expect(line(weightNote({ increases: [2, '2.5', 2], repetitionsAsked: null })).text).toBe(
      'Up 2–2.5 kg · all 3 sets done on Thu',
    );
    expect(line(weightNote({ increases: [1.25], workingSets: 1, unit: 'Pound' })).text).toBe(
      'Up 1.25 lb · 1 × 10 done on Thu',
    );
    // Only warm-ups last time: the step alone.
    expect(line(weightNote({ workingSets: 0 })).text).toBe('Up 2 kg');
  });

  it('says why last time’s weight was kept, in the hold’s own words', () => {
    const short = weightNote({
      move: 'SameAsLastTime',
      increases: [],
      repetitionsAsked: 12,
      reason: standingReason({
        kind: 'RepsShort',
        day: '2026-11-03',
        setNumber: 1,
        repetitions: 11,
        repetitionsAsked: 12,
      }),
    });
    const result = line(short);
    expect(result.text).toBe('Same weight as last time · set 1 reached 11 of 12 on Tue 3 Nov');
    expect(result.parts.filter((part) => part.strong).map((part) => part.text)).toEqual([
      'Same weight as last time',
    ]);

    const harder = weightNote({
      move: 'SameAsLastTime',
      increases: [],
      exertionDisplay: 'Rir',
      reason: standingReason({ kind: 'HarderThanPlanned', setNumber: 2, rpe: 9, targetRpe: 8 }),
    });
    expect(line(harder).text).toBe(
      'Same weight as last time · set 2 felt harder than planned on Thu (RIR 1 of 2)',
    );

    // A reason the lead says on its own (every set done, only the carried sets moved): the lead alone.
    expect(
      line(weightNote({ move: 'SameAsLastTime', increases: [], reason: standingReason() })).text,
    ).toBe('Same weight as last time');
  });
});

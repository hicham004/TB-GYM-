import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import type { HouseProgramView } from '../../core/api/generated';
import {
  BENCH_ID,
  HOUSE_TODAY,
  houseProgram,
  housePrograms,
  powerbuilding,
  programMax,
  runningBlock,
  secondBlock,
  SQUAT_ID,
  startedView,
  underPass,
} from '../../../testing/house-program-fixtures';
import {
  allMaxesTyped,
  blockLine,
  coachedOnMax,
  liftList,
  maxDetail,
  maxHelp,
  maxProblem,
  maxRefusal,
  programDay,
  refusalWords,
  repsText,
  runKey,
  runningStranded,
  sessionLine,
  setsText,
  startQuestion,
  startRefusal,
  toHouseProgram,
  toHouseProgramStarted,
  toHousePrograms,
  trainingClosed,
  weeksLine,
  type HouseProgram,
  type RefusalContext,
} from './house-programs.models';

const LOCALE = 'en-GB';

const program = (overrides: Partial<HouseProgramView> = {}): HouseProgram =>
  toHouseProgram(houseProgram(overrides));

/** The words beside a card under the pass, with the list the fixtures read. */
function context(overrides: Partial<RefusalContext> = {}): RefusalContext {
  const read = toHousePrograms(underPass());
  return {
    today: HOUSE_TODAY,
    locale: LOCALE,
    pass: read.pass,
    running: read.running,
    programs: read.programs,
    ...overrides,
  };
}

const conflict = (code: string, status = 409) =>
  new HttpErrorResponse({ status, error: { code, message: 'The server’s own words.' } });

describe('toHousePrograms', () => {
  it('reads the server’s numbers as numbers and the pass’s last day from its exclusive end', () => {
    const read = toHousePrograms(underPass({ running: runningBlock() }));

    expect(read.today).toBe(HOUSE_TODAY);
    expect(read.pass).toMatchObject({ name: 'Pro+ Programs', lastDay: '2026-12-11' });
    expect(read.running).toMatchObject({ name: 'Strength Base 1', lastDay: '2026-11-27' });
    const second = read.programs[1];
    expect(second).toMatchObject({ runPosition: 2, weeks: 1, canStart: false });
    expect(second.sampleWeek[1].dayOffset).toBe(3);
    expect(read.programs[0].sampleWeek[0].exercises[1]).toEqual({
      exerciseId: expect.any(String),
      name: 'Barbell row',
      isMainLift: false,
      sets: 2,
      repetitionsMinimum: 8,
      repetitionsMaximum: 12,
    });
    expect(read.programs[0].maxes[0]).toEqual({
      exerciseId: SQUAT_ID,
      exerciseName: 'Back squat',
      unit: 'Kilogram',
      value: 140,
      from: 'Typed',
      on: '2026-11-12',
    });
  });

  it('keeps no pass, no program running and no blank words, and never the staff’s count', () => {
    const read = toHousePrograms(
      housePrograms({ programs: [houseProgram({ description: '   ', runName: '  ' })] }),
    );

    expect(read.pass).toBeNull();
    expect(read.running).toBeNull();
    expect(read.programs[0]).toMatchObject({
      description: null,
      runName: null,
      runPosition: null,
    });
    expect(read.programs[0]).not.toHaveProperty('timesStarted');
  });

  it('keeps a refusal only where Start is refused, and names one the server left blank', () => {
    expect(program({ canStart: true, refusal: 'house_program_needs_pass' }).refusal).toBeNull();
    expect(program({ canStart: false, refusal: null }).refusal).toBe('unknown');
  });

  it('maps what Start answers', () => {
    expect(toHouseProgramStarted(startedView())).toEqual({
      programId: expect.any(String),
      listingId: expect.any(String),
      name: 'Strength Base 1',
      startDate: HOUSE_TODAY,
      endDateExclusive: '2026-11-28',
    });
  });

  it('knows a program running whose plan ended with a workout of it open, from a card refused with no day', () => {
    const stranded = (programs: HouseProgramView[], running = runningBlock()) =>
      runningStranded(toHousePrograms(underPass({ running, programs })));
    expect(stranded([powerbuilding({ refusal: 'mesocycle_overlap', opensOn: null })])).toBe(true);
    // Running to a known day: the program holds the days until then.
    expect(stranded([powerbuilding({ refusal: 'mesocycle_overlap', opensOn: '2026-11-28' })])).toBe(
      false,
    );
    // No card weighed against it (each refused before), or nothing running: nothing to say.
    expect(stranded([secondBlock({ refusal: 'house_program_block_not_open' })])).toBe(false);
    expect(
      runningStranded(
        toHousePrograms(
          underPass({ programs: [powerbuilding({ refusal: 'mesocycle_overlap', opensOn: null })] }),
        ),
      ),
    ).toBe(false);
  });

  it('speaks of Max with no Pro+ pass to a trainee Max coaches alone, never under a pass or unread (N9c5b)', () => {
    const free = toHousePrograms(housePrograms({ running: runningBlock() }));
    const passed = toHousePrograms(underPass());
    expect(coachedOnMax(free, true)).toBe(true);
    // A running Pro+ pass keeps its card: the trainee may still start under it.
    expect(coachedOnMax(passed, true)).toBe(false);
    // Not coached, or the profile not read: Free's words.
    expect(coachedOnMax(free, false)).toBe(false);
    expect(coachedOnMax(free, null)).toBe(false);
    expect(coachedOnMax(passed, null)).toBe(false);
  });

  it('says Training is closed when the server refuses the programs for that', () => {
    expect(trainingClosed(toHousePrograms(underPass()))).toBe(false);
    expect(
      trainingClosed(
        toHousePrograms(
          housePrograms({ programs: [houseProgram({ refusal: 'training_closed' })] }),
        ),
      ),
    ).toBe(true);
  });
});

describe('a card’s lines', () => {
  it('writes the house’s days with the weekday, and the year only in another year', () => {
    expect(programDay('2026-11-27', HOUSE_TODAY, LOCALE)).toBe('Fri 27 Nov');
    expect(programDay('2027-01-07', HOUSE_TODAY, LOCALE)).toBe('Thu 7 Jan 2027');
  });

  it('names the block of its run, and nothing for a program on its own', () => {
    expect(blockLine(program())).toBe('Block 1 of Strength Base');
    expect(blockLine(toHouseProgram(secondBlock()))).toBe('Block 2 of Strength Base');
    expect(blockLine(toHouseProgram(powerbuilding()))).toBeNull();
  });

  it('says its weeks and its unit', () => {
    expect(weeksLine(toHouseProgram(powerbuilding()))).toBe('6 weeks · kg');
    expect(weeksLine(toHouseProgram(secondBlock({ loadUnit: 'Pound' })))).toBe('1 week · lb');
  });

  it('counts a session’s day from 1', () => {
    const [dayA, dayB] = program().sampleWeek;
    expect(sessionLine(dayA)).toBe('Day 1 · Day A');
    expect(sessionLine(dayB)).toBe('Day 4 · Day B');
  });

  it('writes reps as one number, a range, or nothing', () => {
    expect(repsText(5, 5)).toBe('5');
    expect(repsText(8, 12)).toBe('8–12');
    expect(repsText(null, 10)).toBe('10');
    expect(repsText(6, null)).toBe('6');
    expect(repsText(null, null)).toBeNull();
  });

  it('writes sets × reps, and the sets alone when no reps are asked for', () => {
    const [squat, row] = program().sampleWeek[0].exercises;
    expect(setsText(squat)).toBe('3 × 5');
    expect(setsText(row)).toBe('2 × 8–12');
    expect(setsText({ ...row, repetitionsMinimum: null, repetitionsMaximum: null })).toBe('2 sets');
    expect(setsText({ ...row, sets: 1, repetitionsMinimum: null, repetitionsMaximum: null })).toBe(
      '1 set',
    );
  });

  it('says each max with where it came from', () => {
    const [kilos] = program({
      maxes: [programMax({ value: '140', from: 'Typed', on: '2026-11-12' })],
    }).maxes;
    expect(maxDetail(kilos, HOUSE_TODAY, LOCALE)).toBe('140 kg, typed Thu 12 Nov');
    const [typed] = program({
      maxes: [
        programMax({ value: '102.35', from: 'LastProgram', on: '2026-10-30', unit: 'Pound' }),
      ],
    }).maxes;
    expect(maxDetail(typed, HOUSE_TODAY, LOCALE)).toBe('102.35 lb, from your last program');
    expect(maxDetail(program().maxes[0], HOUSE_TODAY, LOCALE)).toBe('not typed yet');
  });

  it('says the box’s help in the same words', () => {
    const [none] = program().maxes;
    const [typed] = program({
      maxes: [programMax({ value: 140, from: 'Typed', on: HOUSE_TODAY })],
    }).maxes;
    const [carried] = program({
      maxes: [programMax({ value: 135, from: 'LastProgram', on: '2026-11-01' })],
    }).maxes;
    expect(maxHelp(none, HOUSE_TODAY, LOCALE)).toBe('Not typed yet.');
    expect(maxHelp(typed, HOUSE_TODAY, LOCALE)).toBe('Typed Sat 14 Nov.');
    expect(maxHelp(carried, HOUSE_TODAY, LOCALE)).toBe('From your last program.');
  });

  it('knows when every max is typed', () => {
    expect(allMaxesTyped(program())).toBe(false);
    expect(allMaxesTyped(program({ maxes: [programMax({ value: 140, from: 'Typed' })] }))).toBe(
      true,
    );
    expect(allMaxesTyped(program({ maxes: [] }))).toBe(false);
  });

  it('joins lifts as the server does', () => {
    expect(liftList(['Back squat'])).toBe('Back squat');
    expect(liftList(['Back squat', 'Bench press'])).toBe('Back squat and Bench press');
    expect(liftList(['Back squat', 'Bench press', 'Deadlift'])).toBe(
      'Back squat, Bench press and Deadlift',
    );
  });

  it('keys a run as the server does: trimmed, single-spaced, any case', () => {
    expect(runKey('  Strength   BASE ')).toBe('strength base');
    expect(runKey('   ')).toBeNull();
    expect(runKey(null)).toBeNull();
  });
});

describe('refusalWords', () => {
  const words = (code: string, overrides: Partial<HouseProgramView> = {}, more = {}) =>
    refusalWords(code, program(overrides), context(more));

  it('says nothing on a card on Free: the pass card says Pro+ is needed', () => {
    expect(words('house_program_needs_pass')).toBeNull();
  });

  it('says when the next block opens, once the block before has started', () => {
    expect(
      refusalWords(
        'house_program_block_not_open',
        toHouseProgram(secondBlock({ opensOn: '2026-11-28' })),
        context(),
      ),
    ).toBe('Block 2 of Strength Base opens on Sat 28 Nov, once block 1 has ended.');
  });

  it('asks for the block before first while it is offered, under any spelling of the run', () => {
    const second = toHouseProgram(secondBlock({ runName: ' strength  base ' }));
    expect(refusalWords('house_program_block_not_open', second, context())).toBe(
      'This is block 2 of strength base. Start block 1 first.',
    );
  });

  it('says the block before isn’t offered when the list has none', () => {
    const second = toHouseProgram(secondBlock());
    expect(
      refusalWords(
        'house_program_block_not_open',
        second,
        context({ programs: [second, toHouseProgram(powerbuilding())] }),
      ),
    ).toBe(
      'This is block 2 of Strength Base, and block 1 isn’t offered now, so it can’t start yet.',
    );
  });

  it('says how long the program running holds the days, and when this one can start', () => {
    const running = toHousePrograms(underPass({ running: runningBlock() })).running;
    expect(
      words(
        'mesocycle_overlap',
        { opensOn: '2026-11-28', lastStartDay: '2026-12-05' },
        { running },
      ),
    ).toBe(
      '“Strength Base 1” runs until Fri 27 Nov. One program at a time: this one can start from Sat 28 Nov.',
    );
    expect(
      words(
        'mesocycle_overlap',
        { opensOn: '2026-11-28', lastStartDay: '2026-11-20' },
        { running },
      ),
    ).toBe('“Strength Base 1” runs until Fri 27 Nov. One program at a time.');
    expect(
      words('mesocycle_overlap', { opensOn: '2026-11-28', lastStartDay: null }, { running }),
    ).toBe('“Strength Base 1” runs until Fri 27 Nov. One program at a time.');
    expect(words('mesocycle_overlap', { opensOn: '2026-11-28' }, { running: null })).toBe(
      'The program you’re on runs until Fri 27 Nov. One program at a time.',
    );
  });

  it('says a workout still open under a plan that ended holds the days, and never sends the trainee to finish it', () => {
    const running = toHousePrograms(underPass({ running: runningBlock() })).running;
    // No read lists that workout now (N9c3), so the line names no way to finish it.
    expect(words('mesocycle_overlap', { opensOn: null }, { running })).toBe(
      'A workout you started in “Strength Base 1” is still open, and its plan has ended, so another program can’t start yet.',
    );
    expect(words('mesocycle_overlap', { opensOn: null }, { running: null })).toBe(
      'A workout you started in the program you’re on is still open, and its plan has ended, so another program can’t start yet.',
    );
    expect(words('mesocycle_overlap', { opensOn: null }, { running })).not.toContain('Finish');
  });

  it('says a block that does not fit the pass, and when it no longer could', () => {
    expect(words('house_program_does_not_fit', { weeks: 2, lastStartDay: '2026-11-27' })).toBe(
      'This block runs 2 weeks and your pass ends on Fri 11 Dec, so the last day to start it was Fri 27 Nov. Start it under your next pass.',
    );
    expect(words('house_program_does_not_fit', { weeks: 6, lastStartDay: null })).toBe(
      'This block runs 6 weeks, longer than your pass, so it can’t start under it.',
    );
  });

  it('names the lifts with no max, in the program’s unit', () => {
    expect(
      words('house_program_needs_maxes', {
        loadUnit: 'Pound',
        maxes: [
          programMax({ unit: 'Pound' }),
          programMax({ exerciseId: 'row', exerciseName: 'Barbell row', value: 90, unit: 'Pound' }),
          programMax({ exerciseId: BENCH_ID, exerciseName: 'Bench press', unit: 'Pound' }),
        ],
      }),
    ).toBe(
      'Type your max for Back squat and Bench press first, in lb: this program works its weights out from it.',
    );
  });

  it('says the rest in the house’s words', () => {
    expect(words('house_program_unit')).toBe(
      'This program mixes kg and lb, so it can’t be started until TB Gym puts it in one unit.',
    );
    expect(words('house_program_not_offered')).toBe('TB Gym no longer offers this program.');
    expect(words('training_closed')).toBe('Training isn’t open for you right now.');
    expect(words('unknown')).toBe('This program can’t start right now.');
  });
});

describe('startQuestion', () => {
  it('asks with the program’s length from the house’s day', () => {
    expect(startQuestion(program(), HOUSE_TODAY, LOCALE)).toEqual({
      title: 'Start Strength Base 1?',
      message:
        'It runs 2 weeks, from today until Fri 27 Nov. One program at a time: TB Gym’s other programs wait until it ends.',
    });
    expect(startQuestion(toHouseProgram(secondBlock()), HOUSE_TODAY, LOCALE).message).toBe(
      'It runs 1 week, from today until Fri 20 Nov. One program at a time: TB Gym’s other programs wait until it ends.',
    );
  });
});

describe('startRefusal', () => {
  const card = () => program({ canStart: true, refusal: null, lastStartDay: '2026-11-27' });

  it('reads the list again after a program changed or was withdrawn', () => {
    expect(startRefusal(conflict('house_program_changed'), card(), context())).toEqual({
      message: 'TB Gym changed this program since you read it. Read it again, then start it.',
      stale: true,
      newKey: false,
    });
    expect(startRefusal(conflict('house_program_not_offered'), card(), context())).toEqual({
      message: 'TB Gym no longer offers this program. Pick another from the list.',
      stale: true,
      newKey: false,
    });
    expect(startRefusal(new HttpErrorResponse({ status: 404 }), card(), context()).stale).toBe(
      true,
    );
  });

  it('reads the list again for a refusal whose words depend on what the server holds now', () => {
    // The card could start when read: another tab's Start, a max or the pass changed since.
    for (const code of [
      'mesocycle_overlap',
      'house_program_block_not_open',
      'house_program_does_not_fit',
      'house_program_needs_maxes',
    ]) {
      expect(startRefusal(conflict(code), card(), context()), code).toEqual({
        message: 'Your programs changed since you read them. Here they are again.',
        stale: true,
        newKey: false,
      });
    }
  });

  it('never words an overlap from the old read: no plan ended and no workout is open', () => {
    const refused = startRefusal(conflict('mesocycle_overlap'), card(), context({ running: null }));
    expect(refused.message).not.toContain('plan has ended');
    expect(refused.message).not.toContain('workout');
  });

  it('reads the list again when the pass isn’t running now, so the pass card shows Free', () => {
    expect(startRefusal(conflict('house_program_needs_pass'), card(), context())).toEqual({
      message: 'Your Pro+ pass isn’t running now, so this program couldn’t start.',
      stale: true,
      newKey: false,
    });
  });

  it('says a refusal the read cannot have changed in the card’s words, and keeps the list', () => {
    expect(startRefusal(conflict('house_program_unit'), card(), context())).toEqual({
      message:
        'This program mixes kg and lb, so it can’t be started until TB Gym puts it in one unit.',
      stale: false,
      newKey: false,
    });
    expect(startRefusal(conflict('training_closed'), card(), context())).toEqual({
      message: 'Training isn’t open for you right now.',
      stale: false,
      newKey: false,
    });
    expect(startRefusal(conflict('something_new'), card(), context())).toEqual({
      message: 'This program can’t start right now.',
      stale: false,
      newKey: false,
    });
  });

  it('makes a new key after a key spent on another start', () => {
    expect(startRefusal(conflict('idempotency_conflict'), card(), context())).toEqual({
      message: 'Couldn’t start it. Press Start again.',
      stale: false,
      newKey: true,
    });
  });

  it('says a closed Training, a lost connection and a refused request in words', () => {
    // Closed since the read: reading again shows the page closed.
    expect(startRefusal(new HttpErrorResponse({ status: 403 }), card(), context())).toEqual({
      message: 'Training isn’t open for you right now.',
      stale: true,
      newKey: false,
    });
    expect(startRefusal(new HttpErrorResponse({ status: 0 }), card(), context())).toEqual({
      message: 'Couldn’t start it. Check your connection and try again.',
      stale: false,
      newKey: false,
    });
    expect(
      startRefusal(
        new HttpErrorResponse({ status: 400, error: { errors: { idempotencyKey: ['Bad.'] } } }),
        card(),
        context(),
      ).message,
    ).toBe('This program can’t start right now.');
    expect(startRefusal(new HttpErrorResponse({ status: 500 }), card(), context()).message).toBe(
      'Couldn’t start it. Try again.',
    );
  });
});

describe('typing a max', () => {
  const refused = 'Enter a max above 0 and at most 500 kg (1,100 lb), with two decimals at most.';

  it('takes a max above 0, at most 500 kg or 1,100 lb, with two decimals at most', () => {
    expect(maxProblem(140, 'Kilogram')).toBeNull();
    expect(maxProblem(102.35, 'Kilogram')).toBeNull();
    expect(maxProblem(500, 'Kilogram')).toBeNull();
    expect(maxProblem(1100, 'Pound')).toBeNull();
    expect(maxProblem(0, 'Kilogram')).toBe(refused);
    expect(maxProblem(-5, 'Kilogram')).toBe(refused);
    expect(maxProblem(500.01, 'Kilogram')).toBe(refused);
    expect(maxProblem(1100.5, 'Pound')).toBe(refused);
    expect(maxProblem(102.355, 'Kilogram')).toBe(refused);
    expect(maxProblem(Number.NaN, 'Kilogram')).toBe(refused);
  });

  it('puts the server’s words for a value under its box', () => {
    const sentence = 'Enter a max above 0 and at most 500 kg, with two decimals at most.';
    expect(
      maxRefusal(new HttpErrorResponse({ status: 400, error: { errors: { value: [sentence] } } })),
    ).toEqual({ field: sentence, message: sentence, stale: false });
  });

  it('says typing needs Pro+, and marks the page out of date', () => {
    expect(maxRefusal(conflict('house_program_needs_pass'))).toEqual({
      field: null,
      message: 'Typing your max is for a program, which needs Pro+.',
      stale: true,
    });
    expect(maxRefusal(new HttpErrorResponse({ status: 404 })).stale).toBe(true);
    expect(maxRefusal(new HttpErrorResponse({ status: 403 }))).toEqual({
      field: null,
      message: 'Training isn’t open for you right now.',
      stale: true,
    });
  });

  it('says a lost connection in the app’s words', () => {
    expect(maxRefusal(new HttpErrorResponse({ status: 0 }))).toEqual({
      field: null,
      message: 'The app couldn’t connect. Check your connection and try again.',
      stale: false,
    });
  });
});

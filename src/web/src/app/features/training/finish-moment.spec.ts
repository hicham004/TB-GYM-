import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkoutFinishSummaryView } from '../../core/api/generated';
import type { Motion } from '../../core/motion/motion';
import {
  FINISH_MOMENT,
  planFinishCounts,
  playFinishMoment,
  type FinishFormats,
} from './finish-moment';

const formats: FinishFormats = {
  time: (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
  volume: (value) => value.toLocaleString('en-US', { maximumFractionDigits: 1 }),
};

function summary(overrides: Partial<WorkoutFinishSummaryView> = {}): WorkoutFinishSummaryView {
  return {
    durationSeconds: '3000',
    completedSetCount: 11,
    totalSetCount: '12',
    volume: [{ unit: 'Kilogram', loadTimesRepetitions: '2187.5' }],
    personalRecords: [
      { setPerformanceId: 's1', exerciseName: 'Back squat', load: 52.5, repetitions: 5 },
      { setPerformanceId: 's3', exerciseName: 'Back squat', load: 55, repetitions: 5 },
    ],
    ...overrides,
  } as unknown as WorkoutFinishSummaryView;
}

describe('planFinishCounts', () => {
  it('reads the four numbers from the summary, number or string, and draws the way to each', () => {
    const counts = planFinishCounts(summary(), formats);
    expect(counts.map((count) => [count.stat, count.to, count.duration])).toEqual([
      ['time', 3000, 900],
      ['sets', 11, 900],
      ['records', 2, 900],
      ['volume', 2187.5, 1300],
    ]);
    const [time, sets, records, volume] = counts;
    expect(time.format(1234.4)).toBe('20:34');
    expect(sets.format(5.4)).toBe('5 / 12');
    expect(records.format(0.6)).toBe('1');
    expect(volume.format(1234.56)).toBe('1,234.6');
  });

  it('counts one volume per unit, and none without one', () => {
    expect(planFinishCounts(summary({ volume: [] }), formats).map((count) => count.stat)).toEqual([
      'time',
      'sets',
      'records',
    ]);
    const two = planFinishCounts(
      summary({
        volume: [
          { unit: 'Kilogram', loadTimesRepetitions: 100 },
          { unit: 'Pound', loadTimesRepetitions: 220 },
        ],
      }),
      formats,
    );
    expect(two.filter((count) => count.stat === 'volume').map((count) => count.to)).toEqual([
      100, 220,
    ]);
  });
});

describe('playFinishMoment', () => {
  const host = document.createElement('div');
  const animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() }));

  function page(): void {
    host.innerHTML = `
      <section class="finish-summary">
        <p class="eyebrow">SESSION COMPLETE</p>
        <h2>Workout <em>done.</em></h2>
        <p>Lower A</p>
        <div class="summary-stats">
          <div data-stat="time"><strong>50:00</strong><span>time</span></div>
          <div data-stat="sets"><strong>11 / 12</strong><span>sets logged</span></div>
          <div data-stat="records"><strong>2</strong><span>personal records</span></div>
          <div data-stat="volume"><strong>2,187.5</strong><span>kg lifted</span></div>
        </div>
        <h3>New personal records</h3>
        <ul class="pr-list"><li>Back squat</li><li>Back squat</li></ul>
        <app-share-teaser><div class="card"></div><button>Share your record</button></app-share-teaser>
        <a class="finish-home">Back to Today</a>
      </section>`;
    document.body.append(host);
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      writable: true,
      value: animate,
    });
  }

  afterEach(() => {
    host.remove();
    animate.mockClear();
    delete (Element.prototype as { animate?: unknown }).animate;
    vi.useRealTimers();
  });

  const motion = (allowed: boolean) =>
    ({ allowed: vi.fn(() => allowed), countUp: vi.fn() }) as unknown as Motion & {
      countUp: ReturnType<typeof vi.fn>;
    };

  const name = (element: Element) =>
    `${element.tagName.toLowerCase()}${element.className ? `.${element.className}` : ''}`;

  it('does nothing where motion is not allowed: the template already drew the final state', () => {
    page();
    const stub = motion(false);
    playFinishMoment(host, summary(), stub, formats);
    expect(stub.allowed).toHaveBeenCalledWith(FINISH_MOMENT);
    expect(animate).not.toHaveBeenCalled();
    expect(stub.countUp).not.toHaveBeenCalled();
  });

  it('rises the panel, then its parts and each record in turn, leaving the share card its own landing', () => {
    page();
    host.scrollTop = 40;
    (host.firstElementChild as HTMLElement).scrollTop = 12;
    const stub = motion(true);
    playFinishMoment(host, summary(), stub, formats);
    expect((animate.mock.contexts as Element[]).map(name)).toEqual([
      'section.finish-summary',
      'p.eyebrow',
      'h2',
      'p',
      'div.summary-stats',
      'h3',
      'li',
      'li',
      'button',
      'a.finish-home',
    ]);
    const calls = animate.mock.calls as unknown as [Keyframe[], KeyframeAnimationOptions][];
    expect(calls[0][0][0]).toEqual({ opacity: 0, transform: 'translateY(30px)' });
    // Shown from its top first, wherever the player was scrolled.
    expect(host.scrollTop).toBe(0);
    expect(calls[0][1]).toMatchObject({ duration: 500 });
    expect(calls[1][0][0]).toEqual({ opacity: 0, transform: 'translateY(18px)' });
    expect(calls[1][1]).toMatchObject({ duration: 500, delay: 150, fill: 'backwards' });
    expect(calls.slice(1).map((call) => call[1].delay)).toEqual([
      150, 210, 270, 330, 390, 450, 510, 570, 630,
    ]);
  });

  it('counts each number up through the strong that shows it, to the server’s own figure', () => {
    page();
    const stub = motion(true);
    playFinishMoment(host, summary(), stub, formats);
    expect(
      stub.countUp.mock.calls.map((call) => [(call[0] as Element).textContent, call[1], call[3]]),
    ).toEqual([
      ['50:00', 3000, { moment: FINISH_MOMENT, duration: 900 }],
      ['11 / 12', 11, { moment: FINISH_MOMENT, duration: 900 }],
      ['2', 2, { moment: FINISH_MOMENT, duration: 900 }],
      ['2,187.5', 2187.5, { moment: FINISH_MOMENT, duration: 1300 }],
    ]);
  });

  it('holds each number at its final size while the digits run, then lets it go', () => {
    vi.useFakeTimers();
    page();
    for (const strong of host.querySelectorAll('strong')) {
      strong.getBoundingClientRect = () => ({ width: 120, height: 40 }) as DOMRect;
    }
    playFinishMoment(host, summary(), motion(true), formats);
    const time = host.querySelector<HTMLElement>('[data-stat="time"] strong')!;
    const volume = host.querySelector<HTMLElement>('[data-stat="volume"] strong')!;
    expect(time.style.minWidth).toBe('120px');
    expect(time.style.minHeight).toBe('40px');
    vi.advanceTimersByTime(1000);
    expect(time.style.minWidth).toBe('');
    expect(volume.style.minWidth).toBe('120px');
    vi.advanceTimersByTime(400);
    expect(volume.style.minWidth).toBe('');
    expect(volume.style.minHeight).toBe('');
  });
});

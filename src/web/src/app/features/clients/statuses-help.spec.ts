import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { press, settle } from '../../../testing/dom';
import { StatusesHelp } from './statuses-help';

const squash = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

async function open() {
  TestBed.configureTestingModule({ imports: [StatusesHelp] });
  const fixture = TestBed.createComponent(StatusesHelp);
  await settle(fixture);
  const host = fixture.nativeElement as HTMLElement;
  press(host, 'How these statuses work');
  await settle(fixture);
  const sheet = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!sheet) throw new Error('The sheet did not open.');
  return { fixture, host, sheet };
}

describe('How these statuses work (critique B4a)', () => {
  afterEach(() => {
    document.body.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
    TestBed.resetTestingModule();
  });

  it('opens from a button that says it opens a dialog', async () => {
    const { host, sheet } = await open();

    expect(host.querySelector('button')?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(squash(sheet.querySelector('h2')?.textContent)).toBe('How these statuses work');
  });

  it('names every reason in Today’s order, with when it starts and when it clears', async () => {
    const { sheet } = await open();

    const terms = Array.from(sheet.querySelectorAll('.defs'))[0].querySelectorAll('dt');
    expect(Array.from(terms).map((term) => squash(term.textContent))).toEqual([
      'Check-ins to review',
      'Unread messages',
      'Asked to renew',
      'Joined, no plan yet',
      'Week not shared',
      'Missed workouts',
      'Check-ins overdue',
      'No program yet',
    ]);
    const text = squash(sheet.textContent);
    // CHK-015: 2 to 13 days after the due day, a draft counting as not sent.
    expect(text).toContain(
      'A check-in was due 2 to 13 days ago and they haven’t sent it; one they started but didn’t send still counts.',
    );
    expect(text).toContain('or on the 14th day after it was due.');
    // TRN-021: two or more, counting back up to 14 days from the last workout started.
    expect(text).toContain(
      'Two or more workouts were due and not started since the last day they started one, counting back up to 14 days.',
    );
  });

  it('explains the plan’s pills, the 14-day boundary on one side, and the strip’s marks', async () => {
    const { sheet } = await open();

    expect(
      Array.from(sheet.querySelectorAll('app-status-pill')).map((pill) => squash(pill.textContent)),
    ).toEqual(['On track', 'Plan ends soon', 'Plan paused', 'No active plan']);
    const text = squash(sheet.textContent);
    expect(text).toContain('13 days away is soon, 14 is not.');
    expect(
      Array.from(sheet.querySelectorAll('.marks app-day-mark')).map((mark) =>
        mark.getAttribute('data-mark'),
      ),
    ).toEqual(['done', 'missed', 'due']);
    // The strip cannot tell a started workout from a missed one, so it says what × means.
    expect(text).toContain(
      'A workout due that day wasn’t finished: not started, or started and not finished.',
    );
    expect(text).toContain('Missed workouts counts back up to 14 days and never a started workout');
  });
});

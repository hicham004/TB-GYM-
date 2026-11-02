import { describe, expect, it } from 'vitest';
import { fakeMotion } from '../../../testing/motion-fake';
import type { Motion } from '../../core/motion/motion';
import { PLAYER_MOMENT, playPlayerMoment } from './player-moment';

function player(filled: boolean): HTMLElement {
  const host = document.createElement('app-today-training');
  host.innerHTML = filled
    ? `<section class="player">
        <header class="player-top"><a class="round">×</a><div><p class="eyebrow">YOUR WORKOUT</p><h1>Lower A</h1></div><span class="clock">0:00</span></header>
        <app-menu class="workout-picker"></app-menu>
        <article class="workout">
          <div class="segments"><span><b></b></span></div>
          <p class="workout-intro">See your targets.</p>
          <button class="start-button" type="button">Start workout</button>
          <div class="player-body"><section class="workout-exercise"><header class="exercise-heading"></header><div class="sets"></div></section></div>
        </article>
      </section>`
    : `<section class="player">
        <header class="player-top"><a class="round">×</a><div><p class="eyebrow">YOUR WORKOUT</p><h1>Your workout</h1></div></header>
        <div class="player-skeleton"><div></div><div></div></div>
      </section>`;
  return host;
}

describe('playPlayerMoment (W7)', () => {
  it('rises the title block, the picker, the workout’s blocks and the exercise panel in reading order', () => {
    const motion = fakeMotion({ allowed: true });
    const host = player(true);

    playPlayerMoment(host, motion as unknown as Motion);

    expect(motion.rise).toHaveBeenCalledTimes(1);
    const [parts, options] = motion.rise.mock.calls[0] as unknown as [
      Iterable<Element>,
      Record<string, unknown>,
    ];
    expect(
      Array.from(parts, (part) => part.className || `${part.tagName.toLowerCase()} in .player-top`),
    ).toEqual([
      'div in .player-top',
      'workout-picker',
      'segments',
      'workout-intro',
      'start-button',
      'workout-exercise',
    ]);
    // The × and the clock stay put, and the sets inside the panel move with it, not one by one.
    expect(Array.from(parts).some((part) => part.classList.contains('round'))).toBe(false);
    expect(Array.from(parts).some((part) => part.classList.contains('sets'))).toBe(false);
    expect(options).toEqual({ moment: PLAYER_MOMENT, from: 14, duration: 450, stagger: 40 });
  });

  it('leaves the skeleton alone: only the title block is offered while nothing has filled the player', () => {
    const motion = fakeMotion({ allowed: true });

    playPlayerMoment(player(false), motion as unknown as Motion);

    const [parts] = motion.rise.mock.calls[0] as unknown as [Iterable<Element>];
    expect(Array.from(parts).map((part) => part.tagName.toLowerCase())).toEqual(['div']);
    expect(Array.from(parts).some((part) => part.classList.contains('player-skeleton'))).toBe(
      false,
    );
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Motion } from '../../core/motion/motion';
import { landBubble, MESSAGE_MOMENT, replyLands, riseRow } from './message-moment';

type Call = [Keyframe[], KeyframeAnimationOptions];

describe('messages that move (W8)', () => {
  const animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() }));
  const allowedFor = vi.fn(() => true);
  const moves = { allowed: allowedFor } as unknown as Motion;
  const still = { allowed: () => false } as unknown as Motion;

  afterEach(() => {
    animate.mockClear();
    allowedFor.mockClear();
    delete (Element.prototype as { animate?: unknown }).animate;
    document.body.innerHTML = '';
  });

  function browserThatMoves(): void {
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      writable: true,
      value: animate,
    });
  }

  function row(mine: boolean, direction = 'ltr'): HTMLElement {
    const li = document.createElement('li');
    li.className = mine ? 'mine' : 'theirs';
    li.dir = direction;
    li.style.direction = direction;
    document.body.appendChild(li);
    return li;
  }

  it('rises a sent bubble from the composer and slides a received one in from its side', () => {
    browserThatMoves();
    landBubble(row(true), true, moves);
    landBubble(row(false), false, moves);
    expect(animate).toHaveBeenCalledTimes(2);
    const [mineFrames, mineOptions] = animate.mock.calls[0] as unknown as Call;
    expect(mineFrames[0]).toEqual({ opacity: 0, transform: 'translateY(12px)' });
    expect(mineFrames[1]).toEqual({ opacity: 1, transform: 'none' });
    expect(mineOptions).toEqual({ duration: 200, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    const [theirFrames, theirOptions] = animate.mock.calls[1] as unknown as Call;
    expect(theirFrames[0]).toEqual({ opacity: 0, transform: 'translateX(-12px)' });
    expect(theirOptions.duration).toBe(200);
    expect(allowedFor).toHaveBeenCalledWith(MESSAGE_MOMENT);
  });

  it('slides a received bubble in from the right in a right-to-left thread', () => {
    browserThatMoves();
    landBubble(row(false, 'rtl'), false, moves);
    const [frames] = animate.mock.calls[0] as unknown as Call;
    expect(frames[0]['transform']).toBe('translateX(12px)');
  });

  it('rises the inbox row whose last message changed', () => {
    browserThatMoves();
    riseRow(row(false), moves);
    const [frames, options] = animate.mock.calls[0] as unknown as Call;
    expect(frames[0]).toEqual({ opacity: 0, transform: 'translateY(12px)' });
    expect(options.duration).toBe(200);
  });

  it('rises the coach card 8 px over 320 ms and pulses its dot twice', () => {
    browserThatMoves();
    const card = document.createElement('a');
    card.innerHTML = '<span class="marker dot"></span>';
    document.body.appendChild(card);
    replyLands(card, moves);
    expect(animate).toHaveBeenCalledTimes(2);
    const [cardFrames, cardOptions] = animate.mock.calls[0] as unknown as Call;
    expect(cardFrames[0]).toEqual({ opacity: 0, transform: 'translateY(8px)' });
    expect(cardOptions.duration).toBe(320);
    const [dotFrames, dotOptions] = animate.mock.calls[1] as unknown as Call;
    expect(dotFrames[1]).toEqual({ transform: 'scale(1.6)', offset: 0.5 });
    expect(dotOptions).toMatchObject({ iterations: 2, delay: 320 });
  });

  it('moves nothing where motion is not allowed, without a row, or where the browser cannot', () => {
    browserThatMoves();
    landBubble(row(true), true, still);
    riseRow(row(false), still);
    replyLands(document.createElement('a'), still);
    landBubble(undefined, true, moves);
    riseRow(undefined, moves);
    replyLands(undefined, moves);
    expect(animate).not.toHaveBeenCalled();
  });
});

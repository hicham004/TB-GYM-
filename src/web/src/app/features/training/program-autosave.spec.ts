import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftAutosave, type SaveOutcome } from './program-autosave';

const TIMING = { quietMs: 1000, maxWaitMs: 5000, retryMs: 2000, retryMaxMs: 6000 };

/** A save the test answers when it chooses, as a slow network would. */
function deferred() {
  let answer!: (outcome: SaveOutcome) => void;
  const promise = new Promise<SaveOutcome>((resolve) => (answer = resolve));
  return { promise, answer };
}

function autosave(send: () => Promise<SaveOutcome>) {
  return new DraftAutosave(send, TIMING, () => Date.now());
}

describe('the program builder’s autosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends once the coach pauses, once for a whole burst of edits', async () => {
    const send = vi.fn(async (): Promise<SaveOutcome> => 'saved');
    const saver = autosave(send);

    saver.changed();
    await vi.advanceTimersByTimeAsync(600);
    saver.changed();
    saver.changed();
    expect(saver.status()).toBe('pending');
    expect(saver.hasUnsaved).toBe(true);
    await vi.advanceTimersByTimeAsync(999);
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(saver.status()).toBe('saved');
    expect(saver.hasUnsaved).toBe(false);
  });

  it('never lets a change wait unsent longer than the longest wait while the coach keeps working', async () => {
    const send = vi.fn(async (): Promise<SaveOutcome> => 'saved');
    const saver = autosave(send);

    for (let elapsed = 0; elapsed < 5000; elapsed += 500) {
      saver.changed();
      await vi.advanceTimersByTimeAsync(500);
    }

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends again when the coach changes something while a save is on its way', async () => {
    const first = deferred();
    const send = vi
      .fn<() => Promise<SaveOutcome>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue('saved');
    const saver = autosave(send);

    saver.changed();
    await vi.advanceTimersByTimeAsync(1000);
    expect(saver.status()).toBe('saving');
    saver.changed();
    expect(send).toHaveBeenCalledTimes(1);

    first.answer('saved');
    await vi.advanceTimersByTimeAsync(0);
    expect(saver.status()).toBe('pending');
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(saver.status()).toBe('saved');
  });

  it('tries a failed save again after growing waits, and stops growing at the longest', async () => {
    const send = vi
      .fn<() => Promise<SaveOutcome>>()
      .mockResolvedValueOnce('retry')
      .mockResolvedValueOnce('retry')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue('saved');
    const saver = autosave(send);

    saver.changed();
    await vi.advanceTimersByTimeAsync(1000);
    expect(saver.status()).toBe('retrying');
    saver.changed(); // a new change keeps the wait rather than hammering the server
    await vi.advanceTimersByTimeAsync(1999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(send).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(5999);
    expect(send).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(4);
    expect(saver.status()).toBe('saved');
  });

  it('after a refusal, sends nothing until the coach changes something', async () => {
    const send = vi
      .fn<() => Promise<SaveOutcome>>()
      .mockResolvedValueOnce('refused')
      .mockResolvedValue('saved');
    const saver = autosave(send);

    saver.changed();
    await vi.advanceTimersByTimeAsync(1000);
    expect(saver.status()).toBe('refused');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(saver.hasUnsaved).toBe(true);

    saver.changed();
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(saver.status()).toBe('saved');
  });

  it('once stopped, never sends again and keeps the changes counted as unsaved', async () => {
    const send = vi.fn(async (): Promise<SaveOutcome> => 'stopped');
    const saver = autosave(send);

    saver.changed();
    await vi.advanceTimersByTimeAsync(1000);
    saver.changed();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(send).toHaveBeenCalledTimes(1);
    expect(saver.status()).toBe('stopped');
    expect(saver.hasUnsaved).toBe(true);
    expect(await saver.flush()).toBe(false);
  });

  it('sends at once on a flush, and says whether everything reached the server', async () => {
    const send = vi
      .fn<() => Promise<SaveOutcome>>()
      .mockResolvedValueOnce('saved')
      .mockResolvedValueOnce('retry');
    const saver = autosave(send);

    expect(await saver.flush()).toBe(true); // nothing to send
    saver.changed();
    expect(await saver.flush()).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);

    saver.changed();
    expect(await saver.flush()).toBe(false);
    expect(saver.status()).toBe('retrying');
  });

  it('waits on a hold for the save in flight and sends nothing more until released', async () => {
    const first = deferred();
    const send = vi
      .fn<() => Promise<SaveOutcome>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue('saved');
    const saver = autosave(send);

    saver.changed();
    await vi.advanceTimersByTimeAsync(1000);
    saver.changed();
    let held = false;
    const hold = saver.hold().then(() => (held = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(held).toBe(false);
    first.answer('saved');
    await hold;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(1);

    saver.release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('forgets a save that lands after a reset', async () => {
    const first = deferred();
    const send = vi.fn<() => Promise<SaveOutcome>>().mockReturnValueOnce(first.promise);
    const saver = autosave(send);

    saver.changed();
    await vi.advanceTimersByTimeAsync(1000);
    saver.reset();
    expect(saver.hasUnsaved).toBe(false);
    first.answer('retry');
    await vi.advanceTimersByTimeAsync(60_000);

    expect(saver.status()).toBe('saved');
    expect(send).toHaveBeenCalledTimes(1);
  });
});

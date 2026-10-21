import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PagedSearch, SEARCH_PAUSE_MS, type SearchPage } from './paged-search';

interface Row {
  id: string;
}

const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** A list over a first page of a, b and c out of five, with what the test answers for each request. */
function setup() {
  const first = signal<SearchPage<Row> | null>({ items: rows('a', 'b', 'c'), total: 5 });
  const answers: {
    filter: string;
    skip: number;
    reply: ReturnType<typeof deferred<SearchPage<Row> | null>>;
  }[] = [];
  const fetch = vi.fn((filter: string, skip: number) => {
    const reply = deferred<SearchPage<Row> | null>();
    answers.push({ filter, skip, reply });
    return reply.promise;
  });
  const list = new PagedSearch<Row, string>(
    {
      first,
      isPlain: (filter) => filter.trim() === '',
      fetch,
      key: (row) => row.id,
      filterKey: (filter) => filter.trim().toLowerCase(),
    },
    '',
  );
  const ids = () => list.items().map((row) => row.id);
  return { first, answers, fetch, list, ids };
}

describe('a library list searched and paged on the server (WEA-14)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the first page while nothing is asked, and never reads it again', () => {
    const { list, fetch, ids, first } = setup();

    expect([ids(), list.total(), list.hasMore(), list.answered()]).toEqual([
      ['a', 'b', 'c'],
      5,
      true,
      false,
    ]);
    list.choose('  ');
    vi.advanceTimersByTime(SEARCH_PAUSE_MS);
    expect(fetch).not.toHaveBeenCalled();

    first.set({ items: rows('a', 'd'), total: 2 });
    expect([ids(), list.hasMore()]).toEqual([['a', 'd'], false]);
  });

  it('sends a search once the typing pauses, and keeps the list in place meanwhile', async () => {
    const { list, fetch, answers, ids } = setup();

    list.type('b');
    list.type('be');
    vi.advanceTimersByTime(SEARCH_PAUSE_MS - 1);
    list.type('ben');
    vi.advanceTimersByTime(SEARCH_PAUSE_MS - 1);
    expect(fetch).not.toHaveBeenCalled();
    expect([list.searching(), list.hasMore(), ids()]).toEqual([true, false, ['a', 'b', 'c']]);

    vi.advanceTimersByTime(1);
    expect(fetch.mock.calls).toEqual([['ben', 0]]);
    answers[0].reply.resolve({ items: rows('bench'), total: 1 });
    await vi.runAllTimersAsync();
    expect([list.searching(), list.answered(), ids(), list.hasMore()]).toEqual([
      false,
      true,
      ['bench'],
      false,
    ]);

    // Clearing the box is the first page again at once, with nothing sent.
    list.type('');
    expect([ids(), fetch.mock.calls.length]).toEqual([['a', 'b', 'c'], 1]);
  });

  it('draws only the newest answer, whichever lands first', async () => {
    const { list, answers, ids } = setup();

    list.choose('squat');
    list.choose('press');
    answers[1].reply.resolve({ items: rows('press'), total: 1 });
    await vi.runAllTimersAsync();
    answers[0].reply.resolve({ items: rows('squat'), total: 1 });
    await vi.runAllTimersAsync();

    expect(ids()).toEqual(['press']);
    expect(list.searching()).toBe(false);
  });

  it('adds the next page of the list shown, never a row twice', async () => {
    const { list, answers, ids } = setup();

    const more = list.more();
    expect(list.loadingMore()).toBe(true);
    expect(answers[0]).toMatchObject({ filter: '', skip: 3 });
    // The library gained a row meanwhile, so the next page repeats c.
    answers[0].reply.resolve({ items: rows('c', 'd', 'e'), total: 6 });
    expect(await more).toBe(true);
    expect([ids(), list.loadingMore()]).toEqual([['a', 'b', 'c', 'd', 'e'], false]);

    list.choose('row');
    answers[1].reply.resolve({ items: rows('row-1', 'row-2'), total: 3 });
    await vi.runAllTimersAsync();
    const next = list.more();
    expect(answers[2]).toMatchObject({ filter: 'row', skip: 2 });
    answers[2].reply.resolve({ items: rows('row-2', 'row-3'), total: 3 });
    await next;
    expect([ids(), list.hasMore()]).toEqual([['row-1', 'row-2', 'row-3'], false]);
  });

  it('says a page could not be read, and sends a failed search again on Retry', async () => {
    const { list, answers, ids } = setup();

    const more = list.more();
    answers[0].reply.reject(new Error('offline'));
    expect(await more).toBe(false);
    expect([ids(), list.loadingMore()]).toEqual([['a', 'b', 'c'], false]);

    list.choose('bench');
    answers[1].reply.reject(new Error('offline'));
    await vi.runAllTimersAsync();
    expect([list.failed(), list.searching(), list.hasMore()]).toEqual([true, false, false]);

    list.retry();
    expect(answers[2]).toMatchObject({ filter: 'bench', skip: 0 });
    answers[2].reply.resolve({ items: rows('bench'), total: 1 });
    await vi.runAllTimersAsync();
    expect([list.failed(), ids()]).toEqual([false, ['bench']]);
  });

  it('does not send again a search the server reads alike, and keeps the pages Show more added', async () => {
    const { list, answers, ids, fetch } = setup();

    list.choose('row');
    answers[0].reply.resolve({ items: rows('row-1', 'row-2'), total: 3 });
    await vi.runAllTimersAsync();
    const next = list.more();
    answers[1].reply.resolve({ items: rows('row-3'), total: 3 });
    await next;

    list.type('row ');
    list.type('Row');
    vi.advanceTimersByTime(SEARCH_PAUSE_MS);
    expect([fetch.mock.calls.length, ids(), list.filter()]).toEqual([
      2,
      ['row-1', 'row-2', 'row-3'],
      'Row',
    ]);
  });

  it('sends a failed search again when the same words are typed again', async () => {
    const { list, answers, fetch } = setup();

    list.choose('bench');
    answers[0].reply.reject(new Error('offline'));
    await vi.runAllTimersAsync();
    list.choose('bench');
    expect([fetch.mock.calls.length, list.searching(), list.failed()]).toEqual([2, true, false]);
  });

  it('takes each page’s total, and asks for the next page where the server’s rows end', async () => {
    const { list, answers, ids } = setup();

    // The library grew while the first page was shown: the next page repeats c and says 7 in all.
    const more = list.more();
    answers[0].reply.resolve({ items: rows('c', 'd'), total: 7 });
    await more;
    expect([ids(), list.total(), list.hasMore()]).toEqual([['a', 'b', 'c', 'd'], 7, true]);

    const last = list.more();
    expect(answers[1]).toMatchObject({ filter: '', skip: 5 });
    answers[1].reply.resolve({ items: rows('e', 'f'), total: 7 });
    await last;
    expect([ids(), list.hasMore()]).toEqual([['a', 'b', 'c', 'd', 'e', 'f'], false]);
  });

  it('starts again from the first page on reset, dropping what is on its way', async () => {
    const { list, answers, ids, fetch } = setup();

    list.choose('bench');
    list.type('bench press');
    list.reset();
    vi.advanceTimersByTime(SEARCH_PAUSE_MS);
    answers[0].reply.resolve({ items: rows('bench'), total: 1 });
    await vi.runAllTimersAsync();

    expect([list.filter(), ids(), list.searching(), fetch.mock.calls.length]).toEqual([
      '',
      ['a', 'b', 'c'],
      false,
      1,
    ]);
  });
});

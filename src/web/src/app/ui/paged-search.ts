import { computed, InjectionToken, signal, type WritableSignal } from '@angular/core';

/** One page of a library as the server answered it. */
export interface SearchPage<T> {
  readonly items: readonly T[];
  readonly total: number;
}

/** How long typing must pause before a search goes to the server, as on the Exercises page. */
export const SEARCH_PAUSE_MS = 250;

/** The pause a builder's library lists wait for; a spec sets it to 0 to search at once. */
export const LIBRARY_SEARCH_PAUSE = new InjectionToken<number>('LIBRARY_SEARCH_PAUSE', {
  factory: () => SEARCH_PAUSE_MS,
});

export interface PagedSearchOptions<T, F> {
  /** The unfiltered first page the screen read once for all its lists; null while it is on its way. */
  readonly first: () => SearchPage<T> | null;
  /** Whether a filter asks for nothing, so the list is that first page. */
  readonly isPlain: (filter: F) => boolean;
  /** One page of what the filter finds, from `skip`; null when the answer no longer matters. */
  readonly fetch: (filter: F, skip: number) => Promise<SearchPage<T> | null>;
  /** Tells rows apart, so a page that overlaps the one before (the library changed) adds no row twice. */
  readonly key: (item: T) => string;
  /** What the server reads of a filter: two filters with the same answer are one search, sent once. */
  readonly filterKey: (filter: F) => string;
  /** How long typing must pause before the search goes; `SEARCH_PAUSE_MS` unless given. */
  readonly pauseMs?: number;
}

/** A list as drawn: its rows, the server's rows read so far (where the next page starts), and its total. */
interface Shown<T> {
  readonly items: readonly T[];
  readonly read: number;
  readonly total: number;
}

/**
 * A builder's library list, searched and paged on the server (audit WEA-14), so a library of hundreds is
 * never read whole. Asking for nothing, the list is the first page the screen read once; a search goes once
 * the typing pauses (a chip at once), the list before it stays in place meanwhile, and only the newest answer
 * is drawn. Show more adds the next page of whichever list is shown, from where the server's rows end and
 * with the total that page gives. Read every member as a signal.
 */
export class PagedSearch<T, F> {
  readonly filter: WritableSignal<F>;
  /** A search is on its way; the list shown is the one before it. */
  readonly searching = signal(false);
  /** The newest search could not be read; `retry` sends it again. */
  readonly failed = signal(false);
  readonly loadingMore = signal(false);

  /** What the newest search answered, with its pages; null while the first page is the list. */
  private readonly answer = signal<Shown<T> | null>(null);
  /** The pages Show more added under the first page. */
  private readonly added = signal<Shown<T> | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Moves with every change of filter, so an answer to an older one is dropped. */
  private sent = 0;

  private readonly shown = computed<Shown<T>>(() => {
    const answer = this.answer();
    if (answer) return answer;
    const first = this.options.first();
    const added = this.added();
    const items = first?.items ?? [];
    return added
      ? { items: [...items, ...added.items], read: items.length + added.read, total: added.total }
      : { items, read: items.length, total: first?.total ?? 0 };
  });
  readonly items = computed<readonly T[]>(() => this.shown().items);
  readonly total = computed(() => this.shown().total);
  /** Whether the list shows a search's answer rather than the first page. */
  readonly answered = computed(() => this.answer() !== null);
  readonly hasMore = computed(
    () => !this.searching() && !this.failed() && this.shown().read < this.shown().total,
  );

  constructor(
    private readonly options: PagedSearchOptions<T, F>,
    private readonly initial: F,
  ) {
    this.filter = signal(initial);
  }

  /** Typing: the search goes once the typing has paused. */
  type(filter: F): void {
    this.change(filter, this.options.pauseMs ?? SEARCH_PAUSE_MS);
  }

  /** A chip, or a box cleared: at once. */
  choose(filter: F): void {
    this.change(filter, 0);
  }

  /** Sends the newest search again, after it failed. */
  retry(): void {
    this.change(this.filter(), 0, true);
  }

  /** Back to the first page with nothing asked, such as when the screen reads its library again. */
  reset(): void {
    this.stop();
    this.filter.set(this.initial);
    this.answer.set(null);
    this.added.set(null);
  }

  /** Stops anything still on its way or waiting for the typing to pause. */
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.sent += 1;
    this.searching.set(false);
    this.failed.set(false);
    this.loadingMore.set(false);
  }

  /** Adds the next page of the list shown; false when it could not be read, so the screen can say so. */
  async more(): Promise<boolean> {
    if (this.loadingMore() || !this.hasMore()) return true;
    const sent = this.sent;
    const plain = this.answer() === null;
    this.loadingMore.set(true);
    try {
      const page = await this.options.fetch(this.filter(), this.shown().read);
      if (sent !== this.sent || page === null) return true;
      if (plain) {
        const before = this.added();
        this.added.set({
          items: this.append(before?.items ?? [], page.items, this.options.first()?.items),
          read: (before?.read ?? 0) + page.items.length,
          total: page.total,
        });
      } else {
        this.answer.update((answer) =>
          answer
            ? {
                items: this.append(answer.items, page.items),
                read: answer.read + page.items.length,
                total: page.total,
              }
            : answer,
        );
      }
      return true;
    } catch {
      return sent !== this.sent;
    } finally {
      if (sent === this.sent) this.loadingMore.set(false);
    }
  }

  private change(filter: F, delay: number, again = false): void {
    // The search the server is already answering, or has answered, is not sent twice: a trailing space or a
    // letter typed and taken back keeps the list, and the pages Show more added, where they are.
    const same = this.options.filterKey(filter) === this.options.filterKey(this.filter());
    if (!again && same && !this.failed()) {
      this.filter.set(filter);
      return;
    }
    this.stop();
    this.filter.set(filter);
    const sent = this.sent;
    if (this.options.isPlain(filter)) {
      this.answer.set(null);
      return;
    }
    this.searching.set(true);
    const send = () => {
      this.timer = null;
      void this.send(filter, sent);
    };
    if (delay === 0) send();
    else this.timer = setTimeout(send, delay);
  }

  private async send(filter: F, sent: number): Promise<void> {
    try {
      const page = await this.options.fetch(filter, 0);
      if (sent !== this.sent) return;
      this.searching.set(false);
      if (page) {
        this.answer.set({
          items: this.append([], page.items),
          read: page.items.length,
          total: page.total,
        });
      }
    } catch {
      if (sent !== this.sent) return;
      this.searching.set(false);
      this.failed.set(true);
    }
  }

  /** `items` then the rows of `page` neither holds nor `before` already shows. */
  private append(items: readonly T[], page: readonly T[], before: readonly T[] = []): T[] {
    const seen = new Set([...before, ...items].map(this.options.key));
    const fresh = page.filter((item) => {
      const key = this.options.key(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return [...items, ...fresh];
  }
}

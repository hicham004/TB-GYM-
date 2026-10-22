import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  LOCALE_ID,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { Button } from '../../ui/button';
import { EmptyState } from '../../ui/empty-state';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { SettingsFrame } from '../settings/settings-frame';
import { UndeliveredNoticesApi } from './undelivered-notices-api';
import {
  type UndeliveredNotice,
  undeliveredNoticeRow,
  undeliveredSummary,
} from './undelivered-notices.models';

/** One read's worth, the server's own default page. */
const PAGE = 25;

/**
 * Settings › Undelivered notices (audit INV-4; ADR 0018, NOT-007): the notices TB Gym gave up
 * delivering in this coaching space, newest first, each with what it was about, how it went, when,
 * why it stopped and a reference to quote to TB Gym. Who it was for and what it said are not the
 * owner's to read, so the server never sends them. Read-only: sending one again is a write against
 * somebody else's inbox, which no rule allows yet.
 *
 * Presentation only. The API answers the owner alone, and this page is only reached through the
 * owner's Settings.
 */
@Component({
  selector: 'app-undelivered-notices',
  imports: [Button, EmptyState, SettingsFrame, Skeleton, StatusPill],
  templateUrl: './undelivered-notices.html',
  styleUrl: './undelivered-notices.scss',
})
export class UndeliveredNotices {
  private readonly api = inject(UndeliveredNoticesApi);
  private readonly tenants = inject(TenantStore);
  private readonly calendar = inject(WorkspaceCalendar);
  private readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private loadedTenantId: string | null = null;

  protected readonly loadingLabel = $localize`Loading undelivered notices…`;

  private readonly notices = signal<readonly UndeliveredNotice[]>([]);
  private readonly total = signal(0);
  /**
   * How many rows of the list, from its top, have been read: where the next page starts. A notice given
   * up between two reads moves every row down one, so a page can repeat a row already shown (dropped
   * here) and the new one is read from the top.
   */
  private readonly read = signal(0);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly loadingMore = signal(false);
  protected readonly moreFailed = signal(false);

  protected readonly rows = computed(() =>
    this.notices().map((notice) =>
      undeliveredNoticeRow(notice, this.locale, this.calendar.timeZone()),
    ),
  );
  protected readonly hasMore = computed(() => this.read() < this.total());
  protected readonly summary = computed(() => undeliveredSummary(this.total()));

  constructor() {
    this.scope.onReset(() => {
      this.loadedTenantId = null;
      this.notices.set([]);
      this.total.set(0);
      this.read.set(0);
      this.loadingMore.set(false);
      this.moreFailed.set(false);
      this.state.set('loading');
    });
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        void this.load();
      }
    });
    // The heading takes focus on arrival, so a screen reader starts at the top of the page.
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
  }

  protected async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.state.set('loading');
      try {
        // The workspace's zone comes with the first page, so every time reads on its clock at once.
        const [page] = await owner.wait(
          Promise.all([firstValueFrom(this.api.getPage(0, PAGE)), this.calendar.resolveToday()]),
        );
        this.notices.set(page.items);
        this.read.set(page.items.length);
        this.total.set(page.total);
        this.state.set('ready');
      } catch {
        if (owner.current) this.state.set('error');
      }
    });
  }

  protected async loadMore(): Promise<void> {
    return this.scope.run('more', async (owner) => {
      this.loadingMore.set(true);
      this.moreFailed.set(false);
      try {
        const before = this.total();
        const page = await owner.wait(firstValueFrom(this.api.getPage(this.read(), PAGE)));
        const added = this.notShown(page.items);
        this.notices.update((notices) => [...notices, ...added]);
        this.read.update((read) => read + page.items.length);
        this.total.set(page.total);
        // A notice given up since the first read sits above every row read so far: read that many from
        // the top too, so the count over the list and its rows agree.
        const newer = page.total - before;
        if (newer > 0) {
          const top = await owner.wait(firstValueFrom(this.api.getPage(0, newer)));
          this.notices.update((notices) => [...this.notShown(top.items), ...notices]);
        }
        // The last page takes Show more away: focus moves to the first notice it brought.
        if (!this.hasMore()) this.focusFirstOf(added);
      } catch {
        if (owner.current) this.moreFailed.set(true);
      } finally {
        if (owner.current) this.loadingMore.set(false);
      }
    });
  }

  private notShown(items: readonly UndeliveredNotice[]): UndeliveredNotice[] {
    const shown = new Set(this.notices().map((notice) => notice.id));
    return items.filter((notice) => !shown.has(notice.id));
  }

  private focusFirstOf(added: readonly UndeliveredNotice[]): void {
    const first = added[0] ?? null;
    afterNextRender(
      () => {
        const target = first
          ? this.host.querySelector<HTMLElement>(`[data-notice="${first.id}"]`)
          : null;
        (target ?? this.heading()?.nativeElement)?.focus();
      },
      { injector: this.injector },
    );
  }
}

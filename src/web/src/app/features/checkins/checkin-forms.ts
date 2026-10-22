import { NgTemplateOutlet } from '@angular/common';
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
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type { CheckInFormSummary } from '../../core/api/generated';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { WorkspaceCalendar } from '../../core/tenancy/workspace-calendar';
import { Button, ButtonLink } from '../../ui/button';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { formCard, libraryLine, type FormClock } from './checkin-forms.models';

/** The most forms one read brings, the server's own page limit. */
const PAGE = 100;

/**
 * Check-in forms (audit A14b, AUTH-8): the coach's forms as cards, as Programs and Recipes are, each
 * opening on its own page. The first thing on the page is New form (plan §2 rule 1); a form is assigned
 * from a client's Check-ins tab, which the line under the title says. An empty library is invited to
 * start from a weekly check-in it can change before anything is saved (rule 10).
 */
@Component({
  selector: 'app-checkin-forms',
  imports: [
    Button,
    ButtonLink,
    EmptyState,
    Icon,
    NgTemplateOutlet,
    RouterLink,
    Skeleton,
    StatusPill,
  ],
  templateUrl: './checkin-forms.html',
  styleUrl: './checkin-forms.scss',
})
export class CheckInForms {
  private readonly api = inject(ApiClient);
  private readonly tenants = inject(TenantStore);
  private readonly calendar = inject(WorkspaceCalendar);
  private readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private loadedTenantId: string | null = null;

  protected readonly loadingLabel = $localize`Loading your check-in forms…`;
  protected readonly starter = { start: 'weekly' };

  private readonly forms = signal<CheckInFormSummary[]>([]);
  private readonly total = signal(0);
  /**
   * How many rows the server has sent, which is where the next page starts: a form created or renamed
   * between two reads moves the title order, so a page can repeat a row already shown (dropped here).
   */
  private readonly read = signal(0);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly loadingMore = signal(false);
  protected readonly moreFailed = signal(false);

  private readonly clock = computed<FormClock>(() => ({
    locale: this.locale,
    timeZone: this.calendar.timeZone(),
    today: this.calendar.today(),
  }));
  protected readonly cards = computed(() =>
    this.forms()
      .filter((form) => !form.isArchived)
      .map((form) => formCard(form, this.clock())),
  );
  protected readonly archived = computed(() =>
    this.forms()
      .filter((form) => form.isArchived)
      .map((form) => formCard(form, this.clock())),
  );
  protected readonly hasMore = computed(() => this.read() < this.total());
  protected readonly summary = computed(() => libraryLine(this.forms(), this.total()));

  constructor() {
    this.scope.onReset(() => {
      this.loadedTenantId = null;
      this.forms.set([]);
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
        // The workspace's day and zone come with the cards, so a publish day reads on its clock.
        const [page] = await owner.wait(
          Promise.all([
            firstValueFrom(this.api.listCheckInForms(0, PAGE)),
            this.calendar.resolveToday(),
          ]),
        );
        this.forms.set(page.items);
        this.read.set(page.items.length);
        this.total.set(Number(page.total));
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
        const page = await owner.wait(firstValueFrom(this.api.listCheckInForms(this.read(), PAGE)));
        const seen = new Set(this.forms().map((form) => form.id));
        const added = page.items.filter((form) => !seen.has(form.id));
        this.forms.update((forms) => [...forms, ...added]);
        this.read.update((read) => read + page.items.length);
        this.total.set(Number(page.total));
        // The last page takes Show more away: focus moves to the first form it brought.
        if (!this.hasMore()) this.focusFirstOf(added);
      } catch {
        if (owner.current) this.moreFailed.set(true);
      } finally {
        if (owner.current) this.loadingMore.set(false);
      }
    });
  }

  private focusFirstOf(added: readonly CheckInFormSummary[]): void {
    const first = added.find((form) => !form.isArchived) ?? null;
    afterNextRender(
      () => {
        const target = first
          ? this.host.querySelector<HTMLElement>(`a[href="/checkins/forms/${first.id}"]`)
          : this.host.querySelector<HTMLElement>('details.archived > summary');
        (target ?? this.heading()?.nativeElement)?.focus();
      },
      { injector: this.injector },
    );
  }
}

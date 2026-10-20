import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  LOCALE_ID,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { CsrfService } from '../../core/security/csrf.service';
import { initialsOf } from '../../shell/initials';
import { Avatar, type AvatarPresentation } from '../../ui/avatar';
import { Button } from '../../ui/button';
import { UiConfirm } from '../../ui/confirm';
import { UiDialog } from '../../ui/dialog';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { UiSheet } from '../../ui/sheet';
import { Skeleton } from '../../ui/skeleton';
import { StatTile } from '../../ui/stat-tile';
import { StatusPill, type StatusPillTone } from '../../ui/status-pill';
import { UiToast } from '../../ui/toast';
import {
  billingStatusLabel,
  billingStatusTone,
  formatDay,
  formatMoney,
  formatMonth,
  type AdminWorkspace,
  type PricePlan,
} from '../billing/billing.models';
import { PlatformAdminApi } from './platform-admin-api';
import {
  filterCounts,
  matchesFilter,
  matchesQuery,
  nextLine,
  owedText,
  planSummaryLine,
  planTermRows,
  seatsAndClients,
  SPACE_FILTERS,
  sortSpaces,
  summarize,
  TRIAL_ENDING_DAYS,
  utcToday,
  type SpaceFilter,
} from './platform-admin.models';
import { PlatformRequests } from './platform-requests';
import { PlatformPlan } from './platform-sheets';

interface SpaceRow {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  readonly face: AvatarPresentation;
  readonly owner: string;
  readonly usage: string;
  readonly status: string;
  readonly tone: StatusPillTone;
  readonly next: string;
  /** What it owes, or null when nothing. */
  readonly owed: string | null;
  readonly link: string[];
}

/**
 * Platform billing for the TB Gym platform admin (R5.2b, ADR 0028): every coaching space in the
 * order that needs the admin first, with what is owed, when it falls due and when it locks, and the
 * versioned price plan below. A space opens on its own page; the price plan is published here, in a
 * sheet. Last, the Talk-to-us requests whose email has not reached the admin (audit BEB-1).
 *
 * Presentation only. The API authorizes the global role on every request, works out every amount
 * and date, and keeps every record it replaces; nothing here is ever deleted.
 */
@Component({
  selector: 'app-platform-admin',
  imports: [
    Avatar,
    Button,
    EmptyState,
    Icon,
    PlatformPlan,
    PlatformRequests,
    RouterLink,
    Skeleton,
    StatTile,
    StatusPill,
    UiConfirm,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './platform-admin.html',
  styleUrls: ['./platform-admin.scss', '../clients/clients-toolbar.scss'],
})
export class PlatformAdmin {
  private readonly api = inject(PlatformAdminApi);
  private readonly csrf = inject(CsrfService);
  private readonly locale = inject(LOCALE_ID);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly sheets = inject(UiSheet);
  private readonly dialogs = inject(UiDialog);
  private readonly toast = inject(UiToast);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly planSheet = viewChild.required<TemplateRef<unknown>>('planSheet');
  private readonly confirmDialog = viewChild.required<TemplateRef<unknown>>('confirmDialog');
  private openSheet: { close: () => void } | null = null;
  private planDirty = false;

  protected readonly closeLabel = $localize`Close`;
  protected readonly loadingLabel = $localize`Loading platform billing…`;
  /** Today in UTC, the days billing runs on. */
  protected readonly today = utcToday();

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly spaces = signal<AdminWorkspace[]>([]);
  protected readonly plans = signal<PricePlan[]>([]);
  protected readonly filter = signal<SpaceFilter>(initialFilter(this.route));
  protected readonly search = signal('');
  protected readonly busy = signal(false);
  protected readonly asking = signal<{ message: string; confirm: string; cancel: string } | null>(
    null,
  );

  protected readonly current = computed(() => this.plans().find((plan) => plan.isCurrent) ?? null);
  protected readonly earlier = computed(() => this.plans().filter((plan) => !plan.isCurrent));
  protected readonly summary = computed(() => summarize(this.spaces(), this.today));
  protected readonly owed = computed(() => owedText(this.summary(), this.locale));
  protected readonly counts = computed(() => filterCounts(this.spaces()));
  protected readonly chips = computed(() => {
    const counts = this.counts();
    const labels: Record<SpaceFilter, string> = {
      all: $localize`All`,
      owing: $localize`Needs payment`,
      trial: $localize`On trial`,
      paid: $localize`Paid up`,
    };
    return SPACE_FILTERS.map((value) => ({ value, label: labels[value], count: counts[value] }));
  });
  protected readonly rows = computed<SpaceRow[]>(() =>
    sortSpaces(this.spaces(), this.today)
      .filter((space) => matchesFilter(space, this.filter()) && matchesQuery(space, this.search()))
      .map((space) => this.toRow(space)),
  );
  protected readonly terms = computed(() => {
    const plan = this.current();
    return plan ? planTermRows(plan, this.locale) : [];
  });
  protected readonly resultSummary = computed(() => {
    const count = this.rows().length;
    return count === 1
      ? $localize`1 coaching space shown`
      : $localize`${count}:count: coaching spaces shown`;
  });
  protected readonly empty = computed(() => {
    if (this.search().trim() !== '') {
      return {
        heading: $localize`No coaching space matches “${this.search().trim()}:search:”`,
        description: $localize`Search looks at the space’s name and its owner’s name and email.`,
        action: $localize`Clear search`,
      };
    }
    const headings: Record<SpaceFilter, string> = {
      all: '',
      owing: $localize`Nobody owes anything right now`,
      trial: $localize`No coaching space is on a free trial`,
      paid: $localize`No coaching space is paid up yet`,
    };
    return {
      heading: headings[this.filter()],
      description: $localize`Coaching spaces appear here when they fit.`,
      action: $localize`Show all`,
    };
  });

  protected readonly tileOwed = computed(() =>
    this.summary().owingSpaces === 0
      ? $localize`Nothing is owed`
      : this.summary().owingSpaces === 1
        ? $localize`By 1 coaching space`
        : $localize`By ${this.summary().owingSpaces}:count: coaching spaces`,
  );
  protected readonly tileReadOnly = computed(() =>
    this.summary().readOnlySpaces === 0
      ? $localize`No coaching space is locked`
      : $localize`Their coaches cannot edit until they pay`,
  );
  protected readonly tileOverdue = computed(() =>
    this.summary().overdueSpaces === 0
      ? $localize`Nothing is overdue`
      : $localize`Past their due date, not yet read-only`,
  );
  protected readonly tileTrials = computed(() =>
    this.summary().trialsEnding === 0
      ? $localize`None in the next ${TRIAL_ENDING_DAYS}:days: days`
      : $localize`In the next ${TRIAL_ENDING_DAYS}:days: days`,
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this.openSheet?.close());
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
    void this.load();
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    try {
      const [spaces, plans] = await Promise.all([
        firstValueFrom(this.api.getWorkspaces()),
        firstValueFrom(this.api.getPricePlans()),
      ]);
      this.spaces.set(spaces);
      this.plans.set(plans);
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  protected setFilter(filter: SpaceFilter): void {
    this.filter.set(filter);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { show: filter === 'all' ? null : filter },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected clearFilter(): void {
    if (this.search().trim() !== '') this.search.set('');
    else this.setFilter('all');
  }

  protected money(amount: number, currencyCode: string): string {
    return formatMoney(amount, currencyCode, this.locale);
  }

  protected day(date: string): string {
    return formatDay(date, this.locale);
  }

  /** The month the manual run invoices: the one before this. */
  private lastMonth(): string {
    const [year, month] = this.today.split('-').map(Number);
    const previous =
      month === 1 ? `${year - 1}-12-01` : `${year}-${String(month - 1).padStart(2, '0')}-01`;
    return formatMonth(previous, this.locale);
  }

  protected async issueInvoices(): Promise<void> {
    if (this.busy()) return;
    const month = this.lastMonth();
    const yes = await this.ask(
      $localize`Issue the invoices for ${month}:month: now? Every coaching space past its trial gets one and its owner is emailed. A month already issued is skipped, so this is safe to repeat.`,
      $localize`Issue invoices`,
      $localize`Not now`,
      $localize`Issue last month’s invoices`,
    );
    if (!yes) return;
    this.busy.set(true);
    try {
      await this.csrf.refresh();
      const run = await firstValueFrom(this.api.issueInvoices());
      this.toast.show(
        $localize`Invoices for ${formatMonth(run.periodStart, this.locale)}:month:: ${run.issued}:issued: issued, ${run.alreadyIssued}:already: already issued, ${run.inTrial}:trial: in trial.`,
        { tone: 'success' },
      );
      await this.load();
    } catch (error) {
      this.toast.show(
        apiErrorMessage(error, $localize`The invoices could not be issued. Try again.`),
        { tone: 'error' },
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected openPlan(): void {
    this.planDirty = false;
    this.openSheet?.close();
    const sheet = this.sheets.open<PricePlan | false>(this.planSheet(), {
      title: $localize`Publish a price plan version`,
      closeLabel: this.closeLabel,
      canClose: () =>
        !this.planDirty ||
        this.ask(
          $localize`Close without publishing? What you changed will be lost.`,
          $localize`Discard`,
          $localize`Keep editing`,
          $localize`Discard changes?`,
        ),
    });
    this.openSheet = sheet;
    sheet.closed.subscribe((published) => {
      if (this.openSheet === sheet) this.openSheet = null;
      if (published) {
        this.toast.show(
          $localize`Price plan version ${published.versionNumber}:version: is published. Invoices issued from now on use it.`,
          { tone: 'success' },
        );
      }
      // Whatever happened, show the plans as they are now.
      void this.load();
    });
  }

  protected setPlanDirty(dirty: boolean): void {
    this.planDirty = dirty;
  }

  protected planLine(plan: PricePlan): string {
    return planSummaryLine(plan, this.locale);
  }

  private toRow(space: AdminWorkspace): SpaceRow {
    return {
      id: space.tenantId,
      name: space.name,
      initials: initialsOf(space.name, space.ownerEmail),
      face:
        space.status === 'ReadOnly'
          ? 'client-danger'
          : space.status === 'Overdue'
            ? 'client-warning'
            : 'client',
      owner: `${space.ownerName} · ${space.ownerEmail}`,
      usage: seatsAndClients(space),
      status: billingStatusLabel(space.status),
      tone: billingStatusTone(space.status),
      next: nextLine(space, this.today, this.locale),
      owed: space.unpaidTotal > 0 ? this.money(space.unpaidTotal, space.currencyCode) : null,
      link: ['/admin/billing', space.tenantId],
    };
  }

  private async ask(
    message: string,
    confirm: string,
    cancel: string,
    title: string,
  ): Promise<boolean> {
    this.asking.set({ message, confirm, cancel });
    const dialog = this.dialogs.open<boolean>(this.confirmDialog(), {
      title,
      closeLabel: this.closeLabel,
    });
    const answer = await firstValueFrom(dialog.closed);
    this.asking.set(null);
    return answer === true;
  }
}

function initialFilter(route: ActivatedRoute): SpaceFilter {
  const show = route.snapshot.queryParamMap.get('show');
  return SPACE_FILTERS.find((filter) => filter === show) ?? 'all';
}

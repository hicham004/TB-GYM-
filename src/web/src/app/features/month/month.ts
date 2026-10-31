import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  LOCALE_ID,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Avatar } from '../../ui/avatar';
import { Button, ButtonLink } from '../../ui/button';
import { UiDisclosure, UiDisclosureContent } from '../../ui/disclosure';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { SegmentedControl, type SegmentOption } from '../../ui/segmented-control';
import { Skeleton } from '../../ui/skeleton';
import { MonthApi } from './month-api';
import { monthPage, type MonthPage, type RowNumbers } from './month.models';

/**
 * This month (critique B10d, SUB-018): what came in and what changed, this month beside the last, in
 * the workspace's calendar. A coach reads their own numbers; the owner the coaching space's, with
 * each coach's. One read, opened from Today's This month. It only reads, names no client and says
 * nothing of profit: the app knows what arrived, not what anything cost.
 */
@Component({
  selector: 'app-this-month',
  imports: [
    Avatar,
    Button,
    ButtonLink,
    EmptyState,
    Icon,
    NgTemplateOutlet,
    RouterLink,
    SegmentedControl,
    Skeleton,
    UiDisclosure,
    UiDisclosureContent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './month.html',
  styleUrls: ['./month.scss', './month-coaches.scss'],
})
export class ThisMonth {
  private readonly api = inject(MonthApi);
  private readonly locale = inject(LOCALE_ID);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private loadedTenantId: string | null = null;

  protected readonly loadingLabel = $localize`Loading this month…`;
  protected readonly columns = {
    coach: $localize`Coach`,
    money: $localize`Money received`,
    sessions: $localize`Sessions held`,
    plans: $localize`Plans sold`,
    packs: $localize`Packs sold`,
    started: $localize`Started`,
    ended: $localize`Ended`,
  };

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly month = signal<MonthPage | null>(null);
  /** The month the owner's rows show: a row can't hold both, so they switch together. */
  protected readonly shown = signal<'this' | 'last'>('this');
  protected readonly monthOptions = computed<readonly SegmentOption[]>(() => {
    const month = this.month();
    return month
      ? [
          { value: 'this', label: month.soFar },
          { value: 'last', label: month.lastMonth },
        ]
      : [];
  });
  protected readonly rows = computed(() =>
    (this.month()?.coaches ?? []).map((row) => ({ ...row, numbers: this.numbersOf(row) })),
  );
  protected readonly total = computed(() => {
    const month = this.month();
    return month ? this.numbersOf(month.total) : null;
  });

  constructor() {
    this.scope.onReset(() => {
      this.loadedTenantId = null;
      this.month.set(null);
      this.shown.set('this');
      this.state.set('loading');
    });
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      if (tenantId && tenantId !== this.loadedTenantId) {
        this.loadedTenantId = tenantId;
        void this.load();
      }
    });
  }

  protected async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.state.set('loading');
      try {
        const view = await owner.wait(firstValueFrom(this.api.getMonth()));
        this.month.set(monthPage(view, this.locale));
        this.state.set('ready');
      } catch {
        if (owner.current) this.state.set('error');
      }
    });
  }

  protected show(month: string): void {
    this.shown.set(month === 'last' ? 'last' : 'this');
  }

  private numbersOf(row: { thisMonth: RowNumbers; lastMonth: RowNumbers }): RowNumbers {
    return this.shown() === 'last' ? row.lastMonth : row.thisMonth;
  }
}

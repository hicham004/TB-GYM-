import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe, DecimalPipe } from '@angular/common';
import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
  type WritableSignal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom, type Observable } from 'rxjs';
import { ClientAccessStore } from '../../core/access/client-access.store';
import { ApiClient } from '../../core/api/api-client';
import type { CheckInAssignmentListView } from '../../core/api/generated';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import { Icon } from '../../ui/icon';
import type { NutritionDay } from '../nutrition/nutrition.models';
import { checkInRow, nutritionRow, type ReadState, rowAccessLabel } from './today.models';

type Row = 'nutrition' | 'checkIns';

/**
 * "Also today": nutrition, then the check-in due first. Each row reads on its own and
 * fails on its own; a failure never hides the other row or the training card. The coach reviews a
 * check-in and the client completes a nutrition day, so no shared "n of m done" is invented.
 */
@Component({
  selector: 'app-today-also',
  imports: [Button, DatePipe, DecimalPipe, Icon, RouterLink],
  templateUrl: './today-also.html',
  styleUrls: ['./today-rows.scss'],
})
export class TodayAlso {
  private readonly api = inject(ApiClient);
  private readonly tenants = inject(TenantStore);
  private readonly access = inject(ClientAccessStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  /** The workspace's date, from the training read; null until it is known. */
  readonly today = input<string | null>(null);

  private readonly nutritionRead = signal<ReadState<NutritionDay>>({ kind: 'loading' });
  private readonly checkInRead = signal<ReadState<CheckInAssignmentListView>>({ kind: 'loading' });

  protected readonly nutrition = computed(() =>
    nutritionRow(this.access.decision('Nutrition'), this.access.status(), this.nutritionRead()),
  );
  protected readonly nutritionData = computed(() => {
    const read = this.nutritionRead();
    return read.kind === 'ok' ? read.value : null;
  });
  protected readonly nutritionProgress = computed(() => {
    const day = this.nutritionData();
    return day && day.targetCalories > 0
      ? `${Math.min(100, Math.round((day.selectedCalories / day.targetCalories) * 100))}%`
      : '0%';
  });
  protected readonly checkIn = computed(() =>
    checkInRow(this.access.decision('CheckIns'), this.checkInRead(), this.today()),
  );
  protected readonly visible = computed(
    () => this.nutrition().kind !== 'hidden' || this.checkIn().kind !== 'hidden',
  );
  protected readonly accessLabel = rowAccessLabel;

  /** One polite message for whichever rows could not load; never assertive. */
  protected readonly failures = computed(() =>
    [
      this.nutrition().kind === 'failed' ? $localize`Couldn’t load nutrition.` : '',
      this.checkIn().kind === 'failed' ? $localize`Couldn’t load check-ins.` : '',
    ]
      .filter(Boolean)
      .join(' '),
  );

  /** Rows already read (or deliberately not read) in this workspace. */
  private readonly requested = new Set<Row>();

  constructor() {
    this.scope.onReset(() => {
      this.requested.clear();
      this.nutritionRead.set({ kind: 'loading' });
      this.checkInRead.set({ kind: 'loading' });
    });
    // Each row waits for the access answer, and a feature the answer calls closed (outside the
    // plan, paused, ended…) is never asked for: its row is hidden or states that reason anyway, and
    // the refused read would only put a 403 or 404 in the console. If the answer cannot be read, the
    // rows read regardless and explain what they get back.
    effect(() => {
      this.scope.epoch();
      const tenant = this.tenants.selectedTenantId();
      const status = this.access.status();
      const nutritionClosed = this.access.decision('Nutrition')?.isAllowed === false;
      const checkInsClosed = this.access.decision('CheckIns')?.isAllowed === false;
      if (!tenant || status === 'idle' || status === 'loading') return;
      untracked(() => {
        this.readOnce('nutrition', nutritionClosed);
        this.readOnce('checkIns', checkInsClosed);
      });
    });
  }

  private readOnce(row: Row, closed: boolean): void {
    if (this.requested.has(row)) return;
    this.requested.add(row);
    if (!closed) void this.load(row);
  }

  protected async retry(row: Row): Promise<void> {
    // A nutrition 404 is only readable against the access decision, so a failed one is retried too.
    if (row === 'nutrition' && this.access.status() === 'failed') void this.access.load();
    await this.load(row);
    const state = row === 'nutrition' ? this.nutrition() : this.checkIn();
    if (state.kind !== 'failed') setTimeout(() => this.heading()?.nativeElement.focus());
  }

  private load(row: Row): Promise<void> {
    return row === 'nutrition'
      ? this.read('nutrition', this.api.getMyNutritionDay(), this.nutritionRead)
      : this.read('checkIns', this.api.listOwnCheckInAssignments(0, 50), this.checkInRead);
  }

  private read<T>(
    lane: Row,
    request: Observable<T>,
    target: WritableSignal<ReadState<T>>,
  ): Promise<void> {
    return this.scope.run(lane, async (owner) => {
      target.set({ kind: 'loading' });
      try {
        const value = await owner.wait(firstValueFrom(request));
        target.set({ kind: 'ok', value });
      } catch (error) {
        if (!owner.current) return;
        const status = error instanceof HttpErrorResponse ? error.status : 0;
        target.set({ kind: status === 404 ? 'missing' : status === 403 ? 'denied' : 'failed' });
      }
    });
  }
}

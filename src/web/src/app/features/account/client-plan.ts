import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  LOCALE_ID,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink } from '../../ui/button';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { ownPlans, type OwnPlan, type OwnSession } from './client-plan.models';

/**
 * My plan (critique B10a): where a client reads what they agreed with their coach, its name, what's
 * included, the dates and the coach's description, and for a pack what is left and what happened to
 * each session (B10c). Reached from Me. It only reads: renewing stays on Today, and no price or
 * payment shows here.
 */
@Component({
  selector: 'app-client-plan-page',
  imports: [Button, ButtonLink, EmptyState, Icon, RouterLink, Skeleton, StatusPill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './client-plan.html',
  styleUrl: './client-plan.scss',
})
export class ClientPlanPage {
  private readonly api = inject(ApiClient);
  private readonly locale = inject(LOCALE_ID);
  private readonly tenants = inject(TenantStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private loadedTenantId: string | null = null;

  protected readonly loadingLabel = $localize`Loading your plan…`;
  /** A pack's newest sessions; the rest on request, as Today's feed does. */
  protected readonly preview = 5;

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly plans = signal<readonly OwnPlan[]>([]);
  private readonly opened = signal<ReadonlySet<string>>(new Set());

  constructor() {
    this.scope.onReset(() => {
      this.loadedTenantId = null;
      this.plans.set([]);
      this.opened.set(new Set());
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

  protected isOpen(planId: string): boolean {
    return this.opened().has(planId);
  }

  protected shown(planId: string, history: readonly OwnSession[]): readonly OwnSession[] {
    return this.isOpen(planId) ? history : history.slice(0, this.preview);
  }

  protected toggle(planId: string): void {
    const opened = new Set(this.opened());
    if (!opened.delete(planId)) opened.add(planId);
    this.opened.set(opened);
  }

  protected async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      this.state.set('loading');
      try {
        const view = await owner.wait(firstValueFrom(this.api.getOwnPlans()));
        this.plans.set(ownPlans(view, this.locale));
        this.state.set('ready');
      } catch {
        if (owner.current) this.state.set('error');
      }
    });
  }
}

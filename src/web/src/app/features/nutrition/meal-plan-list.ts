import {
  afterNextRender,
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
import type { MealPlanDraftSummary, MealPlanTemplateSummary } from '../../core/api/generated';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink } from '../../ui/button';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { SectionNav } from '../../ui/section-nav';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { numeric } from '../training/training-builder.models';
import { MealPlanApi } from './meal-plan-api';
import { draftPlanCard, planCard } from './meal-plan-builder.models';

/**
 * Meal plans (C7): the coach's plans as cards, each opening in the builder. The first thing on the
 * page is New meal plan (plan §2 rule 1); an empty workspace is invited to build its first one.
 */
@Component({
  selector: 'app-meal-plan-list',
  imports: [Button, ButtonLink, EmptyState, Icon, RouterLink, SectionNav, Skeleton, StatusPill],
  templateUrl: './meal-plan-list.html',
  styleUrl: './meal-plan-list.scss',
})
export class MealPlanList {
  private readonly api = inject(MealPlanApi);
  private readonly tenants = inject(TenantStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private loadedTenantId: string | null = null;

  protected readonly sections = [
    { label: $localize`Meal plans`, link: '/nutrition/plans' },
    { label: $localize`Recipes and foods`, link: '/nutrition/library' },
  ];
  protected readonly loadingLabel = $localize`Loading your meal plans…`;

  private readonly plans = signal<MealPlanTemplateSummary[]>([]);
  /** The coach's new plans not published yet (NUT-013); changes to saved ones ride their card. */
  private readonly newDrafts = signal<MealPlanDraftSummary[]>([]);
  private readonly total = signal(0);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly loadingMore = signal(false);
  protected readonly moreFailed = signal(false);

  protected readonly cards = computed(() => [
    ...this.newDrafts().map((draft) => draftPlanCard(draft, this.locale)),
    ...this.plans().map((plan) => planCard(plan, this.locale)),
  ]);
  protected readonly hasMore = computed(() => this.plans().length < this.total());
  protected readonly summary = computed(() => {
    const count = this.total();
    if (count === 0) return '';
    const ready = this.plans().filter((plan) => plan.status === 'Published').length;
    const plans = count === 1 ? $localize`1 meal plan` : $localize`${count}:count: meal plans`;
    return this.hasMore() ? plans : $localize`${plans}:plans:, ${ready}:ready: ready to assign`;
  });

  constructor() {
    this.scope.onReset(() => {
      this.loadedTenantId = null;
      this.plans.set([]);
      this.newDrafts.set([]);
      this.total.set(0);
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
        const [page, drafts] = await owner.wait(
          Promise.all([
            firstValueFrom(this.api.listPlans(0, 100)),
            firstValueFrom(this.api.listDrafts()),
          ]),
        );
        this.plans.set([...page.items]);
        this.newDrafts.set(drafts.filter((draft) => !draft.mealPlanTemplateId));
        this.total.set(numeric(page.total));
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
        const page = await owner.wait(firstValueFrom(this.api.listPlans(this.plans().length, 100)));
        this.plans.update((items) => [...items, ...page.items]);
        this.total.set(numeric(page.total));
      } catch {
        if (owner.current) this.moreFailed.set(true);
      } finally {
        if (owner.current) this.loadingMore.set(false);
      }
    });
  }
}

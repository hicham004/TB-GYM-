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
import { ApiClient } from '../../core/api/api-client';
import type { ProgramTemplateSummary } from '../../core/api/generated';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink } from '../../ui/button';
import { EmptyState } from '../../ui/empty-state';
import { Icon } from '../../ui/icon';
import { SectionNav } from '../../ui/section-nav';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { programCard } from './program-builder.models';
import { numeric } from './training-builder.models';

/**
 * Programs (C4): the coach's programs as cards, each opening in the builder. The first thing on the
 * page is New program (plan §2 rule 1); an empty workspace is invited to build its first one.
 */
@Component({
  selector: 'app-program-list',
  imports: [Button, ButtonLink, EmptyState, Icon, RouterLink, SectionNav, Skeleton, StatusPill],
  templateUrl: './program-list.html',
  styleUrl: './program-list.scss',
})
export class ProgramList {
  private readonly api = inject(ApiClient);
  private readonly tenants = inject(TenantStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private loadedTenantId: string | null = null;

  protected readonly sections = [
    { label: $localize`Programs`, link: '/training/programs' },
    { label: $localize`Exercises`, link: '/training/exercises' },
  ];
  protected readonly loadingLabel = $localize`Loading your programs…`;

  private readonly templates = signal<ProgramTemplateSummary[]>([]);
  private readonly total = signal(0);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly loadingMore = signal(false);
  protected readonly moreFailed = signal(false);

  protected readonly cards = computed(() =>
    this.templates().map((template) => programCard(template, this.locale)),
  );
  protected readonly hasMore = computed(() => this.templates().length < this.total());
  protected readonly summary = computed(() => {
    const count = this.total();
    const ready = this.templates().filter((template) =>
      template.versions.some((version) => version.isPublished),
    ).length;
    if (count === 0) return '';
    const programs = count === 1 ? $localize`1 program` : $localize`${count}:count: programs`;
    return this.hasMore()
      ? programs
      : $localize`${programs}:programs:, ${ready}:ready: ready to assign`;
  });

  constructor() {
    this.scope.onReset(() => {
      this.loadedTenantId = null;
      this.templates.set([]);
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
        const page = await owner.wait(firstValueFrom(this.api.listProgramTemplates(0, 100)));
        this.templates.set(page.items);
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
        const page = await owner.wait(
          firstValueFrom(this.api.listProgramTemplates(this.templates().length, 100)),
        );
        this.templates.update((items) => [...items, ...page.items]);
        this.total.set(numeric(page.total));
      } catch {
        if (owner.current) this.moreFailed.set(true);
      } finally {
        if (owner.current) this.loadingMore.set(false);
      }
    });
  }
}

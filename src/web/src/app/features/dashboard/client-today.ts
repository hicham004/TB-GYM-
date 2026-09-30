import { DatePipe, formatNumber } from '@angular/common';
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
import { ClientAccessStore } from '../../core/access/client-access.store';
import { ApiClient } from '../../core/api/api-client';
import type { ClientTrainingDayResult } from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { NotificationStore } from '../../core/notifications/notification.store';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { countDisplay } from '../../shell/coach-navigation';
import { initialsOf } from '../../shell/initials';
import { Avatar } from '../../ui/avatar';
import { Button, ButtonLink } from '../../ui/button';
import { Icon } from '../../ui/icon';
import { StatusLabel } from '../../ui/status-label';
import { trainingReadAccessLabel, type UpcomingTraining } from '../training/training-read.models';
import type { RenewalStatus } from './renewal.models';
import { TodayAlso } from './today-also';
import { TodayCoachMessage } from './today-coach-message';
import { TodayRenewal } from './today-renewal';
import { trainingCard, type TrainingWeek } from './today.models';

/**
 * The client's Today: the workspace date, the one training decision for the day,
 * the other things due today and the coach's latest message. Each part reads and retries on its
 * own, so one failure never hides another, and a reply from a workspace the client has just left
 * is dropped. The date is always the workspace's, never the browser's.
 */
@Component({
  selector: 'app-client-today',
  imports: [
    Avatar,
    Button,
    ButtonLink,
    DatePipe,
    Icon,
    RouterLink,
    StatusLabel,
    TodayAlso,
    TodayCoachMessage,
    TodayRenewal,
  ],
  templateUrl: './client-today.html',
  styleUrls: ['./client-today.scss', './today-card.scss'],
})
export class ClientToday {
  private readonly api = inject(ApiClient);
  private readonly locale = inject(LOCALE_ID);
  private readonly tenants = inject(TenantStore);
  private readonly auth = inject(AuthStore);
  private readonly notifications = inject(NotificationStore);
  private readonly access = inject(ClientAccessStore);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly trainingHeading = viewChild<ElementRef<HTMLElement>>('trainingHeading');
  private generation = 0;

  protected readonly day = signal<ClientTrainingDayResult | null>(null);
  protected readonly week = signal<TrainingWeek | null>(null);
  protected readonly coachName = signal<string | null>(null);
  protected readonly weekFailed = signal(false);
  protected readonly upcoming = signal<UpcomingTraining | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  /** Whether the whole plan has run out (ADR 0029); null until read, or if it could not be. */
  protected readonly renewal = signal<RenewalStatus | null>(null);
  private readonly renewalLoading = signal(true);
  protected readonly planEnded = computed(() => this.renewal()?.planEnded === true);
  /** The workspace's date from `GET /api/workspace`, read only when the training read fails. */
  private readonly workspaceDate = signal<string | null>(null);
  protected readonly accessLabel = trainingReadAccessLabel;

  /** Today in the workspace, or null (no date at all) when neither read could say. */
  protected readonly localDate = computed(
    () => this.day()?.localDate ?? this.upcoming()?.localDate ?? this.workspaceDate(),
  );

  protected readonly card = computed(() => {
    const day = this.day();
    const upcoming = this.upcoming();
    if (day === null || upcoming === null) return null;
    // Training outside the plan says nothing when something else is in it; with nothing in the
    // plan at all, Today says nothing is assigned yet.
    const somethingElse = (['Nutrition', 'CheckIns', 'Messaging'] as const).some((feature) => {
      const decision = this.access.decision(feature);
      return decision !== null && decision.reason !== 'NoEntitlement';
    });
    return trainingCard(day, upcoming, somethingElse);
  });

  /**
   * Training is still being worked out: its own read, or, for a plan that ran out, the renewal read
   * that decides between the ended-plan card and the plain "not available" one.
   */
  protected readonly trainingLoading = computed(() => {
    const card = this.card();
    return (
      this.loading() ||
      (this.renewalLoading() && card?.kind === 'access-closed' && card.reason === 'Expired')
    );
  });

  /** "Message your coach" is offered only while messaging is open. */
  protected readonly canMessage = computed(
    () => this.access.decision('Messaging')?.isAllowed ?? false,
  );

  protected readonly displayName = computed(() => this.auth.user()?.displayName ?? '');
  protected readonly firstName = computed(() => this.displayName().trim().split(/\s+/)[0] ?? '');
  protected readonly weekProgress = computed(() => {
    const days = this.week()?.days ?? [];
    return {
      scheduled: days.reduce((total, day) => total + day.scheduled, 0),
      completed: days.reduce((total, day) => total + day.completed, 0),
    };
  });
  protected readonly initials = computed(() =>
    initialsOf(this.displayName(), this.auth.user()?.email ?? ''),
  );
  protected readonly initialsOf = initialsOf;
  protected readonly unread = computed(() =>
    this.notifications.isAvailable() ? this.notifications.unread() : 0,
  );
  protected readonly unreadText = computed(() => formatNumber(this.unread(), this.locale, '1.0-0'));
  protected readonly unreadCount = computed(() =>
    countDisplay(this.unread(), (value) => formatNumber(value, this.locale, '1.0-0')),
  );

  constructor() {
    this.scope.onReset(() => this.resetTenantState());
    effect(() => {
      this.scope.epoch();
      const tenant = this.tenants.selectedTenantId();
      ++this.generation;
      this.day.set(null);
      this.week.set(null);
      this.coachName.set(null);
      this.weekFailed.set(false);
      this.upcoming.set(null);
      this.workspaceDate.set(null);
      this.renewal.set(null);
      if (tenant) {
        void this.load();
        void this.loadWeek();
        void this.loadCoach();
        void this.loadRenewal();
      }
    });
    // The page heading takes focus on arrival, so a screen reader starts at "Today".
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
  }

  protected async retry(): Promise<void> {
    await this.load();
    if (!this.error()) {
      // The Retry button has gone; focus moves to what replaced it rather than to the page.
      setTimeout(() => this.trainingHeading()?.nativeElement.focus());
    }
  }

  protected async load(): Promise<void> {
    return this.scope.run('load', async (owner) => {
      const generation = ++this.generation;
      this.loading.set(true);
      this.error.set(false);
      try {
        const [day, upcoming] = await owner.wait(
          Promise.all([
            firstValueFrom(this.api.getMyTrainingToday()),
            firstValueFrom(this.api.getMyUpcomingTraining()),
          ]),
        );
        if (generation !== this.generation) return;
        this.day.set(day);
        this.upcoming.set(upcoming);
      } catch {
        if (!owner.current) return;
        if (generation === this.generation) {
          this.error.set(true);
          void this.loadWorkspaceDate(generation);
        }
      } finally {
        if (owner.current && generation === this.generation) this.loading.set(false);
      }
    });
  }

  protected async loadWeek(): Promise<void> {
    return this.scope.run('week', async (owner) => {
      this.weekFailed.set(false);
      try {
        const week = await owner.wait(firstValueFrom(this.api.getMyTrainingWeek()));
        if (owner.current) this.week.set(week);
      } catch {
        if (owner.current) this.weekFailed.set(true);
      }
    });
  }

  private async loadCoach(): Promise<void> {
    return this.scope.run('coach', async (owner) => {
      try {
        const coach = await owner.wait(firstValueFrom(this.api.getOwnCoach()));
        if (owner.current) this.coachName.set(coach.name);
      } catch {
        if (owner.current) this.coachName.set(null);
      }
    });
  }

  /** A failure leaves `renewal` null, and Today shows the plain closed-access card instead. */
  private async loadRenewal(): Promise<void> {
    return this.scope.run('renewal', async (owner) => {
      this.renewalLoading.set(true);
      try {
        this.renewal.set(await owner.wait(firstValueFrom(this.api.getOwnRenewalStatus())));
      } catch {
        if (owner.current) this.renewal.set(null);
      } finally {
        if (owner.current) this.renewalLoading.set(false);
      }
    });
  }

  /** The heading's date when training could not be read. On failure there is simply no date. */
  private async loadWorkspaceDate(generation: number): Promise<void> {
    return this.scope.run('date', async (owner) => {
      try {
        const workspace = await owner.wait(firstValueFrom(this.api.getWorkspace()));
        if (generation === this.generation) this.workspaceDate.set(workspace.currentDate);
      } catch {
        // No browser-clock fallback: a wrong date is worse than none.
      }
    });
  }

  private resetTenantState(): void {
    ++this.generation;
    this.day.set(null);
    this.week.set(null);
    this.coachName.set(null);
    this.weekFailed.set(false);
    this.upcoming.set(null);
    this.workspaceDate.set(null);
    this.renewal.set(null);
    this.renewalLoading.set(false);
    this.loading.set(false);
    this.error.set(false);
  }
}

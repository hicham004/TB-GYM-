import { DatePipe, DOCUMENT, formatNumber } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  EnvironmentInjector,
  inject,
  Injector,
  LOCALE_ID,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ClientAccessStore } from '../../core/access/client-access.store';
import { ApiClient } from '../../core/api/api-client';
import type { ClientTrainingDayResult } from '../../core/api/generated';
import { AuthStore } from '../../core/auth/auth.store';
import { Motion } from '../../core/motion/motion';
import { NotificationStore } from '../../core/notifications/notification.store';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { WorkspaceBrandStore } from '../../core/theme/workspace-brand.store';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { countDisplay } from '../../shell/coach-navigation';
import { initialsOf } from '../../shell/initials';
import { Avatar } from '../../ui/avatar';
import { Button, ButtonLink } from '../../ui/button';
import { drawnTogether } from '../../ui/drawn-together';
import { Icon } from '../../ui/icon';
import { StatusLabel } from '../../ui/status-label';
import { InstallCard } from '../install/install-card';
import { OwnWorkoutApi } from '../training/own-workout-api';
import { ownRefusal, startRefusalWords } from '../training/own-workout.models';
import {
  mapUpcomingTraining,
  trainingReadAccessLabel,
  type UpcomingTraining,
} from '../training/training-read.models';
import { OPEN_MOMENT, PLAYER_PRELOAD, revealInto, revealTarget, whenIdle } from './open-moment';
import { mapRenewalStatus, type RenewalStatus } from './renewal.models';
import { TodayAlso } from './today-also';
import { TodayCoachMessage } from './today-coach-message';
import { riseTodaySteps, type TodayStep } from './today-moment';
import { TodayRenewal } from './today-renewal';
import { mapTrainingWeek, trainingCard, weekDayDone, type TrainingWeek } from './today.models';

/**
 * The client's Today: the workspace date, the one training decision for the day,
 * the other things due today and the coach's latest message. Each part reads and retries on its
 * own, so one failure never hides another, and a reply from a workspace the client has just left
 * is dropped. The date is always the workspace's, never the browser's. The week and the day's card
 * are drawn together once both have answered, and the cards below them once they have too, so no
 * part pushes another down as it lands (audit UIQ-5); a part still out after a moment no longer
 * holds the rest.
 */
@Component({
  selector: 'app-client-today',
  imports: [
    Avatar,
    Button,
    ButtonLink,
    DatePipe,
    Icon,
    InstallCard,
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
  private readonly ownApi = inject(OwnWorkoutApi);
  private readonly csrf = inject(CsrfService);
  private readonly locale = inject(LOCALE_ID);
  private readonly tenants = inject(TenantStore);
  private readonly auth = inject(AuthStore);
  private readonly notifications = inject(NotificationStore);
  private readonly access = inject(ClientAccessStore);
  protected readonly brand = inject(WorkspaceBrandStore);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly motion = inject(Motion);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  /** Outlives this page: the player's first render is awaited after Today is gone (W7). */
  private readonly environment = inject(EnvironmentInjector);
  private readonly injector = inject(Injector);
  private readonly preload = inject(PLAYER_PRELOAD);
  /** The steps of the first draw that have risen in this visit (W9). */
  private readonly risen = new Set<TodayStep>();
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private cancelPreload: (() => void) | null = null;
  private preloadAsked = false;
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly trainingHeading = viewChild<ElementRef<HTMLElement>>('trainingHeading');
  private readonly also = viewChild(TodayAlso);
  private readonly coachMessage = viewChild(TodayCoachMessage);
  private generation = 0;

  protected readonly day = signal<ClientTrainingDayResult | null>(null);
  protected readonly week = signal<TrainingWeek | null>(null);
  protected readonly coachName = signal<string | null>(null);
  /**
   * A trainee of TB Gym's own space, who coaches themselves (CLI-026): the space stands where a coach
   * would, and no coach's name is asked for (notes plan N9a2). Not one whom Max coaches: their coach is
   * read and named as a coach's client's is (N9c5b).
   */
  protected readonly selfDirected = signal(false);
  /**
   * Any trainee of TB Gym's own space, Max included: the house's own screens stay theirs, so Start a
   * workout, Carry on and the week's own workouts follow this, not who coaches them (N9c5b).
   */
  protected readonly houseTrainee = signal(false);
  /** A trainee of the house whom Max coaches today: the card under Start a workout names their coach. */
  protected readonly coachedByTheHouse = computed(
    () => this.houseTrainee() && !this.selfDirected(),
  );
  /** The client's own profile could not be read: nobody's coach is named, since it may be a trainee. */
  protected readonly selfUnknown = signal(false);
  /** The coach's name is on its way: their place in the header is kept, so the heading does not rewrap. */
  protected readonly coachLoading = signal(true);
  /**
   * A coached client with no coach for now (N9d1b): their profile read, and the coach's read answered
   * 404, the only sign the server gives. Today says they wait, and offers no coach to write to.
   */
  protected readonly waitingForCoach = signal(false);
  /** The day's training has answered once in this workspace; a Retry later keeps the page drawn. */
  private readonly trainingAnswered = signal(false);
  protected readonly weekFailed = signal(false);
  protected readonly upcoming = signal<UpcomingTraining | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  /** Whether the whole plan has run out or is about to (ADR 0029); null until read, or if it could not be. */
  protected readonly renewal = signal<RenewalStatus | null>(null);
  private readonly renewalLoading = signal(true);
  protected readonly planEnded = computed(() => this.renewal()?.planEnded === true);
  /** The plan runs on, so training stays and the card sits under it (critique B14). */
  protected readonly planEnding = computed(() => this.renewal()?.endsOn != null);
  /** The workspace's date from `GET /api/workspace`, read only when the training read fails. */
  private readonly workspaceDate = signal<string | null>(null);
  private readonly workspaceZone = signal<string | null>(null);
  protected readonly accessLabel = trainingReadAccessLabel;
  protected readonly dayDone = weekDayDone;
  /** A workout of one's own on its way to starting, and why the last start was refused (notes plan N9b3). */
  protected readonly startingOwn = signal(false);
  protected readonly startProblem = signal<string | null>(null);

  /** Today in the workspace, or null (no date at all) when neither read could say. */
  protected readonly localDate = computed(
    () => this.day()?.localDate ?? this.upcoming()?.localDate ?? this.workspaceDate(),
  );
  /** The workspace's time zone, the calendar a message's day is read on (audit WEA-10). */
  protected readonly timeZone = computed(() => this.upcoming()?.timeZoneId ?? this.workspaceZone());

  protected readonly card = computed(() => {
    const day = this.day();
    const upcoming = this.upcoming();
    if (day === null || upcoming === null) return null;
    // Training outside the plan says nothing when something else is in it; with nothing in the
    // plan at all, Today says nothing is assigned yet.
    const somethingElse = (['Nutrition', 'CheckIns', 'Messaging', 'Sessions'] as const).some(
      (feature) => {
        const decision = this.access.decision(feature);
        return decision !== null && decision.reason !== 'NoEntitlement';
      },
    );
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
      (this.renewalLoading() && card?.kind === 'access-closed' && card.reason === 'Expired') ||
      // Nothing assigned reads differently for a self-directed trainee: it waits for that answer.
      (this.coachLoading() &&
        (card?.kind === 'nothing-assigned' || card?.kind === 'own-in-progress'))
    );
  });

  /**
   * "Message your coach" is offered only while messaging is open and there is a coach to write to: a
   * client waiting for one would land on a thread nobody reads (N9d1b). Asked once the coach answered,
   * so the link never shows and then goes.
   */
  protected readonly canMessage = computed(
    () =>
      (this.access.decision('Messaging')?.isAllowed ?? false) &&
      !this.coachLoading() &&
      !this.waitingForCoach(),
  );

  /**
   * A trainee of TB Gym's own space with nothing to carry on and Training open: the card offers to start
   * a workout of their own (TRN-033), on Max too; the server decides whether it may.
   */
  protected readonly startCard = computed(
    () =>
      this.houseTrainee() &&
      this.card()?.kind === 'nothing-assigned' &&
      this.day()?.isAllowed === true &&
      this.upcoming()?.isAllowed === true,
  );

  /** The week and the day's card, drawn in one frame once both have answered. */
  protected readonly coreDrawn = drawnTogether(
    () => this.trainingAnswered(),
    () =>
      this.trainingAnswered() &&
      !this.trainingLoading() &&
      (this.week() !== null || this.weekFailed()),
  );
  /** Also today and the coach's message, drawn below once they and everything above have answered. */
  protected readonly belowDrawn = drawnTogether(
    () => this.coreDrawn(),
    () =>
      this.coreDrawn() &&
      !this.renewalLoading() &&
      (this.also()?.settled() ?? false) &&
      (this.coachMessage()?.settled() ?? false),
  );
  /** The seven days of the week's shape while it is read. */
  protected readonly weekBones = [1, 2, 3, 4, 5, 6, 7];

  protected readonly displayName = computed(() => this.auth.user()?.displayName ?? '');
  protected readonly firstName = computed(() => this.displayName().trim().split(/\s+/)[0] ?? '');
  protected readonly weekProgress = computed(() => {
    const days = this.week()?.days ?? [];
    return {
      scheduled: days.reduce((total, day) => total + day.scheduled, 0),
      completed: days.reduce((total, day) => total + day.completed, 0),
      own: days.reduce((total, day) => total + day.ownCompleted, 0),
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
      this.selfDirected.set(false);
      this.houseTrainee.set(false);
      this.selfUnknown.set(false);
      this.coachLoading.set(true);
      this.waitingForCoach.set(false);
      this.trainingAnswered.set(false);
      this.weekFailed.set(false);
      this.upcoming.set(null);
      this.workspaceDate.set(null);
      this.workspaceZone.set(null);
      this.renewal.set(null);
      this.startingOwn.set(false);
      this.startProblem.set(null);
      this.risen.clear();
      if (tenant) {
        void this.load();
        void this.loadWeek();
        void this.loadCoach();
        void this.loadRenewal();
      }
    });
    // The page heading takes focus on arrival, so a screen reader starts at "Today".
    afterNextRender(() => this.heading()?.nativeElement.focus({ preventScroll: true }));
    // The card opens into the player (W7): the click is taken in the capture phase, before the
    // link's own listener, and a press on the card preloads the player's chunks.
    afterNextRender(() => {
      const element = this.host.nativeElement;
      element.addEventListener('click', this.openPlayer, true);
      element.addEventListener('pointerdown', this.pressCard, { capture: true, passive: true });
      this.destroyRef.onDestroy(() => {
        element.removeEventListener('click', this.openPlayer, true);
        element.removeEventListener('pointerdown', this.pressCard, true);
        this.cancelPreload?.();
      });
    });
    effect(() => {
      if (this.belowDrawn() && !this.preloadAsked) this.preloadSoon();
    });
    // The first draw (W9): the greeting rises at once, the week and the card once they are drawn,
    // the tiles once they are, each step once per visit and never on a re-read.
    afterNextRender(() => riseTodaySteps(this.host.nativeElement, ['greeting'], this.motion));
    effect(() => {
      const steps: TodayStep[] = [];
      if (this.coreDrawn() && !this.risen.has('core')) steps.push('core');
      if (this.belowDrawn() && !this.risen.has('below')) steps.push('below');
      if (steps.length === 0) return;
      for (const step of steps) this.risen.add(step);
      afterNextRender(() => riseTodaySteps(this.host.nativeElement, steps, this.motion), {
        injector: this.injector,
      });
    });
  }

  /** A plain left click on the card's link to the player grows the card into it (W7). */
  private readonly openPlayer = (event: MouseEvent): void => {
    const link = revealTarget(event, this.document, this.motion);
    const card = link?.closest('.today-card');
    const url = link?.getAttribute('href');
    if (!link || !card || !url) return;
    event.preventDefault();
    event.stopPropagation();
    revealInto(card, () => this.router.navigateByUrl(url), this.document, this.environment);
  };

  private readonly pressCard = (event: Event): void => {
    if (event.target instanceof Element && event.target.closest('.today-card')) {
      this.cancelPreload?.();
      this.cancelPreload = null;
      this.preloadAsked = true;
      void this.preload();
    }
  };

  /** Once Today's own reads have settled, the player's chunks load when the browser is idle. */
  private preloadSoon(): void {
    this.preloadAsked = true;
    const view = this.document.defaultView;
    if (!view) return;
    this.cancelPreload = whenIdle(view, () => {
      this.cancelPreload = null;
      void this.preload();
    });
  }

  /**
   * Starts a workout of one's own and opens the player on it, the card growing into it as a link's
   * press does (W7). A refusal is said on the card; one already started elsewhere turns it into Carry on.
   */
  protected async startOwn(): Promise<void> {
    // Asked before the lane is taken, since a second press would otherwise cancel the first start; the
    // action's first line runs at once, in the same call, so no press slips in between.
    if (this.startingOwn()) return;
    return this.scope.run('start-own', async (owner) => {
      this.startingOwn.set(true);
      this.startProblem.set(null);
      try {
        await owner.wait(this.csrf.refresh());
        const view = await owner.wait(firstValueFrom(this.ownApi.start()));
        const url = this.router.serializeUrl(
          this.router.createUrlTree(['/training/today'], {
            queryParams: { sessionId: view.workoutExecutionId },
          }),
        );
        const card = this.host.nativeElement.querySelector('.today-card');
        if (
          card &&
          typeof this.document.startViewTransition === 'function' &&
          this.motion.allowed(OPEN_MOMENT)
        ) {
          revealInto(card, () => this.router.navigateByUrl(url), this.document, this.environment);
        } else {
          await this.router.navigateByUrl(url);
        }
      } catch (error) {
        if (!owner.current) return;
        this.startProblem.set(startRefusalWords(error));
        if (ownRefusal(error) === 'in-progress') {
          // One started on another phone or tab: the card becomes its Carry on, still saying why, and
          // focus moves to it, since the Start button is gone.
          await owner.wait(this.load());
          if (!this.error()) setTimeout(() => this.trainingHeading()?.nativeElement.focus());
        }
      } finally {
        if (owner.current) this.startingOwn.set(false);
      }
    });
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
        this.upcoming.set(mapUpcomingTraining(upcoming));
      } catch {
        if (!owner.current) return;
        if (generation === this.generation) {
          this.error.set(true);
          void this.loadWorkspaceDate(generation);
        }
      } finally {
        if (owner.current && generation === this.generation) {
          this.loading.set(false);
          this.trainingAnswered.set(true);
        }
      }
    });
  }

  protected async loadWeek(): Promise<void> {
    return this.scope.run('week', async (owner) => {
      this.weekFailed.set(false);
      try {
        const week = await owner.wait(firstValueFrom(this.api.getMyTrainingWeek()));
        if (owner.current) this.week.set(mapTrainingWeek(week));
      } catch {
        if (owner.current) this.weekFailed.set(true);
      }
    });
  }

  /**
   * The client's own profile first: a self-directed trainee's chip names TB Gym's space, and the coach's
   * read, which names a member of its staff, is never asked (notes plan N9a2). A trainee Max coaches
   * reads their coach as a coach's client does, and stays the house's trainee (N9c5b).
   */
  private async loadCoach(): Promise<void> {
    return this.scope.run('coach', async (owner) => {
      try {
        const self = await owner
          .wait(firstValueFrom(this.api.getSelfProfile()))
          .catch((error: unknown) => {
            if (owner.current) this.selfUnknown.set(true);
            throw error;
          });
        if (owner.current) this.houseTrainee.set(self.selfDirected === true);
        if (self.selfDirected === true && self.coachedByTheHouse !== true) {
          if (owner.current) this.selfDirected.set(true);
          return;
        }
        const coach = await owner
          .wait(firstValueFrom(this.api.getOwnCoach()))
          .catch((error: unknown) => {
            // No coach for now (N9d1b); a 403 or any other failure still just names nobody.
            if (owner.current && error instanceof HttpErrorResponse && error.status === 404) {
              this.waitingForCoach.set(true);
            }
            throw error;
          });
        if (owner.current) this.coachName.set(coach.name);
      } catch {
        if (owner.current) this.coachName.set(null);
      } finally {
        if (owner.current) this.coachLoading.set(false);
      }
    });
  }

  /** A failure leaves `renewal` null, and Today shows the plain closed-access card instead. */
  private async loadRenewal(): Promise<void> {
    return this.scope.run('renewal', async (owner) => {
      this.renewalLoading.set(true);
      try {
        this.renewal.set(
          mapRenewalStatus(await owner.wait(firstValueFrom(this.api.getOwnRenewalStatus()))),
        );
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
        if (generation === this.generation) {
          this.workspaceDate.set(workspace.currentDate);
          this.workspaceZone.set(workspace.timeZoneId);
        }
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
    this.selfDirected.set(false);
    this.houseTrainee.set(false);
    this.selfUnknown.set(false);
    this.coachLoading.set(true);
    this.waitingForCoach.set(false);
    this.trainingAnswered.set(false);
    this.weekFailed.set(false);
    this.upcoming.set(null);
    this.workspaceDate.set(null);
    this.workspaceZone.set(null);
    this.renewal.set(null);
    this.renewalLoading.set(false);
    this.loading.set(false);
    this.error.set(false);
    this.startingOwn.set(false);
    this.startProblem.set(null);
  }
}

import { formatDate, NgTemplateOutlet } from '@angular/common';
import {
  Component,
  computed,
  effect,
  inject,
  LOCALE_ID,
  signal,
  type WritableSignal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { featureAccessReason } from '../../core/api/api-error';
import type {
  CheckInAssignmentListItem,
  ClientPersonalRecordsResult,
  ClientProfileOverviewView,
  FeatureAccessReason,
  MesocycleSummary,
} from '../../core/api/generated';
import { clientCheckInDenialMessage } from '../../core/i18n/display-labels';
import { dayInZone } from '../../core/i18n/house-dates';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink } from '../../ui/button';
import { drawnTogether } from '../../ui/drawn-together';
import { Control, Field } from '../../ui/field';
import { Icon } from '../../ui/icon';
import { Skeleton } from '../../ui/skeleton';
import { Sparkline } from '../../ui/sparkline';
import { StatusPill } from '../../ui/status-pill';
import {
  mapProgressDashboard,
  type ProgressDashboard,
} from '../progress/progress-dashboard.models';
import { addDays, daysBetween, weekContaining } from './client-overview.models';
import {
  checkInCard,
  needRows,
  nutritionWeek,
  planStateReason,
  programLine,
  recordRows,
  trainingClosed,
  weekStory,
  weightStory,
  type ProfileContext,
} from './client-profile.models';
import { ClientWorkspaceContext } from './client-workspace.context';
import { activityLabel } from './clients.models';

/**
 * One independently loaded part of the page: a failure in one never blanks the others. A feature
 * the plan does not include is `denied` with the server's reason, which is not the same fact as
 * "nothing recorded" or "could not be loaded".
 */
interface Part<T> {
  state: 'loading' | 'ready' | 'error' | 'denied';
  value: T | null;
  reason: FeatureAccessReason | null;
}

function loading<T>(): Part<T> {
  return { state: 'loading', value: null, reason: null };
}

/** Weeks of weekly weigh-in averages behind the weight line, ending with this one. */
const WEIGHT_WEEKS = 8;

/** The newest records shown here; the Progress tab keeps the whole list. */
const RECORDS_SHOWN = 4;

/**
 * A client's Overview (C3), a story in the order a coach asks: what needs me, how is this week,
 * which way is the weight going, what are they lifting, what did they last send, and what did I
 * note. What needs the coach and the week come from one server read (CLI-018), so this page never
 * disagrees with Today or Clients; the rest are the reads the screens that own them already use.
 * Nothing interprets a check-in answer (CHK-012).
 */
@Component({
  selector: 'app-client-overview',
  imports: [
    Button,
    ButtonLink,
    Control,
    Field,
    Icon,
    NgTemplateOutlet,
    ReactiveFormsModule,
    RouterLink,
    Skeleton,
    Sparkline,
    StatusPill,
  ],
  templateUrl: './client-overview.html',
  styleUrls: ['./client-overview.scss', './client-overview-cards.scss'],
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
})
export class ClientOverview {
  private readonly api = inject(ApiClient);
  private readonly tenants = inject(TenantStore);
  private readonly formBuilder = inject(FormBuilder);
  private readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private loadedKey: string | null = null;
  /** The device clock, read when the page loads, for elapsed time ("2 hours ago") only. */
  private readonly now = signal(new Date());

  protected readonly context = inject(ClientWorkspaceContext);
  protected readonly profile = this.context.profile;
  protected readonly overview = signal<Part<ClientProfileOverviewView>>(loading());
  protected readonly dashboard = signal<Part<ProgressDashboard>>(loading());
  protected readonly records = signal<Part<ClientPersonalRecordsResult>>(loading());
  protected readonly checkIns = signal<Part<CheckInAssignmentListItem[]>>(loading());
  protected readonly blocks = signal<Part<MesocycleSummary[]>>(loading());
  protected readonly editingNote = signal(false);
  protected readonly noteForm = this.formBuilder.nonNullable.group({
    notes: ['', Validators.maxLength(8000)],
  });
  protected readonly loadingLabel = $localize`Loading…`;

  /** Every part's read, for drawing them together. */
  private readonly parts = [
    this.overview,
    this.dashboard,
    this.records,
    this.checkIns,
    this.blocks,
  ];
  /**
   * The parts are drawn in one frame once all have answered, so none pushes the others down as it
   * lands (audit UIQ-5); one still out after a moment shows its own skeleton instead of holding them.
   */
  protected readonly drawn = drawnTogether(
    () => this.parts.some((part) => part().state !== 'loading'),
    () => this.parts.every((part) => part().state !== 'loading'),
  );

  protected readonly firstName = computed(() => this.profile()?.firstName ?? '');
  /** The day a former client's coaching ended, on the workspace's calendar (audit WEB-17). */
  protected readonly releasedOn = computed(() => {
    const release = this.profile()?.release;
    if (!release) return '';
    const timeZone = this.context.workspace()?.timeZoneId ?? null;
    return formatDate(dayInZone(release.releasedAtUtc, timeZone), 'EEE d MMM y', this.locale);
  });
  private readonly today = computed(() => this.context.workspace()?.currentDate ?? null);

  private readonly profileContext = computed<ProfileContext>(() => ({
    locale: this.locale,
    now: this.now(),
    clientId: this.context.clientId(),
    firstName: this.firstName(),
  }));

  /** Blocked by the coach (ADR 0009): training, progress and check-ins are closed, so none is read. */
  protected readonly blocked = computed(() => this.context.plans()?.isRelationshipBlocked === true);

  protected readonly needs = computed(() => {
    const view = this.overview().value;
    return view ? needRows(view.attention, view.today, this.profileContext()) : [];
  });

  /** The workspace week as seven marks; null when training is not in the plan. */
  protected readonly week = computed(() => {
    const view = this.overview().value;
    return view?.week ? weekStory(view.week, view.today, this.locale) : null;
  });

  protected readonly lastActivity = computed(() => {
    const view = this.overview().value;
    return view
      ? activityLabel(view, {
          locale: this.locale,
          now: this.now(),
          userId: null,
        })
      : '';
  });

  /** The block the client is in, named only while their training is open to read. */
  protected readonly program = computed(() => {
    const today = this.today();
    const blocks = this.blocks().value;
    return today && blocks && this.week() ? programLine(blocks, today) : null;
  });

  /** Why the week is missing, said from where the plan stands: ended is not "not in the plan". */
  protected readonly weekClosed = computed(() => {
    const view = this.overview().value;
    return view ? trainingClosed(planStateReason(view.planState), this.firstName()) : '';
  });

  protected readonly recordsClosed = computed(() => {
    const result = this.records().value;
    return result && !result.isAllowed
      ? trainingClosed(result.accessReason as FeatureAccessReason, this.firstName())
      : '';
  });

  protected readonly nutrition = computed(() => {
    const dashboard = this.dashboard().value;
    const workspace = this.context.workspace();
    if (!dashboard || !workspace) return null;
    const week = weekContaining(workspace.currentDate, workspace.weekStartsOn);
    return nutritionWeek(dashboard.nutrition, daysBetween(week.start, workspace.currentDate) + 1);
  });

  protected readonly weight = computed(() => {
    const dashboard = this.dashboard().value;
    return dashboard ? weightStory(dashboard, this.locale, WEIGHT_WEEKS) : null;
  });

  protected readonly recordList = computed(() => {
    const result = this.records().value;
    const today = this.today();
    return result?.isAllowed && today
      ? recordRows(result.items.slice(0, RECORDS_SHOWN), today, this.locale)
      : [];
  });

  protected readonly checkIn = computed(() => {
    const today = this.today();
    const items = this.checkIns().value;
    return today && items ? checkInCard(items, today, this.profileContext()) : null;
  });

  /** Why check-ins are closed for this client: in a word when the plan lacks them, else in full. */
  protected readonly checkInDenied = computed(() => {
    const reason = this.checkIns().reason;
    if (this.checkIns().state !== 'denied' || reason === null) return null;
    return reason === 'NoEntitlement'
      ? $localize`Check-ins aren’t part of ${this.firstName()}:name:’s plan.`
      : clientCheckInDenialMessage(reason);
  });

  constructor() {
    this.scope.onReset(() => this.reset());
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      const clientId = this.context.clientId();
      const workspace = this.context.workspace();
      const former = this.context.isFormer();
      const key =
        tenantId && clientId && workspace && !former
          ? `${tenantId}:${clientId}:${workspace.currentDate}`
          : null;
      if (key && key !== this.loadedKey) {
        this.loadedKey = key;
        void this.context.refreshPlans();
        this.loadAll();
      }
    });
  }

  /** Every part loads on its own, so a slow or refused one leaves the rest on screen. */
  private loadAll(): void {
    this.now.set(new Date());
    if (this.blocked()) {
      // A blocked relationship closes these reads (ADR 0009); the page says so instead of failing.
      return;
    }

    void this.loadOverview();
    void this.loadDashboard();
    void this.loadRecords();
    void this.loadCheckIns();
    void this.loadBlocks();
  }

  protected loadOverview(): Promise<void> {
    return this.loadPart('overview', this.overview, () =>
      firstValueFrom(this.api.getClientOverview(this.context.clientId())),
    );
  }

  protected loadDashboard(): Promise<void> {
    return this.loadPart('dashboard', this.dashboard, () => {
      const workspace = this.context.workspace();
      if (!workspace) return Promise.reject(new Error('The workspace calendar is not loaded.'));
      const week = weekContaining(workspace.currentDate, workspace.weekStartsOn);
      // One window serves both: its last seven days are exactly this week, and the weeks before it
      // carry the weight line.
      return firstValueFrom(
        this.api
          .getClientProgressDashboard(
            this.context.clientId(),
            addDays(week.start, -7 * (WEIGHT_WEEKS - 1)),
            week.endExclusive,
          )
          .pipe(map(mapProgressDashboard)),
      );
    });
  }

  protected loadRecords(): Promise<void> {
    return this.loadPart('records', this.records, () =>
      firstValueFrom(this.api.getClientTrainingPersonalRecords(this.context.clientId())),
    );
  }

  protected loadCheckIns(): Promise<void> {
    // The plan already says whether check-ins are included, so a client without them is not asked
    // (the API would refuse with their reason, and the browser would log a failed request).
    const decision = this.context
      .plans()
      ?.featureAccess.find((item) => item.feature === 'CheckIns');
    if (decision && !decision.isAllowed) {
      this.checkIns.set({ state: 'denied', value: null, reason: decision.reason });
      return Promise.resolve();
    }

    return this.loadPart(
      'checkins',
      this.checkIns,
      async () =>
        (
          await firstValueFrom(
            this.api.listClientCheckInAssignments(this.context.clientId(), 0, 50),
          )
        ).items,
    );
  }

  protected loadBlocks(): Promise<void> {
    return this.loadPart('blocks', this.blocks, () =>
      firstValueFrom(this.api.listClientMesocycles(this.context.clientId())),
    );
  }

  private loadPart<T>(
    name: string,
    part: WritableSignal<Part<T>>,
    read: () => Promise<T>,
  ): Promise<void> {
    return this.scope.run(name, async (owner) => {
      part.set(loading());
      try {
        const value = await owner.wait(read());
        part.set({ state: 'ready', value, reason: null });
      } catch (error) {
        if (!owner.current) return;
        const reason = featureAccessReason(error);
        part.set(
          reason
            ? { state: 'denied', value: null, reason }
            : { state: 'error', value: null, reason: null },
        );
      }
    });
  }

  protected noteErrors(): string[] | null {
    const control = this.noteForm.controls.notes;
    return control.touched && control.hasError('maxlength')
      ? [$localize`Keep the note to 8,000 characters or fewer.`]
      : null;
  }

  protected startNoteEdit(): void {
    this.noteForm.reset({ notes: this.profile()?.coachNotes ?? '' });
    this.editingNote.set(true);
  }

  protected cancelNoteEdit(): void {
    this.editingNote.set(false);
  }

  protected async saveNote(): Promise<void> {
    const profile = this.profile();
    if (!profile || this.noteForm.invalid) {
      this.noteForm.markAllAsTouched();
      return;
    }
    const notes = this.noteForm.getRawValue().notes.trim();
    const saved = await this.context.save(
      () => this.api.updateCoachNotes(profile.id, notes || null, profile.version),
      $localize`Coach note saved.`,
    );
    if (saved) this.editingNote.set(false);
  }

  /** A refresh or a closed tab would lose an unsaved note; the browser asks first. */
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.editingNote() && this.noteForm.dirty) event.preventDefault();
  }

  private reset(): void {
    this.loadedKey = null;
    this.overview.set(loading());
    this.dashboard.set(loading());
    this.records.set(loading());
    this.checkIns.set(loading());
    this.blocks.set(loading());
    this.editingNote.set(false);
  }
}

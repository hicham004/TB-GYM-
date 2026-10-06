import { formatDate } from '@angular/common';
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
  TemplateRef,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import type {
  CoachClientProgramView,
  FeatureAccessReason,
  TrainingMesocycleView,
} from '../../core/api/generated';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Control } from '../../ui/field';
import { EmptyState } from '../../ui/empty-state';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import { UiDialog } from '../../ui/dialog';
import { UiSheet } from '../../ui/sheet';
import { ClientActions } from './client-actions';
import { planChoices, programWriteError } from './client-program-forms.models';
import { ClientProgramApi } from './client-program-api';
import {
  blockCard,
  focusBlockId,
  otherBlocks,
  programMenu,
  type BlockCard,
  type ProgramContext,
  type SessionCard,
  type WeekColumn,
} from './client-program.models';
import { trainingClosed } from './client-profile.models';
import { ClientTrainingTools } from './client-training-tools';
import { ClientWorkspaceContext } from './client-workspace.context';
import { ProgramAssign } from './program-assign';
import {
  ProgramCancel,
  ProgramComplete,
  ProgramRename,
  ProgramReschedule,
} from './program-block-dialogs';
import { ProgramMaxes } from './program-maxes';
import { ProgramMaxesUpdate } from './program-maxes-update';
import { ProgramNextBlock } from './program-next-block';
import { ProgramSession } from './program-session';

/**
 * A client's Training (C3): the program as a timeline, weeks side by side with their sessions, the
 * current week in front. The server decides which program is running, what state each session is in
 * (TRN-020, TRN-022) and whether the plan lets the coach see any of it; this draws that and offers
 * what a coach can do about the program, behind one Actions menu (plan §2 rule 5).
 */
@Component({
  selector: 'app-client-program',
  imports: [
    Button,
    ButtonLink,
    Checkbox,
    ClientActions,
    ClientTrainingTools,
    Control,
    EmptyState,
    ProgramAssign,
    ProgramCancel,
    ProgramComplete,
    ProgramMaxes,
    ProgramMaxesUpdate,
    ProgramNextBlock,
    ProgramRename,
    ProgramReschedule,
    ProgramSession,
    RouterLink,
    Skeleton,
    StatusPill,
  ],
  templateUrl: './client-program.html',
  styleUrls: ['./client-program.scss'],
})
export class ClientProgram {
  private readonly api = inject(ApiClient);
  private readonly programApi = inject(ClientProgramApi);
  private readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly sheets = inject(UiSheet);
  private readonly dialogs = inject(UiDialog);
  private readonly injector = inject(Injector);
  private readonly locale = inject(LOCALE_ID);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private loadedKey: string | null = null;
  private focusedKey: string | null = null;

  protected readonly context = inject(ClientWorkspaceContext);
  protected readonly read = signal<CoachClientProgramView | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  /** The program the coach picked from the list; otherwise the one the page opens on. */
  private readonly picked = signal<string | null>(null);
  /** The week a phone shows; null until one is chosen, then the program's own opening week. */
  private readonly pickedWeek = signal<number | null>(null);
  protected readonly sharing = signal(false);
  protected readonly toolsOpened = signal(false);
  protected readonly active = signal<{ week: WeekColumn; session: SessionCard } | null>(null);

  protected readonly assignSheet = viewChild.required<TemplateRef<unknown>>('assignSheet');
  protected readonly nextSheet = viewChild.required<TemplateRef<unknown>>('nextSheet');
  protected readonly maxesSheet = viewChild.required<TemplateRef<unknown>>('maxesSheet');
  protected readonly renameDialog = viewChild.required<TemplateRef<unknown>>('renameDialog');
  protected readonly sessionSheet = viewChild.required<TemplateRef<unknown>>('sessionSheet');
  protected readonly rescheduleDialog =
    viewChild.required<TemplateRef<unknown>>('rescheduleDialog');
  protected readonly completeDialog = viewChild.required<TemplateRef<unknown>>('completeDialog');
  protected readonly cancelDialog = viewChild.required<TemplateRef<unknown>>('cancelDialog');
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected readonly loadingLabel = $localize`Loading the program…`;
  // Not "Actions": the client's header above already has an Actions menu of its own.
  protected readonly actionsLabel = $localize`Manage program`;
  protected readonly closeLabel = $localize`Close`;
  protected readonly emptyHeading = $localize`No program yet`;

  private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });

  protected readonly firstName = computed(() => this.context.profile()?.firstName ?? '');
  /** The label of every week's share box; each box also names its week for assistive technology. */
  protected readonly shareText = computed(() => $localize`Shared with ${this.firstName()}:name:`);
  protected readonly emptyDescription = computed(() => {
    const name = this.firstName();
    const starts = this.bookedStart();
    return starts
      ? $localize`${name}:name:’s plan starts ${starts}:date:. Assign a program now and ${name}:name: sees it from that day.`
      : $localize`Assign a program and ${name}:name: sees it as soon as its first week opens.`;
  });
  protected readonly today = computed(
    () => this.read()?.localDate ?? this.context.workspace()?.currentDate ?? '',
  );
  private readonly programContext = computed<ProgramContext>(() => ({
    locale: this.locale,
    today: this.today(),
    firstName: this.firstName(),
  }));

  private readonly blocks = computed(() => this.read()?.blocks ?? []);
  private readonly openId = computed(() => {
    const picked = this.picked();
    return picked && this.blocks().some((block) => block.id === picked)
      ? picked
      : focusBlockId(this.blocks());
  });

  /** The program in front of the coach, as its header and timeline. */
  protected readonly card = computed<BlockCard | null>(() => {
    const block = this.blocks().find((item) => item.id === this.openId());
    return block ? blockCard(block, this.programContext()) : null;
  });
  protected readonly others = computed(() =>
    otherBlocks(this.blocks(), this.openId(), this.programContext()),
  );
  protected readonly hasOthers = computed(
    () => this.others().coming.length + this.others().earlier.length > 0,
  );

  /** The week a phone shows; every week shows on a wide screen. */
  protected readonly shownWeek = computed(() => this.pickedWeek() ?? this.card()?.openWeek ?? 1);

  /** A program can be assigned under a plan that includes training and is neither cancelled nor over. */
  protected readonly canAssign = computed(() => {
    const plans = this.context.plans();
    return plans ? planChoices(plans.enrollments, this.locale).length > 0 : true;
  });

  protected readonly menu = computed(() =>
    programMenu(this.card(), this.canAssign(), this.programContext()),
  );

  /**
   * The one filled button on the page, only when the coach has nothing running or coming to look
   * after: the program in front of them is over and no other is lined up.
   */
  protected readonly needsProgram = computed(() => {
    const card = this.card();
    return card !== null && card.terminal && this.others().coming.length === 0 && this.canAssign();
  });

  protected readonly closedReason = computed(() => {
    const view = this.read();
    return view && !view.isAllowed ? (view.accessReason as FeatureAccessReason) : null;
  });

  /** Why training is not shown, in a sentence. */
  protected readonly closedLine = computed(() => {
    const reason = this.closedReason();
    return reason === null ? '' : trainingClosed(reason, this.firstName());
  });

  /**
   * The day a booked plan begins, while the coach can already read its training and the client cannot
   * (TRN-023); null while the plan runs.
   */
  private readonly bookedStart = computed(() => {
    const view = this.read();
    if (!view?.isAllowed || view.accessReason === 'Granted') return null;
    const from = this.context
      .plans()
      ?.featureAccess.find((item) => item.feature === 'Training')?.accessibleFrom;
    return from ? formatDate(from, 'EEE d MMM', this.locale) : null;
  });

  /** Beside the program: the client does not see it yet, and from when they will. */
  protected readonly bookedLine = computed(() => {
    const view = this.read();
    if (!view?.isAllowed || view.accessReason === 'Granted') return '';
    const name = this.firstName();
    const starts = this.bookedStart();
    if (view.accessReason === 'PaymentRequired') {
      return starts
        ? $localize`${name}:name: sees it from ${starts}:date:, once the plan is paid`
        : $localize`${name}:name: sees it once the next plan is paid and starts`;
    }
    return starts
      ? $localize`${name}:name: sees it from ${starts}:date:, when the plan starts`
      : $localize`${name}:name: sees it once the plan starts`;
  });

  /** There is nothing to open on the service page when the person has simply left. */
  protected readonly canOpenService = computed(() => this.closedReason() !== 'MembershipInactive');

  constructor() {
    this.scope.onReset(() => this.reset());
    effect(() => {
      this.scope.epoch();
      const tenantId = this.tenants.selectedTenantId();
      const clientId = this.context.clientId();
      const workspace = this.context.workspace();
      const key = tenantId && clientId && workspace ? `${tenantId}:${clientId}` : null;
      if (key && key !== this.loadedKey) {
        this.loadedKey = key;
        void this.load(true);
      }
    });

    // "Assign program" from the header or Today arrives as `?action=assign`: open it once the page
    // has loaded, then take the word out of the address so Back and a reload do not reopen it.
    effect(() => {
      if (this.query().get('action') !== 'assign' || this.state() !== 'ready') return;
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { action: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
      if (this.canAssign()) this.openAssign();
    });

    // On a wide screen the weeks overflow sideways; bring the current one into view, once per program.
    effect(() => {
      const card = this.card();
      if (!card || this.focusedKey === card.id) return;
      this.focusedKey = card.id;
      afterNextRender(() => this.centreCurrentWeek(), { injector: this.injector });
    });
  }

  protected load(first = false): Promise<void> {
    return this.scope.run('load', async (owner) => {
      if (first || this.read() === null) this.state.set('loading');
      try {
        this.read.set(
          await owner.wait(firstValueFrom(this.programApi.getProgram(this.context.clientId()))),
        );
        this.state.set('ready');
      } catch {
        if (!owner.current) return;
        if (this.read() !== null && !first) {
          // A reread after a change failed: keep what is on screen rather than blanking it.
          this.context.error.set(
            $localize`The program could not be refreshed. Reload the page to see it as it is now.`,
          );
        } else {
          this.state.set('error');
        }
      }
    });
  }

  protected openBlock(id: string): void {
    this.picked.set(id);
    this.pickedWeek.set(null);
    this.focusedKey = null;
    this.context.clearMessages();
  }

  protected chooseWeek(number: number): void {
    this.pickedWeek.set(number);
  }

  protected toolsToggled(event: Event): void {
    if ((event.target as HTMLDetailsElement).open) this.toolsOpened.set(true);
  }

  // ---------- the Actions menu ----------

  protected onAction(action: string): void {
    const name = this.card()?.name ?? '';
    switch (action) {
      case 'assign':
        return this.openAssign();
      case 'rename':
        return this.open(
          this.dialogs,
          this.renameDialog(),
          $localize`Rename program`,
          () => $localize`The program was renamed.`,
        );
      case 'next-block':
        return this.open(
          this.sheets,
          this.nextSheet(),
          $localize`Build next block`,
          () => $localize`The new weeks are added to ${name}:program:.`,
        );
      case 'reschedule':
        return this.open(
          this.dialogs,
          this.rescheduleDialog(),
          $localize`Reschedule`,
          () => $localize`${name}:program: is moved.`,
        );
      case 'complete':
        return this.open(
          this.dialogs,
          this.completeDialog(),
          $localize`Close program`,
          () => $localize`${name}:program: is closed.`,
        );
      case 'cancel':
        return this.open(
          this.dialogs,
          this.cancelDialog(),
          $localize`Cancel program`,
          () => $localize`${name}:program: is cancelled.`,
        );
      case 'reveal-all':
        return void this.setReveal(true);
      case 'reveal-weekly':
        return void this.setReveal(false);
    }
  }

  protected openAssign(): void {
    const ref = this.sheets.open<TrainingMesocycleView | null>(this.assignSheet(), {
      title: $localize`Assign program`,
      closeLabel: this.closeLabel,
    });
    ref.closed.subscribe((assigned) => {
      if (!assigned) return;
      this.done(
        $localize`${assigned.name}:program: is assigned to ${this.firstName()}:name:. It starts ${formatDate(assigned.startDate, 'EEE d MMM', this.locale)}:date:.`,
      );
    });
  }

  /** The panel's one button: change the program's training maxes for the coming weeks (P2). */
  protected openMaxesUpdate(): void {
    this.open(
      this.sheets,
      this.maxesSheet(),
      $localize`Update training maxes`,
      () => $localize`Training maxes updated. The weeks still to come follow them.`,
    );
  }

  protected openSession(week: WeekColumn, session: SessionCard): void {
    this.active.set({ week, session });
    const ref = this.sheets.open<boolean>(this.sessionSheet(), {
      title: session.name,
      closeLabel: this.closeLabel,
    });
    ref.closed.subscribe((swapped) => {
      if (swapped) this.done($localize`${session.name}:session: was swapped.`);
    });
  }

  /** Opens a sheet or dialog on a template; a `true` result means the program changed. */
  private open(
    surface: UiSheet | UiDialog,
    template: TemplateRef<unknown>,
    title: string,
    notice: () => string,
  ): void {
    const ref = surface.open<boolean>(template, { title, closeLabel: this.closeLabel });
    ref.closed.subscribe((changed) => {
      if (changed) this.done(notice());
    });
  }

  /** A change was made: say so, and read the program again. */
  private done(notice: string): void {
    this.context.error.set(null);
    this.context.notice.set(notice);
    void this.load();
  }

  // ---------- sharing a week ----------

  protected async toggleShare(week: WeekColumn, input: HTMLInputElement): Promise<void> {
    const card = this.card();
    if (!card || card.terminal || this.sharing()) {
      input.checked = week.share !== 'unshared';
      return;
    }
    const shared = input.checked;
    this.sharing.set(true);
    this.context.clearMessages();
    try {
      await this.csrf.refresh();
      await firstValueFrom(
        this.api.setMesocycleWeekPublished(card.id, week.id, {
          isPublished: shared,
          version: card.version,
        }),
      );
      this.context.notice.set(
        shared
          ? $localize`${week.title}:week: is shared with ${this.firstName()}:name:.`
          : $localize`${week.title}:week: is no longer shared with ${this.firstName()}:name:.`,
      );
    } catch (error) {
      // The box was ticked by hand; put it back to what the server still holds.
      input.checked = !shared;
      this.context.error.set(
        programWriteError(error, $localize`The week could not be changed.`, this.firstName()),
      );
    } finally {
      // The next change must carry the version this one produced, so the boxes stay disabled until
      // the program has been read again.
      await this.load();
      this.sharing.set(false);
    }
  }

  private async setReveal(all: boolean): Promise<void> {
    const card = this.card();
    if (!card || this.sharing()) return;
    this.sharing.set(true);
    this.context.clearMessages();
    try {
      await this.csrf.refresh();
      await firstValueFrom(
        this.api.updateMesocycleVisibility(card.id, { revealAllWeeks: all, version: card.version }),
      );
      this.context.notice.set(
        all
          ? $localize`${this.firstName()}:name: now sees every shared week.`
          : $localize`Shared weeks now open as they start.`,
      );
    } catch (error) {
      this.context.error.set(
        programWriteError(error, $localize`The setting could not be changed.`, this.firstName()),
      );
    } finally {
      await this.load();
      this.sharing.set(false);
    }
  }

  // ---------- the timeline ----------

  /** Scrolls the week strip, not the page, so the current week sits in the middle of the strip. */
  private centreCurrentWeek(): void {
    const strip = this.scroller()?.nativeElement;
    const current = strip?.querySelector<HTMLElement>('.week.current');
    if (!strip || !current || strip.scrollWidth <= strip.clientWidth) return;
    const inner = strip.getBoundingClientRect();
    const week = current.getBoundingClientRect();
    strip.scrollLeft += week.left - inner.left - (inner.width - week.width) / 2;
  }

  private reset(): void {
    this.loadedKey = null;
    this.focusedKey = null;
    this.read.set(null);
    this.state.set('loading');
    this.picked.set(null);
    this.pickedWeek.set(null);
    this.sharing.set(false);
    this.toolsOpened.set(false);
    this.active.set(null);
  }
}

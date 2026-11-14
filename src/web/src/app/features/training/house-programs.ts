import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  LOCALE_ID,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { GuardedSheets, type Closable } from '../../core/forms/guarded-sheets';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope, type TenantOperation } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button, ButtonLink } from '../../ui/button';
import { UiConfirm } from '../../ui/confirm';
import { UiDisclosure, UiDisclosureContent } from '../../ui/disclosure';
import { EmptyState } from '../../ui/empty-state';
import { Skeleton } from '../../ui/skeleton';
import { HousePlansApi } from '../account/house-plans-api';
import { openAskOf, type HousePlans } from '../account/house-plans.models';
import { HouseProgramMaxes } from './house-program-maxes-sheet';
import { HouseProgramsApi } from './house-programs-api';
import {
  allMaxesTyped,
  blockLine,
  coachedOnMax,
  maxDetail,
  programDay,
  refusalWords,
  runningStranded,
  sessionLine,
  setsText,
  startQuestion,
  startRefusal,
  trainingClosed,
  weeksLine,
  type HouseProgram,
  type HousePrograms as HouseProgramsRead,
  type RefusalContext,
} from './house-programs.models';
import { ownTrainingClosedWords } from './own-workout.models';
import { IntentIdempotencyKey } from './training-assignment-state';

type PageState = 'loading' | 'ready' | 'error' | 'gone' | 'closed';

/**
 * What the pass card says on Free, from what the house sells: the ask already waiting on TB Gym, "Ask for
 * Pro+" while Pro+ is on sale and asks are open, Pro+ not asked for yet, or nothing more when that read
 * failed.
 */
interface FreeOffer {
  readonly kind: 'asked' | 'ask' | 'off' | 'alone';
  /** The plan the open ask is for, as the house named it. */
  readonly planName: string | null;
}

/**
 * TB Gym's programs for a self-directed trainee of the house (notes plan N9c4, TRN-034): the pass first
 * (Pro+ and when it ends, or Free and how to get Pro+), then each program the house offers with whom it
 * suits, its sample week and the maxes it reads, and Start under a pass. The trainee types their own
 * maxes in a sheet. The server decides what may start and refuses the rest (N9c3); this page says why in
 * the house's words, and every day it shows comes from the server. A trainee Max coaches, with no Pro+
 * pass, reads that their coach picks their program instead of Pro+'s offer (N9c5b).
 */
@Component({
  selector: 'app-house-programs',
  imports: [
    Button,
    ButtonLink,
    EmptyState,
    HouseProgramMaxes,
    RouterLink,
    Skeleton,
    UiConfirm,
    UiDisclosure,
    UiDisclosureContent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './house-programs.html',
  styleUrl: './house-programs.scss',
})
export class HousePrograms extends GuardedSheets {
  private readonly api = inject(HouseProgramsApi);
  private readonly housePlans = inject(HousePlansApi);
  private readonly profiles = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly router = inject(Router);
  private readonly tenants = inject(TenantStore);
  private readonly locale = inject(LOCALE_ID);
  private readonly injector = inject(Injector);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly noticeLine = viewChild<ElementRef<HTMLElement>>('notice');
  private readonly maxesSheet = viewChild.required<TemplateRef<unknown>>('maxesSheet');
  private readonly startDialog = viewChild.required<TemplateRef<unknown>>('startDialog');
  private readonly confirmTemplate = viewChild.required<TemplateRef<unknown>>('confirmTemplate');
  /** One key per Start pressed: a retry of the same press sends it again, so one program starts. */
  private readonly intent = new IntentIdempotencyKey();
  private loadedTenantId: string | null = null;
  private destroyed = false;
  /** A lift was saved, or the sheet said the page is out of date: the list reads again once it closes. */
  private rereadOnClose = false;

  protected readonly loadingLabel = $localize`Loading TB Gym’s programs…`;
  protected readonly startCancel = $localize`Not now`;

  protected readonly state = signal<PageState>('loading');
  protected readonly read = signal<HouseProgramsRead | null>(null);
  /** What the house sells, read on Free alone; null when not read or the read failed. */
  private readonly plans = signal<HousePlans | null>(null);
  /**
   * Whether Max coaches the trainee today, read from their own profile beside the plans, with no pass
   * alone; null when not read or the read failed, which keeps Free's words (N9c5b).
   */
  private readonly coachedByTheHouse = signal<boolean | null>(null);
  /** The program whose Start is on its way. */
  protected readonly starting = signal<string | null>(null);
  /** The Start question is open: a second press opens no second one. */
  private confirming = false;
  protected readonly startProblem = signal<{ listingId: string; message: string } | null>(null);
  /** Said above the list after a Start found it out of date, once the list was read again. */
  protected readonly notice = signal<string | null>(null);
  protected readonly question = signal<{ title: string; message: string; confirm: string } | null>(
    null,
  );
  /** The program whose maxes the sheet types. */
  protected readonly editing = signal<HouseProgram | null>(null);
  protected readonly sheetBusy = signal(false);

  protected readonly closedWords = computed(() => ownTrainingClosedWords(''));
  private readonly context = computed<RefusalContext | null>(() => {
    const read = this.read();
    return read ? this.contextOf(read) : null;
  });
  /** On Max with no Pro+ pass: their coach picks their program, and the program running is named. */
  protected readonly max = computed(() => {
    const read = this.read();
    if (!read || !coachedOnMax(read, this.coachedByTheHouse())) return null;
    return {
      running: read.running
        ? {
            name: read.running.name,
            until: this.day(read.running.lastDay),
            stranded: runningStranded(read),
          }
        : null,
    };
  });
  protected readonly pass = computed(() => {
    const read = this.read();
    if (!read?.pass) return null;
    return {
      until: this.day(read.pass.lastDay),
      running: read.running
        ? {
            name: read.running.name,
            until: this.day(read.running.lastDay),
            // Its plan ended with a workout of it open: no "runs until", the cards say what it holds.
            stranded: runningStranded(read),
          }
        : null,
    };
  });
  protected readonly free = computed<FreeOffer>(() => {
    const plans = this.plans();
    if (!plans) return { kind: 'alone', planName: null };
    const asked = openAskOf(plans.asks);
    if (asked) return { kind: 'asked', planName: asked.planName };
    if (plans.asksOpen && plans.plans.some((offer) => offer.tier === 'ProPlus')) {
      return { kind: 'ask', planName: null };
    }
    return { kind: 'off', planName: null };
  });
  /** Everything a card says, worked out once per read. */
  protected readonly cards = computed(() => {
    const read = this.read();
    const context = this.context();
    if (!read || !context) return [];
    return read.programs.map((program) => ({
      program,
      block: blockLine(program),
      weeks: weeksLine(program),
      sessions: program.sampleWeek.map((session, index) => ({
        key: `${index}:${session.name}`,
        line: sessionLine(session),
        exercises: session.exercises.map((exercise, place) => ({
          key: `${place}:${exercise.exerciseId}`,
          name: exercise.name,
          sets: setsText(exercise),
          main: exercise.isMainLift,
        })),
      })),
      maxes: program.maxes.map((max) => ({
        exerciseId: max.exerciseId,
        name: max.exerciseName,
        detail: maxDetail(max, read.today, this.locale),
      })),
      // Typing a max is for a program, which needs a pass: on Free the server refuses it (N9c3).
      typing: this.typingButton(program, read),
      refusal: program.refusal === null ? null : refusalWords(program.refusal, program, context),
      lastStart: program.lastStartDay ? this.day(program.lastStartDay) : null,
    }));
  });

  constructor() {
    super();
    this.scope.onReset(() => {
      this.loadedTenantId = null;
      this.closeSheets();
      this.read.set(null);
      this.plans.set(null);
      this.coachedByTheHouse.set(null);
      this.starting.set(null);
      this.startProblem.set(null);
      this.notice.set(null);
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
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
  }

  protected confirmDialog(): TemplateRef<unknown> {
    return this.confirmTemplate();
  }

  /** A save on its way keeps the sheet open until it answers; typed work asks before it goes. */
  protected override canClose(): boolean | Promise<boolean> {
    return this.sheetBusy() ? false : super.canClose();
  }

  /** The list; quietly after a write, so the page keeps what it shows until the new read lands. */
  protected async load(quiet = false): Promise<void> {
    return this.scope.run('load', async (owner) => {
      if (!quiet || this.read() === null) this.state.set('loading');
      try {
        const read = await owner.wait(firstValueFrom(this.api.programs()));
        if (trainingClosed(read)) {
          this.present(null, null, null, 'closed');
          return;
        }
        // What the house sells, and whether Max coaches them, matter only with no pass: under one there
        // is nothing to ask for. Both are read at once, so Free waits for no second round trip.
        const [plans, coached]: [HousePlans | null, boolean | null] =
          read.pass === null
            ? await Promise.all([this.readPlans(owner), this.readCoached(owner)])
            : [null, null];
        this.present(read, coached === true ? null : plans, coached, 'ready');
      } catch (error) {
        if (!owner.current) return;
        const status = error instanceof HttpErrorResponse ? error.status : null;
        // A 404 is no failure: the programs are TB Gym's own trainees' alone, and this is not one.
        this.present(
          null,
          null,
          null,
          status === 404 ? 'gone' : status === 403 ? 'closed' : 'error',
        );
      }
    });
  }

  /** The press on Start: asks once, then starts it from the house's day and opens Training. */
  protected async start(program: HouseProgram): Promise<void> {
    const read = this.read();
    // Asked before the lane is taken: a second run in the lane would cancel the first.
    if (!read || this.confirming || this.starting() !== null) return;
    const words = startQuestion(program, read.today, this.locale);
    this.question.set({ ...words, confirm: $localize`Start program` });
    this.confirming = true;
    const dialog = this.dialogs.open<boolean>(this.startDialog(), {
      title: words.title,
      closeLabel: $localize`Close`,
    });
    const answer = await firstValueFrom(dialog.closed);
    this.confirming = false;
    if (answer !== true) return;

    await this.scope.run('start', async (owner) => {
      this.starting.set(program.listingId);
      this.startProblem.set(null);
      this.notice.set(null);
      const payload = {
        listingId: program.listingId,
        templateVersionId: program.templateVersionId,
      };
      const idempotencyKey = this.intent.forPayload(payload);
      try {
        await owner.wait(this.csrf.refresh());
        const started = await owner.wait(
          firstValueFrom(
            this.api.start(program.listingId, {
              templateVersionId: program.templateVersionId,
              idempotencyKey,
            }),
          ),
        );
        this.intent.complete();
        this.toast.show(
          $localize`${started.name || program.name}:program: started. Its sessions are on Today and Training.`,
          { tone: 'success' },
        );
        await this.router.navigate(['/training/program']);
      } catch (error) {
        if (!owner.current) return;
        const refused = startRefusal(error, program, this.contextOf(this.read() ?? read));
        if (refused.newKey) this.intent.complete();
        if (refused.stale) {
          this.notice.set(refused.message);
          this.starting.set(null);
          await this.load(true);
          this.focusNotice();
          return;
        }
        this.startProblem.set({ listingId: program.listingId, message: refused.message });
      } finally {
        if (owner.current) this.starting.set(null);
      }
    });
  }

  protected typeMaxes(program: HouseProgram): void {
    this.editing.set(program);
    this.rereadOnClose = false;
    this.sheetBusy.set(false);
    const sheet = this.show(this.maxesSheet(), $localize`Your maxes`);
    sheet.closed.subscribe(() => {
      this.sheetBusy.set(false);
      if (this.rereadOnClose && !this.destroyed) {
        this.rereadOnClose = false;
        void this.load(true).then(() => this.keepFocus());
      }
    });
  }

  /** The maxes sheet closed: saved, it says so; closed with typing, it asks first. */
  protected maxesClosed(saved: true | null, sheet: Closable): void {
    if (saved) {
      this.done(sheet, $localize`Your maxes are saved.`);
      return;
    }
    void this.closeAsking(sheet);
  }

  protected markStale(): void {
    this.rereadOnClose = true;
  }

  protected problemOf(listingId: string): string | null {
    const problem = this.startProblem();
    return problem?.listingId === listingId ? problem.message : null;
  }

  private present(
    read: HouseProgramsRead | null,
    plans: HousePlans | null,
    coached: boolean | null,
    state: PageState,
  ): void {
    this.read.set(read);
    this.plans.set(plans);
    this.coachedByTheHouse.set(coached);
    this.state.set(state);
  }

  /** What the house sells; a 404 or a failure leaves the pass card's first sentence alone. */
  private async readPlans(owner: TenantOperation): Promise<HousePlans | null> {
    try {
      return await owner.wait(firstValueFrom(this.housePlans.plans()));
    } catch {
      owner.check();
      return null;
    }
  }

  /** Whether Max coaches the trainee today, from their own profile; a failure keeps Free's words. */
  private async readCoached(owner: TenantOperation): Promise<boolean | null> {
    try {
      const self = await owner.wait(firstValueFrom(this.profiles.getSelfProfile()));
      return self.coachedByTheHouse === true;
    } catch {
      owner.check();
      return null;
    }
  }

  /**
   * The button that opens the maxes sheet, under a pass alone (on Free the server refuses typing, N9c3):
   * Type while a lift has none, Change once all have one. Its name says the program, after the words seen.
   */
  private typingButton(
    program: HouseProgram,
    read: HouseProgramsRead,
  ): { readonly label: string; readonly name: string } | null {
    if (read.pass === null || program.maxes.length === 0) return null;
    return allMaxesTyped(program)
      ? {
          label: $localize`Change your maxes`,
          name: $localize`Change your maxes, for ${program.name}:program:`,
        }
      : {
          label: $localize`Type your maxes`,
          name: $localize`Type your maxes, for ${program.name}:program:`,
        };
  }

  private contextOf(read: HouseProgramsRead): RefusalContext {
    return {
      today: read.today,
      locale: this.locale,
      pass: read.pass,
      running: read.running,
      programs: read.programs,
    };
  }

  private day(date: string): string {
    return programDay(date, this.read()?.today ?? date, this.locale);
  }

  /** The list was read again after a Start found it out of date: its sentence takes focus. */
  private focusNotice(): void {
    if (this.destroyed) return;
    afterNextRender(
      () => (this.noticeLine()?.nativeElement ?? this.heading()?.nativeElement)?.focus(),
      { injector: this.injector },
    );
  }

  /** A new read can take away the button that had focus: the heading takes it, never the body. */
  private keepFocus(): void {
    if (this.destroyed) return;
    afterNextRender(
      () => {
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected) return;
        this.heading()?.nativeElement.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }
}

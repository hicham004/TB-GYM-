import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage, featureAccessReason } from '../../core/api/api-error';
import type {
  CheckInAssignmentDetail,
  CheckInFormSummary,
  FeatureAccessReason,
} from '../../core/api/generated';
import { SheetForm } from '../../core/forms/sheet-form';
import type { TenantOperation } from '../../core/tenancy/tenant-async-scope';
import { Button } from '../../ui/button';
import { DateField } from '../../ui/date-field';
import { FormSummary } from '../../ui/form-summary';
import { UiSelect, type SelectOption } from '../../ui/select';
import { EntryActions, SHEET_STYLES } from '../../ui/sheet-parts';
import { Skeleton } from '../../ui/skeleton';
import { questionCountText, validateAssignment } from '../checkins/checkin-builder.models';
import { dayOf, isReady, type FormClock } from '../checkins/checkin-forms.models';

/** The most forms read for the sheet: ten of the server's pages, far beyond a real library. */
const PAGES = 10;
const PAGE = 100;

/** Where the coach goes to have a form to send: their library, or a new form to write. */
export type WriteForm = 'library' | 'new';

/**
 * Assign a check-in, in a sheet on the client's Check-ins tab (audit A14b, AUTH-8), in place of the old
 * Client check-ins page: which published form, and the day it is due on the workspace's calendar
 * (CHK-004). An archived form or one never published is not offered; with none to offer, the sheet
 * says what to do first. The server decides who may be sent one and refuses a day already past.
 */
@Component({
  selector: 'app-assign-checkin',
  imports: [Button, DateField, EntryActions, FormSummary, Skeleton, UiSelect],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      @if (forms() === null && !loadFailed()) {
        <app-skeleton [label]="loadingLabel" [lines]="3" />
      } @else if (loadFailed()) {
        <div class="problem-text" role="alert">
          <span i18n>Your check-in forms could not be loaded.</span>&ngsp;
          <button appButton type="button" variant="text" (click)="load()" i18n>Try again</button>
        </div>
      } @else if (ready().length === 0) {
        <div class="about" data-no-forms>
          <strong i18n>No check-in form is ready to send yet.</strong>
          @if (drafts().length > 0) {
            <span i18n
              >Publish one of your drafts in Check-in forms, then come back to assign it to
              {{ firstName() }}.</span
            >
            <button appButton type="button" variant="outlined" (click)="write.emit('library')" i18n>
              Open check-in forms
            </button>
          } @else {
            <span i18n
              >Write the few questions {{ firstName() }} answers each week, or start from a weekly
              check-in, and publish it. Then assign it here.</span
            >
            <button appButton type="button" variant="outlined" (click)="write.emit('new')" i18n>
              Write a check-in form
            </button>
          }
        </div>
      } @else {
        <app-select
          [label]="formLabel"
          [options]="options()"
          [value]="chosen()"
          (valueChange)="chosen.set($event)"
          [errors]="shows('form', formIssues()) ? formIssues() : null"
          (touched)="attempt.touch('form')"
        />
        <app-date-field
          [label]="dueLabel"
          [help]="dueHelp()"
          [errors]="shows('due', dueIssues()) ? dueIssues() : null"
          [(value)]="due"
          [min]="today()"
          [today]="today()"
          [firstDay]="firstDay()"
          (touched)="attempt.touch('due')"
        />
      }
      <app-form-summary>
        @if (error(); as message) {
          {{ message }}
        } @else if (attempt.wasTried() && problems() > 0) {
          <ng-container i18n>Check what is marked above.</ng-container>
        }
      </app-form-summary>
      @if (ready().length > 0) {
        <app-entry-actions
          [saveLabel]="assignLabel"
          [busyLabel]="assigningLabel"
          [busy]="busy()"
          (notNow)="closed.emit(null)"
        />
      }
    </form>
  `,
  styles: [SHEET_STYLES],
})
export class AssignCheckIn extends SheetForm implements OnInit {
  private readonly api = inject(ApiClient);
  private readonly root = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly sheetInjector = inject(Injector);

  readonly clientId = input.required<string>();
  readonly firstName = input.required<string>();
  /** Today in the coaching space, never the browser's. */
  readonly today = input.required<string>();
  /** The weekday the workspace's weeks start on, 1 Monday to 7 Sunday. */
  readonly firstDay = input<number | null>(null);
  readonly locale = input<string>('en');
  readonly timeZone = input<string | null>(null);
  /** The check-in assigned, or null when the sheet was closed without one. */
  readonly closed = output<CheckInAssignmentDetail | null>();
  /** The coach wants to write or publish a form first. */
  readonly write = output<WriteForm>();
  /**
   * Check-ins closed for this client while the sheet was open (a plan ended, paused, unpaid or
   * blocked): the page says why in place of its list (CHK-011).
   */
  readonly denied = output<FeatureAccessReason>();

  protected readonly loadingLabel = $localize`Reading your check-in forms`;
  protected readonly formLabel = $localize`Check-in form`;
  protected readonly dueLabel = $localize`Due`;
  protected readonly assignLabel = $localize`Assign check-in`;
  protected readonly assigningLabel = $localize`Assigning…`;

  protected readonly forms = signal<CheckInFormSummary[] | null>(null);
  protected readonly loadFailed = signal(false);
  protected readonly chosen = signal('');
  protected readonly due = signal('');

  /** Only a published form that is not archived can be sent (CHK-004, CHK-013). */
  protected readonly ready = computed(() =>
    (this.forms() ?? []).filter((form) => !form.isArchived && isReady(form)),
  );
  protected readonly drafts = computed(() =>
    (this.forms() ?? []).filter((form) => !form.isArchived && !isReady(form)),
  );
  private readonly clock = computed<FormClock>(() => ({
    locale: this.locale(),
    timeZone: this.timeZone(),
    today: this.today(),
  }));
  protected readonly options = computed<SelectOption[]>(() =>
    this.ready().map((form) => ({
      value: form.id,
      label: form.title,
      hint: form.latestPublishedAtUtc
        ? $localize`${questionCountText(form.questionCount)}:questions: · published ${dayOf(form.latestPublishedAtUtc, this.clock())}:day:`
        : questionCountText(form.questionCount),
    })),
  );
  private readonly form = computed(
    () => this.ready().find((form) => form.id === this.chosen()) ?? null,
  );
  private readonly validation = computed(() =>
    validateAssignment(
      { formVersionId: this.form()?.latestPublishedVersionId ?? '', dueDate: this.due() },
      this.today(),
    ),
  );
  protected readonly formIssues = computed(() => this.validation().byField['formVersionId'] ?? []);
  protected readonly dueIssues = computed(() => this.validation().byField['dueDate'] ?? []);
  protected readonly problems = computed(() => this.validation().errors.length);
  protected readonly dueHelp = computed(
    () =>
      $localize`${this.firstName()}:name: can answer it from now on. After this day it shows as late.`,
  );

  /** The form chosen for the coach when there was only one to choose; choosing it is not typed work. */
  private offered = '';

  constructor() {
    super();
    effect(() => this.dirtyChange.emit(this.chosen() !== this.offered || this.due() !== ''));
  }

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    return this.scope.run('forms', async (owner) => {
      // Try again takes itself away while the forms are read: focus then goes where they land.
      const retried = this.loadFailed();
      this.loadFailed.set(false);
      try {
        const forms = new Map<string, CheckInFormSummary>();
        let read = 0;
        for (let page = 0; page < PAGES; page++) {
          const answer = await owner.wait(firstValueFrom(this.api.listCheckInForms(read, PAGE)));
          // A form renamed between two pages can come twice; it is offered once.
          for (const form of answer.items) forms.set(form.id, form);
          read += answer.items.length;
          if (answer.items.length === 0 || read >= Number(answer.total)) break;
        }
        this.forms.set([...forms.values()]);
        const ready = this.ready();
        if (ready.length === 1 && this.chosen() === '') {
          this.offered = ready[0].id;
          this.chosen.set(ready[0].id);
        }
        if (retried) this.focusFirst('button.trigger, button');
      } catch {
        if (!owner.current) return;
        this.loadFailed.set(true);
        if (retried) this.focusFirst('.problem-text button');
      }
    });
  }

  private focusFirst(selector: string): void {
    afterNextRender(() => this.root.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.sheetInjector,
    });
  }

  protected async submit(): Promise<void> {
    if (this.busy() || this.ready().length === 0) return;
    const form = this.form();
    if (this.problems() > 0 || form === null || form.latestPublishedVersionId === null) {
      this.refuse();
      return;
    }
    const formVersionId = form.latestPublishedVersionId;
    let assigned = null as CheckInAssignmentDetail | null;
    const ok = await this.send(
      async (owner) => {
        assigned = await owner.wait(
          firstValueFrom(
            this.api.assignCheckIn(this.clientId(), { formVersionId, dueDate: this.due() }),
          ),
        );
      },
      (error) => apiErrorMessage(error, $localize`The check-in could not be assigned. Try again.`),
    );
    if (ok && assigned) this.closed.emit(assigned);
  }

  /** A refusal for closed check-ins is the page's to say, with its reason; any other stays here. */
  protected override send(
    work: (owner: TenantOperation) => Promise<void>,
    words: (error: unknown) => string,
  ): Promise<boolean> {
    return super.send(work, (error) => {
      const reason = featureAccessReason(error);
      if (reason !== null && error instanceof HttpErrorResponse) this.denied.emit(reason);
      return words(error);
    });
  }
}

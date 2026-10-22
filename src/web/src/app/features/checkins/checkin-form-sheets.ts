import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { apiErrorMessage } from '../../core/api/api-error';
import type {
  CheckInFormDetails,
  CheckInFormVersionView,
  CheckInQuestionView,
} from '../../core/api/generated';
import { GuardedSheets, type Closable } from '../../core/forms/guarded-sheets';
import { SheetForm } from '../../core/forms/sheet-form';
import { Button } from '../../ui/button';
import { UiConfirm } from '../../ui/confirm';
import { Control, Field } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { EntryActions, SHEET_STYLES } from '../../ui/sheet-parts';
import { StatusPill } from '../../ui/status-pill';
import { CHECK_IN_LIMITS, nameIssues } from './checkin-builder.models';
import { questionFacts, readQuestions, versionRows, type FormClock } from './checkin-forms.models';

/**
 * A form's name and description, in a sheet (audit A14b). They belong to the form, not to a version,
 * so they are saved on their own with the form's own concurrency token, never bundled into a draft's
 * save, which would leave two records half-written on a conflict.
 */
@Component({
  selector: 'app-checkin-form-name',
  imports: [Control, EntryActions, Field, FormSummary],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <app-field
        [label]="titleLabel"
        [errors]="shows('title', titleIssues()) ? titleIssues() : null"
      >
        <input
          appControl
          type="text"
          name="title"
          autocomplete="off"
          dir="auto"
          [attr.maxlength]="limits.titleLength"
          [value]="title()"
          (input)="title.set($any($event.target).value)"
          (blur)="attempt.touch('title')"
        />
      </app-field>
      <app-field
        [label]="descriptionLabel"
        [help]="descriptionHelp"
        [errors]="shows('description', descriptionIssues()) ? descriptionIssues() : null"
      >
        <textarea
          appControl
          name="description"
          rows="3"
          dir="auto"
          [attr.maxlength]="limits.descriptionLength"
          [value]="description()"
          (input)="description.set($any($event.target).value)"
          (blur)="attempt.touch('description')"
        ></textarea>
      </app-field>
      <app-form-summary>
        @if (error(); as message) {
          {{ message }}
        } @else if (attempt.wasTried() && problems() > 0) {
          <ng-container i18n>Check what is marked above.</ng-container>
        }
      </app-form-summary>
      <app-entry-actions
        [saveLabel]="saveLabel"
        [busyLabel]="savingLabel"
        [busy]="busy()"
        (notNow)="closed.emit(null)"
      />
    </form>
  `,
  styles: [SHEET_STYLES],
})
export class CheckInFormName extends SheetForm {
  private readonly api = inject(ApiClient);

  readonly details = input.required<CheckInFormDetails>();
  /** The form as renamed, or null when the sheet was closed without saving. */
  readonly closed = output<CheckInFormDetails | null>();
  /** The form changed since the page read it (a 409): the page reads it again for a fresh token. */
  readonly stale = output<void>();

  protected readonly limits = CHECK_IN_LIMITS;
  protected readonly titleLabel = $localize`Name`;
  protected readonly descriptionLabel = $localize`Description (optional)`;
  protected readonly descriptionHelp = $localize`Clients read it above the first question.`;
  protected readonly saveLabel = $localize`Save name`;
  protected readonly savingLabel = $localize`Saving…`;

  // Seeded from the stored words, never from the details object: the page reading the form again
  // (after a write, or a refusal for a stale form) keeps what was typed unless the words changed.
  protected readonly title = linkedSignal<string, string>({
    source: () => this.details().form.title,
    computation: (title, previous) => (previous?.source === title ? previous.value : title),
  });
  protected readonly description = linkedSignal<string, string>({
    source: () => this.details().form.description ?? '',
    computation: (description, previous) =>
      previous?.source === description ? previous.value : description,
  });
  private readonly issues = computed(() => nameIssues(this.title(), this.description()));
  protected readonly titleIssues = computed(() => this.issues().title);
  protected readonly descriptionIssues = computed(() => this.issues().description);
  protected readonly problems = computed(
    () => this.titleIssues().length + this.descriptionIssues().length,
  );

  constructor() {
    super();
    effect(() => {
      const form = this.details().form;
      this.dirtyChange.emit(
        this.title() !== form.title || this.description() !== (form.description ?? ''),
      );
    });
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.problems() > 0) {
      this.refuse();
      return;
    }
    const form = this.details().form;
    const description = this.description().trim();
    let renamed = null as CheckInFormDetails | null;
    const ok = await this.send(
      async (owner) => {
        renamed = await owner.wait(
          firstValueFrom(
            this.api.renameCheckInForm(form.id, {
              title: this.title().trim(),
              description: description === '' ? null : description,
              version: Number(form.version),
            }),
          ),
        );
      },
      (error) => {
        if (error instanceof HttpErrorResponse && error.status === 409) {
          this.stale.emit();
          return $localize`This form was changed somewhere else since you opened it. Its newest version is read again: save again to keep this name.`;
        }
        return apiErrorMessage(error, $localize`The name could not be saved. Try again.`);
      },
    );
    if (ok && renamed) this.closed.emit(renamed);
  }
}

/**
 * Every version of a form, newest first, in a sheet (audit A14b): when each was published and how many
 * questions it asked, and Read to see one's questions as a client was sent them. Nothing here changes;
 * a published version never can (CHK-002).
 */
@Component({
  selector: 'app-checkin-form-versions',
  imports: [Button, StatusPill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="body">
      <p class="muted" i18n>
        A check-in already sent keeps the version it was sent with. Answers to the same question
        line up across versions, however it was re-worded.
      </p>
      <ol class="versions" role="list">
        @for (row of rows(); track row.id) {
          <li class="version">
            <div class="version-head">
              <div class="version-copy">
                <span class="version-title">{{ row.title }}</span>
                <span class="muted">{{ row.line }}</span>
              </div>
              <app-status-pill [label]="row.state" [tone]="row.tone" />
              <!-- Named by its visible word and the version, so "Hide" says what it hides. -->
              <button
                appButton
                type="button"
                variant="text"
                [id]="'toggle-' + row.id"
                [attr.aria-expanded]="openId() === row.id"
                [attr.aria-controls]="'version-' + row.id"
                (click)="toggle(row.id)"
              >
                @if (openId() === row.id) {
                  <span i18n>Hide</span>
                } @else {
                  <span i18n>Read</span>
                }
                <span class="tb-visually-hidden">&ngsp;{{ row.title }}</span>
              </button>
            </div>
            @if (row.current) {
              <p class="current" i18n>The version clients are assigned now.</p>
            }
            <div class="version-body" [id]="'version-' + row.id">
              @if (openId() === row.id) {
                @if (failed()) {
                  <p class="problem-text" role="alert">
                    <span i18n>This version could not be loaded.</span>&ngsp;
                    <button appButton type="button" variant="text" (click)="retry(row.id)" i18n>
                      Try again
                    </button>
                  </p>
                } @else if (opened(); as version) {
                  <ol class="questions" role="list">
                    @for (question of questionsOf(version); track question.id; let index = $index) {
                      <li class="question">
                        <p class="question-prompt" dir="auto">
                          <span class="number">{{ index + 1 }}.</span>&ngsp;{{ question.prompt }}
                        </p>
                        <p class="muted">{{ facts(question) }}</p>
                        @if (question.helpText) {
                          <p class="muted hint" dir="auto">{{ question.helpText }}</p>
                        }
                        @if (question.options.length > 0) {
                          <p class="muted" dir="auto">{{ optionWords(question) }}</p>
                        }
                      </li>
                    }
                  </ol>
                } @else {
                  <p class="muted" i18n>Loading the questions…</p>
                }
              }
            </div>
          </li>
        }
      </ol>
    </div>
  `,
  styles: [
    SHEET_STYLES,
    `
      .versions,
      .questions {
        display: flex;
        flex-direction: column;
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .versions {
        gap: 0.75rem;
      }

      .version {
        border: 1px solid var(--tb-line);
        border-radius: var(--tb-radius-control);
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 0.75rem 0.875rem;
      }

      .version-head {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem 0.75rem;
      }

      .version-copy {
        display: flex;
        flex: 1 1 10rem;
        flex-direction: column;
        min-inline-size: 0;
      }

      .version-title {
        font-weight: 600;
      }

      .current {
        color: var(--tb-success);
        font-size: 0.875rem;
        font-weight: 600;
      }

      .version-body:empty {
        display: none;
      }

      .questions {
        border-block-start: 1px solid var(--tb-line);
        gap: 0.625rem;
        padding-block-start: 0.625rem;
      }

      .question {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
      }

      .question-prompt {
        font-weight: 600;
      }

      .number {
        color: var(--tb-muted);
        font-variant-numeric: tabular-nums;
      }

      .hint {
        font-style: italic;
      }
    `,
  ],
})
export class CheckInFormVersions {
  private readonly api = inject(ApiClient);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly details = input.required<CheckInFormDetails>();
  readonly clock = input.required<FormClock>();

  protected readonly rows = computed(() => versionRows(this.details(), this.clock()));
  protected readonly openId = signal<string | null>(null);
  protected readonly opened = signal<CheckInFormVersionView | null>(null);
  protected readonly failed = signal(false);
  private request = 0;

  protected toggle(versionId: string): void {
    if (this.openId() === versionId) {
      this.openId.set(null);
      return;
    }
    void this.read(versionId);
  }

  /** Try again: focus waits on the row's own button, which stays, while the version is read again. */
  protected retry(versionId: string): Promise<void> {
    this.host.querySelector<HTMLElement>(`[id="toggle-${versionId}"]`)?.focus();
    return this.read(versionId);
  }

  /** Reads one version's questions; an answer for a version no longer open is dropped. */
  protected async read(versionId: string): Promise<void> {
    const request = ++this.request;
    this.openId.set(versionId);
    this.opened.set(null);
    this.failed.set(false);
    try {
      const version = await firstValueFrom(
        this.api.getCheckInFormVersion(this.details().form.id, versionId),
      );
      if (request === this.request) this.opened.set(version);
    } catch {
      if (request === this.request) this.failed.set(true);
    }
  }

  protected questionsOf(version: CheckInFormVersionView): CheckInQuestionView[] {
    return readQuestions(version.questions);
  }

  protected facts(question: CheckInQuestionView): string {
    return questionFacts(question);
  }

  protected optionWords(question: CheckInQuestionView): string {
    return [...question.options]
      .sort((a, b) => Number(a.order) - Number(b.order))
      .map((option) => option.label)
      .join(' · ');
  }
}

/**
 * The sheets of a check-in form's page, opened from one place (audit A14b): its name and description,
 * and its versions. A sheet holding typed work asks before it closes, however it is closed, and one
 * that saved says so in a toast and gives the page the form as saved.
 */
@Component({
  selector: 'app-checkin-form-sheets',
  imports: [CheckInFormName, CheckInFormVersions, UiConfirm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: none' },
  template: `
    <ng-template #nameSheet let-sheet>
      <app-checkin-form-name
        [details]="details()"
        (dirtyChange)="dirty = $event"
        (stale)="stale.emit()"
        (closed)="named($event, sheet)"
      />
    </ng-template>

    <ng-template #versionsSheet>
      <app-checkin-form-versions [details]="details()" [clock]="clock()" />
    </ng-template>

    <ng-template #confirmTemplate let-dialog>
      @if (asking(); as question) {
        <app-confirm
          [message]="question.message"
          [confirmLabel]="question.confirm"
          [cancelLabel]="question.cancel"
          (answer)="dialog.close($event)"
        />
      }
    </ng-template>
  `,
})
export class CheckInFormSheets extends GuardedSheets {
  readonly details = input.required<CheckInFormDetails>();
  readonly clock = input.required<FormClock>();
  /** The form as renamed. */
  readonly renamed = output<CheckInFormDetails>();
  /** A rename was refused because the form changed elsewhere: read it again. */
  readonly stale = output<void>();

  private readonly nameSheet = viewChild.required<TemplateRef<unknown>>('nameSheet');
  private readonly versionsSheet = viewChild.required<TemplateRef<unknown>>('versionsSheet');
  private readonly confirmTemplate = viewChild.required<TemplateRef<unknown>>('confirmTemplate');

  protected confirmDialog(): TemplateRef<unknown> {
    return this.confirmTemplate();
  }

  rename(): void {
    this.show(this.nameSheet(), $localize`Name and description`);
  }

  versions(): void {
    this.show(this.versionsSheet(), $localize`Versions`);
  }

  /** Closes whatever is open without asking: the page is moving on. */
  close(): void {
    this.closeSheets();
  }

  protected async named(details: CheckInFormDetails | null, sheet: Closable): Promise<void> {
    if (details === null) {
      await this.closeAsking(sheet);
      return;
    }
    this.renamed.emit(details);
    this.done(sheet, $localize`Name saved.`);
  }
}

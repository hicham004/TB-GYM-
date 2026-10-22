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
  LOCALE_ID,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Control, Field } from '../../ui/field';
import { FormSummary } from '../../ui/form-summary';
import { type SegmentOption, SegmentedControl } from '../../ui/segmented-control';
import { selectOptions, UiSelect } from '../../ui/select';
import {
  LEGAL_KINDS,
  legalAudienceLine,
  legalContextClause,
  legalKindName,
  legalParagraphs,
  type LegalContext,
  type LegalKind,
} from '../legal/legal.models';
import { PlatformAdminApi } from './platform-admin-api';
import {
  acceptanceClause,
  characterLine,
  currentFor,
  defaultContext,
  entryDirty,
  entryFrom,
  inForceLine,
  legalEntryErrors,
  normalizedContent,
  toPublishLegalRequest,
  type LegalEntry,
  type LegalField,
  type LegalPublishStart,
  type LegalVersion,
} from './legal-documents.models';

/**
 * Publish a version of a legal document (audit INV-3, CLI-010). The platform admin pastes the text and
 * the sentence beside the box people tick, both as a qualified reviewer approved them, and says so; TB
 * Gym adds no words of its own to either, and no box shortens what was pasted. The sheet says what the
 * version replaces and who is asked, shows the text as people will read it, asks once more before
 * publishing, since a published version stays for good, and keeps a refusal on screen in the server's
 * words. Nothing is decided here: the server checks every rule again, stores the words and hashes them.
 */
@Component({
  selector: 'app-legal-publish',
  imports: [Button, Checkbox, Control, Field, FormSummary, SegmentedControl, UiSelect],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="body" (submit)="$event.preventDefault(); submit()" novalidate>
      <app-select
        label="Document"
        i18n-label
        [options]="kindOptions"
        [value]="entry().kind"
        (valueChange)="setKind($any($event))"
      />
      <app-segmented-control
        label="Who accepts it"
        i18n-label
        [options]="contextOptions"
        [selected]="entry().context"
        (selectedChange)="set({ context: $any($event) })"
      />
      <p class="muted" data-audience>{{ audience() }}</p>

      <p class="notice" data-replaces aria-live="polite">{{ replacesLine() }}</p>

      <app-field
        label="Version name"
        i18n-label
        help="Such as 2026-11. People see it beside the document; it can’t be used twice."
        i18n-help
        [errors]="due('version')"
      >
        <input
          appControl
          name="version"
          autocomplete="off"
          [value]="entry().version"
          (input)="set({ version: $any($event.target).value })"
          (blur)="attempt.touch('version')"
        />
      </app-field>

      <app-field
        label="The document’s text"
        i18n-label
        [help]="textHelp()"
        [errors]="due('content')"
      >
        <textarea
          appControl
          name="content"
          rows="12"
          dir="auto"
          spellcheck="false"
          lang="en"
          [value]="entry().content"
          (input)="set({ content: $any($event.target).value })"
          (blur)="attempt.touch('content')"
        ></textarea>
      </app-field>

      <app-field
        label="The sentence people tick"
        i18n-label
        help="Shown beside the box people tick to accept, in your reviewer’s words."
        i18n-help
        [errors]="due('statement')"
      >
        <input
          appControl
          name="statement"
          autocomplete="off"
          dir="auto"
          lang="en"
          [value]="entry().statement"
          (input)="set({ statement: $any($event.target).value })"
          (blur)="attempt.touch('statement')"
        />
      </app-field>

      @if (paragraphs().length > 0) {
        <details class="preview">
          <summary i18n>Preview as people will read it</summary>
          <article lang="en" dir="auto" data-preview>
            @for (paragraph of paragraphs(); track $index) {
              <p>{{ paragraph }}</p>
            }
          </article>
        </details>
      }

      <div class="reviewed">
        <app-checkbox
          label="A qualified reviewer approved this exact text and sentence."
          i18n-label
        >
          <input
            type="checkbox"
            appControl
            id="legal-reviewed"
            name="reviewed"
            [checked]="entry().reviewed"
            [markInvalid]="shows('reviewed')"
            [aria-describedby]="shows('reviewed') ? 'legal-reviewed-reason' : null"
            (change)="setReviewed($any($event.target).checked)"
          />
        </app-checkbox>
        @if (shows('reviewed')) {
          <p class="reason" id="legal-reviewed-reason">{{ errors().reviewed?.[0] }}</p>
        }
      </div>

      <p class="muted" i18n>
        A published version can’t be changed or deleted. To correct it, publish another version or
        stop asking for it.
      </p>

      @if (confirming()) {
        <p class="confirm" #confirmText tabindex="-1" data-confirm>{{ confirmLine() }}</p>
      }

      <app-form-summary>
        @if (error(); as message) {
          {{ message }}
        } @else if (attempt.wasTried() && problemCount() > 0) {
          <ng-container i18n>Check the fields marked above.</ng-container>
        }
      </app-form-summary>
      <div class="actions">
        @if (confirming()) {
          <button appButton type="button" variant="text" (click)="backToEditing()" i18n>
            Back to editing
          </button>
          <button appButton type="button" [loading]="busy()" (click)="publish()" data-publish-now>
            @if (busy()) {
              <ng-container i18n>Publishing…</ng-container>
            } @else {
              <ng-container i18n>Publish now</ng-container>
            }
          </button>
        } @else {
          <button appButton type="button" variant="text" (click)="closed.emit(null)" i18n>
            Not now
          </button>
          <button appButton type="submit" data-submit i18n>Publish this version</button>
        }
      </div>
    </form>
  `,
  styles: `
    :host {
      display: block;
    }

    .body {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    p {
      color: var(--tb-ink);
      margin: 0;
      overflow-wrap: anywhere;
    }

    .muted {
      color: var(--tb-muted);
      font-size: 0.875rem;
    }

    .notice {
      background: var(--tb-surface-2);
      border-radius: var(--tb-radius-control);
      padding: 0.75rem 0.875rem;
    }

    // The last word before a version is published for good.
    .confirm {
      background: var(--tb-warm-soft);
      border-inline-start: 4px solid var(--tb-warm);
      border-radius: var(--tb-radius-control);
      font-weight: 600;
      padding: 0.75rem 0.875rem;
      scroll-margin-block: 1rem 5rem;
    }

    .confirm:focus {
      outline: none;
    }

    .confirm:focus-visible {
      outline: 3px solid var(--tb-focus);
      outline-offset: 2px;
    }

    // A focused field scrolls clear of the sticky action bar at the sheet's foot.
    input,
    textarea,
    button.trigger {
      scroll-margin-block-end: 5rem;
    }

    textarea {
      min-block-size: 12rem;
      resize: vertical;
    }

    .preview {
      border: 1px solid var(--tb-line);
      border-radius: var(--tb-radius-control);
      padding: 0.625rem 0.875rem;
    }

    .preview summary {
      color: var(--tb-ink);
      cursor: pointer;
      font-weight: 600;
      min-block-size: 1.5rem;
    }

    .preview article {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-block-start: 0.75rem;
      max-block-size: 22rem;
      overflow-y: auto;
    }

    // Line breaks, spaces and indents are kept, as the reading page keeps them.
    .preview article p {
      line-height: 1.6;
      white-space: pre-wrap;
    }

    .reviewed {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .reason {
      color: var(--tb-danger);
      font-size: 0.875rem;
      font-weight: 600;
      margin-inline-start: calc(16px + 0.5rem);
    }

    // The platform sheets' sticky actions (platform-sheets.ts).
    .actions {
      background: var(--tb-surface);
      border-block-start: 1px solid var(--tb-line);
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      inset-block-end: -1.5rem;
      justify-content: flex-end;
      margin-block-end: -1.5rem;
      margin-inline: -1.5rem;
      padding: 0.75rem 1.5rem;
      position: sticky;
    }
  `,
})
export class LegalPublish {
  private readonly api = inject(PlatformAdminApi);
  private readonly csrf = inject(CsrfService);
  private readonly locale = inject(LOCALE_ID);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly summary = viewChild.required(FormSummary);
  private readonly confirmText = viewChild<ElementRef<HTMLElement>>('confirmText');

  /** Where the sheet starts: blank, or a new version of one in force. */
  readonly start = input.required<LegalPublishStart>();
  /** Every version, so the sheet can say what a new one replaces. */
  readonly versions = input.required<readonly LegalVersion[]>();
  /** The version published, or null when the sheet was closed without publishing. */
  readonly closed = output<LegalVersion | null>();
  readonly dirtyChange = output<boolean>();
  /** Another version was published meanwhile: the page reads the versions again. */
  readonly changedMeanwhile = output<void>();

  protected readonly attempt = new FormAttempt();
  protected readonly kindOptions = selectOptions(LEGAL_KINDS, legalKindName);
  protected readonly contextOptions: readonly SegmentOption[] = [
    { value: 'Platform', label: $localize`Once per person` },
    { value: 'Workspace', label: $localize`In each coaching space` },
  ];

  protected readonly entry = linkedSignal<LegalEntry>(() => entryFrom(this.start()));
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** The entry is ready and the sheet asks once more before it is published for good. */
  protected readonly confirming = signal(false);

  protected readonly errors = computed(() =>
    legalEntryErrors(this.entry(), this.versions(), this.locale),
  );
  protected readonly problemCount = computed(() => Object.keys(this.errors()).length);
  protected readonly replaces = computed(() => {
    const entry = this.entry();
    return currentFor(this.versions(), entry.kind, entry.culture);
  });
  protected readonly audience = computed(() => legalAudienceLine(this.entry().kind));
  protected readonly replacesLine = computed(() => {
    const replaces = this.replaces();
    if (!replaces) {
      return $localize`Nothing of this kind is in force yet. People who join from now on are asked to accept this version.`;
    }
    return $localize`This replaces version ${replaces.version}:version: (${inForceLine(replaces, this.locale)}:since:, ${acceptanceClause(replaces.acceptances)}:accepted:). People who join from now on are asked to accept this version; nobody who joined before is asked again yet.`;
  });
  protected readonly confirmLine = computed(() => {
    const entry = this.entry();
    return $localize`Publish the ${legalKindName(entry.kind)}:document: version ${entry.version.trim()}:version:, accepted ${legalContextClause(entry.context)}:who:? It can’t be changed or deleted afterwards; you can only replace it or stop asking for it.`;
  });
  protected readonly paragraphs = computed(() =>
    legalParagraphs(normalizedContent(this.entry().content)),
  );
  protected readonly textHelp = computed(
    () =>
      $localize`Paste the whole text exactly as it was reviewed; a blank line starts a new paragraph. ${characterLine(this.entry().content, this.locale)}:count:.`,
  );

  constructor() {
    effect(() => this.dirtyChange.emit(entryDirty(this.entry())));
  }

  /** A change to the entry takes the sheet back from its last question, so it asks about what is there. */
  protected set(change: Partial<LegalEntry>): void {
    this.entry.update((entry) => ({ ...entry, ...change }));
    this.confirming.set(false);
  }

  /** A document's own way of being accepted comes with it; the admin can still change it. */
  protected setKind(kind: LegalKind): void {
    this.set({ kind, context: defaultContext(kind) as LegalContext });
  }

  protected setReviewed(reviewed: boolean): void {
    this.set({ reviewed });
    this.attempt.touch('reviewed');
  }

  protected shows(field: LegalField): boolean {
    return this.attempt.shows(field, this.errors()[field] ?? []);
  }

  /** The reasons due on screen for a field now, or null. */
  protected due(field: LegalField): readonly string[] | null {
    return this.shows(field) ? (this.errors()[field] ?? null) : null;
  }

  /** Publish this version: refused here while a box is wrong, else the sheet asks once more. */
  protected submit(): void {
    if (this.busy()) return;
    if (this.problemCount() > 0) {
      // The summary points at the marked boxes now, not at the server's last refusal.
      this.error.set(null);
      this.attempt.attempt();
      afterNextRender(
        () => {
          const wrong = this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]');
          if (wrong) wrong.focus();
          else this.summary().focus();
        },
        { injector: this.injector },
      );
      return;
    }
    this.error.set(null);
    this.confirming.set(true);
    afterNextRender(
      () => {
        const text = this.confirmText()?.nativeElement;
        text?.focus({ preventScroll: true });
        text?.scrollIntoView?.({ block: 'nearest' });
      },
      { injector: this.injector },
    );
  }

  protected backToEditing(): void {
    this.confirming.set(false);
  }

  protected async publish(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.csrf.refresh();
      const published = await firstValueFrom(
        this.api.publishLegalDocument(toPublishLegalRequest(this.entry(), this.replaces())),
      );
      this.closed.emit(published);
    } catch (error) {
      this.confirming.set(false);
      const code = error instanceof HttpErrorResponse ? error.error?.code : null;
      if (code === 'legal_document_changed') {
        this.changedMeanwhile.emit();
        this.error.set(
          $localize`Another version of this document was published or withdrawn while this sheet was open. The line above says what yours would replace now; publish again to replace it.`,
        );
      } else {
        this.error.set(
          apiErrorMessage(error, $localize`The document could not be published. Try again.`),
        );
      }
      this.summary().focus();
    } finally {
      this.busy.set(false);
    }
  }
}

import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  Directive,
  ElementRef,
  inject,
  Injector,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantAsyncScope, type TenantOperation } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { Button } from '../../ui/button';
import type { IsoDate } from '../../ui/calendar';
import { Control, Field } from '../../ui/field';
import { ProgressEntriesApi } from './progress-entries-api';
import {
  entryRefusal,
  isStale,
  REASON_LIMIT,
  type Audience,
  type ReasonPick,
  type RefusalContext,
} from './progress-entries.models';

/**
 * The part every weigh-in, measurement and photo sheet shares (R5.3c): the writes belong to the
 * workspace they started in, a refusal stays on screen in words with what was typed kept, and a
 * change that happened while the sheet was open says so and asks the page to read its list again.
 * Each sheet decides what it asks for; the server decides whether it may.
 */
@Directive()
export abstract class EntrySheet {
  protected readonly entries = inject(ProgressEntriesApi);
  protected readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  /** A write started in one workspace is dropped, never sent to or answered into another (ADR 0026). */
  protected readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());

  /** The client a coach is entering for; null on the client's own page. */
  readonly clientId = input<string | null>(null);
  readonly audience = input.required<Audience>();
  /** Today in the coaching space, never the browser's. */
  readonly today = input.required<IsoDate>();
  readonly firstDay = input<number | null>(null);
  /** The entry changed under the person: the page reads its list again. */
  readonly stale = output<void>();
  /** Whether something has been typed that closing would lose. */
  readonly dirtyChange = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected shows(field: string, messages: readonly string[]): boolean {
    return this.attempt.shows(field, messages);
  }

  /** A refused submit: every message shows and the first box that is wrong takes focus. */
  protected refuse(): void {
    this.attempt.attempt();
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      { injector: this.injector },
    );
  }

  /** Brings a message at the foot of the sheet above the sticky bar that would cover it. */
  protected reveal(selector = '.refusal'): void {
    afterNextRender(
      () => this.host.nativeElement.querySelector(selector)?.scrollIntoView?.({ block: 'nearest' }),
      { injector: this.injector },
    );
  }

  /**
   * Runs one write: a fresh CSRF token first, the answer ignored if the workspace changed, a refusal
   * kept on screen. Answers true when the write was made.
   */
  protected send(
    work: (owner: TenantOperation) => Promise<void>,
    fallback: string,
    context: RefusalContext = {},
  ): Promise<boolean> {
    return this.scope.run(
      'send',
      async (owner) => {
        this.busy.set(true);
        this.error.set(null);
        try {
          await owner.wait(this.csrf.refresh());
          await owner.wait(work(owner));
          return true;
        } catch (error) {
          if (!owner.current) return false;
          this.error.set(entryRefusal(error, fallback, context));
          if (isStale(error)) this.stale.emit();
          this.reveal();
          return false;
        } finally {
          if (owner.current) this.busy.set(false);
        }
      },
      false,
    );
  }
}

/** The sheet's foot: Not now, and the one action. It stays in view while a long form scrolls. */
@Component({
  selector: 'app-entry-actions',
  imports: [Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="actions">
      <button appButton type="button" variant="text" (click)="notNow.emit()">
        {{ cancelLabel() }}
      </button>
      <button appButton type="submit" [loading]="busy()">
        @if (busy()) {
          {{ busyLabel() }}
        } @else {
          {{ saveLabel() }}
        }
      </button>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

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
export class EntryActions {
  readonly saveLabel = input.required<string>();
  readonly busyLabel = input.required<string>();
  readonly busy = input(false);
  readonly cancelLabel = input($localize`Not now`);
  readonly notNow = output<void>();
}

let nextReasonGroup = 0;

/**
 * "What was wrong?": the commonest reasons one tap away and "Something else" typed. The server keeps
 * a reason with every correction and removal, so it is asked for once, in words, and never as a blank box.
 */
@Component({
  selector: 'app-reason-picker',
  imports: [Control, Field],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="choices">
      <legend>{{ label() }}</legend>
      @for (option of picks(); track option.key) {
        <label class="choice" [class.chosen]="pick()?.key === option.key">
          <input
            type="radio"
            [name]="group"
            [value]="option.key"
            [checked]="pick()?.key === option.key"
            [attr.aria-invalid]="chooseError() ? 'true' : null"
            [attr.aria-describedby]="chooseError() ? errorId : null"
            (change)="choose(option)"
          />
          <span>{{ option.label }}</span>
        </label>
      }
      @if (chooseError(); as message) {
        <p class="problem" [id]="errorId">{{ message }}</p>
      }
    </fieldset>
    @if (pick()?.text === null) {
      <app-field [label]="otherLabel" [errors]="typedErrors()">
        <textarea
          appControl
          rows="2"
          dir="auto"
          [attr.maxlength]="limit"
          [value]="typed()"
          (input)="typed.set($any($event.target).value)"
          (blur)="touched.emit()"
        ></textarea>
      </app-field>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    fieldset {
      border: 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin: 0;
      min-inline-size: 0;
      padding: 0;
    }

    legend {
      color: var(--tb-ink);
      font-size: 0.875rem;
      font-weight: 600;
      margin-block-end: 0.5rem;
      padding: 0;
    }

    .choice {
      align-items: center;
      background: var(--tb-surface);
      border: 1px solid var(--tb-line-strong);
      border-radius: var(--tb-radius-control);
      cursor: pointer;
      display: flex;
      gap: 0.625rem;
      min-block-size: 2.75rem;
      padding: 0.5rem 0.875rem;
    }

    .choice:hover {
      border-color: var(--tb-ink);
    }

    .choice.chosen {
      background: var(--tb-accent-soft);
      border-color: var(--tb-accent-ink);
    }

    .choice:has(input:focus-visible) {
      outline: 2px solid var(--tb-focus);
      outline-offset: 2px;
    }

    input[type='radio'] {
      accent-color: var(--tb-accent-ink);
      block-size: 1.125rem;
      flex: none;
      inline-size: 1.125rem;
      margin: 0;
    }

    span {
      overflow-wrap: anywhere;
    }

    .problem {
      color: var(--tb-danger);
      font-size: 0.875rem;
      margin: 0;
    }
  `,
})
export class ReasonPicker {
  readonly label = input.required<string>();
  readonly picks = input.required<readonly ReasonPick[]>();
  /** What the person chose, and what they typed for "Something else". */
  readonly pick = model<ReasonPick | null>(null);
  readonly typed = model('');
  /** The messages due on screen now. */
  readonly errors = input<readonly string[] | null>(null);
  readonly touched = output<void>();

  protected readonly group = `tb-reason-${++nextReasonGroup}`;
  protected readonly errorId = `${this.group}-error`;
  protected readonly limit = REASON_LIMIT;
  protected readonly otherLabel = $localize`What was wrong?`;
  protected readonly chooseError = computed(() =>
    this.pick() === null ? (this.errors()?.[0] ?? null) : null,
  );
  protected readonly typedErrors = computed(() => (this.pick() === null ? null : this.errors()));

  protected choose(option: ReasonPick): void {
    this.pick.set(option);
  }
}

/** The sheet's own look, shared by every sheet of the three tabs. */
export const SHEET_STYLES = `
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

  .about {
    background: var(--tb-surface-2);
    border-radius: var(--tb-radius-control);
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    padding: 0.75rem 0.875rem;
  }

  .about strong {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .value-unit {
    align-items: start;
    display: grid;
    gap: 0.5rem;
    grid-template-columns: minmax(0, 1fr) minmax(0, 10rem);
  }

  @media (max-width: 26rem) {
    .value-unit {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  .problem-text {
    background: var(--tb-danger-soft);
    border-radius: var(--tb-radius-control);
    color: var(--tb-danger);
    font-weight: 600;
    padding: 0.625rem 0.875rem;
    // Scrolled into view clear of the sticky action bar below it.
    scroll-margin-block-end: 5rem;
  }

  // A focused box scrolls clear of the sticky action bar at the sheet's foot.
  input,
  textarea,
  button {
    scroll-margin-block-end: 5rem;
  }
`;

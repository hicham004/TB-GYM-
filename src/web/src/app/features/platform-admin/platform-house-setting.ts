import { HttpErrorResponse } from '@angular/common/http';
import {
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
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { FormAttempt } from '../../core/forms/form-attempt';
import { CsrfService } from '../../core/security/csrf.service';
import { Button } from '../../ui/button';
import { Control, Field } from '../../ui/field';
import { ModalFooter, modalFormId } from '../../ui/modal-footer';
import { PlatformHouseApi } from './platform-house-api';
import {
  changedLine,
  houseSettingWords,
  type HouseSettingRow,
  type HouseWorkspace,
  settingValueText,
  whishNumberForm,
} from './platform-house.models';
import { focusFirstProblem, SHEET_STYLES } from './platform-sheets';

/**
 * Change one of the house's settings (notes plan N9a2, CLI-023): a number, or the house's Whish number
 * (N9c2), or nothing, which closes what the setting governs. It is sent at the version the page read; a
 * change made meanwhile is refused, the page reads the house again and what was typed stays to be saved over
 * it. The server's own sentence is shown under the box when it refuses the value.
 */
@Component({
  selector: 'app-platform-house-setting',
  imports: [Button, Control, Field, ModalFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './platform-house-setting.html',
  styles: SHEET_STYLES,
})
export class PlatformHouseSetting {
  private readonly api = inject(PlatformHouseApi);
  private readonly csrf = inject(CsrfService);
  private readonly locale = inject(LOCALE_ID);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** The setting as the sheet opened on it: typed work is measured against it. */
  readonly start = input.required<HouseSettingRow>();
  /** The setting as the page reads it now; a save sends its version. */
  readonly current = input.required<HouseSettingRow>();
  readonly house = input.required<HouseWorkspace>();
  /** The saved setting, or null when the sheet was closed without saving. */
  readonly closed = output<HouseSettingRow | null>();
  readonly dirtyChange = output<boolean>();
  /** The setting changed, or the house went, while the sheet was open: the page reads it again. */
  readonly changedMeanwhile = output<void>();

  protected readonly attempt = new FormAttempt();
  protected readonly formId = modalFormId('platform-house-setting');
  protected readonly words = computed(() => houseSettingWords()[this.start().setting]);
  /** A number setting's bounds for its number box; null for the Whish number, which has a text box. */
  protected readonly bounds = computed(() => {
    const words = this.words();
    return words.kind === 'number' ? words : null;
  });
  /** The longest Whish number the server keeps, as its box's own limit; null for a number setting. */
  protected readonly maxLength = computed(() => {
    const words = this.words();
    return words.kind === 'text' ? words.maxLength : null;
  });
  protected readonly typed = linkedSignal(() => this.start().value ?? '');
  /** The box holds something the browser cannot read as a number: it is marked, never sent as empty. */
  protected readonly unreadable = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly refused = signal<readonly string[] | null>(null);

  /** "In force now: 20 · Changed by Hicham Haddad on Thu 12 Nov". */
  protected readonly inForce = computed(() => {
    const current = this.current();
    const value = settingValueText(current.value, this.locale, this.words());
    const changed = changedLine(current, this.house(), this.locale);
    return $localize`In force now: ${value}:value: · ${changed}:changed:`;
  });

  protected readonly reasons = computed(() => {
    const words = this.words();
    const typed = this.typed().trim();
    if (this.unreadable()) return [words.reason];
    if (typed === '') return [];
    if (words.kind === 'text') return whishNumberForm(typed) === null ? [words.reason] : [];
    const number = Number(typed);
    return /^\d+$/.test(typed) && number >= words.min && number <= words.max ? [] : [words.reason];
  });

  constructor() {
    // Something typed that the browser cannot read is typed work too: closing asks before it is lost.
    effect(() =>
      this.dirtyChange.emit(
        this.unreadable() || this.typed().trim() !== (this.start().value ?? ''),
      ),
    );
  }

  protected errorsShown(): readonly string[] | null {
    const local = this.reasons();
    if (this.attempt.shows('value', local)) return local;
    return this.refused();
  }

  protected setTyped(box: HTMLInputElement): void {
    const unreadable = box.validity.badInput;
    this.unreadable.set(unreadable);
    if (!unreadable) this.typed.set(box.value);
    this.refused.set(null);
  }

  protected async submit(): Promise<void> {
    if (this.busy()) return;
    if (this.reasons().length > 0) {
      this.attempt.attempt();
      focusFirstProblem(this.host, this.injector);
      return;
    }
    const typed = this.typed().trim();
    this.busy.set(true);
    this.error.set(null);
    this.refused.set(null);
    try {
      await this.csrf.refresh();
      const saved = await firstValueFrom(
        this.api.changeSetting(
          this.start().setting,
          typed === '' ? null : typed,
          this.current().version,
        ),
      );
      this.closed.emit(saved);
    } catch (error) {
      const code = refusalCode(error);
      if (code === 'house_setting_changed') {
        this.changedMeanwhile.emit();
        this.error.set(
          $localize`This setting was changed while this sheet was open. The line above shows it as it is now; save again to replace it.`,
        );
      } else if (code === 'house_not_set') {
        this.changedMeanwhile.emit();
        this.error.set(
          $localize`No coaching space is marked as the house any more, so it has no settings to change.`,
        );
      } else {
        const messages = valueRefusal(error);
        if (messages) {
          this.refused.set(messages);
          focusFirstProblem(this.host, this.injector);
        } else {
          this.error.set(
            apiErrorMessage(error, $localize`The setting couldn’t be saved. Try again.`),
          );
        }
      }
    } finally {
      this.busy.set(false);
    }
  }
}

function refusalCode(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse)) return null;
  const code = (error.error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

/** The server's sentence for a value it refused, under `value` (CLI-023's bounds and the Whish number's form). */
function valueRefusal(error: unknown): readonly string[] | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 400) return null;
  const errors = (error.error as { errors?: Record<string, unknown> } | null)?.errors;
  const messages = errors?.['value'] ?? errors?.['Value'];
  if (!Array.isArray(messages)) return null;
  const sentences = messages.filter((message): message is string => typeof message === 'string');
  return sentences.length > 0 ? sentences : null;
}

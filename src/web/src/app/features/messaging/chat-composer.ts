import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FormAttempt } from '../../core/forms/form-attempt';

/** The counter appears only when the limit is close enough to matter. */
const nearLimitCharacters = 200;

/**
 * The chat composer (§4 `Composer`): one growing field and a round send button. It holds no state
 * of its own. The screen owns the draft, the attempt and the send, so a draft still belongs to one
 * conversation and is cleared with it.
 *
 * Send is never disabled for an invalid draft; the attempt is refused out loud instead
 * (ARCHITECTURE.md §8). While a request is in flight the button stays focusable and says so.
 */
@Component({
  selector: 'app-chat-composer',
  imports: [FormsModule],
  templateUrl: './chat-composer.html',
  styleUrl: './chat-composer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatComposer {
  private readonly document = inject(DOCUMENT);

  readonly draft = input.required<string>();
  readonly placeholder = input('');
  readonly maximumLength = input.required<number>();
  readonly issues = input.required<readonly string[]>();
  readonly attempt = input.required<FormAttempt>();
  readonly busy = input(false);
  readonly draftChange = output<string>();
  readonly send = output<void>();

  private readonly summary = viewChild<ElementRef<HTMLElement>>('summary');

  protected readonly remaining = computed(() => this.maximumLength() - this.draft().trim().length);
  protected readonly nearLimit = nearLimitCharacters;

  /** Where focus goes when a send is refused, so the reason is what is read next. */
  focusSummary(): void {
    this.summary()?.nativeElement.focus();
  }

  /**
   * Enter sends on a keyboard-and-pointer device, as every desktop chat does; Shift+Enter is a new
   * line. On a phone Enter stays a new line, because the send button is under the thumb. A key
   * pressed while an input method is composing (Arabic, for one) belongs to the composition.
   */
  protected sendOnEnter(event: Event): void {
    const key = event as KeyboardEvent;
    if (key.shiftKey || key.isComposing || !this.hasFinePointer()) {
      return;
    }

    key.preventDefault();
    this.send.emit();
  }

  private hasFinePointer(): boolean {
    const view = this.document.defaultView;
    return typeof view?.matchMedia === 'function' && view.matchMedia('(pointer: fine)').matches;
  }
}

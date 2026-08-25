import { signal, type Signal } from '@angular/core';

/**
 * When a form's derived validation messages have earned a place on screen.
 *
 * A derived message — "choose a due date", "this question has to be answered" — describes something
 * the user has not done yet. Rendering it on a pristine form tells someone they got it wrong before
 * they touched anything, which is noise on screen and an unprompted announcement off it. So each
 * message waits for one of two events: the user left that control, or the user tried to submit and
 * the form refused. Once shown it stays and updates live, because a message that vanishes while its
 * field is still wrong is worse than one that simply sits there being true.
 *
 * Derived messages render as plain text. `role="alert"` is an assertive live region and belongs to
 * things that just happened — a server error, or the summary of a refused submit — never to content
 * that is already on screen at the moment it is announced.
 *
 * One set keyed by field name rather than a signal per field: a form whose questions are added and
 * removed needs no extra bookkeeping to keep its touched state straight.
 */
export class FormAttempt {
  private readonly touched = signal<ReadonlySet<string>>(new Set<string>());
  private readonly tried = signal(false);

  /** True once a submit was attempted and refused. Only the summary region reads this. */
  readonly wasTried: Signal<boolean> = this.tried.asReadonly();

  /**
   * Whether `messages` for `field` belong on screen. Taking the messages as well as the field name
   * keeps the three places that need this answer — the text itself, `aria-invalid`, and
   * `aria-describedby` — reading one expression, so they cannot drift out of agreement.
   */
  shows(field: string, messages: readonly string[]): boolean {
    return messages.length > 0 && (this.tried() || this.touched().has(field));
  }

  /** Records that the user has left `field`, which reveals that field's message and only that one. */
  touch(field: string): void {
    if (!this.touched().has(field)) {
      this.touched.update((current) => new Set(current).add(field));
    }
  }

  /** Records a submit attempt, which reveals every outstanding message at once. */
  attempt(): void {
    this.tried.set(true);
  }

  /** Back to pristine: after a successful submit, or when the form is replaced wholesale. */
  reset(): void {
    this.touched.set(new Set<string>());
    this.tried.set(false);
  }
}

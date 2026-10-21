import {
  afterNextRender,
  Directive,
  ElementRef,
  inject,
  Injector,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormSummary } from '../../ui/form-summary';
import { CsrfService } from '../security/csrf.service';
import { TenantAsyncScope, type TenantOperation } from '../tenancy/tenant-async-scope';
import { TenantStore } from '../tenancy/tenant.store';
import { FormAttempt } from './form-attempt';

/**
 * What a form in a sheet shares (R5.3d): a write belongs to the workspace it started in, a refusal
 * stays on screen in words with what was typed kept, and the box that is wrong takes focus. Each sheet
 * decides what it asks for and how a refusal reads; the server decides whether it may. The sheet holds
 * one `<app-form-summary>` above its actions, where a refusal is said (ARCHITECTURE §8).
 */
@Directive()
export abstract class SheetForm {
  protected readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly summary = viewChild(FormSummary);
  /** A write started in one workspace is dropped, never sent to or answered into another (ADR 0026). */
  protected readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());

  /** Whether something has been typed that closing would lose. */
  readonly dirtyChange = output<boolean>();

  protected readonly attempt = new FormAttempt();
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected shows(field: string, messages: readonly string[]): boolean {
    return this.attempt.shows(field, messages);
  }

  /**
   * A refused submit: every message shows, the summary points at them in place of the server's last
   * word, and the first box that is wrong takes focus; the summary does when no box is (nothing
   * chosen yet, say).
   */
  protected refuse(): void {
    this.error.set(null);
    this.attempt.attempt();
    afterNextRender(
      () => {
        const wrong = this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]');
        if (wrong) wrong.focus();
        else this.focusSummary();
      },
      { injector: this.injector },
    );
  }

  /** The server refused: its words are in the summary, which takes focus clear of the sticky bar. */
  protected focusSummary(): void {
    this.summary()?.focus();
  }

  /** Brings a part of the sheet that has just appeared above the sticky bar that would cover it. */
  protected reveal(selector: string): void {
    afterNextRender(
      () => this.host.nativeElement.querySelector(selector)?.scrollIntoView?.({ block: 'nearest' }),
      { injector: this.injector },
    );
  }

  /**
   * Runs one write: a fresh CSRF token first, the answer ignored if the workspace changed, a refusal
   * kept on screen as `words` writes it. Answers true when the write was made.
   */
  protected send(
    work: (owner: TenantOperation) => Promise<void>,
    words: (error: unknown) => string,
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
          this.error.set(words(error));
          this.focusSummary();
          return false;
        } finally {
          if (owner.current) this.busy.set(false);
        }
      },
      false,
    );
  }
}

import {
  afterNextRender,
  Directive,
  ElementRef,
  inject,
  Injector,
  output,
  signal,
} from '@angular/core';
import { CsrfService } from '../security/csrf.service';
import { TenantAsyncScope, type TenantOperation } from '../tenancy/tenant-async-scope';
import { TenantStore } from '../tenancy/tenant.store';
import { FormAttempt } from './form-attempt';

/**
 * What a form in a sheet shares (R5.3d): a write belongs to the workspace it started in, a refusal
 * stays on screen in words with what was typed kept, and the box that is wrong takes focus. Each sheet
 * decides what it asks for and how a refusal reads; the server decides whether it may.
 */
@Directive()
export abstract class SheetForm {
  protected readonly csrf = inject(CsrfService);
  private readonly tenants = inject(TenantStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
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

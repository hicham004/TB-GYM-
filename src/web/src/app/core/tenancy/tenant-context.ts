import { Injectable, signal } from '@angular/core';

/** UI ownership only. The server still authorizes every tenant resource operation. */
@Injectable({ providedIn: 'root' })
export class TenantContext {
  private readonly epochState = signal(0);
  private readonly listeners = new Set<() => void>();
  readonly epoch = this.epochState.asReadonly();

  invalidate(): void {
    this.epochState.update((epoch) => epoch + 1);
    // Effects can coalesce A -> B -> A. Invalidation and clearing must be synchronous.
    for (const listener of this.listeners) listener();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

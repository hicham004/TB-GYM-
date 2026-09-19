import { DestroyRef, effect, inject, untracked } from '@angular/core';
import { TenantContext } from './tenant-context';

class ObsoleteTenantOperation extends Error {}

export class TenantOperation {
  constructor(
    readonly tenantId: string,
    private readonly owns: () => boolean,
  ) {}

  get current(): boolean {
    return this.owns();
  }

  /** Check both resolutions and rejections before the caller resumes or dispatches another write. */
  async wait<T>(pending: T | PromiseLike<T>): Promise<T> {
    try {
      const value = await pending;
      this.check();
      return value;
    } catch (error) {
      this.check();
      throw error;
    }
  }

  check(): void {
    if (!this.current) throw new ObsoleteTenantOperation();
  }
}

/** One instance per component/store; request lanes preserve independent concurrent work. */
export class TenantAsyncScope {
  private readonly context = inject(TenantContext);
  private readonly requests = new Map<string, number>();
  private readonly resets = new Set<() => void>();
  private destroyed = false;
  private revision = 0;
  private observedTenant: string | null;
  private observedEpoch: number;
  readonly epoch = this.context.epoch;

  constructor(private readonly tenantId: () => string | null) {
    this.observedTenant = tenantId();
    this.observedEpoch = this.epoch();
    const remove = this.context.onChange(() => this.reset());
    // Observe changes from the owning view's tenant source as well as session invalidation.
    effect(() => {
      const tenant = tenantId();
      const epoch = this.epoch();
      if (tenant !== this.observedTenant || epoch !== this.observedEpoch) {
        untracked(() => this.reset());
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      ++this.revision;
      remove();
      for (const reset of this.resets) reset();
      this.resets.clear();
    });
  }

  onReset(reset: () => void): void {
    this.resets.add(reset);
  }

  async run<T>(
    lane: string,
    action: (owner: TenantOperation) => Promise<T>,
    obsolete: T,
  ): Promise<T>;
  async run(lane: string, action: (owner: TenantOperation) => Promise<void>): Promise<void>;
  async run<T>(
    lane: string,
    action: (owner: TenantOperation) => Promise<T>,
    obsolete?: T,
  ): Promise<T | undefined> {
    const tenant = this.tenantId();
    if (this.destroyed || tenant === null) return obsolete;
    const epoch = this.epoch();
    const revision = this.revision;
    const request = (this.requests.get(lane) ?? 0) + 1;
    this.requests.set(lane, request);
    const owner = new TenantOperation(
      tenant,
      () =>
        !this.destroyed &&
        this.tenantId() === tenant &&
        this.epoch() === epoch &&
        this.revision === revision &&
        this.requests.get(lane) === request,
    );
    try {
      return await action(owner);
    } catch (error) {
      if (error instanceof ObsoleteTenantOperation || !owner.current) return obsolete;
      throw error;
    }
  }

  private reset(): void {
    this.observedTenant = this.tenantId();
    this.observedEpoch = this.epoch();
    ++this.revision;
    this.requests.clear();
    for (const reset of this.resets) reset();
  }
}

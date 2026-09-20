import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { TenantContext } from './tenant-context';
import { TenantStore } from './tenant.store';

interface ResolvedDate {
  key: string;
  date: string;
}

/**
 * Today's calendar date in the active workspace, as the server resolved it.
 *
 * Date rules are judged in the workspace's own time zone, so a date default must not be derived
 * from the browser's clock: at 01:00 in Asia/Beirut the browser's UTC date is still yesterday, and
 * two sections of one page end up disagreeing about what day it is. `GET /api/workspace` already
 * answers with `currentDate`, computed server-side, so that is the single source here.
 *
 * `currentDate` is a snapshot taken at request time. An app left open across midnight keeps
 * serving the previous day until the workspace is read again, which is accepted for form
 * defaults: nothing here subscribes or polls.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceCalendar {
  private readonly api = inject(ApiClient);
  private readonly tenants = inject(TenantStore);
  private readonly context = inject(TenantContext);
  private readonly resolved = signal<ResolvedDate | null>(null);
  private pending: { key: string; request: Promise<string> } | null = null;

  /** Cached per active workspace; the epoch drops the cache when the workspace changes. */
  private readonly key = computed(() => {
    const tenantId = this.tenants.selectedTenantId();
    return tenantId === null ? null : `${tenantId}#${this.context.epoch()}`;
  });

  /**
   * The workspace's date once it is known, and the browser's own calendar date until then. The
   * fallback is what these defaults used before, so an unreadable workspace is never worse than
   * it was, and a required date field is never left blank.
   */
  readonly today = computed(() => {
    const resolved = this.resolved();
    return resolved !== null && resolved.key === this.key() ? resolved.date : browserDate();
  });

  /** Reads the workspace once per active workspace; concurrent callers share the one request. */
  async resolveToday(): Promise<string> {
    const key = this.key();
    if (key === null) {
      return browserDate();
    }

    const resolved = this.resolved();
    if (resolved !== null && resolved.key === key) {
      return resolved.date;
    }

    if (this.pending === null || this.pending.key !== key) {
      this.pending = { key, request: this.read(key) };
    }

    return this.pending.request;
  }

  private async read(key: string): Promise<string> {
    try {
      const workspace = await firstValueFrom(this.api.getWorkspace());
      if (this.key() !== key) {
        return browserDate();
      }

      this.resolved.set({ key, date: workspace.currentDate });
      return workspace.currentDate;
    } catch {
      return browserDate();
    } finally {
      if (this.pending !== null && this.pending.key === key) {
        this.pending = null;
      }
    }
  }
}

function browserDate(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

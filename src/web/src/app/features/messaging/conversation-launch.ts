import { DestroyRef, inject, Injectable } from '@angular/core';
import { TenantContext } from '../../core/tenancy/tenant-context';
import type { Conversation } from './messaging.models';

/** One in-memory handoff from the client page. Never persisted or shared across workspaces. */
@Injectable({ providedIn: 'root' })
export class ConversationLaunch {
  private pending: { tenantId: string; conversation: Conversation } | null = null;

  constructor() {
    const remove = inject(TenantContext).onChange(() => { this.pending = null; });
    inject(DestroyRef).onDestroy(remove);
  }

  open(tenantId: string, conversation: Conversation): void {
    this.pending = { tenantId, conversation };
  }

  take(tenantId: string | null): Conversation | null {
    const pending = this.pending;
    this.pending = null;
    return pending?.tenantId === tenantId ? pending.conversation : null;
  }
}

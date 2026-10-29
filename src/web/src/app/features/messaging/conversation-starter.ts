import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api/api-client';
import { CsrfService } from '../../core/security/csrf.service';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { ConversationLaunch } from './conversation-launch';
import { mapConversationDetail } from './messaging.models';

/**
 * Opens the coach's chat with one client in Messages, starting it first when there is none: the
 * client page's Message, and Remind for an overdue check-in (critique B4a) on Today and the client's
 * Overview. The server decides who may (only the client's own coach, while messaging is in the plan,
 * ADR 0026) and answers the existing chat when there is one.
 */
@Injectable({ providedIn: 'root' })
export class ConversationStarter {
  private readonly api = inject(ApiClient);
  private readonly csrf = inject(CsrfService);
  private readonly router = inject(Router);
  private readonly launch = inject(ConversationLaunch);
  private readonly tenants = inject(TenantStore);
  /** One command key per workspace and client, kept until it succeeds, so a retry is the same command. */
  private readonly keys = new Map<string, string>();

  /**
   * Resolves true once Messages opens on the chat, false when the workspace changed meanwhile, and
   * rejects with the server's refusal.
   */
  async open(clientId: string): Promise<boolean> {
    const tenantId = this.tenants.selectedTenantId();
    if (!tenantId) return false;
    const slot = `${tenantId}:${clientId}`;
    const key = this.keys.get(slot) ?? crypto.randomUUID();
    this.keys.set(slot, key);
    // A write straight after sign-in needs a fresh token, as every other write here takes.
    await this.csrf.refresh();
    if (tenantId !== this.tenants.selectedTenantId()) return false;
    const detail = mapConversationDetail(
      await firstValueFrom(this.api.createDirectConversation(clientId, key)),
    );
    this.keys.delete(slot);
    if (tenantId !== this.tenants.selectedTenantId()) return false;
    this.launch.open(tenantId, detail.conversation);
    await this.router.navigateByUrl('/messages');
    return true;
  }
}

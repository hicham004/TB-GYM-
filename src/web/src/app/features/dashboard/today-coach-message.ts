import { DatePipe } from '@angular/common';
import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ClientAccessStore } from '../../core/access/client-access.store';
import { ApiClient } from '../../core/api/api-client';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { initialsOf } from '../../shell/initials';
import { Avatar } from '../../ui/avatar';
import { Button } from '../../ui/button';
import { StatusLabel } from '../../ui/status-label';
import { ConversationLaunch } from '../messaging/conversation-launch';
import type { Conversation } from '../messaging/messaging.models';
import { coachMessage, localDateOf, type ReadState, rowAccessLabel } from './today.models';

/**
 * The coach's latest message (340:2199), from the newest conversation. Opening it hands that thread
 * to Messages, which marks it read; Today never marks anything read. The sent time is shown the way
 * Messages shows it, in the device's time zone, so one message never has two different times.
 */
@Component({
  selector: 'app-today-coach-message',
  imports: [Avatar, Button, DatePipe, RouterLink, StatusLabel],
  templateUrl: './today-coach-message.html',
  styleUrl: './today-coach-message.scss',
})
export class TodayCoachMessage {
  private readonly api = inject(ApiClient);
  private readonly tenants = inject(TenantStore);
  private readonly access = inject(ClientAccessStore);
  private readonly launch = inject(ConversationLaunch);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  /** The workspace's date, which decides whether the sent time or the sent day is shown. */
  readonly today = input<string | null>(null);

  private readonly read = signal<ReadState<Conversation | null>>({ kind: 'loading' });
  protected readonly state = computed(() =>
    coachMessage(this.access.decision('Messaging'), this.read()),
  );
  protected readonly accessLabel = rowAccessLabel;
  protected readonly initialsOf = initialsOf;

  constructor() {
    this.scope.onReset(() => this.read.set({ kind: 'loading' }));
    effect(() => {
      this.scope.epoch();
      if (this.tenants.selectedTenantId()) void this.load();
    });
  }

  protected sentToday(conversation: Conversation): boolean {
    const sent = conversation.lastMessage?.sentAtUtc;
    return sent !== undefined && this.today() !== null && localDateOf(sent) === this.today();
  }

  protected open(conversation: Conversation): void {
    const tenantId = this.tenants.selectedTenantId();
    if (tenantId) this.launch.open(tenantId, conversation);
  }

  protected async retry(): Promise<void> {
    await this.load();
    if (this.state().kind !== 'failed') setTimeout(() => this.heading()?.nativeElement.focus());
  }

  private load(): Promise<void> {
    return this.scope.run('latest', async (owner) => {
      this.read.set({ kind: 'loading' });
      try {
        const page = await owner.wait(firstValueFrom(this.api.listConversations(null, null, 1)));
        this.read.set({ kind: 'ok', value: page.items[0] ?? null });
      } catch {
        if (owner.current) this.read.set({ kind: 'failed' });
      }
    });
  }
}

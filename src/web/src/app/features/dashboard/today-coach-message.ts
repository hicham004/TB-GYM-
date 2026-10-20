import { DatePipe } from '@angular/common';
import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  LOCALE_ID,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ClientAccessStore } from '../../core/access/client-access.store';
import { ApiClient } from '../../core/api/api-client';
import { dayInZone, houseDay } from '../../core/i18n/house-dates';
import { MessagingRealtimeService } from '../../core/messaging/messaging-realtime.service';
import { TenantAsyncScope } from '../../core/tenancy/tenant-async-scope';
import { TenantStore } from '../../core/tenancy/tenant.store';
import { initialsOf } from '../../shell/initials';
import { Avatar } from '../../ui/avatar';
import { Button } from '../../ui/button';
import { StatusLabel } from '../../ui/status-label';
import { ConversationLaunch } from '../messaging/conversation-launch';
import type { Conversation, MessagePreview } from '../messaging/messaging.models';
import { coachMessage, type ReadState, rowAccessLabel } from './today.models';

/**
 * The coach's latest message (340:2199, M1), from the newest conversation: the newest thing the
 * coach wrote, even after the client replied (audit CLIENT-13). Opening it hands that thread to
 * Messages, which marks it read; Today never marks anything read. Whether it was sent today is
 * judged on the workspace's calendar, like Today's own date (WEA-10); the time itself is shown the
 * way Messages shows it, so one message never has two different times. When the live channel says
 * a conversation changed, the card reads again without flashing back to a skeleton.
 */
@Component({
  selector: 'app-today-coach-message',
  imports: [Avatar, Button, DatePipe, RouterLink, StatusLabel],
  templateUrl: './today-coach-message.html',
  styleUrl: './today-coach-message.scss',
})
export class TodayCoachMessage {
  private readonly api = inject(ApiClient);
  private readonly locale = inject(LOCALE_ID);
  private readonly tenants = inject(TenantStore);
  private readonly access = inject(ClientAccessStore);
  private readonly launch = inject(ConversationLaunch);
  private readonly realtime = inject(MessagingRealtimeService);
  private readonly scope = new TenantAsyncScope(() => this.tenants.selectedTenantId());
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private handledRefresh = this.realtime.listRefreshRequests();

  /** The workspace's date, which decides whether the sent time or the sent day is shown. */
  readonly today = input<string | null>(null);
  /** The workspace's time zone, the calendar the sent day is read on; the device's until known. */
  readonly timeZone = input<string | null>(null);

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
    // A new message, an edit or a removal elsewhere: read the newest conversation again (CLIENT-13).
    effect(() => {
      const requests = this.realtime.listRefreshRequests();
      if (requests === this.handledRefresh) return;
      this.handledRefresh = requests;
      untracked(() => {
        if (this.tenants.selectedTenantId()) void this.load(true);
      });
    });
  }

  protected sentToday(message: MessagePreview): boolean {
    const today = this.today();
    return today !== null && dayInZone(message.sentAtUtc, this.timeZone()) === today;
  }

  /** "Sun 20 Sep": the day it was sent on the workspace's calendar. */
  protected sentDay(message: MessagePreview): string {
    const day = dayInZone(message.sentAtUtc, this.timeZone());
    return houseDay(day, this.locale, this.today() ?? day);
  }

  protected open(conversation: Conversation): void {
    const tenantId = this.tenants.selectedTenantId();
    if (tenantId) this.launch.open(tenantId, conversation);
  }

  protected async retry(): Promise<void> {
    await this.load();
    if (this.state().kind !== 'failed') setTimeout(() => this.heading()?.nativeElement.focus());
  }

  /**
   * A quiet read keeps what is shown while it runs, and keeps it if the read fails; one that replaced
   * the first read still in flight says so, rather than leaving the skeleton up.
   */
  private load(quiet = false): Promise<void> {
    return this.scope.run('latest', async (owner) => {
      if (!quiet) this.read.set({ kind: 'loading' });
      try {
        const page = await owner.wait(firstValueFrom(this.api.listConversations(null, null, 1)));
        this.read.set({ kind: 'ok', value: page.items[0] ?? null });
      } catch {
        if (owner.current && (!quiet || this.read().kind === 'loading')) {
          this.read.set({ kind: 'failed' });
        }
      }
    });
  }
}

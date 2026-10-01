import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  LOCALE_ID,
  output,
} from '@angular/core';
import { initialsOf } from '../../shell/initials';
import { Avatar } from '../../ui/avatar';
import { conversationTimeLabel } from './chat-timeline';
import type { Conversation } from './messaging.models';

/**
 * The inbox half of the chat (M7, and the coach's C6): a face, a name, when, the last line said and
 * how many are waiting. Presentation only; the screen owns selection, paging and every request.
 */
@Component({
  selector: 'app-conversation-list',
  imports: [Avatar],
  templateUrl: './conversation-list.html',
  styleUrl: './conversation-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConversationList {
  private readonly locale = inject(LOCALE_ID);

  readonly conversations = input.required<readonly Conversation[]>();
  readonly selectedId = input<string | null>(null);
  readonly hasMore = input(false);
  readonly loadingMore = input(false);
  readonly now = input.required<Date>();
  readonly choose = output<Conversation>();
  readonly loadMore = output<void>();

  protected readonly initialsOf = initialsOf;

  protected time(conversation: Conversation): string {
    return conversationTimeLabel(conversation.lastActivityAtUtc, this.now(), this.locale);
  }

  /** The row's name for assistive technology: who, and whether anything is waiting. */
  protected label(conversation: Conversation): string {
    return conversation.unreadCount > 0
      ? $localize`${conversation.counterpart.displayName}:name:, ${conversation.unreadCount}:count: unread messages`
      : $localize`${conversation.counterpart.displayName}:name:, no unread messages`;
  }

  /** A client's past coach, or a thread nobody can write in any more. */
  protected readOnlyLabel(conversation: Conversation): string {
    return conversation.callerRole === 'Client' ? $localize`Former coach` : $localize`Read-only`;
  }
}

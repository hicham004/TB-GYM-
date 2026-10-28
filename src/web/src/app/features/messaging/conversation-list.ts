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
import { UiMenu, type UiMenuItem } from '../../ui/menu';
import { conversationTimeLabel } from './chat-timeline';
import { countsAsUnread, type Conversation } from './messaging.models';

/**
 * The inbox half of the chat (M7, and the coach's C6): a face, a name, when, the last line said and
 * how many are waiting, and each row's menu with Mark as unread. Presentation only; the screen owns
 * selection, paging and every request.
 */
@Component({
  selector: 'app-conversation-list',
  imports: [Avatar, UiMenu],
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
  /** Mark as unread, from the row's own menu (MSG-022, critique B3b). */
  readonly markUnread = output<Conversation>();
  readonly loadMore = output<void>();

  protected readonly initialsOf = initialsOf;
  protected readonly countsAsUnread = countsAsUnread;
  protected readonly rowMenu: readonly UiMenuItem[] = [
    { label: $localize`Mark as unread`, action: 'unread' },
  ];

  protected time(conversation: Conversation): string {
    return conversationTimeLabel(conversation.lastActivityAtUtc, this.now(), this.locale);
  }

  /** A row offers Mark as unread while the chat opens and nothing in it counts as unread yet. */
  protected canMarkUnread(conversation: Conversation): boolean {
    return conversation.isAvailable && !countsAsUnread(conversation);
  }

  /** The row's name for assistive technology: who, and whether anything is unread. */
  protected label(conversation: Conversation): string {
    const name = conversation.counterpart.displayName;
    if (conversation.unreadCount > 0) {
      return $localize`${name}:name:, ${conversation.unreadCount}:count: unread messages`;
    }

    return conversation.isMarkedUnread
      ? $localize`${name}:name:, marked unread`
      : $localize`${name}:name:, no unread messages`;
  }

  /** A client's past coach, or a thread nobody can write in any more. */
  protected readOnlyLabel(conversation: Conversation): string {
    return conversation.callerRole === 'Client' ? $localize`Former coach` : $localize`Read-only`;
  }
}

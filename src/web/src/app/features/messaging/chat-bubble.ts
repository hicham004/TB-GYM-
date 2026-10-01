import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { messageRemovalLabel } from '../../core/i18n/display-labels';
import type { Message } from './messaging.models';

/**
 * One chat bubble: the words, or what happened to them, and when. The caller's own messages sit on
 * the brand colour at the end of the line; the other person's on the surface at the start. A run
 * from one side shares a flattened edge, and its last bubble ends in a tail.
 *
 * The body is rendered by interpolation, never as HTML, so a message that looks like markup is shown
 * as the characters it is.
 */
@Component({
  selector: 'app-chat-bubble',
  imports: [DatePipe],
  template: `
    @let value = message();
    @if (value.isDeleted) {
      <p class="removed-body">{{ removal() }}</p>
    } @else {
      <p class="body" dir="auto">{{ value.body }}</p>
    }
    <p class="meta">
      <time [attr.datetime]="value.sentAtUtc">{{ value.sentAtUtc | date: 'shortTime' }}</time>
      @if (value.editedAtUtc !== null && !value.isDeleted) {
        <span aria-hidden="true">·</span>
        <span i18n>Edited</span>
      }
    </p>
  `,
  styleUrl: './chat-bubble.scss',
  host: {
    '[class.mine]': 'message().isFromCaller',
    '[class.removed]': 'message().isDeleted',
    '[class.joined]': '!startsRun()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatBubble {
  readonly message = input.required<Message>();
  /** False for the second and later bubbles of a run, which join the one above. */
  readonly startsRun = input(true);

  protected readonly removal = computed(() => messageRemovalLabel(this.message().deletionKind));
}

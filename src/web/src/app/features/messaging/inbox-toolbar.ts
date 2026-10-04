import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Icon } from '../../ui/icon';
import { INBOX_FILTERS, type InboxCounts, type InboxFilter } from './messaging.models';

const FILTER_LABELS: Record<InboxFilter, string> = {
  all: $localize`All`,
  unread: $localize`Unread`,
  waiting: $localize`Waiting for reply`,
};

/**
 * The coach's inbox search and filter chips (C6, R3.5b), drawn like the client list's. Presentation
 * only: the screen owns the query and asks the server, which searches every conversation, not just
 * the ones loaded, and counts each filter (MSG-022).
 */
@Component({
  selector: 'app-inbox-toolbar',
  imports: [Icon],
  templateUrl: './inbox-toolbar.html',
  styleUrls: ['../clients/clients-toolbar.scss', './inbox-toolbar.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InboxToolbar {
  readonly filter = input.required<InboxFilter>();
  readonly search = input.required<string>();
  readonly counts = input<InboxCounts | null>(null);
  readonly filterChange = output<InboxFilter>();
  readonly searchChange = output<string>();

  protected readonly chips = computed(() => {
    const counts = this.counts();
    return INBOX_FILTERS.map((value) => ({
      value,
      label: FILTER_LABELS[value],
      count: counts?.[value] ?? null,
    }));
  });

  protected onSearch(event: Event): void {
    this.searchChange.emit((event.target as HTMLInputElement).value);
  }

  /** The clear button goes with the text, so focus goes back to the box rather than to nowhere. */
  protected clear(box: HTMLInputElement): void {
    this.searchChange.emit('');
    box.focus();
  }
}

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonLink } from '../../ui/button';
import { Skeleton } from '../../ui/skeleton';
import { StatusPill } from '../../ui/status-pill';
import type { ClientPanelState } from './chat-client-panel.models';

let nextPanelId = 0;

/**
 * The client beside a coach's chat (C6, R3.5b): how they stand, their plan, their last workout and
 * what waits for the coach, each a link to where it is handled. A third column on a wide screen and
 * a sheet elsewhere. Presentation only: the screen reads the client and owns the state.
 */
@Component({
  selector: 'app-chat-client-panel',
  imports: [ButtonLink, RouterLink, Skeleton, StatusPill],
  templateUrl: './chat-client-panel.html',
  styleUrl: './chat-client-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatClientPanel {
  readonly state = input.required<ClientPanelState>();
  /** The other person's name, for the title and when the client could not be read. */
  readonly name = input.required<string>();
  readonly clientId = input.required<string>();
  /** A sheet draws its own title, so the panel leaves its own out there. */
  readonly showTitle = input(true);

  /** The column and the sheet can both be on the page, so headings get their own ids. */
  protected readonly uid = `client-panel-${++nextPanelId}`;

  protected readonly panel = computed(() => {
    const state = this.state();
    return state.status === 'ready' ? state.panel : null;
  });
}

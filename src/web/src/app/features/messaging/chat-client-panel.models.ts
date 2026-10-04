import type { ClientProfileOverviewView } from '../../core/api/generated';
import { initialsOf } from '../../shell/initials';
import type { StatusPillTone } from '../../ui/status-pill';
import {
  needRows,
  planStateReason,
  trainingClosed,
  type NeedRow,
} from '../clients/client-profile.models';
import { activityLabel, planLabel, statusPill } from '../clients/clients.models';
import { activityRow } from '../dashboard/coach-today.models';

/**
 * The client beside a coach's chat (C6, R3.5b), in coach words, from the read their page uses
 * (CLI-018): how they stand, their plan, their last workout and what waits for the coach. Workspace
 * dates are measured against the date the server sent; only "2 hours ago" uses the device clock.
 */
export interface ClientPanelContext {
  locale: string;
  /** The device clock, for elapsed time only. */
  now: Date;
}

export interface ClientPanelWorkout {
  title: string;
  /** "52 min · yesterday". */
  detail: string;
  at: string;
  /** The first records it set, phrased ("Back squat 130 kg × 6"), and how many more. */
  records: string[];
  moreRecords: number;
  link: string;
}

export interface ClientPanel {
  id: string;
  name: string;
  firstName: string;
  initials: string;
  link: string;
  status: { label: string; tone: StatusPillTone };
  /** "Weighed in 2 hours ago". */
  activity: string;
  plan: { name: string | null; label: string; soon: boolean };
  lastWorkout: ClientPanelWorkout | null;
  /** Why there is no training to show, when the plan does not let the coach read it. */
  trainingClosed: string | null;
  /** "2 of 4 sessions done this week"; null when training is closed. */
  week: string | null;
  /** What waits for the coach, except the messages: the coach is already in the chat. */
  needs: NeedRow[];
}

export function clientPanel(
  view: ClientProfileOverviewView,
  context: ClientPanelContext,
): ClientPanel {
  const client = view.client;
  const id = client.clientProfileId;
  const name = `${client.firstName} ${client.lastName}`.trim();
  const firstName = client.firstName.trim() || name;
  const training = view.week !== null;
  return {
    id,
    name,
    firstName,
    initials: initialsOf(name),
    link: `/clients/${id}`,
    status: statusPill(view.status),
    activity: activityLabel(view, { ...context, userId: null }),
    plan: { name: view.planName?.trim() || null, ...planLabel(view, view.today, context.locale) },
    lastWorkout: view.lastWorkout ? lastWorkout(view.lastWorkout, context) : null,
    trainingClosed: training ? null : trainingClosed(planStateReason(view.planState), firstName),
    week: view.week ? weekLine(Number(view.week.completed), Number(view.week.scheduled)) : null,
    needs: needRows(
      view.attention.filter((item) => item.kind !== 'UnreadMessages'),
      view.today,
      { ...context, clientId: id, firstName },
    ),
  };
}

function lastWorkout(
  item: NonNullable<ClientProfileOverviewView['lastWorkout']>,
  context: ClientPanelContext,
): ClientPanelWorkout {
  const row = activityRow(item, { ...context, userId: null });
  const minutes = Math.round(Number(item.durationSeconds ?? 0) / 60);
  return {
    title: item.title?.trim() || $localize`Workout`,
    detail: minutes > 0 ? $localize`${minutes}:minutes: min · ${row.ago}:ago:` : row.ago,
    at: item.occurredAtUtc,
    records: row.records,
    moreRecords: row.moreRecords,
    link: row.link,
  };
}

function weekLine(completed: number, scheduled: number): string {
  if (scheduled === 0) return $localize`No sessions this week`;
  return $localize`${Math.min(completed, scheduled)}:done: of ${scheduled}:total: sessions done this week`;
}

/** The panel as the screen holds it while a thread is open on the coach's side. */
export type ClientPanelState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly panel: ClientPanel }
  | { readonly status: 'failed' };

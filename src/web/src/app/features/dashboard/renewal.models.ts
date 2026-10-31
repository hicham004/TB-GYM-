import type { RenewalStatusView } from '../../core/api/generated';

/**
 * The client's renewal state (ADR 0029): whether their whole plan has run out or is about to, with
 * whom and on which day, and when they last asked to renew. `canAsk` is the server's answer, never
 * recalculated here.
 */
export interface RenewalStatus {
  readonly planEnded: boolean;
  /** The plan's last covered day (a calendar date). */
  readonly endedOn: string | null;
  /** The last covered day of a plan still running that the client may already ask about (critique B14). */
  readonly endsOn: string | null;
  /** The plan the ask is about, which My plan shows it on. */
  readonly planId: string | null;
  readonly coachName: string | null;
  readonly lastRequest: {
    readonly id: string;
    readonly requestedOn: string;
    /** The first date the client may ask again. */
    readonly askAgainFrom: string;
  } | null;
  readonly canAsk: boolean;
}

export function mapRenewalStatus(value: RenewalStatusView): RenewalStatus {
  return {
    planEnded: value.planEnded,
    endedOn: value.endedOn ?? null,
    endsOn: value.endsOn ?? null,
    planId: value.planId ?? null,
    coachName: value.coachName ?? null,
    lastRequest: value.lastRequest ? { ...value.lastRequest } : null,
    canAsk: value.canAsk,
  };
}

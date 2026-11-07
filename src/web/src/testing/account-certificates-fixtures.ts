import type { OwnCertificateLine } from '../app/features/account/account-certificates.models';

/**
 * A coach's own certificate lines (notes plan N4b) as `GET /api/coach-certificates/me` answers them:
 * one line in each state the coach's page tells apart. The objects have the API's own JSON shape and
 * the imports are types only, so a Playwright check can answer a request with them as they are. No
 * line holds a word TB Gym keeps out of a coach's line, nor one the screens never call a coach.
 */

/** Confirmed on 2 October and shown to the coach's clients: NASM CPT, shown to TB Gym on 1 October. */
export function ownShownLine(overrides: Partial<OwnCertificateLine> = {}): OwnCertificateLine {
  return {
    id: 'line-nasm',
    state: 'Confirmed',
    text: 'NASM CPT, 2019, shown to TB Gym on 1 Oct 2026',
    what: 'NASM CPT, 2019',
    shownOn: '2026-10-01',
    wordingVersion: 1,
    confirmedOn: '2026-10-02',
    takenDownOn: null,
    coachShows: true,
    version: 2,
    ...overrides,
  };
}

/** Confirmed, and switched off by the coach: their clients do not read it. */
export function ownHiddenLine(overrides: Partial<OwnCertificateLine> = {}): OwnCertificateLine {
  return ownShownLine({
    id: 'line-degree',
    text: 'BSc Sport Science, AUB, shown to TB Gym on 3 Oct 2026',
    what: 'BSc Sport Science, AUB',
    shownOn: '2026-10-03',
    confirmedOn: '2026-10-04',
    coachShows: false,
    version: 4,
    ...overrides,
  });
}

/** Recorded, and waiting for the trainer partner to confirm it with the coach: no switch yet. */
export function ownWaitingLine(overrides: Partial<OwnCertificateLine> = {}): OwnCertificateLine {
  return ownShownLine({
    id: 'line-gym',
    state: 'Waiting',
    text: 'Owns Iron House gym in Hamra, shown to TB Gym on 8 Oct 2026',
    what: 'Owns Iron House gym in Hamra',
    shownOn: '2026-10-08',
    confirmedOn: null,
    version: 1,
    ...overrides,
  });
}

/** Confirmed in August and taken down by TB Gym on 3 November: still on the coach's page, no switch. */
export function ownTakenDownLine(overrides: Partial<OwnCertificateLine> = {}): OwnCertificateLine {
  return ownShownLine({
    id: 'line-years',
    state: 'TakenDown',
    text: 'Six years coaching, shown to TB Gym on 10 Aug 2026',
    what: 'Six years coaching',
    shownOn: '2026-08-10',
    confirmedOn: '2026-08-11',
    takenDownOn: '2026-11-03',
    version: 3,
    ...overrides,
  });
}

/**
 * The coach's lines in the server's order, the order TB Gym recorded them: neither by their words, nor
 * their ids, nor their state, so a screen that sorts them shows it.
 */
export function ownLines(): OwnCertificateLine[] {
  return [ownTakenDownLine(), ownShownLine(), ownHiddenLine(), ownWaitingLine()];
}

import type { ClientInvitation } from '../app/core/api/api.models';

/** Invitations (R5.3a): the coach's list on the fixed day 2026-10-09, one invitation in each state. */

export const TODAY = '2026-10-09';
export const NOW = '2026-10-09T12:00:00Z';

export function invitation(overrides: Partial<ClientInvitation> = {}): ClientInvitation {
  return {
    id: 'invitation-1',
    email: 'rana@example.test',
    firstName: 'Rana',
    lastName: 'Haddad',
    status: 'Pending',
    expiresAtUtc: '2026-10-14T09:00:00Z',
    sendCount: 1,
    logicalSendGeneration: 1,
    createdAtUtc: '2026-10-07T09:00:00Z',
    version: 7,
    developmentActionUrl: null,
    kind: 'Client',
    ...overrides,
  };
}

/** Two waiting (one sent twice), one joined, one whose link ran out, one cancelled. */
export function atlasInvitations(): ClientInvitation[] {
  return [
    invitation(),
    invitation({
      id: 'invitation-2',
      email: 'karl@mail.example',
      firstName: 'Karl',
      lastName: 'Bou Saab',
      sendCount: 2,
      logicalSendGeneration: 2,
      expiresAtUtc: '2026-10-13T09:00:00Z',
      createdAtUtc: '2026-10-06T09:00:00Z',
      version: 3,
    }),
    invitation({
      id: 'invitation-3',
      email: 'maya@mail.example',
      firstName: 'Maya',
      lastName: 'Fakhoury',
      status: 'Accepted',
      expiresAtUtc: '2026-09-20T09:00:00Z',
      createdAtUtc: '2026-09-13T09:00:00Z',
      version: 2,
    }),
    invitation({
      id: 'invitation-4',
      email: 'lynn@mail.example',
      firstName: 'Lynn',
      lastName: 'Bou Khalil',
      status: 'Expired',
      expiresAtUtc: '2026-10-01T09:00:00Z',
      createdAtUtc: '2026-09-24T09:00:00Z',
      version: 2,
    }),
    invitation({
      id: 'invitation-5',
      email: 'ali@mail.example',
      firstName: 'Ali',
      lastName: 'Nasr',
      status: 'Revoked',
      expiresAtUtc: '2026-09-18T09:00:00Z',
      createdAtUtc: '2026-09-11T09:00:00Z',
      version: 2,
    }),
  ];
}

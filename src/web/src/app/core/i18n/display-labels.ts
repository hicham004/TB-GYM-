import { ClientOnboardingStatus, InvitationStatus, TenantRole } from '../api/api.models';

export function tenantRoleLabel(role: TenantRole | undefined): string {
  switch (role) {
    case 'Owner':
      return $localize`Owner`;
    case 'Coach':
      return $localize`Coach`;
    case 'Client':
      return $localize`Client`;
    default:
      return '';
  }
}

export function onboardingStatusLabel(status: ClientOnboardingStatus): string {
  switch (status) {
    case 'NotStarted':
      return $localize`Not started`;
    case 'InProgress':
      return $localize`In progress`;
    case 'Completed':
      return $localize`Completed`;
  }
}

export function invitationStatusLabel(status: InvitationStatus): string {
  switch (status) {
    case 'Pending':
      return $localize`Pending`;
    case 'Accepted':
      return $localize`Accepted`;
    case 'Revoked':
      return $localize`Revoked`;
    case 'Expired':
      return $localize`Expired`;
  }
}

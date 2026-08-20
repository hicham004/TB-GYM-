import type {
  BodyweightUnit as ContractBodyweightUnit,
  ClientOnboardingStatus as ContractClientOnboardingStatus,
  CoachRegistrationResponse,
  CompleteClientOnboardingRequest as ContractCompleteClientOnboardingRequest,
  CreateClientInvitationRequest as ContractCreateClientInvitationRequest,
  CurrentUserResponse,
  DayOfWeek as ContractDayOfWeek,
  EmailActionResponse as ContractEmailActionResponse,
  InvitationAcceptanceResponse,
  InvitationStatus as ContractInvitationStatus,
  LengthUnit as ContractLengthUnit,
  LoginRequest as ContractLoginRequest,
  PublicInvitationDetails,
  RegisterCoachRequest as ContractRegisterCoachRequest,
  TenantMembershipSummary,
  TenantRole as ContractTenantRole,
  UpdateClientIntakeRequest as ContractUpdateClientIntakeRequest,
  UpdateWorkspaceRequest as ContractUpdateWorkspaceRequest,
} from './generated';

export type TenantRole = ContractTenantRole;
export type DayOfWeek = ContractDayOfWeek;
export type InvitationStatus = ContractInvitationStatus;
export type ClientOnboardingStatus = ContractClientOnboardingStatus;
export type LengthUnit = ContractLengthUnit;
export type BodyweightUnit = ContractBodyweightUnit;

export type CurrentUser = CurrentUserResponse;
export type TenantMembership = TenantMembershipSummary;
export type RegisterCoachRequest = ContractRegisterCoachRequest;
export type RegistrationResponse = CoachRegistrationResponse;
export type LoginRequest = ContractLoginRequest;
export type EmailActionResponse = ContractEmailActionResponse;
export type CreateClientInvitationRequest = ContractCreateClientInvitationRequest;
export type PublicInvitation = PublicInvitationDetails;
export type InvitationAcceptance = InvitationAcceptanceResponse;
export type UpdateClientIntakeRequest = ContractUpdateClientIntakeRequest;
export type CompleteClientOnboardingRequest = ContractCompleteClientOnboardingRequest;
export type UpdateWorkspaceRequest = ContractUpdateWorkspaceRequest;

export interface WorkspaceDetails {
  id: string;
  name: string;
  slug: string;
  timeZoneId: string;
  defaultCulture: string;
  defaultCurrencyCode: string;
  weekStartsOn: DayOfWeek;
  version: number;
}

export interface ClientInvitation {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: InvitationStatus;
  expiresAtUtc: string;
  sendCount: number;
  createdAtUtc: string;
  developmentActionUrl: string | null;
}

export interface ClientSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string | null;
  onboardingStatus: ClientOnboardingStatus;
  isCoachBlocked: boolean;
  version: number;
}

export interface ClientIntakeProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string | null;
  birthDate: string | null;
  heightCentimeters: number | null;
  heightEnteredValue: number | null;
  heightEnteredUnit: LengthUnit | null;
  workType: string | null;
  averageDailySteps: number | null;
  trainingBackground: string | null;
  foodPreferences: string | null;
  foodAversions: string | null;
  goals: string | null;
  allergies: string | null;
  medications: string | null;
  previousInjuries: string | null;
  onboardingStatus: ClientOnboardingStatus;
  onboardingCompletedAtUtc: string | null;
  version: number;
}

export interface CoachClientDetails extends ClientIntakeProfile {
  userId: string | null;
  coachNotes: string | null;
  isCoachBlocked: boolean;
}

export type ClientSelfProfile = ClientIntakeProfile;

export interface ApiErrorBody {
  code?: string;
  message?: string;
  title?: string;
  errors?: Record<string, string[]>;
}

import type {
  AssignProductRequest as ContractAssignProductRequest,
  BodyweightUnit as ContractBodyweightUnit,
  ChangeClientRelationshipRequest as ContractChangeClientRelationshipRequest,
  ChangeEnrollmentStatusRequest as ContractChangeEnrollmentStatusRequest,
  ClientOnboardingStatus as ContractClientOnboardingStatus,
  CoachingFeature as ContractCoachingFeature,
  CoachRegistrationResponse,
  CompleteClientOnboardingRequest as ContractCompleteClientOnboardingRequest,
  CreateClientInvitationRequest as ContractCreateClientInvitationRequest,
  CreateCoachingProductRequest as ContractCreateCoachingProductRequest,
  CreateProductOfferRequest as ContractCreateProductOfferRequest,
  CurrentUserResponse,
  DayOfWeek as ContractDayOfWeek,
  EmailActionResponse as ContractEmailActionResponse,
  InvitationAcceptanceResponse,
  InvitationStatus as ContractInvitationStatus,
  LengthUnit as ContractLengthUnit,
  LoginRequest as ContractLoginRequest,
  ManualPaymentMethod as ContractManualPaymentMethod,
  OfferDurationUnit as ContractOfferDurationUnit,
  PublicInvitationDetails,
  RegisterCoachRequest as ContractRegisterCoachRequest,
  RecordManualPaymentRequest as ContractRecordManualPaymentRequest,
  RenewEnrollmentRequest as ContractRenewEnrollmentRequest,
  ResumeEnrollmentRequest as ContractResumeEnrollmentRequest,
  SetOfferAvailabilityRequest as ContractSetOfferAvailabilityRequest,
  TenantMembershipSummary,
  TenantRole as ContractTenantRole,
  UpdateClientIntakeRequest as ContractUpdateClientIntakeRequest,
  UpdateCoachingProductRequest as ContractUpdateCoachingProductRequest,
  UpdateWorkspaceRequest as ContractUpdateWorkspaceRequest,
} from './generated';

export type TenantRole = ContractTenantRole;
export type DayOfWeek = ContractDayOfWeek;
export type InvitationStatus = ContractInvitationStatus;
export type ClientOnboardingStatus = ContractClientOnboardingStatus;
export type LengthUnit = ContractLengthUnit;
export type BodyweightUnit = ContractBodyweightUnit;
export type CoachingFeature = ContractCoachingFeature;
export type OfferDurationUnit = ContractOfferDurationUnit;
export type ManualPaymentMethod = ContractManualPaymentMethod;

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
export type CreateCoachingProductRequest = ContractCreateCoachingProductRequest;
export type CreateProductOfferRequest = ContractCreateProductOfferRequest;
export type RecordManualPaymentRequest = ContractRecordManualPaymentRequest;
export type RenewEnrollmentRequest = ContractRenewEnrollmentRequest;
export type ChangeEnrollmentStatusRequest = ContractChangeEnrollmentStatusRequest;
export type ChangeClientRelationshipRequest = ContractChangeClientRelationshipRequest;
export type AssignProductRequest = ContractAssignProductRequest;
export type ResumeEnrollmentRequest = ContractResumeEnrollmentRequest;
export type SetOfferAvailabilityRequest = ContractSetOfferAvailabilityRequest;
export type UpdateCoachingProductRequest = ContractUpdateCoachingProductRequest;

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

export interface ProductCatalog {
  workspaceCurrencyCode: string;
  products: CoachingProduct[];
}

export interface CoachingProduct {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  offers: ProductOffer[];
  version: number;
}

export interface ProductOffer {
  id: string;
  label: string;
  billingModel: 'FixedDuration' | 'Recurring';
  durationCount: number;
  durationUnit: OfferDurationUnit;
  priceAmount: number;
  priceCurrency: string;
  isActive: boolean;
  features: OfferFeature[];
  createdAtUtc: string;
  version: number;
}

export interface OfferFeature {
  feature: CoachingFeature;
  allowsConcurrentCoverage: boolean;
}

export type EnrollmentStatus = 'PendingPayment' | 'Active' | 'Paused' | 'Cancelled' | 'Expired';

export type EffectiveEnrollmentStatus =
  'PendingPayment' | 'Upcoming' | 'Active' | 'Paused' | 'Expired' | 'Cancelled' | 'Blocked';

export type FeatureAccessReason =
  | 'Granted'
  | 'MembershipInactive'
  | 'RelationshipBlocked'
  | 'NoEntitlement'
  | 'PaymentRequired'
  | 'NotStarted'
  | 'Expired'
  | 'Paused'
  | 'Cancelled'
  | 'PlatformBlocked';

export interface FeatureAccessDecision {
  feature: CoachingFeature;
  isAllowed: boolean;
  reason: FeatureAccessReason;
  enrollmentId: string | null;
  accessibleFrom: string | null;
  accessibleUntilExclusive: string | null;
}

export interface ClientCommercialOverview {
  clientProfileId: string;
  isRelationshipBlocked: boolean;
  featureAccess: FeatureAccessDecision[];
  enrollments: ClientEnrollment[];
}

export interface ClientEnrollment {
  id: string;
  productId: string;
  offerId: string;
  renewedFromEnrollmentId: string | null;
  productName: string;
  offerLabel: string;
  priceAmount: number;
  priceCurrency: string;
  paidAmount: number;
  balanceAmount: number;
  startDate: string;
  endDateExclusive: string;
  lastActiveDate: string;
  storedStatus: EnrollmentStatus;
  effectiveStatus: EffectiveEnrollmentStatus;
  statusReason: string | null;
  features: CoachingFeature[];
  payments: PaymentRecord[];
  createdAtUtc: string;
  version: number;
}

export interface PaymentRecord {
  id: string;
  amount: number;
  currencyCode: string;
  receivedAtUtc: string;
  method: ManualPaymentMethod;
  reference: string | null;
  note: string | null;
  recordedByUserId: string;
  operation: 'Receipt' | 'Refund' | 'Reversal';
  source: 'Manual' | 'Provider';
  createdAtUtc: string;
}

export interface ApiErrorBody {
  code?: string;
  message?: string;
  title?: string;
  errors?: Record<string, string[]>;
}

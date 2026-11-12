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
  InvitationKind as ContractInvitationKind,
  InvitationStatus as ContractInvitationStatus,
  LengthUnit as ContractLengthUnit,
  LoginRequest as ContractLoginRequest,
  ManualPaymentMethod as ContractManualPaymentMethod,
  OfferDurationUnit as ContractOfferDurationUnit,
  PublicInvitationDetails,
  RegisterCoachRequest as ContractRegisterCoachRequest,
  RecordManualPaymentRequest as ContractRecordManualPaymentRequest,
  RecordSessionRequest as ContractRecordSessionRequest,
  RenewEnrollmentRequest as ContractRenewEnrollmentRequest,
  ResumeEnrollmentRequest as ContractResumeEnrollmentRequest,
  SessionEntryKind as ContractSessionEntryKind,
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

export type CurrentUser = CurrentUserResponse & {
  preferredThemeMode: 'light' | 'dark' | 'system';
  preferredWeightUnit: BodyweightUnit;
};
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
export type RecordSessionRequest = ContractRecordSessionRequest;
export type SessionEntryKind = ContractSessionEntryKind;
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
  /**
   * Today in the workspace's own calendar, as the server resolved it. Date rules are decided in
   * this frame, so a form that needs "today" reads it here rather than from the browser clock.
   */
  currentDate: string;
  version: number;
  /** The coach's brand colours (`#rrggbb`), both or neither; null keeps TB Gym's (GAM-005). */
  brandColor: string | null;
  accentColor: string | null;
  /** The logo's media asset, read through a media grant like any other upload (MED-013). */
  logoAssetId: string | null;
}

export interface ClientInvitation {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: InvitationStatus;
  expiresAtUtc: string;
  /** How many times a person deliberately sent this invitation. Never incremented by a retry. */
  sendCount: number;
  /**
   * Which round of sending is currently valid. Only tokens issued for this generation can be
   * accepted; a deliberate resend advances it and kills every earlier link.
   */
  logicalSendGeneration: number;
  createdAtUtc: string;
  /** The optimistic-concurrency token a resend or revoke must present. */
  version: number;
  developmentActionUrl: string | null;
  /** Whether accepting makes the person a client or a coach of the workspace. */
  kind: InvitationKind;
}

export type InvitationKind = ContractInvitationKind;

export interface ClientSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string | null;
  onboardingStatus: ClientOnboardingStatus;
  isCoachBlocked: boolean;
  version: number;
  /** The one Owner or Coach who coaches this client (ADR 0026). */
  assignedCoachUserId: string;
  assignedCoachName: string;
}

/** An active Owner or Coach of the workspace, as the owner's team page lists them. */
export interface TeamMember {
  userId: string;
  displayName: string;
  email: string;
  role: TenantRole;
  assignedClientCount: number;
  joinedAtUtc: string;
  /** The membership version a removal must present. */
  version: number;
}

export interface CoachRemoval {
  reassignedClientCount: number;
  reassignedInvitationCount: number;
}

export interface CreateCoachInvitationRequest {
  email: string;
  firstName: string;
  lastName: string;
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
  assignedCoachUserId: string;
  assignedCoachName: string;
  /** Present only on a former client: the record is then read-only (ADR 0027). */
  release: ClientRelease | null;
}

/** Who ended a former client's relationship: the owner, or the client themselves (ADR 0027). */
export type ClientDepartureKind = 'ReleasedByOwner' | 'LeftByClient';

/** When, why and by whom a client's relationship with the workspace ended. */
export interface ClientRelease {
  releasedAtUtc: string;
  reason: string;
  releasedByName: string;
  departureKind: ClientDepartureKind;
}

/** One row of the owner's "Former clients" list. */
export interface FormerClient {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  releasedAtUtc: string;
  reason: string;
  departureKind: ClientDepartureKind;
}

/** The client's own profile; `selfDirected` marks a trainee of TB Gym's own space (CLI-026). */
export interface ClientSelfProfile extends ClientIntakeProfile {
  selfDirected?: boolean;
}

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
  /** A coaching plan, or a session pack whose options count sessions (ADR 0038). */
  kind?: 'CoachingPlan' | 'SessionPack';
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
  /** The option Change price put in this one's place (ADR 0034); null when it was not replaced. */
  replacedByOfferId: string | null;
  /** The sessions a pack's option sells (SES-001); null on a coaching plan's. */
  sessionCount?: number | null;
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
  /** The workspace day the plan was cancelled (COACH-20); null unless it was. */
  cancelledOn: string | null;
  features: CoachingFeature[];
  payments: PaymentRecord[];
  createdAtUtc: string;
  version: number;
  /** A pack's sessions and ledger (SES-003); null on a coaching plan. */
  sessions?: SessionPack | null;
}

export interface SessionPack {
  /** The sessions it was sold with. */
  count: number;
  /** Issued less held less charged plus undone; none until it is paid. */
  left: number;
  held: number;
  charged: number;
  /** What was left when it ended or was cancelled; none while it runs (SES-006). */
  lapsed: number;
  lapsedOn: string | null;
  lastHeldOn: string | null;
  /** The ledger, newest day first. */
  entries: SessionEntry[];
}

export interface SessionEntry {
  id: string;
  kind: SessionEntryKind;
  count: number;
  day: string;
  /** Who held it, or who charged it. */
  coachName: string | null;
  /** Who recorded it, only when that was someone else (critique B12). */
  recordedByName: string | null;
  /** The coach's own note, for the team. */
  note: string | null;
  /** Why it was charged, which the client reads. */
  reason: string | null;
  voidsEntryId: string | null;
  isVoided: boolean;
}

export interface PaymentRecord {
  id: string;
  amount: number;
  currencyCode: string;
  receivedAtUtc: string;
  /** The workspace day the money arrived (WEA-6), the same for every reader. */
  receivedOn: string;
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

import { ClientOnboardingStatus, InvitationStatus, TenantRole } from '../api/api.models';
import type {
  ExerciseClassification,
  ExerciseEquipment,
  MediaAssetStatus,
  MediaKind,
  MediaSource,
  MesocycleStatus,
  MovementPattern,
  StrengthMaxKind,
  TrainingLoadStrategy,
  TrainingSetType,
  WorkoutExecutionStatus,
} from '../api/generated';

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

export function exerciseEquipmentLabel(value: ExerciseEquipment): string {
  const labels: Record<ExerciseEquipment, string> = {
    None: $localize`None`,
    Barbell: $localize`Barbell`,
    Dumbbell: $localize`Dumbbell`,
    Kettlebell: $localize`Kettlebell`,
    Machine: $localize`Machine`,
    Cable: $localize`Cable`,
    Band: $localize`Band`,
    Bodyweight: $localize`Bodyweight`,
    SpecialtyBar: $localize`Specialty bar`,
    Other: $localize`Other`,
  };
  return labels[value];
}

export function movementPatternLabel(value: MovementPattern): string {
  const labels: Record<MovementPattern, string> = {
    Squat: $localize`Squat`,
    Hinge: $localize`Hinge`,
    HorizontalPush: $localize`Horizontal push`,
    VerticalPush: $localize`Vertical push`,
    HorizontalPull: $localize`Horizontal pull`,
    VerticalPull: $localize`Vertical pull`,
    Carry: $localize`Carry`,
    Rotation: $localize`Rotation`,
    Locomotion: $localize`Locomotion`,
    Isolation: $localize`Isolation`,
    Mobility: $localize`Mobility`,
    Other: $localize`Other`,
  };
  return labels[value];
}

export function exerciseClassificationLabel(value: ExerciseClassification): string {
  const labels: Record<ExerciseClassification, string> = {
    Strength: $localize`Strength`,
    General: $localize`General`,
    Mobility: $localize`Mobility`,
    Conditioning: $localize`Conditioning`,
  };
  return labels[value];
}

export function trainingSetTypeLabel(value: TrainingSetType): string {
  const labels: Record<TrainingSetType, string> = {
    WarmUp: $localize`Warm-up`,
    Normal: $localize`Normal`,
    Top: $localize`Top`,
    BackOff: $localize`Back-off`,
    Drop: $localize`Drop`,
    Failure: $localize`Failure`,
  };
  return labels[value];
}

export function trainingLoadStrategyLabel(value: TrainingLoadStrategy): string {
  const labels: Record<TrainingLoadStrategy, string> = {
    None: $localize`No prescribed load`,
    Direct: $localize`Direct load`,
    PercentageWorkingMax: $localize`% working max`,
    RpeBasedEpley: $localize`RPE recommendation`,
  };
  return labels[value];
}

export function strengthMaxKindLabel(value: StrengthMaxKind): string {
  const labels: Record<StrengthMaxKind, string> = {
    TestedOneRepMax: $localize`Tested 1RM`,
    EstimatedOneRepMax: $localize`Estimated 1RM`,
    CoachWorkingMax: $localize`Working max`,
  };
  return labels[value];
}

export function mesocycleStatusLabel(value: MesocycleStatus): string {
  const labels: Record<MesocycleStatus, string> = {
    Planned: $localize`Planned`,
    Active: $localize`Active`,
    Completed: $localize`Completed`,
    Cancelled: $localize`Cancelled`,
  };
  return labels[value];
}

export function workoutStatusLabel(value: WorkoutExecutionStatus): string {
  return value === 'Completed' ? $localize`Completed` : $localize`In progress`;
}

export function mediaKindLabel(value: MediaKind): string {
  return value === 'Image' ? $localize`Image` : $localize`Video`;
}

export function mediaSourceLabel(value: MediaSource): string {
  return value === 'Upload' ? $localize`Protected upload` : $localize`External embed`;
}

export function mediaStatusLabel(value: MediaAssetStatus): string {
  const labels: Record<MediaAssetStatus, string> = {
    PendingScan: $localize`Pending scan`,
    Ready: $localize`Ready`,
    Rejected: $localize`Rejected`,
    Tombstoned: $localize`Removed`,
  };
  return labels[value];
}

export function trainingAccessReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    Granted: $localize`Training available`,
    MembershipInactive: $localize`Workspace membership inactive`,
    RelationshipBlocked: $localize`Access blocked by coach`,
    NoEntitlement: $localize`No active training service`,
    PaymentRequired: $localize`Payment required`,
    NotStarted: $localize`Training service has not started`,
    Expired: $localize`Training service expired`,
    Paused: $localize`Training service paused`,
    Cancelled: $localize`Training service cancelled`,
    PlatformBlocked: $localize`Account access blocked`,
  };
  return labels[reason] ?? $localize`Training unavailable`;
}

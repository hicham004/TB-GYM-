namespace TB.Gym.Modules.Training;

public interface ITrainingApplicationService
{
    Task<ProgramTemplatePage> ListTemplatesAsync(
        int skip,
        int take,
        CancellationToken cancellationToken);

    Task<ProgramTemplateVersionView?> GetTemplateVersionAsync(
        Guid templateVersionId,
        CancellationToken cancellationToken);

    Task<TrainingCommandResult> CreateTemplateAsync(
        SaveProgramTemplateRequest request,
        CancellationToken cancellationToken);

    Task<TrainingCommandResult> AddTemplateVersionAsync(
        Guid templateId,
        SaveProgramTemplateRequest request,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<SavedSessionView>> ListSavedSessionsAsync(CancellationToken cancellationToken);

    Task<TrainingCommandResult> SaveSessionAsync(
        SaveSessionTemplateRequest request,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<MesocycleSummary>?> ListClientMesocyclesAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken);

    Task<TrainingMesocycleView?> GetMesocycleAsync(Guid mesocycleId, CancellationToken cancellationToken);

    Task<TrainingCommandResult> AssignMesocycleAsync(
        Guid clientProfileId,
        AssignMesocycleRequest request,
        CancellationToken cancellationToken);

    Task<TrainingCommandResult> UpdateMesocycleVisibilityAsync(
        Guid mesocycleId,
        UpdateMesocycleVisibilityRequest request,
        CancellationToken cancellationToken);

    Task<TrainingCommandResult> SetWeekPublishedAsync(
        Guid mesocycleId,
        Guid weekId,
        SetWeekPublishedRequest request,
        CancellationToken cancellationToken);

    Task<TrainingCommandResult> RescheduleMesocycleAsync(
        Guid mesocycleId,
        RescheduleMesocycleRequest request,
        CancellationToken cancellationToken);

    Task<TrainingCommandResult> CancelMesocycleAsync(
        Guid mesocycleId,
        CancelMesocycleRequest request,
        CancellationToken cancellationToken);

    Task<TrainingCommandResult> CompleteMesocycleAsync(
        Guid mesocycleId,
        CompleteMesocycleRequest request,
        CancellationToken cancellationToken);

    Task<TrainingCommandResult> ReplaceSessionAsync(
        Guid mesocycleId,
        Guid sessionId,
        ReplaceTrainingSessionRequest request,
        CancellationToken cancellationToken);

    Task<ProgressionPreviewView?> PreviewProgressionAsync(
        Guid mesocycleId,
        ProgressionPreviewRequest request,
        CancellationToken cancellationToken);

    Task<TrainingCommandResult> ApplyProgressionAsync(
        Guid mesocycleId,
        ApplyProgressionRequest request,
        CancellationToken cancellationToken);

    Task<ExerciseHistoryPage?> GetExerciseHistoryAsync(
        Guid clientProfileId,
        Guid exerciseId,
        int skip,
        int take,
        CancellationToken cancellationToken);

    Task<ClientTrainingDayResult> GetTodayAsync(CancellationToken cancellationToken);

    Task<TrainingCommandResult> StartWorkoutAsync(Guid sessionId, CancellationToken cancellationToken);

    Task<TrainingCommandResult> RecordSetActualAsync(
        Guid workoutExecutionId,
        Guid setPerformanceId,
        RecordSetActualRequest request,
        CancellationToken cancellationToken);

    Task<TrainingCommandResult> SubstituteExerciseAsync(
        Guid workoutExecutionId,
        Guid exercisePerformanceId,
        SubstituteExerciseRequest request,
        CancellationToken cancellationToken);

    Task<TrainingCommandResult> CompleteWorkoutAsync(
        Guid workoutExecutionId,
        CompleteWorkoutRequest request,
        CancellationToken cancellationToken);

    Task<TrainingCommandResult> AddWorkoutNoteAsync(
        Guid workoutExecutionId,
        AddWorkoutNoteRequest request,
        CancellationToken cancellationToken);
}

public sealed record ProgramTemplatePage(
    int Total,
    int Skip,
    int Take,
    IReadOnlyList<ProgramTemplateSummary> Items);

public sealed record ProgramTemplateSummary(
    Guid Id,
    string Name,
    int CurrentVersionNumber,
    bool IsArchived,
    uint Version,
    IReadOnlyList<ProgramTemplateVersionSummary> Versions);

public sealed record ProgramTemplateVersionSummary(
    Guid Id,
    int VersionNumber,
    string Name,
    bool IsPublished,
    int WeekCount,
    DateTimeOffset CreatedAtUtc);

public sealed record ProgramTemplateVersionView(
    Guid Id,
    Guid TemplateId,
    int VersionNumber,
    string Name,
    string? Description,
    bool IsPublished,
    IReadOnlyList<TrainingWeekView> Weeks);

public sealed record SaveProgramTemplateRequest(
    string Name,
    string? Description,
    bool Publish,
    uint? TemplateVersion,
    IReadOnlyList<TrainingWeekRequest> Weeks);

public sealed record TrainingWeekRequest(
    string? Label,
    bool IsPublished,
    IReadOnlyList<TrainingSessionRequest> Sessions);

public sealed record TrainingSessionRequest(
    string Name,
    int DayOffset,
    string? CoachNotes,
    IReadOnlyList<ExercisePrescriptionRequest> Exercises);

public sealed record ExercisePrescriptionRequest(
    Guid ExerciseId,
    int Position,
    bool IsMainLift,
    PrescriptionModificationPolicy ModificationPolicy,
    string? CoachNotes,
    IReadOnlyList<Guid> ApprovedAlternativeExerciseIds,
    IReadOnlyList<SetPrescriptionRequest> Sets);

public sealed record SetPrescriptionRequest(
    int Position,
    TrainingSetType SetType,
    int? RepetitionsMinimum,
    int? RepetitionsMaximum,
    TrainingLoadStrategy LoadStrategy,
    decimal? DirectLoad,
    TrainingLoadUnit? LoadUnit,
    decimal? PercentageWorkingMax,
    decimal? TargetRpe,
    decimal? TargetRir,
    ExertionDisplayPreference ExertionDisplayPreference,
    int? RestSeconds,
    string? Tempo,
    string? CoachNotes,
    decimal? ManualLoadOverride = null);

public sealed record SavedSessionView(
    Guid Id,
    string Name,
    Guid SourceTemplateVersionId,
    Guid SourceTemplateSessionId,
    TrainingSessionView Session);

public sealed record SaveSessionTemplateRequest(
    string Name,
    Guid SourceTemplateVersionId,
    Guid SourceTemplateSessionId);

public sealed record AssignMesocycleRequest(
    Guid EnrollmentId,
    Guid TemplateVersionId,
    DateOnly StartDate,
    MesocycleKind Kind,
    TrainingLoadUnit LoadUnit,
    decimal LoadIncrement,
    TrainingLoadRoundingMode LoadRoundingMode,
    IReadOnlyList<WorkingMaxSelectionRequest> WorkingMaxes,
    Guid IdempotencyKey);

public sealed record WorkingMaxSelectionRequest(
    Guid ExerciseId,
    Guid? StrengthMaxRecordId,
    decimal Value,
    TrainingLoadUnit Unit);

public sealed record MesocycleSummary(
    Guid Id,
    Guid EnrollmentId,
    string Name,
    DateOnly StartDate,
    DateOnly EndDateExclusive,
    MesocycleKind Kind,
    MesocycleStatus Status,
    bool RevealAllWeeks,
    uint Version);

public sealed record TrainingMesocycleView(
    Guid Id,
    Guid ClientProfileId,
    Guid EnrollmentId,
    Guid SourceTemplateId,
    Guid SourceTemplateVersionId,
    string Name,
    DateOnly StartDate,
    DateOnly EndDateExclusive,
    string TimeZoneId,
    MesocycleKind Kind,
    MesocycleStatus Status,
    bool RevealAllWeeks,
    TrainingLoadUnit LoadUnit,
    decimal LoadIncrement,
    TrainingLoadRoundingMode LoadRoundingMode,
    IReadOnlyList<WorkingMaxSnapshotView> WorkingMaxes,
    IReadOnlyList<TrainingWeekView> Weeks,
    IReadOnlyList<MesocycleLifecycleEventView> Lifecycle,
    uint Version);

public sealed record MesocycleLifecycleEventView(
    Guid Id,
    MesocycleLifecycleEventType EventType,
    MesocycleStatus? FromStatus,
    MesocycleStatus ToStatus,
    string Reason,
    DateTimeOffset OccurredAtUtc,
    Guid? ActorUserId);

public sealed record WorkingMaxSnapshotView(
    Guid Id,
    Guid ExerciseId,
    string ExerciseName,
    Guid? SourceMaxRecordId,
    decimal Value,
    TrainingLoadUnit Unit,
    int EffectiveFromWeek,
    Guid? SupersedesSnapshotId,
    string Reason);

public sealed record TrainingWeekView(
    Guid Id,
    int WeekNumber,
    string? Label,
    DateOnly? StartsOn,
    bool IsPublished,
    bool? IsVisible,
    DateOnly? UnlockDate,
    IReadOnlyList<TrainingSessionView> Sessions);

public sealed record TrainingSessionView(
    Guid Id,
    int Position,
    int DayOffset,
    DateOnly? ScheduledDate,
    string Name,
    string? CoachNotes,
    bool HasStarted,
    bool IsCompleted,
    Guid? WorkoutExecutionId,
    IReadOnlyList<ExercisePrescriptionView> Exercises);

public sealed record ExercisePrescriptionView(
    Guid Id,
    Guid ExerciseId,
    string ExerciseName,
    int Position,
    bool IsMainLift,
    PrescriptionModificationPolicy ModificationPolicy,
    string? CoachNotes,
    IReadOnlyList<Guid> ApprovedAlternativeExerciseIds,
    IReadOnlyList<SetPrescriptionView> Sets);

public sealed record SetPrescriptionView(
    Guid Id,
    int Position,
    TrainingSetType SetType,
    int? RepetitionsMinimum,
    int? RepetitionsMaximum,
    TrainingLoadStrategy LoadStrategy,
    decimal? DirectLoad,
    TrainingLoadUnit? LoadUnit,
    decimal? PercentageWorkingMax,
    decimal? TargetRpe,
    decimal? TargetRir,
    ExertionDisplayPreference ExertionDisplayPreference,
    int? RestSeconds,
    string? Tempo,
    string? CoachNotes,
    Guid? WorkingMaxSnapshotId,
    decimal? UnroundedRecommendedLoad,
    decimal? PrescribedLoad,
    string? CalculationStrategyKey,
    string? CalculationStrategyVersion,
    string? CalculationExplanation,
    bool IsManualLoadOverride);

public sealed record UpdateMesocycleVisibilityRequest(bool RevealAllWeeks, uint Version);

public sealed record SetWeekPublishedRequest(bool IsPublished, uint Version);

public sealed record RescheduleMesocycleRequest(DateOnly StartDate, uint Version);

public sealed record CancelMesocycleRequest(string Reason, uint Version);

public sealed record CompleteMesocycleRequest(uint Version);

public sealed record ReplaceTrainingSessionRequest(TrainingSessionRequest Session, uint Version);

public sealed record ProgressionPreviewRequest(
    IReadOnlyList<Guid> SourceWeekIds,
    int Iterations,
    decimal RpeIncrement,
    uint MesocycleVersion);

public sealed record ApplyProgressionRequest(
    IReadOnlyList<Guid> SourceWeekIds,
    int Iterations,
    decimal RpeIncrement,
    string PreviewHash,
    uint MesocycleVersion);

public sealed record ProgressionPreviewView(
    string PreviewHash,
    string TransformKey,
    string TransformVersion,
    int ResultingWeekCount,
    DateOnly ResultingEndDateExclusive,
    bool IsInsideTrainingCoverage,
    string? CoverageMessage,
    IReadOnlyList<TrainingWeekView> GeneratedWeeks);

public sealed record ClientTrainingDayResult(
    bool IsAllowed,
    string AccessReason,
    DateOnly LocalDate,
    IReadOnlyList<ClientWorkoutView> Workouts);

public sealed record ClientWorkoutView(
    Guid SessionId,
    Guid MesocycleId,
    Guid? WorkoutExecutionId,
    string Name,
    string? CoachNotes,
    WorkoutExecutionStatus? Status,
    IReadOnlyList<ClientExerciseView> Exercises,
    IReadOnlyList<WorkoutNoteView> Notes,
    uint? ExecutionVersion);

public sealed record ClientExerciseView(
    Guid PrescriptionId,
    Guid? PerformanceId,
    Guid PrescribedExerciseId,
    string PrescribedExerciseName,
    Guid ActualExerciseId,
    string ActualExerciseName,
    bool WasSubstituted,
    PrescriptionModificationPolicy ModificationPolicy,
    IReadOnlyList<ExerciseAlternativeOptionView> Alternatives,
    string? CoachNotes,
    IReadOnlyList<Guid> MediaAssetIds,
    PreviousExercisePerformanceView? PreviousPerformance,
    IReadOnlyList<ClientSetView> Sets);

public sealed record ExerciseAlternativeOptionView(Guid ExerciseId, string Name);

public sealed record ClientSetView(
    Guid PrescriptionId,
    Guid? PerformanceId,
    int Position,
    TrainingSetType SetType,
    int? PrescribedRepetitionsMinimum,
    int? PrescribedRepetitionsMaximum,
    decimal? PrescribedLoad,
    TrainingLoadUnit? PrescribedLoadUnit,
    decimal? PrescribedTargetRpe,
    decimal? PrescribedTargetRir,
    int? RestSeconds,
    string? Tempo,
    int? ActualRepetitions,
    decimal? ActualLoad,
    TrainingLoadUnit? ActualLoadUnit,
    decimal? ActualRpe,
    decimal? ActualRir,
    bool IsCompleted,
    string? ClientNote);

public sealed record PreviousExercisePerformanceView(
    DateOnly Date,
    decimal? BestLoad,
    TrainingLoadUnit? Unit,
    int? Repetitions,
    decimal? Rpe);

public sealed record WorkoutExecutionView(
    Guid Id,
    WorkoutExecutionStatus Status,
    DateTimeOffset StartedAtUtc,
    DateTimeOffset? CompletedAtUtc,
    uint Version);

public sealed record WorkoutSetSaveView(
    Guid WorkoutExecutionId,
    uint ExecutionVersion,
    Guid SetPerformanceId,
    int? ActualRepetitions,
    decimal? ActualLoad,
    TrainingLoadUnit? ActualLoadUnit,
    decimal? ActualRpe,
    decimal? ActualRir,
    bool IsCompleted,
    string? ClientNote);

public sealed record RecordSetActualRequest(
    int? Repetitions,
    decimal? Load,
    TrainingLoadUnit? LoadUnit,
    decimal? Rpe,
    decimal? Rir,
    bool IsCompleted,
    string? ClientNote,
    uint Version);

public sealed record SubstituteExerciseRequest(Guid ExerciseId, uint Version);

public sealed record CompleteWorkoutRequest(uint Version);

public sealed record AddWorkoutNoteRequest(Guid? ExercisePerformanceId, string Text);

public sealed record WorkoutNoteView(
    Guid Id,
    Guid? ExercisePerformanceId,
    Guid AuthorUserId,
    WorkoutNoteAuthorRole AuthorRole,
    string Text,
    DateTimeOffset CreatedAtUtc);

public sealed record ExerciseHistoryItem(
    Guid WorkoutExecutionId,
    DateOnly Date,
    Guid PrescribedExerciseId,
    Guid ActualExerciseId,
    bool WasSubstituted,
    int? Repetitions,
    decimal? Load,
    TrainingLoadUnit? LoadUnit,
    decimal? Rpe,
    decimal? Rir,
    decimal? EstimatedOneRepMax,
    decimal? Volume,
    string? Note);

public sealed record ExerciseHistoryPage(
    int Total,
    int Skip,
    int Take,
    IReadOnlyList<ExerciseHistoryItem> Items);

public sealed record TrainingCommandResult(
    TrainingCommandStatus Status,
    ProgramTemplateVersionView? TemplateVersion = null,
    TrainingMesocycleView? Mesocycle = null,
    SavedSessionView? SavedSession = null,
    WorkoutExecutionView? WorkoutExecution = null,
    WorkoutSetSaveView? SetSave = null,
    IReadOnlyDictionary<string, string[]>? Errors = null,
    string? Code = null,
    string? Message = null);

public enum TrainingCommandStatus
{
    Success = 1,
    NotFound = 2,
    Forbidden = 3,
    Invalid = 4,
    Conflict = 5,
}

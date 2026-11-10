namespace TB.Gym.Modules.Training;

public interface ITrainingApplicationService
{
    Task<ProgramTemplatePage> ListTemplatesAsync(
        int skip,
        int take,
        CancellationToken cancellationToken);

    /// <summary>One program with its versions, newest first, as the list shows it; null when absent.</summary>
    Task<ProgramTemplateSummary?> GetTemplateAsync(
        Guid templateId,
        CancellationToken cancellationToken);

    Task<ProgramTemplateVersionView?> GetTemplateVersionAsync(
        Guid templateVersionId,
        CancellationToken cancellationToken);

    /// <summary>
    /// A program and its version 1 in one step, for the demo workspace generator. No route calls it:
    /// people make programs by publishing a draft (TRN-024, audit INV-12).
    /// </summary>
    Task<TrainingCommandResult> CreateTemplateAsync(
        SaveProgramTemplateRequest request,
        CancellationToken cancellationToken);

    /// <summary>The caller's own program drafts in this workspace, newest change first (TRN-024).</summary>
    Task<IReadOnlyList<ProgramDraftSummary>> ListProgramDraftsAsync(CancellationToken cancellationToken);

    /// <summary>One of the caller's own drafts with its content; null for anyone else's or none.</summary>
    Task<ProgramDraftView?> GetProgramDraftAsync(Guid draftId, CancellationToken cancellationToken);

    Task<TrainingCommandResult> CreateProgramDraftAsync(
        CreateProgramDraftRequest request,
        CancellationToken cancellationToken);

    Task<TrainingCommandResult> SaveProgramDraftAsync(
        Guid draftId,
        SaveProgramDraftRequest request,
        CancellationToken cancellationToken);

    Task<TrainingCommandResult> DiscardProgramDraftAsync(
        Guid draftId,
        DiscardProgramDraftRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// Checks the draft as any save is checked, creates the program's next version (or the program
    /// and its first version) published, and removes the draft, in one transaction.
    /// </summary>
    Task<TrainingCommandResult> PublishProgramDraftAsync(
        Guid draftId,
        PublishProgramDraftRequest request,
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

    /// <summary>"Can see finished programs" (TRN-031): the coach's choice for one client, on by default.</summary>
    Task<TrainingCommandResult> SetFinishedProgramsVisibilityAsync(
        Guid clientProfileId,
        SetFinishedProgramsVisibilityRequest request,
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

    /// <summary>
    /// The builder's "Duplicate with progression" (TRN-025): the copies of one week the coach would
    /// add, calculated but not saved. Nothing is persisted; the coach adds the weeks to their own
    /// draft after reading them, and Publish checks them like any save.
    /// </summary>
    Task<WeekProgressionPreviewView> PreviewWeekProgressionAsync(
        PreviewWeekProgressionRequest request,
        CancellationToken cancellationToken);

    Task<ProgressionPreviewView?> PreviewProgressionAsync(
        Guid mesocycleId,
        ProgressionPreviewRequest request,
        CancellationToken cancellationToken);

    Task<TrainingCommandResult> ApplyProgressionAsync(
        Guid mesocycleId,
        ApplyProgressionRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// What editing a client's weeks in the builder's grid would do (TRN-028): the sessions and weeks added,
    /// edited, moved or removed, every new weight, and whether the result stays inside the plan. Nothing is
    /// saved. Throws <see cref="ArgumentException"/> for a grid the rule refuses and
    /// <see cref="InvalidOperationException"/> when the program changed after the version the request carries.
    /// </summary>
    Task<ProgramEditPreviewView?> PreviewProgramEditAsync(
        Guid mesocycleId,
        PreviewProgramEditRequest request,
        CancellationToken cancellationToken);

    Task<TrainingCommandResult> ApplyProgramEditAsync(
        Guid mesocycleId,
        ApplyProgramEditRequest request,
        CancellationToken cancellationToken);

    /// <summary>A program's training maxes, the one in use for each lift and the ones before it (STR-002).</summary>
    Task<TrainingMaxesView?> GetTrainingMaxesAsync(Guid mesocycleId, CancellationToken cancellationToken);

    /// <summary>
    /// What updating the maxes would change, calculated and not saved (STR-002, STR-009). Throws
    /// <see cref="ArgumentException"/> for a request that is wrong and <see cref="InvalidOperationException"/>
    /// when the program changed after the version the request carries.
    /// </summary>
    Task<TrainingMaxesPreviewView?> PreviewTrainingMaxesAsync(
        Guid mesocycleId,
        PreviewTrainingMaxesRequest request,
        CancellationToken cancellationToken);

    Task<TrainingCommandResult> ApplyTrainingMaxesAsync(
        Guid mesocycleId,
        ApplyTrainingMaxesRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// The maxes the client's latest program uses now, for the next program to start from (STR-014). Null for a
    /// client who is missing or another coach's (ADR 0026).
    /// </summary>
    Task<PreviousProgramMaxesView?> GetPreviousProgramMaxesAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken);

    Task<TrainingCommandResult> RenameMesocycleAsync(
        Guid mesocycleId,
        RenameMesocycleRequest request,
        CancellationToken cancellationToken);

    Task<ExerciseHistoryPage?> GetExerciseHistoryAsync(
        Guid clientProfileId,
        Guid exerciseId,
        int skip,
        int take,
        CancellationToken cancellationToken);

    Task<ClientTrainingDayResult> GetTodayAsync(CancellationToken cancellationToken);

    Task<ClientTrainingWeekView> GetMyWeekAsync(CancellationToken cancellationToken);

    Task<ClientPersonalRecordsResult> GetMyPersonalRecordsAsync(CancellationToken cancellationToken);

    /// <summary>
    /// A client's personal records for their coach (R3.3b), by the same rule as their own read
    /// (TRN-019). Null when the client is not in this workspace.
    /// </summary>
    Task<ClientPersonalRecordsResult?> GetClientPersonalRecordsAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken);

    Task<ClientTrainingProgramView> GetMyProgramAsync(CancellationToken cancellationToken);

    /// <summary>
    /// A client's programs for their coach (R3.4a): every block with its weeks, shared or not, and the
    /// state of each session by the client's own rule (TRN-020). Null when the client is not in this
    /// workspace.
    /// </summary>
    Task<CoachClientProgramView?> GetClientProgramAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken);

    /// <summary>
    /// Applies the weights where the client's lifts stand names (notes plan N6c, STR-020): for each lift, the sets
    /// <c>LastTimeStep</c> v1 moves in its coming session, exactly as the coach read them, else a conflict that asks
    /// for a fresh read. One request per client, a lift or "Apply all"; the coach applies, never the app or the client.
    /// </summary>
    Task<TrainingCommandResult> ApplyLiftWeightsAsync(
        Guid clientProfileId,
        ApplyLiftWeightsRequest request,
        CancellationToken cancellationToken);

    Task<ClientWorkoutHistoryPage> GetMyWorkoutHistoryAsync(int skip, CancellationToken cancellationToken);

    /// <summary>
    /// One of the signed-in client's finished programs, for their share card (R6.1a, TRN-030). Null when
    /// it is not theirs in this workspace, not finished yet, or cancelled.
    /// </summary>
    Task<ClientProgramSummaryResult?> GetMyProgramSummaryAsync(
        Guid programId,
        CancellationToken cancellationToken);

    Task<ClientTrainingUpcomingView> GetUpcomingAsync(int skip, CancellationToken cancellationToken);

    Task<CoachWorkoutDetailResult?> GetCoachWorkoutAsync(
        Guid clientProfileId,
        Guid workoutExecutionId,
        int notesSkip,
        CancellationToken cancellationToken);

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

/// <param name="Draft">The caller's own unpublished changes to this program, if any (TRN-024).</param>
public sealed record ProgramTemplateSummary(
    Guid Id,
    string Name,
    int CurrentVersionNumber,
    bool IsArchived,
    uint Version,
    IReadOnlyList<ProgramTemplateVersionSummary> Versions,
    ProgramDraftSummary? Draft = null);

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

/// <summary>
/// A version's content as publishing a draft, and the demo workspace generator, hand it to the checks
/// every version passes (TRN-005). No route accepts it since the direct template writes went (audit INV-12).
/// </summary>
public sealed record SaveProgramTemplateRequest(
    string Name,
    string? Description,
    bool Publish,
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

/// <param name="LoadStep">
/// A last time + step set's step, in the set's unit (N6a); ignored on any other set. Not the week copies'
/// weight a week, <see cref="ProgressionPreviewRequest.LoadStep"/>.
/// </param>
public sealed record SetPrescriptionRequest(
    int Position,
    TrainingSetType SetType,
    int? RepetitionsMinimum,
    int? RepetitionsMaximum,
    TrainingLoadStrategy LoadStrategy,
    decimal? DirectLoad,
    TrainingLoadUnit? LoadUnit,
    decimal? PercentageWorkingMax,
    decimal? LoadStep,
    decimal? TargetRpe,
    decimal? TargetRir,
    ExertionDisplayPreference ExertionDisplayPreference,
    int? RestSeconds,
    string? Tempo,
    string? CoachNotes,
    decimal? ManualLoadOverride = null);

/// <summary>
/// The builder's program as it stands mid-edit (TRN-024): the shape of a save, whose values are
/// checked only when it is published.
/// </summary>
public sealed record ProgramDraftContent(
    string Name,
    string? Description,
    IReadOnlyList<TrainingWeekRequest> Weeks);

/// <param name="TemplateId">The program it changes; null for a new program.</param>
/// <param name="SourceVersionId">The version the builder opened; null for a new program.</param>
/// <param name="TemplateVersionNumber">The program's newest version number when the builder read it.</param>
public sealed record CreateProgramDraftRequest(
    Guid? TemplateId,
    Guid? SourceVersionId,
    int? TemplateVersionNumber,
    ProgramDraftContent Content);

public sealed record SaveProgramDraftRequest(ProgramDraftContent Content, uint Version);

public sealed record DiscardProgramDraftRequest(uint Version);

/// <param name="ReplaceNewer">
/// Publish even though someone published a version after this draft began; theirs stays in the
/// program's versions.
/// </param>
public sealed record PublishProgramDraftRequest(uint Version, bool ReplaceNewer);

public sealed record ProgramDraftSummary(
    Guid Id,
    Guid? TemplateId,
    string Name,
    int WeekCount,
    DateTimeOffset UpdatedAtUtc);

/// <param name="Exercises">Every exercise the content names, archived ones included, for its names.</param>
public sealed record ProgramDraftView(
    Guid Id,
    Guid? TemplateId,
    Guid? SourceVersionId,
    int StartedAtVersionNumber,
    DateTimeOffset UpdatedAtUtc,
    uint Version,
    ProgramDraftContent Content,
    IReadOnlyList<ProgramDraftExerciseView> Exercises);

public sealed record ProgramDraftExerciseView(Guid Id, string Name, bool IsArchived);

/// <summary>What a draft save answers: small, since the builder already holds the content.</summary>
public sealed record ProgramDraftSaveView(Guid Id, DateTimeOffset UpdatedAtUtc, uint Version);

public static class ProgramDraftConflictCodes
{
    /// <summary>The caller already has a draft of this program, made in another tab or device.</summary>
    public const string AlreadyExists = "program_draft_exists";

    public const string LimitReached = "program_draft_limit";

    /// <summary>The draft was changed or removed in another tab or device since this one read it.</summary>
    public const string Stale = "program_draft_stale";

    /// <summary>Someone published a version of the program after this draft began.</summary>
    public const string NewerVersionPublished = "newer_version_published";
}

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

/// <param name="Name">The program's name for this client; the template's own name when left out (TRN-002).</param>
/// <param name="RevealAllWeeks">
/// "The client sees it: Now": every shared week is read now, before the program's first day once a paid plan
/// covers its dates (TRN-023). Left out, weeks open from their first day.
/// </param>
public sealed record AssignMesocycleRequest(
    Guid EnrollmentId,
    Guid TemplateVersionId,
    DateOnly StartDate,
    MesocycleKind Kind,
    TrainingLoadUnit LoadUnit,
    decimal LoadIncrement,
    TrainingLoadRoundingMode LoadRoundingMode,
    IReadOnlyList<WorkingMaxSelectionRequest> WorkingMaxes,
    Guid IdempotencyKey,
    string? Name = null,
    bool RevealAllWeeks = false);

/// <summary>
/// The training max for one exercise: a number the coach typed or picked from the client's saved maxes
/// (<paramref name="Value"/>), or the weight of week 1's working set, from which the server works the max out on
/// the RTS chart (<paramref name="WeekOneWeight"/>, STR-011). Exactly one of the two is given. A
/// <paramref name="Value"/> may name the latest program's max it carries over (<paramref name="CarriedFromMaxId"/>,
/// STR-014), and must then equal it.
/// </summary>
public sealed record WorkingMaxSelectionRequest(
    Guid ExerciseId,
    Guid? StrengthMaxRecordId,
    decimal? Value,
    TrainingLoadUnit Unit,
    decimal? WeekOneWeight = null,
    Guid? CarriedFromMaxId = null);

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
    uint Version,
    IReadOnlyList<LiftStandingView>? LiftStandings = null);

/// <summary>
/// Where one writing of a lift with "Last time + step" sets stands for its coming session (<c>LastTimeStep</c> v1,
/// STR-019, notes plan N6b): the coach's reads alone carry it, and only while the read is open (TRN-023).
/// <c>SessionId</c> is the lift's coming session, the earliest one not started and not before today in an open
/// block that writes it with a step; <c>Occurrence</c> says which writing of the lift there it is (the first by
/// position is 1); <c>ExertionDisplay</c> is how the coach wrote the set's effort, RPE or RIR.
/// </summary>
public sealed record LiftStandingView(
    string RuleKey,
    int RuleVersion,
    Guid MesocycleId,
    Guid SessionId,
    string SessionName,
    DateOnly SessionDate,
    Guid ExercisePrescriptionId,
    Guid ExerciseId,
    string ExerciseName,
    int Occurrence,
    ExertionDisplayPreference ExertionDisplay,
    LiftStanding Standing);

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
    string Reason,
    TrainingMaxSource Source);

/// <summary>Where a training max came from; the Strength module's source, in this module's words.</summary>
public enum TrainingMaxSource
{
    Typed = 1,
    SavedMax = 2,
    WeekOneWeight = 3,
    LoggedSet = 4,
    PreviousProgram = 5,
}

/// <summary>
/// The set, weight and method a max was worked out from: week 1's prescribed set, or a set the client logged
/// (<paramref name="LoggedSet"/> then says which and when).
/// </summary>
public sealed record TrainingMaxBasisView(
    decimal Load,
    int Repetitions,
    decimal Rpe,
    string MethodKey,
    string MethodVersion,
    TrainingMaxLoggedSetView? LoggedSet);

/// <summary>Where a logged set behind a max sits: its program week, the day the workout was finished and the session.</summary>
public sealed record TrainingMaxLoggedSetView(
    Guid SetPerformanceId,
    int WeekNumber,
    DateOnly PerformedOn,
    string SessionName);

/// <summary>One training max as it was set: its value, source, the week it applies from and why.</summary>
public sealed record TrainingMaxEntryView(
    Guid Id,
    decimal Value,
    TrainingLoadUnit Unit,
    TrainingMaxSource Source,
    TrainingMaxBasisView? Basis,
    int EffectiveFromWeek,
    DateOnly SetOn,
    string Reason);

/// <summary>The set of week 1 that "from week 1's weight" would read for a lift, and the weight it has now.</summary>
public sealed record TrainingMaxWeekOneSetView(int Repetitions, decimal Rpe, decimal? Load);

/// <summary>One lift's training max in use, the week 1 set it could be worked out from, and its earlier values.</summary>
public sealed record TrainingMaxView(
    Guid ExerciseId,
    string ExerciseName,
    TrainingMaxEntryView Current,
    TrainingMaxWeekOneSetView? WeekOneSet,
    IReadOnlyList<TrainingMaxEntryView> Earlier);

/// <summary>
/// The client's latest program (not cancelled) and the max each of its lifts uses now, so a new program can start
/// where it ended (STR-014). Empty, with no program, when the client has none. Values stay in that program's unit;
/// a new program in the other unit starts without them.
/// </summary>
public sealed record PreviousProgramMaxesView(
    Guid? MesocycleId,
    string? ProgramName,
    DateOnly? LastDay,
    TrainingLoadUnit? LoadUnit,
    IReadOnlyList<PreviousProgramMaxView> Maxes);

/// <param name="MaxId">The max in use, which an assignment names to carry it over.</param>
/// <param name="SetOn">The workspace day that max was set.</param>
public sealed record PreviousProgramMaxView(
    Guid ExerciseId,
    string ExerciseName,
    Guid MaxId,
    decimal Value,
    TrainingLoadUnit Unit,
    DateOnly SetOn);

/// <param name="LoadIncrement">The program's rounding step (STR-008), the step its calculated weights are rounded to.</param>
/// <param name="IsClosed">True once the program is finished or cancelled; its maxes are then history.</param>
public sealed record TrainingMaxesView(
    Guid MesocycleId,
    uint Version,
    TrainingLoadUnit LoadUnit,
    decimal LoadIncrement,
    bool IsClosed,
    IReadOnlyList<TrainingMaxView> Maxes);

/// <summary>
/// One lift's new max: a typed number, or the weight of week 1's set to work it out from (STR-011). Exactly one
/// of the two is given.
/// </summary>
public sealed record TrainingMaxChangeRequest(Guid ExerciseId, decimal? Value, decimal? WeekOneWeight);

public sealed record PreviewTrainingMaxesRequest(
    uint MesocycleVersion,
    IReadOnlyList<TrainingMaxChangeRequest> Changes);

/// <param name="Reason">Why, in the coach's words; recorded with the new maxes. Optional.</param>
public sealed record ApplyTrainingMaxesRequest(
    uint MesocycleVersion,
    IReadOnlyList<TrainingMaxChangeRequest> Changes,
    string? Reason,
    string PreviewHash,
    Guid IdempotencyKey);

public sealed record RenameMesocycleRequest(string Name, uint Version);

public sealed record TrainingMaxLiftChangeView(
    Guid ExerciseId,
    string ExerciseName,
    decimal PreviousValue,
    decimal NewValue,
    TrainingLoadUnit Unit,
    TrainingMaxSource Source,
    TrainingMaxBasisView? Basis,
    string Explanation);

public sealed record TrainingMaxSetChangeView(
    Guid SetId,
    int WeekNumber,
    DateOnly ScheduledDate,
    Guid SessionId,
    string SessionName,
    Guid ExerciseId,
    string ExerciseName,
    int SetPosition,
    int? Repetitions,
    decimal? TargetRpe,
    decimal? PercentageWorkingMax,
    decimal? PreviousLoad,
    decimal NewLoad,
    string Explanation);

/// <summary>
/// What updating a program's training maxes would do. <paramref name="Sets"/> lists the sets whose weight
/// changes, in the order they come up; sets only re-pointed to the new max with the same weight are counted,
/// and sessions that are started or in the past are left as they were (TRN-004).
/// </summary>
public sealed record TrainingMaxesPreviewView(
    string PreviewHash,
    TrainingLoadUnit LoadUnit,
    int EffectiveFromWeek,
    IReadOnlyList<TrainingMaxLiftChangeView> Lifts,
    IReadOnlyList<TrainingMaxSetChangeView> Sets,
    int ChangedSetCount,
    int UnchangedSetCount,
    int SessionCount,
    int KeptSessionCount);

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

/// <param name="MediaAssetIds">
/// The exercise's demo media as the client was given it (MED-002), in display order; empty for a program
/// template, whose media is the library's.
/// </param>
public sealed record ExercisePrescriptionView(
    Guid Id,
    Guid ExerciseId,
    string ExerciseName,
    int Position,
    bool IsMainLift,
    PrescriptionModificationPolicy ModificationPolicy,
    string? CoachNotes,
    IReadOnlyList<Guid> ApprovedAlternativeExerciseIds,
    IReadOnlyList<SetPrescriptionView> Sets,
    IReadOnlyList<Guid> MediaAssetIds);

/// <param name="LoadStep">A last time + step set's step, in the set's unit (N6a); null on every other set.</param>
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
    decimal? LoadStep,
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

/// <summary><c>Version</c> is the one the coach's program read gave: 0 until a coach has first chosen.</summary>
public sealed record SetFinishedProgramsVisibilityRequest(bool CanSeeFinishedPrograms, uint Version);

/// <summary>"Can see finished programs" for one client (TRN-031), and the version a change sends back.</summary>
public sealed record FinishedProgramsVisibilityView(bool CanSeeFinishedPrograms, uint Version);

public sealed record SetWeekPublishedRequest(bool IsPublished, uint Version);

public sealed record RescheduleMesocycleRequest(DateOnly StartDate, uint Version);

public sealed record CancelMesocycleRequest(string Reason, uint Version);

public sealed record CompleteMesocycleRequest(uint Version);

public sealed record ReplaceTrainingSessionRequest(TrainingSessionRequest Session, uint Version);

/// <param name="SourceWeek">The week as the builder holds it, values as typed.</param>
/// <param name="Copies">1 to 12 copies, each moved a further step from the source.</param>
/// <param name="WeeksInProgram">How many weeks the program has now, so the 52-week limit is checked.</param>
public sealed record PreviewWeekProgressionRequest(
    TrainingWeekRequest SourceWeek,
    int Copies,
    WeekProgressionSteps Steps,
    int WeeksInProgram);

public sealed record WeekProgressionPreviewView(
    string TransformKey,
    string TransformVersion,
    IReadOnlyList<TrainingWeekRequest> Weeks);

/// <summary>
/// Build next block (STR-006, TRN-025): <paramref name="Iterations"/> copies of each chosen week, each a
/// further step from its source. The four steps are WeekStep v1's; <paramref name="RpeIncrement"/> is the
/// RPE step, kept under its first name, and the others may be left out (no change).
/// </summary>
public sealed record ProgressionPreviewRequest(
    IReadOnlyList<Guid> SourceWeekIds,
    int Iterations,
    decimal RpeIncrement,
    uint MesocycleVersion,
    int RepetitionsStep = 0,
    decimal PercentageStep = 0m,
    decimal LoadStep = 0m)
{
    public WeekProgressionSteps ToSteps() => new(RpeIncrement, RepetitionsStep, PercentageStep, LoadStep);
}

public sealed record ApplyProgressionRequest(
    IReadOnlyList<Guid> SourceWeekIds,
    int Iterations,
    decimal RpeIncrement,
    string PreviewHash,
    uint MesocycleVersion,
    int RepetitionsStep = 0,
    decimal PercentageStep = 0m,
    decimal LoadStep = 0m)
{
    public WeekProgressionSteps ToSteps() => new(RpeIncrement, RepetitionsStep, PercentageStep, LoadStep);
}

/// <param name="OverlapMessage">
/// Set when the new weeks would run into another of the client's programs (TRN-011): it names that program and
/// how many new weeks fit before it. Apply refuses such weeks, as it refuses weeks outside the coverage.
/// </param>
public sealed record ProgressionPreviewView(
    string PreviewHash,
    string TransformKey,
    string TransformVersion,
    int ResultingWeekCount,
    DateOnly ResultingEndDateExclusive,
    bool IsInsideTrainingCoverage,
    string? CoverageMessage,
    string? OverlapMessage,
    IReadOnlyList<TrainingWeekView> GeneratedWeeks);

/// <summary>
/// One session as the grid sends it when a client's weeks are edited (TRN-028). Only sessions that are still
/// open are sent; the others are never touched.
/// </summary>
/// <param name="SessionId">The stored session this one is; null for a session added in the grid.</param>
public sealed record ProgramEditSessionRequest(Guid? SessionId, TrainingSessionRequest Session);

/// <param name="WeekId">The stored week this one is; null for a week added in the grid.</param>
public sealed record ProgramEditWeekRequest(
    Guid? WeekId,
    string? Label,
    bool IsPublished,
    IReadOnlyList<ProgramEditSessionRequest> Sessions);

/// <summary>The program's weeks as the coach wants them, with the version they were read at.</summary>
public sealed record PreviewProgramEditRequest(uint MesocycleVersion, IReadOnlyList<ProgramEditWeekRequest> Weeks);

public sealed record ApplyProgramEditRequest(
    uint MesocycleVersion,
    IReadOnlyList<ProgramEditWeekRequest> Weeks,
    string PreviewHash);

/// <param name="WeekNumber">Where the session lands (where it was, for a removed one).</param>
/// <param name="PreviousWeekNumber">Where an edited or moved session was, when its date changes.</param>
/// <param name="WeekIsShared">Whether the client sees that week; an unshared week reaches nobody.</param>
/// <param name="After">The session as it will be, weights worked out; null for a removed or moved-only session.</param>
public sealed record ProgramEditSessionChangeView(
    ProgramEditChangeKind Kind,
    Guid? SessionId,
    int WeekNumber,
    DateOnly Date,
    int? PreviousWeekNumber,
    DateOnly? PreviousDate,
    string Name,
    bool WeekIsShared,
    TrainingSessionView? After);

public sealed record ProgramEditWeekChangeView(
    ProgramEditChangeKind Kind,
    int WeekNumber,
    int? PreviousWeekNumber,
    string? Label,
    bool IsShared);

/// <summary>
/// What an edit would do (TRN-028). <paramref name="Problems"/> are reasons it cannot be applied, in plain
/// words: the result leaving the plan, or colliding with another program of the client.
/// </summary>
public sealed record ProgramEditPreviewView(
    string PreviewHash,
    string RuleKey,
    string RuleVersion,
    DateOnly Today,
    int FrozenWeekCount,
    int ResultingWeekCount,
    DateOnly CurrentEndDateExclusive,
    DateOnly ResultingEndDateExclusive,
    bool IsInsideTrainingCoverage,
    IReadOnlyList<string> Problems,
    int WeeksAdded,
    int WeeksMoved,
    int WeeksRemoved,
    int SessionsAdded,
    int SessionsEdited,
    int SessionsMoved,
    int SessionsRemoved,
    IReadOnlyList<ProgramEditWeekChangeView> WeekChanges,
    IReadOnlyList<ProgramEditSessionChangeView> SessionChanges);

public sealed record ClientTrainingDayResult(
    bool IsAllowed,
    string AccessReason,
    DateOnly LocalDate,
    IReadOnlyList<ClientWorkoutView> Workouts);

public sealed record ClientTrainingWeekView(
    bool IsAllowed,
    string AccessReason,
    DateOnly LocalDate,
    DateOnly WeekStart,
    IReadOnlyList<ClientTrainingWeekDayView> Days);

public sealed record ClientTrainingWeekDayView(DateOnly Date, int Scheduled, int Completed);

public sealed record ClientTrainingUpcomingView(
    bool IsAllowed,
    string AccessReason,
    DateOnly LocalDate,
    string TimeZoneId,
    bool HasAssignedProgram,
    bool HasVisibleSessions,
    DateOnly SearchThrough,
    UpcomingTrainingSessionView? NextSession,
    IReadOnlyList<DatedWorkoutView> UnfinishedWorkouts,
    int? NextSkip,
    TodayTrainingCoverageView? TodayCoverage);

public sealed record UpcomingTrainingSessionView(Guid SessionId, DateOnly Date, string Name);

/// <summary>
/// Which block, if any, covers the workspace's today, so the client's Today can tell a rest day from
/// a week that is not shared yet and from a gap between blocks. Null when training is not allowed.
/// </summary>
public sealed record TodayTrainingCoverageView(ActiveTrainingBlockView? ActiveBlock, DateOnly? NextBlockStartDate);

public sealed record ActiveTrainingBlockView(
    Guid Id,
    string Name,
    int WeekNumber,
    int WeekCount,
    bool IsCurrentWeekPublished);

public sealed record DatedWorkoutView(DateOnly Date, string TimeZoneId, ClientWorkoutView Workout, bool HasMoreNotes);

/// <param name="LiftStandings">
/// Where each lift done in the workout stands for its coming session (STR-019): the coach's read alone carries it,
/// never the client's (whose reads share <c>DatedWorkoutView</c>), and a closed read none.
/// </param>
public sealed record CoachWorkoutDetailResult(
    bool IsAllowed,
    string AccessReason,
    DatedWorkoutView? Detail,
    int? NextNotesSkip,
    IReadOnlyList<LiftStandingView>? LiftStandings = null);

/// <param name="DurationSeconds">
/// Set once the workout is finished: its finish summary's duration, so a finished workout shows the time it took
/// instead of a clock still counting from its start (audit UIQ-1).
/// </param>
public sealed record ClientWorkoutView(
    Guid SessionId,
    Guid MesocycleId,
    Guid? WorkoutExecutionId,
    string Name,
    string? CoachNotes,
    WorkoutExecutionStatus? Status,
    IReadOnlyList<ClientExerciseView> Exercises,
    IReadOnlyList<WorkoutNoteView> Notes,
    uint? ExecutionVersion,
    DateTimeOffset? StartedAtUtc = null,
    int? DurationSeconds = null);

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
    IReadOnlyList<ClientSetView> Sets,
    ClientWeightNoteView? WeightNote = null);

/// <summary>
/// Why the coach set this lift's weight (notes plan N6c, STR-020): the latest weight a coach applied from where the
/// lift stood, on a workout still to do or running, while every set it set still holds that weight. Only the
/// client's own numbers: who applied it and when stay on the coach's reads.
/// </summary>
/// <param name="Move"><c>StepUp</c> when a set went up by its step; <c>SameAsLastTime</c> when last time's weight was kept.</param>
/// <param name="Increases">Each stepped set's rise over last time, in set order; empty when last time's weight was kept.</param>
/// <param name="LastTimeDay">The day of the workout the rule read as last time, in the program's calendar.</param>
/// <param name="WorkingSets">Last time's working sets of the lift (never its warm-ups).</param>
/// <param name="RepetitionsAsked">The reps each of those sets asked, when they all asked the same.</param>
/// <param name="Reason">Why last time's weight was kept (STR-019's hold); null on a step up.</param>
/// <param name="ExertionDisplay">How the coach wrote the set's effort, RPE or RIR, for a reason that names one.</param>
public sealed record ClientWeightNoteView(
    SetStandingMove Move,
    IReadOnlyList<decimal> Increases,
    TrainingLoadUnit Unit,
    DateOnly LastTimeDay,
    int WorkingSets,
    int? RepetitionsAsked,
    LiftStandingReasonDetail? Reason,
    ExertionDisplayPreference ExertionDisplay);

/// <summary>
/// The weights a coach applies for a client (notes plan N6c, STR-020): per lift, the sets its standing moves, each
/// with the weight it had and the weight it goes to, as the coach's read gave them. The key makes a retry safe.
/// </summary>
public sealed record ApplyLiftWeightsRequest(IReadOnlyList<LiftWeightRequest> Lifts, Guid IdempotencyKey);

/// <param name="ExercisePrescriptionId">The writing of the lift in its coming session (<c>LiftStandingView</c>).</param>
public sealed record LiftWeightRequest(Guid ExercisePrescriptionId, IReadOnlyList<SetWeightRequest> Sets);

/// <param name="CurrentWeight">The set's weight as the coach read it; null when the client picks.</param>
/// <param name="Weight">The weight the standing names for the set.</param>
public sealed record SetWeightRequest(Guid SetPrescriptionId, decimal? CurrentWeight, decimal Weight);

/// <summary>What an apply wrote, lift by lift (the first answer again on a retry with the same key).</summary>
public sealed record LiftWeightsAppliedView(Guid ClientProfileId, IReadOnlyList<AppliedLiftWeightView> Lifts);

public sealed record AppliedLiftWeightView(
    Guid ApplicationId,
    Guid MesocycleId,
    Guid SessionId,
    string SessionName,
    DateOnly SessionDate,
    Guid ExercisePrescriptionId,
    Guid ExerciseId,
    string ExerciseName,
    IReadOnlyList<AppliedLiftSetView> Sets,
    DateTimeOffset AppliedAtUtc);

/// <param name="WeightBefore">The set's weight before; null when the client picked it.</param>
public sealed record AppliedLiftSetView(
    Guid SetPrescriptionId,
    int SetNumber,
    SetStandingMove Move,
    decimal? WeightBefore,
    decimal WeightAfter,
    TrainingLoadUnit Unit,
    decimal Step);

public sealed record ExerciseAlternativeOptionView(Guid ExerciseId, string Name);

/// <param name="LoadStrategy">
/// The set's weight choice; null only for a workout started before N6a, whose snapshot kept no choice.
/// </param>
/// <param name="LoadStep">The set's step, in its unit: present exactly on a "Last time + step" set (N6a).</param>
public sealed record ClientSetView(
    Guid PrescriptionId,
    Guid? PerformanceId,
    int Position,
    TrainingSetType SetType,
    int? PrescribedRepetitionsMinimum,
    int? PrescribedRepetitionsMaximum,
    decimal? PrescribedLoad,
    TrainingLoadUnit? PrescribedLoadUnit,
    TrainingLoadStrategy? LoadStrategy,
    decimal? LoadStep,
    decimal? PrescribedTargetRpe,
    decimal? PrescribedTargetRir,
    int? RestSeconds,
    string? Tempo,
    string? CoachNotes,
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
    decimal? Rpe,
    IReadOnlyList<PreviousSetPerformanceView>? Sets = null);

public sealed record PreviousSetPerformanceView(
    int Position,
    int? Repetitions,
    decimal? Load,
    TrainingLoadUnit? LoadUnit,
    decimal? Rpe);

public sealed record WorkoutPersonalRecordView(
    Guid SetPerformanceId,
    string ExerciseName,
    int Repetitions,
    decimal Load,
    TrainingLoadUnit Unit,
    string RuleKey,
    int RuleVersion);

public sealed record ClientPersonalRecordView(
    Guid ExerciseId,
    string ExerciseName,
    DateOnly Date,
    int Repetitions,
    decimal Load,
    TrainingLoadUnit Unit,
    string RuleKey,
    int RuleVersion);

public sealed record ClientPersonalRecordsResult(
    bool IsAllowed,
    string AccessReason,
    IReadOnlyList<ClientPersonalRecordView> Items);

/// <summary>
/// The client's Training page (R2.5b): the program it describes (the one covering today, else the
/// next, else the last one finished while the coach lets them see it, TRN-031) and, separately, the
/// start of a later program. With training closed today (<c>IsAllowed</c> false) <c>Program</c> is empty
/// unless the coach shows a program before its first day (TRN-023). <c>NextProgram</c> is a program shown
/// early that <c>Program</c> is not.
/// </summary>
public sealed record ClientTrainingProgramView(
    bool IsAllowed,
    string AccessReason,
    DateOnly LocalDate,
    ClientProgramView? Program,
    DateOnly? NextProgramStartDate,
    string SessionStateRuleKey,
    int SessionStateRuleVersion,
    ClientProgramView? NextProgram);

public enum ClientProgramPhase
{
    Upcoming = 1,
    Current = 2,
    Finished = 3,
}

/// <summary>Counts cover only the weeks the client can see.</summary>
public sealed record ClientProgramView(
    Guid Id,
    string Name,
    DateOnly StartDate,
    DateOnly EndDateExclusive,
    ClientProgramPhase Phase,
    int WeekCount,
    int? CurrentWeekNumber,
    int SessionCount,
    int CompletedCount,
    int MissedCount,
    IReadOnlyList<ClientProgramWeekView> Weeks);

/// <summary>
/// A week the client cannot see yet (TRN-006) carries no sessions: <c>IsShared</c> says whether the
/// coach has shared it, and a shared week opens on its <c>StartDate</c>.
/// </summary>
public sealed record ClientProgramWeekView(
    int WeekNumber,
    DateOnly StartDate,
    bool IsVisible,
    bool IsShared,
    IReadOnlyList<ClientProgramSessionView> Sessions);

/// <param name="StartedOn">The day the session's workout was started, in the program's time zone; null before.</param>
/// <param name="IsLate">The workout was started on a day after the session's own (TRN-020 v2, "Do it now").</param>
public sealed record ClientProgramSessionView(
    Guid SessionId,
    string Name,
    DateOnly ScheduledDate,
    ClientSessionState State,
    Guid? WorkoutExecutionId,
    int ExerciseCount,
    int SetCount,
    DateOnly? StartedOn = null,
    bool IsLate = false);

/// <summary>
/// A client's programs as their coach reads them (R3.4a, TRN-022): the newest blocks first, each with
/// every week, shared or not, and the state of each session. A closed feature carries its reason and
/// no blocks, never an empty list, and no <c>FinishedPrograms</c>: that choice opens with the read (TRN-031).
/// <c>LiftStandings</c> says where each lift with a step stands for its coming session (STR-019); a closed read
/// carries none.
/// </summary>
public sealed record CoachClientProgramView(
    bool IsAllowed,
    string AccessReason,
    DateOnly LocalDate,
    IReadOnlyList<CoachProgramBlockView> Blocks,
    string SessionStateRuleKey,
    int SessionStateRuleVersion,
    FinishedProgramsVisibilityView? FinishedPrograms,
    IReadOnlyList<LiftStandingView>? LiftStandings = null);

/// <summary>
/// Counts cover every session of the block, shared or not. <c>CurrentWeekNumber</c> is set only while
/// the block is running; an active block past its last day (a missed session keeps it from closing)
/// has none. <c>Version</c> is the concurrency token the block's changes (share a week, reschedule,
/// complete, cancel, add weeks) must send back. <c>Lifecycle</c> is the block's audited history, oldest
/// first: assigned, renamed, cancelled with the coach's reason, completed (audit LOST-6).
/// <c>IsShownEarly</c> says the client reads it now, before its first day (TRN-023): the coach chose Now
/// (<c>RevealAllWeeks</c>) and a paid plan covers its dates.
/// </summary>
public sealed record CoachProgramBlockView(
    Guid Id,
    Guid EnrollmentId,
    string Name,
    DateOnly StartDate,
    DateOnly EndDateExclusive,
    MesocycleStatus Status,
    bool RevealAllWeeks,
    uint Version,
    int WeekCount,
    int? CurrentWeekNumber,
    int SessionCount,
    int CompletedCount,
    int MissedCount,
    IReadOnlyList<CoachProgramWeekView> Weeks,
    IReadOnlyList<MesocycleLifecycleEventView> Lifecycle,
    bool IsShownEarly);

/// <summary>
/// <c>IsShared</c> is the coach's choice; <c>IsVisible</c> is what the client can open today (shared
/// and unlocked, or all shared weeks revealed). A shared week the client cannot open yet opens on
/// <c>UnlockDate</c>.
/// </summary>
public sealed record CoachProgramWeekView(
    Guid Id,
    int WeekNumber,
    string? Label,
    DateOnly StartDate,
    bool IsShared,
    bool IsVisible,
    DateOnly UnlockDate,
    IReadOnlyList<CoachProgramSessionView> Sessions);

/// <summary>
/// <c>State</c> is null for a session never started in a week that is not shared, or in a cancelled
/// block: the client could not train it, so it is neither missed nor still to come. <c>StartedOn</c> and
/// <c>IsLate</c> say when its workout was started and whether that was after the session's day, so a
/// coach sees a session done late (TRN-020 v2).
/// </summary>
public sealed record CoachProgramSessionView(
    Guid SessionId,
    string Name,
    DateOnly ScheduledDate,
    ClientSessionState? State,
    Guid? WorkoutExecutionId,
    int ExerciseCount,
    int SetCount,
    DateOnly? StartedOn = null,
    bool IsLate = false);

/// <summary>Finished workouts, newest first, each with the records it set (TRN-019).</summary>
public sealed record ClientWorkoutHistoryPage(
    bool IsAllowed,
    string AccessReason,
    IReadOnlyList<ClientWorkoutHistoryItemView> Items,
    int? NextSkip,
    string PersonalRecordRuleKey,
    int PersonalRecordRuleVersion);

/// <param name="Notes">
/// The notes on the workout, the client's and the coach's, oldest first (TRN-009), so a coach's note on a
/// finished workout reaches the client after its day (P4).
/// </param>
public sealed record ClientWorkoutHistoryItemView(
    Guid WorkoutExecutionId,
    string Name,
    string ProgramName,
    DateOnly Date,
    DateTimeOffset CompletedAtUtc,
    int DurationSeconds,
    int CompletedSetCount,
    int TotalSetCount,
    IReadOnlyList<WorkoutVolumeView> Volume,
    IReadOnlyList<WorkoutPersonalRecordView> PersonalRecords,
    IReadOnlyList<WorkoutNoteView> Notes);

public sealed record WorkoutVolumeView(TrainingLoadUnit Unit, decimal LoadTimesRepetitions);

/// <param name="FinishedProgram">
/// Set only when this workout finished its program, every session done (TRN-013): the program's facts
/// for the client's share card (R6.1a, TRN-030).
/// </param>
public sealed record WorkoutFinishSummaryView(
    int DurationSeconds,
    int CompletedSetCount,
    int TotalSetCount,
    IReadOnlyList<WorkoutVolumeView> Volume,
    IReadOnlyList<WorkoutPersonalRecordView> PersonalRecords,
    ClientProgramSummaryView? FinishedProgram = null);

/// <summary>
/// A finished program as the client's share card tells it (R6.1a, TRN-030). A closed feature carries its
/// reason and no program, never an empty one.
/// </summary>
public sealed record ClientProgramSummaryResult(
    bool IsAllowed,
    string AccessReason,
    ClientProgramSummaryView? Program);

/// <summary>
/// One finished program's facts (TRN-030): its weeks, the workouts the client finished in it, and the
/// personal records those workouts set, each counted as the finish summary and history showed it
/// (TRN-019), so a record beaten twice in the program counts twice.
/// </summary>
public sealed record ClientProgramSummaryView(
    Guid Id,
    string Name,
    DateOnly StartDate,
    DateOnly EndDateExclusive,
    int WeekCount,
    int WorkoutCount,
    int PersonalRecordCount,
    string PersonalRecordRuleKey,
    int PersonalRecordRuleVersion);

public sealed record WorkoutExecutionView(
    Guid Id,
    WorkoutExecutionStatus Status,
    DateTimeOffset StartedAtUtc,
    DateTimeOffset? CompletedAtUtc,
    uint Version,
    WorkoutFinishSummaryView? FinishSummary = null);

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
    string? ClientNote,
    bool IsPersonalRecord = false,
    string PersonalRecordRuleKey = WorkoutPersonalRecordRule.Key,
    int PersonalRecordRuleVersion = WorkoutPersonalRecordRule.Version);

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

/// <param name="EstimateMethodKey">
/// The formula behind <paramref name="EstimatedOneRepMax"/>: <c>RpeChart</c> for a set with an RPE the RTS chart
/// covers, <c>Epley</c> for any other set of 1 to 12 reps with a weight; null with no estimate.
/// </param>
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
    string? EstimateMethodKey,
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
    string? Message = null,
    ProgramDraftSaveView? Draft = null,
    FinishedProgramsVisibilityView? FinishedPrograms = null,
    LiftWeightsAppliedView? LiftWeights = null);

public enum TrainingCommandStatus
{
    Success = 1,
    NotFound = 2,
    Forbidden = 3,
    Invalid = 4,
    Conflict = 5,
}

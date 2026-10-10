using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Notifications;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Queues the training notices (ADR 0036, R5.1c) inside the caller's transaction, so a coach's change
/// and the promise to tell the client about it commit together. All are in-app only; the dispatcher
/// checks each again before it reaches an inbox.
/// </summary>
/// <remarks>
/// A notice about weeks is keyed by the change that caused it, so one change makes one notice.
/// A note's notice is keyed by the note.
/// </remarks>
internal static class TrainingNotices
{
    public static void ProgramAssigned(
        GymDbContext dbContext,
        Guid tenantId,
        string tenantTimeZoneId,
        Guid clientUserId,
        Guid clientProfileId,
        Guid mesocycleId,
        DateTimeOffset now) =>
        WorkspaceRelationshipNotices.ScheduleInApp(
            dbContext,
            tenantId,
            tenantTimeZoneId,
            clientUserId,
            mesocycleId,
            CommercialNotificationKind.ProgramAssigned,
            WorkspaceRelationshipNotices.Payload(new TrainingNotificationPayload(clientProfileId, mesocycleId, [])),
            $"program-assigned:{mesocycleId:N}:v1",
            now);

    /// <summary>Weeks the client can see now and could not before, or could see and that changed.</summary>
    public static void Weeks(
        GymDbContext dbContext,
        Guid tenantId,
        string tenantTimeZoneId,
        Guid clientUserId,
        Guid clientProfileId,
        Guid mesocycleId,
        CommercialNotificationKind kind,
        IReadOnlyList<int> weeks,
        Guid changeId,
        DateTimeOffset now)
    {
        if (kind is not (CommercialNotificationKind.WeeksShared or CommercialNotificationKind.WeeksChanged))
        {
            throw new ArgumentOutOfRangeException(nameof(kind), "Only a week notice names weeks.");
        }

        WorkspaceRelationshipNotices.ScheduleInApp(
            dbContext,
            tenantId,
            tenantTimeZoneId,
            clientUserId,
            mesocycleId,
            kind,
            WorkspaceRelationshipNotices.Payload(new TrainingNotificationPayload(
                clientProfileId,
                mesocycleId,
                weeks.Distinct().Order().ToArray())),
            $"{(kind == CommercialNotificationKind.WeeksShared ? "weeks-shared" : "weeks-changed")}:{changeId:N}:v1",
            now);
    }

    /// <summary>
    /// A note on a workout, to the other side: a coach's note to the client, a client's note to the
    /// coach who has the client. <paramref name="recipientUserId"/> decides which.
    /// </summary>
    public static void WorkoutNote(
        GymDbContext dbContext,
        Guid tenantId,
        string tenantTimeZoneId,
        Guid recipientUserId,
        bool fromCoach,
        Guid clientProfileId,
        Guid mesocycleId,
        Guid sessionId,
        Guid workoutExecutionId,
        Guid noteId,
        DateTimeOffset now) =>
        WorkspaceRelationshipNotices.ScheduleInApp(
            dbContext,
            tenantId,
            tenantTimeZoneId,
            recipientUserId,
            workoutExecutionId,
            fromCoach ? CommercialNotificationKind.CoachWorkoutNote : CommercialNotificationKind.ClientWorkoutNote,
            WorkspaceRelationshipNotices.Payload(new TrainingNotificationPayload(
                clientProfileId,
                mesocycleId,
                [],
                sessionId,
                workoutExecutionId)),
            $"{(fromCoach ? "coach-workout-note" : "client-workout-note")}:{noteId:N}:v1",
            now);
}

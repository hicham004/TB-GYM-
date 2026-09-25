using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Notifications;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Queues the notices a change in a workspace relationship produces (ADR 0027), inside the caller's
/// transaction, so the change and the promise to tell people about it commit together.
/// </summary>
/// <remarks>
/// In-app notices go through the existing notification outbox as in-app-only intents: the dispatcher
/// re-checks them and writes the inbox row, exactly as for a plan reminder. The coach-departure email
/// goes through the workspace notice queue instead, which does not depend on the recipient having
/// opted in to service email and names nothing sensitive.
/// </remarks>
internal static class WorkspaceRelationshipNotices
{
    private static readonly JsonSerializerOptions PayloadJsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// Tells a client, in-app and by one email, that their coach left and the workspace will assign a
    /// new one. <paramref name="coachAssignmentId"/> is the history entry that moved them to the owner.
    /// </summary>
    public static void CoachDeparted(
        GymDbContext dbContext,
        Guid tenantId,
        string tenantTimeZoneId,
        Guid clientUserId,
        Guid clientProfileId,
        Guid coachAssignmentId,
        Guid? actorUserId,
        DateTimeOffset now)
    {
        ScheduleInApp(
            dbContext,
            tenantId,
            tenantTimeZoneId,
            clientUserId,
            coachAssignmentId,
            CommercialNotificationKind.CoachDeparted,
            Payload(new WorkspaceNotificationPayload(clientProfileId)),
            $"coach-departed:{coachAssignmentId:N}:v1",
            now);
        dbContext.WorkspaceNoticeMailRequests.Add(WorkspaceNoticeMailRequest.CoachDeparted(
            tenantId,
            clientUserId,
            coachAssignmentId,
            actorUserId,
            now));
    }

    /// <summary>Tells a staff member, in-app only, that a client left the workspace.</summary>
    public static void ClientLeft(
        GymDbContext dbContext,
        Guid tenantId,
        string tenantTimeZoneId,
        Guid staffUserId,
        Guid clientProfileId,
        DateTimeOffset now) =>
        ScheduleInApp(
            dbContext,
            tenantId,
            tenantTimeZoneId,
            staffUserId,
            clientProfileId,
            CommercialNotificationKind.ClientLeft,
            Payload(new WorkspaceNotificationPayload(clientProfileId)),
            $"client-left:{clientProfileId:N}:{staffUserId:N}:v1",
            now);

    /// <summary>
    /// Tells the owner, in-app only, that a coach resigned and their clients are now the owner's. A
    /// coach who rejoins and resigns again is a new departure, so the key carries its instant.
    /// </summary>
    public static void CoachResigned(
        GymDbContext dbContext,
        Guid tenantId,
        string tenantTimeZoneId,
        Guid ownerUserId,
        Guid coachMembershipId,
        Guid coachUserId,
        DateTimeOffset now) =>
        ScheduleInApp(
            dbContext,
            tenantId,
            tenantTimeZoneId,
            ownerUserId,
            coachMembershipId,
            CommercialNotificationKind.CoachResigned,
            Payload(new CoachNotificationPayload(coachUserId)),
            $"coach-resigned:{coachMembershipId:N}:{now.UtcTicks}:v1",
            now);

    /// <summary>
    /// Tells a client's coach, in-app only, that the client asked to renew (ADR 0029). The payload
    /// holds only the client's id; the dispatcher reads the name when it writes the inbox row.
    /// </summary>
    public static void RenewalRequested(
        GymDbContext dbContext,
        Guid tenantId,
        string tenantTimeZoneId,
        Guid coachUserId,
        Guid clientProfileId,
        Guid renewalRequestId,
        DateTimeOffset now) =>
        ScheduleInApp(
            dbContext,
            tenantId,
            tenantTimeZoneId,
            coachUserId,
            clientProfileId,
            CommercialNotificationKind.RenewalRequested,
            Payload(new WorkspaceNotificationPayload(clientProfileId)),
            $"renewal-requested:{renewalRequestId:N}:v1",
            now);

    public static Task<string> TenantTimeZoneAsync(
        GymDbContext dbContext,
        Guid tenantId,
        CancellationToken cancellationToken) =>
        dbContext.Tenants
            .Where(tenant => tenant.Id == tenantId)
            .Select(tenant => tenant.TimeZoneId)
            .SingleAsync(cancellationToken);

    private static string Payload<TPayload>(TPayload payload) =>
        JsonSerializer.Serialize(payload, PayloadJsonOptions);

    private static void ScheduleInApp(
        GymDbContext dbContext,
        Guid tenantId,
        string tenantTimeZoneId,
        Guid recipientUserId,
        Guid aggregateId,
        CommercialNotificationKind kind,
        string payloadJson,
        string deduplicationKey,
        DateTimeOffset now)
    {
        var item = NotificationOutboxItem.Schedule(
            tenantId,
            recipientUserId,
            aggregateId,
            kind,
            deduplicationKey,
            payloadJson,
            now,
            tenantTimeZoneId);
        dbContext.NotificationOutboxItems.Add(item);

        // No email channel is available to the planner here, so it selects in-app alone.
        foreach (var selection in NotificationChannelPlanner.Plan(
                     item.Purpose,
                     new NotificationChannelPlanInputs(false, false, false)))
        {
            dbContext.NotificationChannelDeliveries.Add(NotificationChannelDelivery.Select(
                tenantId,
                item.Id,
                selection.Channel,
                selection.Purpose,
                selection.Reason,
                NotificationChannelPlanner.PolicyVersion,
                now));
        }
    }
}

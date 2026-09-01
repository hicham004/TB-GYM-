namespace TB.Gym.Infrastructure.Persistence;

/// <summary>
/// Database object names that application-level conflict translation depends on.
/// </summary>
internal static class DatabaseConstraintNames
{
    public const string OneCheckInResponsePerAssignment =
        "IX_CheckInResponses_TenantId_AssignmentId";

    public const string OneCheckInResponseEventPerType =
        "IX_CheckInResponseEvents_TenantId_ResponseId_EventType";

    public const string OneProgressPhotoPerDateAndPose =
        "IX_ProgressPhotos_TenantId_ClientProfileId_PhotoDate_Pose";

    /// <summary>
    /// One in-app notification per outbox intent. The dispatcher reads this name to recognise a
    /// replay it lost the race for, rather than parsing a PostgreSQL message.
    /// </summary>
    public const string OneNotificationPerOutboxItem =
        "IX_Notifications_TenantId_SourceOutboxItemId";

    public const string OneNotificationAttemptPerNumber =
        "IX_DeliveryAttempts_TenantId_OutboxItemId_Channel_AttemptNumber";
}

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

    /// <summary>
    /// One direct conversation per workspace, client and coach. The creation path reads this name to
    /// recognise a race it lost and return the winner's conversation rather than a failure.
    /// </summary>
    public const string OneDirectConversationPerCoachAndClient =
        "IX_Conversations_TenantId_ClientProfileId_CoachUserId";

    /// <summary>Exactly one Coach-side and one Client-side identity per direct conversation.</summary>
    public const string OneParticipantPerConversationSide =
        "IX_ConversationParticipants_TenantId_ConversationId_Role";

    /// <summary>The ordering invariant: one message per conversation sequence.</summary>
    public const string OneMessageSequencePerConversation =
        "IX_Messages_TenantId_ConversationId_Sequence";

    public const string OneMessageRevisionPerNumber =
        "IX_MessageRevisions_TenantId_MessageId_RevisionNumber";

    public const string OneMessageDeletionEvent =
        "IX_MessageDeletionEvents_TenantId_MessageId";

    /// <summary>
    /// One spent messaging idempotency key per workspace, across every messaging command. The send,
    /// edit, delete and moderate paths read this name to recognise a concurrent identical retry.
    /// </summary>
    public const string OneMessagingCommandPerKey =
        "IX_CommandRecords_TenantId_IdempotencyKey";
}

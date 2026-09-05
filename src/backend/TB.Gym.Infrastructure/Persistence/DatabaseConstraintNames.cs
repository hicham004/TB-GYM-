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
        "IX_DeliveryAttempts_TenantId_ChannelDeliveryId_AttemptNumber";

    /// <summary>
    /// At most one delivery per intent and channel. Channel planning reads this name to recognise a
    /// race it lost rather than reporting a server error for a row that already says what it wanted.
    /// </summary>
    public const string OneChannelDeliveryPerIntent =
        "IX_ChannelDeliveries_TenantId_OutboxItemId_Channel";

    /// <summary>One settings row per member and workspace.</summary>
    public const string OneNotificationPreferencePerMember =
        "IX_ChannelPreferences_TenantId_UserId";

    /// <summary>
    /// One spent preference idempotency key per workspace. The update path reads this name to
    /// recognise a concurrent identical retry and replay the winner's result.
    /// </summary>
    public const string OneNotificationPreferenceCommandPerKey =
        "IX_PreferenceCommandRecords_TenantId_IdempotencyKey";

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

    /// <summary>
    /// One realtime event per conversation event position. The catch-up cursor is only resumable
    /// because this is unique and, with the deferred tip trigger, gap-free.
    /// </summary>
    public const string OneRealtimeEventPerConversationSequence =
        "IX_RealtimeEvents_TenantId_ConversationId_EventSequence";

    /// <summary>
    /// One realtime event per source mutation. A settled idempotent replay returns the original
    /// result and cannot allocate a second event; this is the database saying so.
    /// </summary>
    public const string OneRealtimeEventPerSourceCommand =
        "IX_RealtimeEvents_TenantId_SourceCommandRecordId";

    public const string OneRealtimeAttemptPerNumber =
        "IX_RealtimeAttempts_TenantId_RecipientId_AttemptNumber";

    /// <summary>
    /// One acknowledgement per event and participant.
    /// </summary>
    /// <remarks>
    /// Abbreviated deliberately. PostgreSQL truncates an identifier at 63 characters, so the name
    /// this convention would otherwise produce is not the name the database ends up with — and a
    /// constant that does not match the object it names is worse than no constant, because the next
    /// person to compare against it gets a silent miss rather than an error.
    /// </remarks>
    public const string OneRealtimeAcknowledgementPerRecipient =
        "IX_RealtimeAcks_TenantId_RealtimeEventId_AcknowledgedByUserId";

    /// <summary>The acknowledgement read path, abbreviated for the same reason.</summary>
    public const string RealtimeAcknowledgementsByConversation =
        "IX_RealtimeAcks_TenantId_ConversationId_AcknowledgedAtUtc";
}

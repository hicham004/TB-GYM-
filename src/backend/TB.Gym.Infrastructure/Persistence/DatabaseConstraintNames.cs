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
}

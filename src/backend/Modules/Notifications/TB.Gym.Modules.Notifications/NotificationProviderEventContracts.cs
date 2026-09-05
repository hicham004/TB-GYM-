namespace TB.Gym.Modules.Notifications;

/// <summary>
/// The provider-authenticated ingestion path. Implemented in Infrastructure, which is what composes
/// the modules and owns persistence; the module owns the vocabulary, the signature scheme and the
/// rules about what may be written.
/// </summary>
public interface INotificationProviderEventIngestion
{
    Task<NotificationProviderEventIngestionResult> IngestAsync(
        NotificationProviderEventRequest request,
        CancellationToken cancellationToken);
}

/// <summary>
/// One raw, unverified webhook request.
/// </summary>
/// <remarks>
/// The body is carried as bytes rather than as a string or a parsed model on purpose: the signature
/// covers the exact octets, and any round trip through a decoder, a serializer or a model changes
/// them. Nothing reads this body until the signature over these same bytes has been verified.
/// </remarks>
public sealed record NotificationProviderEventRequest(
    string? EventId,
    string? Timestamp,
    string? Signature,
    ReadOnlyMemory<byte> Body);

public sealed record NotificationProviderEventIngestionResult(
    NotificationProviderEventIngestionStatus Status)
{
    public static NotificationProviderEventIngestionResult Of(
        NotificationProviderEventIngestionStatus status) => new(status);
}

/// <summary>
/// What ingestion did with one request.
/// </summary>
/// <remarks>
/// Every refusal that could distinguish one workspace's data from another's collapses at the HTTP
/// boundary: an event for a message this deployment never issued, and an event for a message that
/// exists, are both a plain acknowledgement. A provider retrying an event it cannot deliver is worse
/// for everybody than a provider being told, uninformatively, that the event was seen.
/// </remarks>
public enum NotificationProviderEventIngestionStatus
{
    /// <summary>Verified, mapped, and its fact applied for the first time.</summary>
    Recorded = 1,

    /// <summary>Verified, and already recorded under the same provider event identifier.</summary>
    Duplicate = 2,

    /// <summary>Verified, and of a type this build deliberately does not record.</summary>
    Ignored = 3,

    /// <summary>Verified, and about a message identifier this deployment did not issue.</summary>
    UnknownMessage = 4,

    /// <summary>Missing, malformed, expired or invalid signature. Nothing was parsed and nothing written.</summary>
    Unauthorized = 5,

    /// <summary>The body exceeded the configured limit. Nothing was read past the limit.</summary>
    PayloadTooLarge = 6,

    /// <summary>Authenticated, and then unreadable. Retrying will not change that.</summary>
    Malformed = 7,

    /// <summary>This deployment has no provider configured, so it accepts no provider events.</summary>
    Unavailable = 8,
}

using System.Globalization;
using System.Text.Json;

namespace TB.Gym.Modules.Notifications;

/// <summary>
/// Reads one verified provider webhook body into owned vocabulary, and refuses everything else.
/// </summary>
/// <remarks>
/// The body is untrusted input that arrives on a public route, so it is treated the way every other
/// untrusted document in this repository is: bounded before it is parsed, parsed with an explicit
/// depth limit, read for exactly the few members that matter, and dropped. Nothing is deserialized
/// into a provider-shaped model that could later be persisted by accident, and no member of it is
/// stored — in particular <c>data.to</c>, which is the recipient's address and is deliberately never
/// read at all.
/// <para>
/// Parsing happens strictly after signature verification, and never before it: a parser is code, and
/// running it on bytes nobody authenticated hands an attacker a free reachable surface.
/// </para>
/// </remarks>
public static class NotificationProviderEventPayload
{
    /// <summary>Deep enough for the provider's own shape, shallow enough to refuse a nesting bomb.</summary>
    public const int MaximumJsonDepth = 8;

    /// <summary>The oldest occurrence instant an event may declare before it is treated as malformed.</summary>
    public static TimeSpan MaximumBackdating { get; } = TimeSpan.FromDays(31);

    /// <summary>How far into the future a declared occurrence instant may sit. Clock skew, and no more.</summary>
    public static TimeSpan MaximumPostdating { get; } = TimeSpan.FromDays(1);

    /// <summary>
    /// The provider's event names, mapped to owned vocabulary.
    /// </summary>
    /// <remarks>
    /// Everything absent from this table is ignored rather than rejected: a provider adds event types
    /// over time, and refusing an unknown one would make it retry forever. Two absences are
    /// deliberate rather than incidental — <c>email.opened</c> and <c>email.clicked</c> are tracking
    /// events, they are never recorded, and no open is ever allowed to look like a read.
    /// </remarks>
    private static readonly Dictionary<string, NotificationProviderEventType> ResendEventTypes =
        new(StringComparer.Ordinal)
        {
            ["email.sent"] = NotificationProviderEventType.ProviderAccepted,
            ["email.delivered"] = NotificationProviderEventType.RecipientServerAccepted,
            ["email.delivery_delayed"] = NotificationProviderEventType.DeliveryDelayed,
            ["email.bounced"] = NotificationProviderEventType.Bounced,
            ["email.complained"] = NotificationProviderEventType.Complained,
            ["email.failed"] = NotificationProviderEventType.Failed,
            ["email.suppressed"] = NotificationProviderEventType.ProviderSuppressed,
        };

    public static NotificationProviderEventPayloadResult Read(
        ReadOnlySpan<byte> body,
        DateTimeOffset receivedAtUtc)
    {
        if (body.IsEmpty)
        {
            return NotificationProviderEventPayloadResult.Malformed;
        }

        try
        {
            var reader = new Utf8JsonReader(
                body,
                new JsonReaderOptions { MaxDepth = MaximumJsonDepth });
            using var document = JsonDocument.ParseValue(ref reader);
            if (reader.Read())
            {
                // Trailing content after the document. A body the provider did not produce.
                return NotificationProviderEventPayloadResult.Malformed;
            }

            return ReadDocument(document.RootElement, receivedAtUtc);
        }
        catch (JsonException)
        {
            return NotificationProviderEventPayloadResult.Malformed;
        }
    }

    private static NotificationProviderEventPayloadResult ReadDocument(
        JsonElement root,
        DateTimeOffset receivedAtUtc)
    {
        if (root.ValueKind != JsonValueKind.Object ||
            !TryReadString(root, "type", 100, out var providerType) ||
            !root.TryGetProperty("data", out var data) ||
            data.ValueKind != JsonValueKind.Object)
        {
            return NotificationProviderEventPayloadResult.Malformed;
        }

        if (!ResendEventTypes.TryGetValue(providerType, out var eventType))
        {
            return NotificationProviderEventPayloadResult.Ignored;
        }

        if (!TryReadString(data, "email_id", NotificationProviderMessageId.MaximumLength, out var messageId) ||
            !NotificationProviderMessageId.IsValid(messageId))
        {
            return NotificationProviderEventPayloadResult.Malformed;
        }

        if (!TryReadOccurredAt(root, receivedAtUtc, out var occurredAtUtc))
        {
            return NotificationProviderEventPayloadResult.Malformed;
        }

        NotificationProviderBounceClass? bounceClass = null;
        string? failureCode = null;
        if (eventType == NotificationProviderEventType.Bounced)
        {
            bounceClass = ReadBounceClass(data);
            failureCode = NotificationProviderEventCodes.For(bounceClass.Value);
        }
        else if (eventType == NotificationProviderEventType.Failed)
        {
            failureCode = NotificationProviderEventCodes.ProviderFailed;
        }

        return NotificationProviderEventPayloadResult.Read(new NotificationProviderEventFacts(
            messageId,
            eventType,
            bounceClass,
            failureCode,
            occurredAtUtc));
    }

    /// <summary>
    /// The provider's own bounce classification, mapped conservatively.
    /// </summary>
    /// <remarks>
    /// Anything that is not explicitly permanent is not treated as permanent. A missing, unexpected
    /// or renamed classification becomes <see cref="NotificationProviderBounceClass.Undetermined"/>,
    /// which suppresses nothing — because the cost of failing to suppress is a second bounce, and the
    /// cost of suppressing wrongly is a client who silently stops being told about their payments.
    /// </remarks>
    private static NotificationProviderBounceClass ReadBounceClass(JsonElement data)
    {
        if (!data.TryGetProperty("bounce", out var bounce) ||
            bounce.ValueKind != JsonValueKind.Object ||
            !TryReadString(bounce, "type", 40, out var classification))
        {
            return NotificationProviderBounceClass.Undetermined;
        }

        return classification switch
        {
            _ when string.Equals(classification, "Permanent", StringComparison.OrdinalIgnoreCase) =>
                NotificationProviderBounceClass.Permanent,
            _ when string.Equals(classification, "Transient", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(classification, "Temporary", StringComparison.OrdinalIgnoreCase) =>
                NotificationProviderBounceClass.Transient,
            _ => NotificationProviderBounceClass.Undetermined,
        };
    }

    private static bool TryReadOccurredAt(
        JsonElement root,
        DateTimeOffset receivedAtUtc,
        out DateTimeOffset occurredAtUtc)
    {
        occurredAtUtc = default;
        if (!TryReadString(root, "created_at", 64, out var raw) ||
            !DateTimeOffset.TryParse(
                raw,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal,
                out var parsed))
        {
            return false;
        }

        // Bounded rather than trusted. The signature already fixes when the request was made; this
        // stops a provider-declared instant from landing a fact in 1970 or in 2140 and reordering a
        // history somebody later reads.
        if (parsed < receivedAtUtc - MaximumBackdating || parsed > receivedAtUtc + MaximumPostdating)
        {
            return false;
        }

        occurredAtUtc = parsed.ToUniversalTime();
        return true;
    }

    private static bool TryReadString(
        JsonElement element,
        string propertyName,
        int maximumLength,
        out string value)
    {
        value = string.Empty;
        if (!element.TryGetProperty(propertyName, out var property) ||
            property.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        var raw = property.GetString();
        if (string.IsNullOrWhiteSpace(raw) || raw.Length > maximumLength)
        {
            return false;
        }

        value = raw;
        return true;
    }
}

/// <summary>What one verified provider body turned out to be.</summary>
public sealed record NotificationProviderEventPayloadResult(
    NotificationProviderEventPayloadStatus Status,
    NotificationProviderEventFacts? Facts = null)
{
    public static NotificationProviderEventPayloadResult Malformed { get; } =
        new(NotificationProviderEventPayloadStatus.Malformed);

    public static NotificationProviderEventPayloadResult Ignored { get; } =
        new(NotificationProviderEventPayloadStatus.Ignored);

    public static NotificationProviderEventPayloadResult Read(NotificationProviderEventFacts facts) =>
        new(NotificationProviderEventPayloadStatus.Read, facts);
}

public enum NotificationProviderEventPayloadStatus
{
    Read = 1,

    /// <summary>A well-formed event of a type this build deliberately does not record.</summary>
    Ignored = 2,

    Malformed = 3,
}

/// <summary>
/// Everything one provider event contributes, in owned vocabulary. No address, no subject, no body,
/// no provider diagnostic text.
/// </summary>
public sealed record NotificationProviderEventFacts(
    string ProviderMessageId,
    NotificationProviderEventType EventType,
    NotificationProviderBounceClass? BounceClass,
    string? FailureCode,
    DateTimeOffset OccurredAtUtc);

using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Notifications;

/// <summary>
/// One member's own notification settings in one workspace.
/// </summary>
/// <remarks>
/// The row is a read optimisation over <see cref="NotificationConsentEvent"/>, not the record itself.
/// Every change to an email setting appends evidence in the same transaction, so the mutable current
/// value and the append-only history can be compared and must agree; the history is what survives, and
/// this row is what a dispatcher and a settings screen read.
/// <para>
/// It is user-owned and tenant-scoped. A coach or an owner has no route that writes somebody else's
/// row: the API derives the subject from the authentication cookie and never from a request body, so
/// nobody can be opted into email by another member of their workspace.
/// </para>
/// <para>
/// In-app has no switch here. It is passive persisted state that interrupts nobody, every supported
/// notification type keeps it, and this slice deliberately exposes no way to turn it off — a member
/// who could silently disable their own inbox would stop receiving the payment and expiry notices the
/// workspace relies on them seeing.
/// </para>
/// </remarks>
public sealed class NotificationChannelPreference : TenantEntity
{
    private NotificationChannelPreference()
    {
    }

    private NotificationChannelPreference(Guid tenantId, Guid userId)
        : base(tenantId)
    {
        if (userId == Guid.Empty)
        {
            throw new ArgumentException("A notification preference needs the member it belongs to.", nameof(userId));
        }

        UserId = userId;
        PolicyVersion = NotificationPreferencePolicy.CurrentVersion;
    }

    public Guid UserId { get; private set; }

    /// <summary>
    /// Whether service/transactional email is wanted. Defaults to off: a durable channel that costs
    /// money and lands in somebody's mailbox is opt-in, and silence is not consent.
    /// </summary>
    public bool EmailServiceEnabled { get; private set; }

    /// <summary>
    /// Reserved. Nothing produces marketing notifications in this phase and no route sets this, so it
    /// is false everywhere; the planner fails marketing closed without it, and it is deliberately a
    /// separate field so marketing can never be carried by the service-email decision.
    /// </summary>
    public bool EmailMarketingEnabled { get; private set; }

    public bool QuietHoursEnabled { get; private set; }

    /// <summary>Inclusive local start of the quiet window, in the workspace's configured time zone.</summary>
    public TimeOnly? QuietHoursStartLocal { get; private set; }

    /// <summary>Exclusive local end of the quiet window. The interval is half-open, `[start, end)`.</summary>
    public TimeOnly? QuietHoursEndLocal { get; private set; }

    /// <summary>The preference policy version this row was last written under.</summary>
    public int PolicyVersion { get; private set; }

    public DateTimeOffset? EmailServiceDecidedAtUtc { get; private set; }

    /// <summary>The exact append-only event that explains the current service-email decision.</summary>
    public Guid? EmailServiceConsentEventId { get; private set; }

    public DateTimeOffset? EmailMarketingDecidedAtUtc { get; private set; }

    /// <summary>The exact append-only event that explains the current marketing-email decision.</summary>
    public Guid? EmailMarketingConsentEventId { get; private set; }

    /// <summary>
    /// The defaults a member has before they have ever chosen anything: in-app on, email off, no quiet
    /// hours. Creating the row is not a decision and appends no consent evidence.
    /// </summary>
    public static NotificationChannelPreference CreateDefault(Guid tenantId, Guid userId) =>
        new(tenantId, userId);

    public NotificationQuietHours? QuietHours =>
        QuietHoursEnabled && QuietHoursStartLocal is { } start && QuietHoursEndLocal is { } end
            ? new NotificationQuietHours(start, end)
            : null;

    /// <summary>
    /// Records a service-email decision and returns the evidence to append, or null when the value did
    /// not actually change. A no-op save writes no evidence, so the history is a list of decisions and
    /// not a list of times somebody pressed Save.
    /// </summary>
    public NotificationConsentEvent? SetEmailService(
        bool enabled,
        Guid actorUserId,
        DateTimeOffset now,
        string source)
    {
        RequireOwnActor(actorUserId);
        PolicyVersion = NotificationPreferencePolicy.CurrentVersion;
        if (EmailServiceEnabled == enabled)
        {
            return null;
        }

        var evidence = NotificationConsentEvent.Record(
            TenantId,
            UserId,
            NotificationChannel.Email,
            NotificationPurpose.ServiceTransactional,
            enabled ? NotificationConsentDecision.Granted : NotificationConsentDecision.Withdrawn,
            now,
            NotificationPreferencePolicy.CurrentVersion,
            source,
            actorUserId);
        EmailServiceEnabled = enabled;
        EmailServiceDecidedAtUtc = now;
        EmailServiceConsentEventId = evidence.Id;
        return evidence;
    }

    /// <summary>
    /// The marketing equivalent. No route reaches it in this phase; it exists so that when one does,
    /// the consent evidence it must append is already part of the operation rather than an afterthought.
    /// </summary>
    public NotificationConsentEvent? SetEmailMarketing(
        bool enabled,
        Guid actorUserId,
        DateTimeOffset now,
        string source)
    {
        RequireOwnActor(actorUserId);
        PolicyVersion = NotificationPreferencePolicy.CurrentVersion;
        if (EmailMarketingEnabled == enabled)
        {
            return null;
        }

        var evidence = NotificationConsentEvent.Record(
            TenantId,
            UserId,
            NotificationChannel.Email,
            NotificationPurpose.Marketing,
            enabled ? NotificationConsentDecision.Granted : NotificationConsentDecision.Withdrawn,
            now,
            NotificationPreferencePolicy.CurrentVersion,
            source,
            actorUserId);
        EmailMarketingEnabled = enabled;
        EmailMarketingDecidedAtUtc = now;
        EmailMarketingConsentEventId = evidence.Id;
        return evidence;
    }

    /// <summary>
    /// Sets or clears quiet hours. Quiet hours are an interruption policy rather than a consent
    /// decision, so they append no consent evidence.
    /// </summary>
    public void SetQuietHours(bool enabled, TimeOnly? startLocal, TimeOnly? endLocal)
    {
        PolicyVersion = NotificationPreferencePolicy.CurrentVersion;
        if (!enabled)
        {
            QuietHoursEnabled = false;
            QuietHoursStartLocal = null;
            QuietHoursEndLocal = null;
            return;
        }

        if (startLocal is not { } start || endLocal is not { } end)
        {
            throw new ArgumentException("Quiet hours need both a start and an end.");
        }

        // Refused rather than silently read as a whole day. "22:00 to 22:00" is at least as likely to
        // mean "I have not finished choosing" as "never email me", and guessing wrong either buries
        // every notification or delivers every one of them at 3am.
        if (!NotificationQuietHours.TryCreate(start, end, out var window, out var error))
        {
            throw new ArgumentException(error);
        }

        QuietHoursEnabled = true;
        QuietHoursStartLocal = window.StartLocal;
        QuietHoursEndLocal = window.EndLocal;
    }

    private void RequireOwnActor(Guid actorUserId)
    {
        // Defence in depth behind the API, which already derives the subject from the cookie. A
        // preference is one person's own decision and nobody else's to make on their behalf.
        if (actorUserId == Guid.Empty || actorUserId != UserId)
        {
            throw new InvalidOperationException("A notification preference can only be changed by its own member.");
        }
    }
}

/// <summary>
/// Append-only evidence of one email consent decision.
/// </summary>
/// <remarks>
/// Written in the same transaction as the preference change it explains, never updated and never
/// deleted — a database trigger refuses both. Withdrawing consent appends a withdrawal; it does not
/// erase the grant, because the question a consent record has to answer afterwards is what was true
/// at a given moment and not what is true now.
/// <para>
/// It carries only what is needed to answer that question: which channel and purpose, whether consent
/// was granted or withdrawn, when in UTC, under which policy version and from which source, and which
/// authenticated actor made the decision. Deliberately not: the address, an IP address, a user-agent
/// string, a rendered message, or anything else that would turn a consent log into a tracking log.
/// </para>
/// </remarks>
public sealed class NotificationConsentEvent : TenantEntity
{
    private NotificationConsentEvent()
    {
    }

    private NotificationConsentEvent(
        Guid tenantId,
        Guid userId,
        NotificationChannel channel,
        NotificationPurpose purpose,
        NotificationConsentDecision decision,
        DateTimeOffset recordedAtUtc,
        int policyVersion,
        string source,
        Guid actorUserId)
        : base(tenantId)
    {
        if (userId == Guid.Empty || actorUserId == Guid.Empty)
        {
            throw new ArgumentException("Consent evidence needs a subject and an authenticated actor.");
        }

        if (!Enum.IsDefined(channel) || !Enum.IsDefined(purpose) || !Enum.IsDefined(decision))
        {
            throw new ArgumentException("Consent evidence needs a known channel, purpose, and decision.");
        }

        if (policyVersion < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(policyVersion), "A policy version starts at 1.");
        }

        UserId = userId;
        Channel = channel;
        Purpose = purpose;
        Decision = decision;
        RecordedAtUtc = recordedAtUtc;
        PolicyVersion = policyVersion;
        Source = Normalize(source, 100, nameof(source));
        ActorUserId = actorUserId;
    }

    public Guid UserId { get; private set; }

    public NotificationChannel Channel { get; private set; }

    public NotificationPurpose Purpose { get; private set; }

    public NotificationConsentDecision Decision { get; private set; }

    public DateTimeOffset RecordedAtUtc { get; private set; }

    public int PolicyVersion { get; private set; }

    /// <summary>A stable code naming where the decision came from, such as the settings screen.</summary>
    public string Source { get; private set; } = string.Empty;

    /// <summary>
    /// The authenticated actor. In this phase it always equals <see cref="UserId"/>, and a database
    /// check says so, because there is no route by which anybody consents on somebody else's behalf.
    /// </summary>
    public Guid ActorUserId { get; private set; }

    public static NotificationConsentEvent Record(
        Guid tenantId,
        Guid userId,
        NotificationChannel channel,
        NotificationPurpose purpose,
        NotificationConsentDecision decision,
        DateTimeOffset recordedAtUtc,
        int policyVersion,
        string source,
        Guid actorUserId) =>
        new(
            tenantId,
            userId,
            channel,
            purpose,
            decision,
            recordedAtUtc,
            policyVersion,
            source,
            actorUserId);

    private static string Normalize(string value, int maxLength, string parameterName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);
        var normalized = value.Trim();
        return normalized.Length <= maxLength
            ? normalized
            : throw new ArgumentException($"The value cannot exceed {maxLength} characters.", parameterName);
    }
}

public enum NotificationConsentDecision
{
    Granted = 1,
    Withdrawn = 2,
}

/// <summary>
/// One spent preference-command idempotency key, bound to the normalized command it was spent on.
/// </summary>
/// <remarks>
/// The same discipline the messaging commands use, and for the same reason: a client that lost a
/// response must be able to retry without making a second decision, and a key reused with different
/// content must conflict rather than quietly overwrite the first one.
/// </remarks>
public sealed class NotificationPreferenceCommandRecord : TenantEntity
{
    private NotificationPreferenceCommandRecord()
    {
    }

    private NotificationPreferenceCommandRecord(
        Guid tenantId,
        Guid idempotencyKey,
        NotificationPreferenceCommandType commandType,
        string payloadFingerprint,
        Guid actorUserId,
        DateTimeOffset recordedAtUtc,
        NotificationPreferenceView result)
        : base(tenantId)
    {
        if (idempotencyKey == Guid.Empty || actorUserId == Guid.Empty)
        {
            throw new ArgumentException("A preference command record needs a key and an actor.");
        }

        if (!Enum.IsDefined(commandType))
        {
            throw new ArgumentException("An unknown command type cannot be recorded.", nameof(commandType));
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(payloadFingerprint);

        IdempotencyKey = idempotencyKey;
        CommandType = commandType;
        PayloadFingerprint = payloadFingerprint;
        ActorUserId = actorUserId;
        RecordedAtUtc = recordedAtUtc;
        ResultEmailServiceEnabled = result.EmailServiceEnabled;
        ResultEmailMarketingEnabled = result.EmailMarketingEnabled;
        ResultEmailChannelAvailable = result.EmailChannelAvailable;
        ResultQuietHoursEnabled = result.QuietHoursEnabled;
        ResultQuietHoursStartLocal = ParseOptionalTime(result.QuietHoursStartLocal);
        ResultQuietHoursEndLocal = ParseOptionalTime(result.QuietHoursEndLocal);
        ResultTimeZoneId = Normalize(result.TenantTimeZoneId, 100, nameof(result));
        ResultPolicyVersion = result.PolicyVersion;
        ResultPreferenceVersion = result.Version;
    }

    public Guid IdempotencyKey { get; private set; }

    public NotificationPreferenceCommandType CommandType { get; private set; }

    public string PayloadFingerprint { get; private set; } = string.Empty;

    public Guid ActorUserId { get; private set; }

    public DateTimeOffset RecordedAtUtc { get; private set; }

    /// <summary>
    /// The non-sensitive response produced by this command. Idempotency replays this snapshot rather
    /// than the member's current mutable settings, which may have changed under a later command.
    /// </summary>
    public bool ResultEmailServiceEnabled { get; private set; }

    public bool ResultEmailMarketingEnabled { get; private set; }

    public bool ResultEmailChannelAvailable { get; private set; }

    public bool ResultQuietHoursEnabled { get; private set; }

    public TimeOnly? ResultQuietHoursStartLocal { get; private set; }

    public TimeOnly? ResultQuietHoursEndLocal { get; private set; }

    public string ResultTimeZoneId { get; private set; } = string.Empty;

    public int ResultPolicyVersion { get; private set; }

    public uint ResultPreferenceVersion { get; private set; }

    public static NotificationPreferenceCommandRecord Record(
        Guid tenantId,
        Guid idempotencyKey,
        NotificationPreferenceCommandType commandType,
        string payloadFingerprint,
        Guid actorUserId,
        DateTimeOffset recordedAtUtc,
        NotificationPreferenceView result) =>
        new(tenantId, idempotencyKey, commandType, payloadFingerprint, actorUserId, recordedAtUtc, result);

    /// <summary>
    /// The snapshotted response, with the caller's <em>current</em> suppression status overlaid.
    /// </summary>
    /// <remarks>
    /// Suppression is deliberately not snapshotted. It is not a result of this command — nobody
    /// decided it, a provider reported it — and freezing it here would let a replay tell a member
    /// their mail is flowing hours after it stopped. Everything the command actually settled comes
    /// from the record; this one fact is read fresh.
    /// </remarks>
    public NotificationPreferenceView ReplayResult(NotificationEmailSuppressionReason? suppressionReason) => new(
        InAppEnabled: true,
        ResultEmailServiceEnabled,
        ResultEmailMarketingEnabled,
        ResultEmailChannelAvailable,
        suppressionReason is not null,
        suppressionReason,
        ResultQuietHoursEnabled,
        NotificationLocalTime.Format(ResultQuietHoursStartLocal),
        NotificationLocalTime.Format(ResultQuietHoursEndLocal),
        ResultTimeZoneId,
        ResultPolicyVersion,
        ResultPreferenceVersion);

    /// <summary>
    /// Whether a retry presenting this key is the same command. The actor is compared as well as the
    /// fingerprint, so one member's key can never settle another member's decision.
    /// </summary>
    public bool Matches(NotificationPreferenceCommandType commandType, string payloadFingerprint, Guid actorUserId) =>
        CommandType == commandType &&
        ActorUserId == actorUserId &&
        string.Equals(PayloadFingerprint, payloadFingerprint, StringComparison.Ordinal);

    private static TimeOnly? ParseOptionalTime(string? value)
    {
        if (value is null)
        {
            return null;
        }

        return NotificationLocalTime.TryParse(value, out var parsed)
            ? parsed
            : throw new ArgumentException("A snapshotted quiet-hours time must use HH:mm.", nameof(value));
    }

    private static string Normalize(string value, int maxLength, string parameterName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);
        var normalized = value.Trim();
        return normalized.Length <= maxLength
            ? normalized
            : throw new ArgumentException($"The value cannot exceed {maxLength} characters.", parameterName);
    }
}

public enum NotificationPreferenceCommandType
{
    UpdateOwnPreferences = 1,
}

/// <summary>The named preference policy, so a later change to the defaults is a visible decision.</summary>
public static class NotificationPreferencePolicy
{
    public const string Name = "notification-preferences-v1";

    public const int CurrentVersion = 1;

    /// <summary>Where a decision came from. Stable codes, never free text a caller supplies.</summary>
    public const string OwnSettingsSource = "notification-preferences-own-settings";
}

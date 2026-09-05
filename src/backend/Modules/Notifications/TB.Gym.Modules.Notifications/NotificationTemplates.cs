namespace TB.Gym.Modules.Notifications;

/// <summary>
/// One rendered template: what a notification of a given kind says, in a given culture, at a given
/// template version.
/// </summary>
public sealed record NotificationTemplate(string Key, int Version, string Culture, string Title, string Body);

/// <summary>
/// The complete, code-owned set of notification wordings.
/// </summary>
/// <remarks>
/// Templates are an allowlist compiled into the assembly. There is no Razor, no database-authored
/// markup, no HTML, and no format string a caller can influence: the catalog takes a kind and a
/// culture and returns fixed text. Rendering therefore cannot be turned into an injection surface by
/// anything a coach types or a payload carries.
/// <para>
/// The wording is deliberately generic. None of it names the client, the coach, the product, the
/// offer, an amount, a currency, a date, a database identifier, or any part of the payload, because
/// an in-app notification is a pointer to look at the workspace and not a place to restate
/// commercial or health-adjacent facts. The screens behind it already authorize per request; the
/// notification does not.
/// </para>
/// <para>
/// Only culture <c>en</c> and template version 1 exist. Arabic and any other locale are deferred:
/// the versioned key is here so a later wording change publishes version 2 and leaves every
/// already-delivered snapshot exactly as it was read.
/// </para>
/// </remarks>
public static class NotificationTemplateCatalog
{
    /// <summary>The only culture with published templates in this slice.</summary>
    public const string DefaultCulture = "en";

    public const int CurrentVersion = 1;

    private static readonly Dictionary<CommercialNotificationKind, NotificationTemplate> EnglishV1 = new()
    {
        [CommercialNotificationKind.PaymentRequired] = new NotificationTemplate(
            "commercial.payment-required",
            CurrentVersion,
            DefaultCulture,
            "Payment required",
            "Your coaching access starts once payment for your new service has been received. Open your workspace for the details."),
        [CommercialNotificationKind.EnrollmentActivated] = new NotificationTemplate(
            "commercial.enrollment-activated",
            CurrentVersion,
            DefaultCulture,
            "Coaching access activated",
            "Your coaching access is now active. Open your workspace to get started."),
        [CommercialNotificationKind.EnrollmentEndingSoon] = new NotificationTemplate(
            "commercial.enrollment-ending-soon",
            CurrentVersion,
            DefaultCulture,
            "Your service is ending soon",
            "Your current coaching service is approaching its end date. Open your workspace to see what happens next."),
        [CommercialNotificationKind.EnrollmentExpired] = new NotificationTemplate(
            "commercial.enrollment-expired",
            CurrentVersion,
            DefaultCulture,
            "Your service has ended",
            "Your coaching service period has ended. Open your workspace to see your options."),
        // Careful wording: a renewal may still be awaiting payment, so this must not imply that paid
        // or active access already exists. It says only that a renewal was created.
        [CommercialNotificationKind.EnrollmentRenewed] = new NotificationTemplate(
            "commercial.enrollment-renewed",
            CurrentVersion,
            DefaultCulture,
            "A renewal was created",
            "A renewal of your coaching service has been created. Open your workspace to see its status."),
    };

    /// <summary>
    /// Resolves the template for a kind and culture, or reports that none is published. A missing
    /// template is a permanent dead letter rather than a retry: no amount of waiting will make an
    /// unpublished wording appear.
    /// </summary>
    public static bool TryResolve(
        CommercialNotificationKind kind,
        string culture,
        out NotificationTemplate template)
    {
        // Only `en` is published. A workspace culture of `en-LB` resolves to it by language, and
        // anything else is refused rather than silently answered in the wrong language.
        var language = LanguageOf(culture);
        if (!string.Equals(language, DefaultCulture, StringComparison.OrdinalIgnoreCase))
        {
            template = null!;
            return false;
        }

        return EnglishV1.TryGetValue(kind, out template!);
    }

    /// <summary>Every published template, for tests and for documentation of the allowlist.</summary>
    public static IReadOnlyCollection<NotificationTemplate> Published => EnglishV1.Values;

    /// <summary>
    /// The one wording an email may carry in this phase.
    /// </summary>
    /// <remarks>
    /// Deliberately one generic template for every kind rather than five specific ones. An in-app
    /// notification sits behind an authenticated session; an email sits in a mailbox that a phone
    /// shows on a lock screen, that a shared computer displays, and that a mail provider stores
    /// indefinitely. So it says only that something is waiting and where to look: no client or coach
    /// name, no product, offer, amount, currency or date, no health data, no conversation text, no
    /// identifier, no token and no action URL. Which of the five kinds it is is itself commercial
    /// information about the recipient, so the email does not carry that either.
    /// <para>
    /// It follows that a recipient must sign in to learn anything, which is the intended trade: the
    /// screens behind the sign-in authorize every request, and an email cannot.
    /// </para>
    /// </remarks>
    public static NotificationTemplate ServiceEmailV1 { get; } = new(
        "notification.service-email",
        CurrentVersion,
        DefaultCulture,
        "You have a new TB Gym notification",
        """
        You have a new notification in TB Gym.

        Sign in to TB Gym and open your notifications to read it.

        You are receiving this because you turned on email notifications for this workspace. You can
        turn them off again at any time in your TB Gym notification settings.
        """);

    private static string LanguageOf(string culture)
    {
        if (string.IsNullOrWhiteSpace(culture))
        {
            return string.Empty;
        }

        var trimmed = culture.Trim();
        var separator = trimmed.IndexOfAny(['-', '_']);
        return separator < 0 ? trimmed : trimmed[..separator];
    }
}

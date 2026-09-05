namespace TB.Gym.Modules.Notifications;

/// <summary>
/// The channels one logical notification was selected for, decided once when it is scheduled.
/// </summary>
public sealed record NotificationChannelSelection(
    NotificationChannel Channel,
    NotificationPurpose Purpose,
    string Reason);

/// <summary>
/// What the planner needs to know about the recipient and the deployment. Deliberately a snapshot
/// taken inside the scheduling transaction rather than a service the planner calls, so the decision
/// is a pure function that a domain test can enumerate exhaustively.
/// </summary>
/// <param name="EmailServiceEnabled">The recipient's own current service-email preference.</param>
/// <param name="EmailMarketingConsentGranted">
/// Current affirmative marketing consent. Separate from the service preference by construction: a
/// member who wants payment reminders has not thereby agreed to promotional mail.
/// </param>
/// <param name="EmailChannelAvailable">
/// Whether this deployment has an email transport configured at all. False by default, and false in
/// production until a real provider exists.
/// </param>
public sealed record NotificationChannelPlanInputs(
    bool EmailServiceEnabled,
    bool EmailMarketingConsentGranted,
    bool EmailChannelAvailable);

/// <summary>
/// Decides which channels a notification is delivered over, and records why.
/// </summary>
/// <remarks>
/// The decision is made once, when the business event schedules the intent, and the selected rows are
/// written in the same transaction. Two consequences follow deliberately:
/// <list type="bullet">
/// <item><description>
/// Turning email on later does not resurrect anything. Notifications scheduled before the decision
/// have no email row and never gain one, so a member who opts in today is not suddenly mailed a
/// month of history they have already read in the app.
/// </description></item>
/// <item><description>
/// Turning email off is still honoured for anything already scheduled: the dispatcher rechecks the
/// current preference immediately before materialization and suppresses the pending row. Selection is
/// what creates work; the recheck is what refuses to do it.
/// </description></item>
/// </list>
/// <para>
/// In-app is selected for every supported notification type and is not conditional on anything. It is
/// passive persisted state that interrupts nobody, and this slice exposes no way to switch it off.
/// </para>
/// </remarks>
public static class NotificationChannelPlanner
{
    /// <summary>Bumped when the rules below change, and snapshotted onto every row they create.</summary>
    public const int PolicyVersion = 1;

    /// <summary>In-app is always selected; there is no preference that removes it.</summary>
    public const string InAppAlways = "notification-channel-inapp-always";

    /// <summary>The recipient opted into service email, and this deployment can send it.</summary>
    public const string EmailServiceOptIn = "notification-channel-email-service-opt-in";

    /// <summary>Marketing email with current affirmative consent. Nothing produces this yet.</summary>
    public const string EmailMarketingConsent = "notification-channel-email-marketing-consent";

    public static IReadOnlyList<NotificationChannelSelection> Plan(
        NotificationPurpose purpose,
        NotificationChannelPlanInputs inputs)
    {
        ArgumentNullException.ThrowIfNull(inputs);
        if (!Enum.IsDefined(purpose))
        {
            throw new ArgumentException("An unknown notification purpose cannot be planned.", nameof(purpose));
        }

        var selections = new List<NotificationChannelSelection>(2)
        {
            new(NotificationChannel.InApp, purpose, InAppAlways),
        };

        if (inputs.EmailChannelAvailable && WantsEmail(purpose, inputs))
        {
            selections.Add(new NotificationChannelSelection(
                NotificationChannel.Email,
                purpose,
                purpose == NotificationPurpose.Marketing ? EmailMarketingConsent : EmailServiceOptIn));
        }

        return selections;
    }

    /// <summary>
    /// The email rule, kept separate so it reads as the two distinct decisions it is. Marketing fails
    /// closed: it requires its own current affirmative consent and can never be carried by the
    /// service-email preference.
    /// </summary>
    private static bool WantsEmail(NotificationPurpose purpose, NotificationChannelPlanInputs inputs) =>
        purpose switch
        {
            NotificationPurpose.ServiceTransactional => inputs.EmailServiceEnabled,
            NotificationPurpose.Marketing => inputs.EmailMarketingConsentGranted,
            _ => false,
        };
}

/// <summary>
/// The purpose of each notification kind this repository produces.
/// </summary>
/// <remarks>
/// Every one of them is service/transactional: it states a fact about a coaching relationship or a
/// service the recipient already has — a payment that is outstanding, access that started, a period
/// that is ending or has ended, a renewal that was created. None of them promotes anything, and none
/// of them may be reclassified to avoid a consent or unsubscribe obligation. The mapping is explicit
/// so adding a kind is a decision about its purpose rather than an inherited default.
/// </remarks>
public static class NotificationPurposeCatalog
{
    public static NotificationPurpose For(CommercialNotificationKind kind) => kind switch
    {
        CommercialNotificationKind.PaymentRequired => NotificationPurpose.ServiceTransactional,
        CommercialNotificationKind.EnrollmentActivated => NotificationPurpose.ServiceTransactional,
        CommercialNotificationKind.EnrollmentEndingSoon => NotificationPurpose.ServiceTransactional,
        CommercialNotificationKind.EnrollmentExpired => NotificationPurpose.ServiceTransactional,
        CommercialNotificationKind.EnrollmentRenewed => NotificationPurpose.ServiceTransactional,
        _ => throw new ArgumentOutOfRangeException(nameof(kind), "An unclassified notification kind cannot be planned."),
    };
}

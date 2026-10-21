namespace TB.Gym.Modules.Notifications;

/// <summary>
/// One rendered template: what a notification of a given kind says, in a given culture, at a given
/// template version.
/// </summary>
public sealed record NotificationTemplate(string Key, int Version, string Culture, string Title, string Body)
{
    public int[]? TargetWeeks { get; init; }
}

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
/// One exception, decided for ADR 0029: a renewal request tells a coach which client asked, since a
/// coach with many clients could not act on "a client asked". Its title carries
/// <see cref="ClientNameToken"/>, which the dispatcher replaces with the client's current name as
/// plain text when the in-app row is written. It is in-app only, so the name never reaches email.
/// A client's note on a workout names the client the same way (R5.1c), and so does a client leaving,
/// to the owner and the coach it tells (audit COACH-12), who could not otherwise learn who left.
/// </para>
/// <para>
/// A second exception, decided for ADR 0036: a notice about weeks of a client's program names those
/// weeks ("week 3", "weeks 3 to 6") through <see cref="WeeksToken"/>. The words come from this class
/// and the payload carries only the numbers. Training notices are in-app only. A note's notice names
/// the workout it is on through <see cref="WorkoutToken"/>, the name the workout kept when it started,
/// read when the row is written (audit UIQ-21); never the note's text.
/// </para>
/// <para>
/// Only culture <c>en</c> exists; Arabic and any other locale are deferred. Each template carries its
/// own version: a wording change publishes the next version of that template alone and leaves every
/// already-delivered snapshot exactly as it was read. Version 2 is the glossary pass of audit COACH-12
/// (the plan and team notices in the screens' words, and the note notices naming the workout).
/// </para>
/// </remarks>
public static class NotificationTemplateCatalog
{
    /// <summary>The only culture with published templates in this slice.</summary>
    public const string DefaultCulture = "en";

    /// <summary>Where a named template takes the client's name: RenewalRequested, ClientLeft and ClientWorkoutNote.</summary>
    public const string ClientNameToken = "{client}";

    /// <summary>Where a week notice takes the weeks it is about (ADR 0036): numbers only, worded here.</summary>
    public const string WeeksToken = "{weeks}";

    /// <summary>Where a note's notice takes the name of the workout it is on (audit UIQ-21).</summary>
    public const string WorkoutToken = "{workout}";

    /// <summary>A client's name is cut to this many characters in a title.</summary>
    private const int MaximumNameLength = 120;

    /// <summary>
    /// A workout's name is cut to this many characters in a title, so a long client name and a long
    /// workout name together stay inside the 200-character column.
    /// </summary>
    private const int MaximumWorkoutNameLength = 60;

    /// <summary>More scattered weeks than this are counted ("6 weeks") rather than listed.</summary>
    private const int MaximumListedWeeks = 4;

    private const int FirstVersion = 1;

    /// <summary>The glossary pass of audit COACH-12 and UIQ-21 (2026-10-21).</summary>
    private const int GlossaryVersion = 2;

    private static readonly Dictionary<CommercialNotificationKind, NotificationTemplate> English = new()
    {
        // The plan notices go to the client and open their Today, which says where the plan stands.
        [CommercialNotificationKind.PaymentRequired] = new NotificationTemplate(
            "commercial.payment-required",
            GlossaryVersion,
            DefaultCulture,
            "Your new plan is waiting for payment",
            "It starts once your coach has your payment."),
        [CommercialNotificationKind.EnrollmentActivated] = new NotificationTemplate(
            "commercial.enrollment-activated",
            GlossaryVersion,
            DefaultCulture,
            "Your plan has started",
            "Open Today to see what your coach has set up for you."),
        [CommercialNotificationKind.EnrollmentEndingSoon] = new NotificationTemplate(
            "commercial.enrollment-ending-soon",
            GlossaryVersion,
            DefaultCulture,
            "Your plan ends soon",
            "If you'd like to keep going, ask your coach to renew it."),
        [CommercialNotificationKind.EnrollmentExpired] = new NotificationTemplate(
            "commercial.enrollment-expired",
            GlossaryVersion,
            DefaultCulture,
            "Your plan has ended",
            "If you'd like to keep going, ask your coach to renew it."),
        // Careful wording: a renewal may still be awaiting payment, so this must not imply that paid
        // or active access already exists. It says only that the next plan was set up.
        [CommercialNotificationKind.EnrollmentRenewed] = new NotificationTemplate(
            "commercial.enrollment-renewed",
            GlossaryVersion,
            DefaultCulture,
            "Your coach set up your next plan",
            "It follows on from this one. Open Today to see where your plan stands."),
        // To the client, naming nobody (CLI-014): the owner has them until they are reassigned.
        [CommercialNotificationKind.CoachDeparted] = new NotificationTemplate(
            "workspace.coach-departed",
            GlossaryVersion,
            DefaultCulture,
            "Your coach has changed",
            "Your coach has left. Another coach looks after you now, and your plan and history stay as they are."),
        // To the owner and the client's coach, naming the client: a coach cannot open Former clients
        // to find out who left.
        [CommercialNotificationKind.ClientLeft] = new NotificationTemplate(
            "workspace.client-left",
            GlossaryVersion,
            DefaultCulture,
            $"{ClientNameToken} left your coaching space",
            "Their record is kept, read-only, under Former clients."),
        // To the owner. Names nobody, like the coach-departure notice; the clients are on the owner's list.
        [CommercialNotificationKind.CoachResigned] = new NotificationTemplate(
            "workspace.coach-resigned",
            GlossaryVersion,
            DefaultCulture,
            "A coach left your team",
            "Their clients and client invitations are yours now. You can reassign them from Clients."),
        // To the client's coach, naming the client (ADR 0029); the inbox links to the client's page.
        [CommercialNotificationKind.RenewalRequested] = new NotificationTemplate(
            "workspace.renewal-requested",
            FirstVersion,
            DefaultCulture,
            $"{ClientNameToken} asked to renew",
            "This client's coaching plan has ended. Open the client's page to set up a renewal."),
        // The training notices (ADR 0036, R5.1c). Each opens the program or the workout it is about.
        [CommercialNotificationKind.ProgramAssigned] = new NotificationTemplate(
            "training.program-assigned",
            FirstVersion,
            DefaultCulture,
            "Your coach set up a new program",
            "Open Training to see your program and its first workouts."),
        [CommercialNotificationKind.WeeksShared] = new NotificationTemplate(
            "training.weeks-shared",
            FirstVersion,
            DefaultCulture,
            $"Your coach shared {WeeksToken}",
            "Open Training to see the workouts."),
        [CommercialNotificationKind.WeeksChanged] = new NotificationTemplate(
            "training.weeks-changed",
            FirstVersion,
            DefaultCulture,
            $"Your coach updated {WeeksToken}",
            "Open Training to see your workouts as they are now."),
        // The workout's name, never the note's text, which can be about an injury.
        [CommercialNotificationKind.CoachWorkoutNote] = new NotificationTemplate(
            "training.coach-workout-note",
            GlossaryVersion,
            DefaultCulture,
            $"Your coach left a note on {WorkoutToken}",
            "Open the workout to read it."),
        [CommercialNotificationKind.ClientWorkoutNote] = new NotificationTemplate(
            "training.client-workout-note",
            GlossaryVersion,
            DefaultCulture,
            $"{ClientNameToken} left a note on {WorkoutToken}",
            "Open the workout on the client's Training to read it."),
    };

    /// <summary>
    /// Puts a client's name into a named template's title. The name is data, inserted as plain text
    /// and shortened, never interpreted; a template without the token is returned unchanged.
    /// </summary>
    public static NotificationTemplate NameClient(NotificationTemplate template, string clientName) =>
        Fill(template, ShortClientName(clientName), null);

    /// <summary>
    /// Puts the name of the workout a note is on into a note notice's title, as plain text and
    /// shortened with an ellipsis; a workout with no name reads "a workout". A template without the
    /// token is returned unchanged.
    /// </summary>
    public static NotificationTemplate NameWorkout(NotificationTemplate template, string? workoutName) =>
        Fill(template, null, ShortWorkoutName(workoutName));

    /// <summary>
    /// Both names at once, in one pass over the template's own words, so a client called "{workout}"
    /// or a workout called "{client}" is written out as typed rather than filled in.
    /// </summary>
    public static NotificationTemplate NameClientAndWorkout(
        NotificationTemplate template,
        string clientName,
        string? workoutName) =>
        Fill(template, ShortClientName(clientName), ShortWorkoutName(workoutName));

    private static string ShortClientName(string clientName)
    {
        var name = clientName.Trim();
        return name.Length > MaximumNameLength ? name[..MaximumNameLength] : name;
    }

    private static string ShortWorkoutName(string? workoutName)
    {
        var name = (workoutName ?? string.Empty).Trim();
        if (name.Length == 0)
        {
            return "a workout";
        }

        return name.Length > MaximumWorkoutNameLength
            ? string.Concat(name.AsSpan(0, MaximumWorkoutNameLength - 1).TrimEnd(), "…")
            : name;
    }

    /// <summary>Replaces the tokens of the template's title only; what a name holds is never read for tokens.</summary>
    private static NotificationTemplate Fill(NotificationTemplate template, string? clientName, string? workoutName)
    {
        var title = template.Title;
        var filled = new System.Text.StringBuilder(title.Length + 64);
        var index = 0;
        while (index < title.Length)
        {
            var rest = title.AsSpan(index);
            if (clientName is not null && rest.StartsWith(ClientNameToken, StringComparison.Ordinal))
            {
                filled.Append(clientName);
                index += ClientNameToken.Length;
            }
            else if (workoutName is not null && rest.StartsWith(WorkoutToken, StringComparison.Ordinal))
            {
                filled.Append(workoutName);
                index += WorkoutToken.Length;
            }
            else
            {
                filled.Append(title[index]);
                index++;
            }
        }

        return template with { Title = filled.ToString() };
    }

    /// <summary>
    /// Puts the weeks a notice is about into its title: "week 3", "weeks 3 and 5", "weeks 3 to 6",
    /// "weeks 2, 4 and 7", or "6 weeks" when more than four are scattered. Only positive numbers are
    /// read, so nothing a person typed can reach the wording.
    /// </summary>
    public static NotificationTemplate NameWeeks(NotificationTemplate template, IEnumerable<int> weeks) =>
        template with
        {
            Title = template.Title.Replace(WeeksToken, DescribeWeeks(weeks), StringComparison.Ordinal),
            TargetWeeks = weeks.Where(week => week > 0).Distinct().Order().ToArray(),
        };

    public static string DescribeWeeks(IEnumerable<int> weeks)
    {
        var numbers = weeks.Where(week => week > 0).Distinct().Order().ToArray();
        if (numbers.Length == 0)
        {
            throw new ArgumentException("At least one week is required.", nameof(weeks));
        }

        var culture = System.Globalization.CultureInfo.InvariantCulture;
        if (numbers.Length == 1)
        {
            return string.Create(culture, $"week {numbers[0]}");
        }

        if (numbers.Length > 2 && numbers[^1] - numbers[0] == numbers.Length - 1)
        {
            return string.Create(culture, $"weeks {numbers[0]} to {numbers[^1]}");
        }

        if (numbers.Length > MaximumListedWeeks)
        {
            return string.Create(culture, $"{numbers.Length} weeks");
        }

        var listed = string.Join(", ", numbers[..^1].Select(week => week.ToString(culture)));
        return string.Create(culture, $"weeks {listed} and {numbers[^1]}");
    }

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

        return English.TryGetValue(kind, out template!);
    }

    /// <summary>Every published template, for tests and for documentation of the allowlist.</summary>
    public static IReadOnlyCollection<NotificationTemplate> Published => English.Values;

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
        FirstVersion,
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

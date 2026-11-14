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
/// A house trainee asking for a plan, and saying its money was sent, names the trainee the same way to the house's
/// Owner and the trainee's coach (SUB-020); never the plan, a price or the trainee's Whish details.
/// </para>
/// <para>
/// A second exception, decided for ADR 0036: a notice about weeks of a client's program names those
/// weeks ("week 3", "weeks 3 to 6") through <see cref="WeeksToken"/>. The words come from this class
/// and the payload carries only the numbers. Training notices are in-app only. A note's notice names
/// the workout it is on through <see cref="WorkoutToken"/>, the name the workout kept when it started,
/// read when the row is written (audit UIQ-21); never the note's text.
/// </para>
/// <para>
/// Only culture <c>en</c> exists; Arabic and any other locale are deferred, and a workspace that chose
/// Arabic is answered in English until they are (audit INV-8). Each template carries its
/// own version: a wording change publishes the next version of that template alone and leaves every
/// already-delivered snapshot exactly as it was read. Version 2 is the glossary pass of audit COACH-12
/// (the plan and team notices in the screens' words, and the note notices naming the workout). Critique B14's are
/// <see cref="MyPlanVersion"/>, <see cref="PackMyPlanVersion"/> and <see cref="AskBeforeTheEndVersion"/>.
/// </para>
/// <para>
/// A session pack hears the plan notices in its own words (critique B10c, SES-009): it runs beside a coaching plan, so
/// "your plan has ended" could name the wrong thing. They are as generic as the rest, with no count and no date: the
/// screens behind them say how many are left. The kind stays the plan's; only the wording differs.
/// </para>
/// </remarks>
public static class NotificationTemplateCatalog
{
    /// <summary>The only culture with published templates in this slice.</summary>
    public const string DefaultCulture = "en";

    /// <summary>
    /// Where a named template takes the client's name: RenewalRequested, ClientLeft, ClientWorkoutNote, HousePlanAsked
    /// and HousePlanMoneySent.
    /// </summary>
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

    /// <summary>A plan's renewal notice names My plan, the page it opens (critique B14, 2026-10-31).</summary>
    private const int MyPlanVersion = 3;

    /// <summary>A pack's renewal notice names My plan too.</summary>
    private const int PackMyPlanVersion = 2;

    /// <summary>A client may ask before the end, so the coach's notice no longer says the plan has ended (critique B14).</summary>
    private const int AskBeforeTheEndVersion = 2;

    /// <summary>A departing coach's clients wait for a coach instead of moving to the owner (C8, notes plan N9d1b).</summary>
    private const int WaitingVersion = 3;

    private static readonly Dictionary<CommercialNotificationKind, NotificationTemplate> English = new()
    {
        // The plan notices go to the client and open My plan, which says where the plan stands and offers Ask to renew;
        // "Your plan has started" opens Today, where the first workout is (critique B14).
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
            MyPlanVersion,
            DefaultCulture,
            "Your coach set up your next plan",
            "It follows on from this one. Open My plan to see where your plan stands."),
        // To the client, naming nobody (CLI-014): they wait for a coach until the owner gives them one, and are told
        // then (CoachAssigned). No promise to train on: a blocked client or one whose plan ended is told this too.
        [CommercialNotificationKind.CoachDeparted] = new NotificationTemplate(
            "workspace.coach-departed",
            WaitingVersion,
            DefaultCulture,
            "Your coach has left",
            "Your coaching space will give you a new coach and tell you when it does. Your plan and history stay as they are."),
        // To the owner and the client's coach, naming the client: a coach cannot open Former clients
        // to find out who left.
        [CommercialNotificationKind.ClientLeft] = new NotificationTemplate(
            "workspace.client-left",
            GlossaryVersion,
            DefaultCulture,
            $"{ClientNameToken} left your coaching space",
            "Their record is kept, read-only, under Former clients."),
        // To the owner. Names nobody, like the coach-departure notice; the waiting clients are on Clients and Today, and
        // nothing gives a pending invitation a coach, so the words promise none.
        [CommercialNotificationKind.CoachResigned] = new NotificationTemplate(
            "workspace.coach-resigned",
            WaitingVersion,
            DefaultCulture,
            "A coach left your team",
            "Their clients now wait for a coach, as will anyone who accepts one of their invitations. Give each one a coach from Clients, yourself included."),
        // To the client's coach, naming the client (ADR 0029); the inbox links to the client's page.
        [CommercialNotificationKind.RenewalRequested] = new NotificationTemplate(
            "workspace.renewal-requested",
            AskBeforeTheEndVersion,
            DefaultCulture,
            $"{ClientNameToken} asked to renew",
            "Open the client's page to set up a renewal."),
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
        // The house's money notices (SUB-020), to its Owner and the trainee's coach, naming the trainee; the inbox
        // links to the client's page, where the ask is.
        [CommercialNotificationKind.HousePlanAsked] = new NotificationTemplate(
            "workspace.house-plan-asked",
            FirstVersion,
            DefaultCulture,
            $"{ClientNameToken} asked for a plan",
            "Open the client's page to see the ask. Book the plan once the money is there."),
        [CommercialNotificationKind.HousePlanMoneySent] = new NotificationTemplate(
            "workspace.house-plan-money-sent",
            FirstVersion,
            DefaultCulture,
            $"{ClientNameToken} says the money is sent",
            "Check the Whish account, then book the plan from the client's page."),
        // To the client on every coach change the owner makes, the owner taking them included (C8, CLI-014). Names
        // nobody, like the departure notice: the client's own screens say who coaches them now.
        [CommercialNotificationKind.CoachAssigned] = new NotificationTemplate(
            "workspace.coach-assigned",
            FirstVersion,
            DefaultCulture,
            "You have a new coach",
            "Open Today to see who coaches you now. Your plan and history stay as they are."),
        // To a self-directed trainee of the house (CLI-026), who trains as their own coach: what changed is who on the
        // team may read their training (C8, CLI-013). Names nobody.
        [CommercialNotificationKind.TraineeStaffChanged] = new NotificationTemplate(
            "workspace.trainee-staff-changed",
            FirstVersion,
            DefaultCulture,
            "Who can see your training changed",
            "Another member of your coaching space's team can now see your training and progress. Your plan and history stay as they are."),
    };

    /// <summary>The plan notices as a session pack hears them (SES-009), in English like the rest.</summary>
    private static readonly Dictionary<CommercialNotificationKind, NotificationTemplate> PackEnglish = new()
    {
        [CommercialNotificationKind.PaymentRequired] = new NotificationTemplate(
            "commercial.pack-payment-required",
            FirstVersion,
            DefaultCulture,
            "Your new 1-on-1 sessions are waiting for payment",
            "They start once your coach has your payment."),
        [CommercialNotificationKind.EnrollmentActivated] = new NotificationTemplate(
            "commercial.pack-activated",
            FirstVersion,
            DefaultCulture,
            "Your 1-on-1 sessions are ready",
            "Open Today to see how many you have."),
        [CommercialNotificationKind.EnrollmentEndingSoon] = new NotificationTemplate(
            "commercial.pack-ending-soon",
            FirstVersion,
            DefaultCulture,
            "Your 1-on-1 sessions end soon",
            "If you'd like to keep going, ask your coach to renew them."),
        [CommercialNotificationKind.EnrollmentExpired] = new NotificationTemplate(
            "commercial.pack-expired",
            FirstVersion,
            DefaultCulture,
            "Your 1-on-1 sessions have ended",
            "If you'd like to keep going, ask your coach to renew them."),
        // Careful wording, as for a plan's renewal: it may still be waiting for payment.
        [CommercialNotificationKind.EnrollmentRenewed] = new NotificationTemplate(
            "commercial.pack-renewed",
            PackMyPlanVersion,
            DefaultCulture,
            "Your coach set up more 1-on-1 sessions",
            "Open My plan to see where your sessions stand."),
    };

    /// <summary>The wordings by language; only English is written so far (audit INV-8).</summary>
    private static readonly Dictionary<string, Dictionary<CommercialNotificationKind, NotificationTemplate>> Wordings =
        new(StringComparer.OrdinalIgnoreCase) { [DefaultCulture] = English };

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
    /// Resolves the template for a kind in a workspace's language, or reports that the kind has no
    /// published wording at all. A missing kind is a permanent dead letter rather than a retry: no
    /// amount of waiting will make an unpublished wording appear.
    /// </summary>
    /// <remarks>
    /// A kind not yet worded in the workspace's language, such as every kind in Arabic, gets English,
    /// the source language, so a coaching space that chose it still hears every notice (audit INV-8:
    /// refusing it stopped every notice of that space). The fallback is per kind, so a language worded
    /// in part never stops the kinds it lacks. The template keeps its own culture, so the notice records
    /// the English it was written in and never claims to be Arabic.
    /// </remarks>
    public static bool TryResolve(
        CommercialNotificationKind kind,
        string culture,
        out NotificationTemplate template)
    {
        // `en-LB` resolves to `en` by language.
        if (Wordings.TryGetValue(LanguageOf(culture), out var wording) && wording.TryGetValue(kind, out template!))
        {
            return true;
        }

        return English.TryGetValue(kind, out template!);
    }

    /// <summary>
    /// A plan notice for an enrollment, in a session pack's own words when it is one (SES-009); any other kind, and any
    /// plan, as <see cref="TryResolve(CommercialNotificationKind, string, out NotificationTemplate)"/> answers it.
    /// </summary>
    public static bool TryResolveForEnrollment(
        CommercialNotificationKind kind,
        string culture,
        bool isSessionPack,
        out NotificationTemplate template) =>
        (isSessionPack && PackEnglish.TryGetValue(kind, out template!)) || TryResolve(kind, culture, out template);

    /// <summary>Every published template, for tests and for documentation of the allowlist.</summary>
    public static IReadOnlyCollection<NotificationTemplate> Published => [.. English.Values, .. PackEnglish.Values];

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

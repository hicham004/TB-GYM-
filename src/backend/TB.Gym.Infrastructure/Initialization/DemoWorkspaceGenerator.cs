using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Modules.CheckIns;
using TB.Gym.Modules.ExerciseLibrary;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Invitations;
using TB.Gym.Modules.Nutrition;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;
using TB.Gym.Modules.Training;
using static TB.Gym.Infrastructure.Initialization.DemoStepFailedException;
using static TB.Gym.Infrastructure.Initialization.DemoWorkspaceCast;

namespace TB.Gym.Infrastructure.Initialization;

/// <summary>
/// Builds the Atlas Performance demo by doing what its people would have done, through the same
/// application services the API calls, one step at a time on a clock that walks through the last
/// eleven weeks. Nothing is inserted behind the services' backs, so every business rule, snapshot and
/// audit row is the one the product would have produced.
/// </summary>
/// <remarks>
/// The endpoint policies are not in the path, so each step runs as the person whose job it is: the
/// owner builds the library, each coach manages only their own clients, and clients do their own
/// logging. The services still apply their own scoping (a Coach reaching another coach's client
/// fails here exactly as it would over HTTP).
/// </remarks>
internal sealed partial class DemoWorkspaceGenerator
{
    private readonly IServiceProvider services;
    private readonly DemoClock clock;
    private readonly DemoCalendar calendar;
    private readonly DemoRequests requests;
    private readonly DemoTimeline timeline;
    private readonly string password;
    private readonly IReadOnlyList<DemoClient> clients;
    private readonly CancellationToken cancellationToken;

    private readonly Dictionary<string, Guid> staffUserIds = [];
    private readonly Dictionary<string, Guid> exerciseIds = [];
    private readonly Dictionary<Guid, DemoExercise> exercisesById = [];
    private readonly Dictionary<DemoOffer, Guid> offerIds = [];
    private readonly Dictionary<string, Guid> templateVersionIds = [];
    private readonly DemoWorkspaceTally tally = new();
    private Guid tenantId;
    private Guid checkInFormVersionId;
    private Guid mealPlanVersionId;

    public DemoWorkspaceGenerator(
        IServiceProvider services,
        DemoClock clock,
        string password,
        IReadOnlyList<DemoClient> clients,
        CancellationToken cancellationToken)
    {
        this.services = services;
        this.clock = clock;
        this.password = password;
        this.clients = clients;
        this.cancellationToken = cancellationToken;
        calendar = new DemoCalendar(DateTimeOffset.UtcNow, TimeZoneId);
        clock.Rewind(calendar.At(WorkspaceCreatedDay, 9, 0));
        requests = new DemoRequests(services);
        timeline = new DemoTimeline(clock);
    }

    public async Task<DemoWorkspaceTally> GenerateAsync(TextWriter output)
    {
        PlanWorkspace();
        foreach (var client in clients)
        {
            // Each client keeps their place in the cast, so their story is the same in any subset.
            PlanClient(new DemoClientState(client), IndexOf(client));
        }

        PlanPendingInvitations();
        tally.Steps = await timeline.RunAsync(output, cancellationToken);
        return tally;
    }

    private void PlanWorkspace()
    {
        var day = WorkspaceCreatedDay;
        timeline.At(calendar.At(day, 9, 30), "open the workspace", OpenWorkspaceAsync);
        timeline.At(calendar.At(day, 10, 0), "build the exercise library", BuildExerciseLibraryAsync);
        timeline.At(calendar.At(day, 10, 40), "create the products", CreateProductsAsync);
        timeline.At(calendar.At(day, 11, 0), "publish the check-in form", PublishCheckInFormAsync);
        timeline.At(calendar.At(day, 11, 30), "build the programs", BuildProgramsAsync);
        timeline.At(calendar.At(day, 12, 0), "build the meal plan", BuildMealPlanAsync);

        var acceptances = new[] { calendar.At(day + 1, 18, 10), calendar.At(day + 2, 9, 30) };
        for (var index = 0; index < Coaches.Count; index++)
        {
            var coach = Coaches[index];
            var acceptAt = acceptances[index];
            timeline.At(calendar.At(day + 1, 11, index * 5), $"invite coach {coach.FirstName}",
                () => InviteCoachAsync(coach, acceptAt));
        }
    }

    private async Task OpenWorkspaceAsync()
    {
        var result = await As<IWorkspaceApplicationService, WorkspaceRegistrationResult>(
            DemoActor.Anonymous,
            (service, token) => service.RegisterCoachAsync(
                new RegisterCoachRequest(
                    Owner.DisplayName,
                    Owner.Email,
                    password,
                    WorkspaceName,
                    TimeZoneId,
                    "en-LB",
                    Currency,
                    DayOfWeek.Monday),
                token));
        Require(result.Status == WorkspaceRegistrationStatus.Created, "open the workspace", result);

        var ownerId = await ConfirmEmailAsync(Owner.Email);
        staffUserIds[Owner.Key] = ownerId;
        await using var scope = services.CreateAsyncScope();
        var memberships = await scope.ServiceProvider.GetRequiredService<ITenantMembershipStore>()
            .ListForUserAsync(ownerId, cancellationToken);
        tenantId = memberships.Single().TenantId;
    }

    private async Task BuildExerciseLibraryAsync()
    {
        foreach (var exercise in Exercises)
        {
            var result = await As<IExerciseLibraryApplicationService, ExerciseCommandResult>(
                OwnerActor,
                (service, token) => service.CreateAsync(
                    new CreateExerciseRequest(
                        exercise.Name,
                        exercise.Instructions,
                        exercise.Equipment,
                        exercise.Pattern,
                        exercise.Classification,
                        [.. exercise.Muscles.Select(muscle => new ExerciseMuscleRequest(muscle.Muscle, muscle.Role))],
                        exercise.Tags,
                        [.. exercise.AlternativeKeys.Select(key => new ExerciseAlternativeRequest(exerciseIds[key], null))],
                        []),
                    token));
            var created = Require(result.Exercise, result.Status == ExerciseCommandStatus.Success, $"create {exercise.Name}", result);
            exerciseIds[exercise.Key] = created.Id;
            exercisesById[created.Id] = exercise;
        }
    }

    private async Task CreateProductsAsync()
    {
        foreach (var product in Products)
        {
            var first = product.Offers[0];
            var result = await As<ICommercialApplicationService, CommercialCommandResult>(
                OwnerActor,
                (service, token) => service.CreateProductAsync(
                    new CreateCoachingProductRequest(product.Name, product.Description, OfferRequest(product, first)),
                    token));
            var created = Require(result.Product, result.Status == CommercialCommandStatus.Success, $"create {product.Name}", result);
            offerIds[first.Offer] = created.Offers.Single().Id;

            foreach (var offer in product.Offers.Skip(1))
            {
                var added = await As<ICommercialApplicationService, CommercialCommandResult>(
                    OwnerActor,
                    (service, token) => service.AddOfferAsync(created.Id, OfferRequest(product, offer), token));
                var updated = Require(added.Product, added.Status == CommercialCommandStatus.Success, $"add {offer.Label}", added);
                offerIds[offer.Offer] = updated.Offers.Single(item => item.Label == offer.Label).Id;
            }
        }
    }

    private static CreateProductOfferRequest OfferRequest(DemoProduct product, DemoOfferInfo offer) =>
        new(
            offer.Label,
            offer.Weeks,
            OfferDurationUnit.Week,
            offer.Price,
            Currency,
            [.. product.Features.Select(feature => new OfferFeatureRequest(feature))]);

    private async Task PublishCheckInFormAsync()
    {
        var form = DemoWorkspaceCast.CheckInForm;
        var created = await As<ICheckInApplicationService, CheckInFormCommandResult>(
            OwnerActor,
            (service, token) => service.CreateFormAsync(
                new CreateCheckInFormRequest(
                    form.Title,
                    form.Description,
                    [.. form.Questions.Select(question => new CheckInQuestionRequest(
                        question.Type,
                        question.Prompt,
                        question.IsRequired,
                        QuestionKey: null,
                        question.HelpText,
                        question.ScaleMinimum,
                        question.ScaleMaximum,
                        question.ScaleStep,
                        question.Options))]),
                token));
        var details = Require(created.Form, created.Status == CheckInCommandStatus.Success, "create the check-in form", created);
        var draft = details.Versions.Single(version => version.Id == details.Form.DraftVersionId);
        var published = await As<ICheckInApplicationService, CheckInVersionCommandResult>(
            OwnerActor,
            (service, token) => service.PublishVersionAsync(
                details.Form.Id,
                draft.Id,
                new CheckInConcurrencyRequest(draft.Version),
                token));
        checkInFormVersionId = Require(
            published.Version,
            published.Status == CheckInCommandStatus.Success,
            "publish the check-in form",
            published).Id;
    }

    private async Task BuildProgramsAsync()
    {
        foreach (var program in Programs)
        {
            var result = await As<ITrainingApplicationService, TrainingCommandResult>(
                OwnerActor,
                (service, token) => service.CreateTemplateAsync(TemplateRequest(program), token));
            templateVersionIds[program.Key] = Require(
                result.TemplateVersion,
                result.Status == TrainingCommandStatus.Success,
                $"build {program.Name}",
                result).Id;
        }
    }

    private SaveProgramTemplateRequest TemplateRequest(DemoProgram program) =>
        new(
            program.Name,
            program.Description,
            Publish: true,
            TemplateVersion: null,
            [.. program.Weeks.Select(week => new TrainingWeekRequest(
                week.Label,
                IsPublished: true,
                [.. program.Sessions.Select(session => new TrainingSessionRequest(
                    session.Name,
                    session.DayOffset,
                    session.CoachNotes,
                    [.. session.Exercises.Select((exercise, position) => Prescription(exercise, position, week))]))]))]);

    private ExercisePrescriptionRequest Prescription(DemoExercisePlan plan, int position, DemoWeekScheme week)
    {
        var alternatives = Exercise(plan.ExerciseKey).AlternativeKeys.Select(key => exerciseIds[key]).ToList();
        var sets = plan.IsMainLift
            ? Enumerable.Range(0, week.MainSets).Select(index => new SetPrescriptionRequest(
                index,
                TrainingSetType.Normal,
                week.MainReps,
                week.MainReps,
                TrainingLoadStrategy.PercentageWorkingMax,
                DirectLoad: null,
                TrainingLoadUnit.Kilogram,
                week.Percent,
                week.MainRpe,
                TargetRir: null,
                ExertionDisplayPreference.Rpe,
                RestSeconds: 180,
                Tempo: null,
                CoachNotes: null))
            : Enumerable.Range(0, Math.Max(1, plan.Sets - (week.IsDeload ? 1 : 0))).Select(index => new SetPrescriptionRequest(
                index,
                TrainingSetType.Normal,
                plan.RepsMinimum,
                plan.RepsMaximum,
                TrainingLoadStrategy.None,
                DirectLoad: null,
                LoadUnit: null,
                PercentageWorkingMax: null,
                week.IsDeload ? 7m : 8m,
                TargetRir: null,
                ExertionDisplayPreference.Rpe,
                RestSeconds: 90,
                Tempo: null,
                CoachNotes: null));
        return new ExercisePrescriptionRequest(
            exerciseIds[plan.ExerciseKey],
            position,
            plan.IsMainLift,
            alternatives.Count > 0 ? PrescriptionModificationPolicy.CoachApprovedSwap : PrescriptionModificationPolicy.Locked,
            CoachNotes: null,
            alternatives,
            [.. sets]);
    }

    private async Task InviteCoachAsync(DemoStaff coach, DateTimeOffset acceptAt)
    {
        var result = await As<IInvitationApplicationService, InvitationCommandResult>(
            OwnerActor,
            (service, token) => service.CreateCoachAsync(
                new CreateCoachInvitationRequest(coach.Email, coach.FirstName, coach.LastName),
                token));
        var invitation = Require(result.Invitation, result.Status == InvitationCommandStatus.Success, $"invite {coach.FirstName}", result);
        var link = InvitationToken(invitation);
        timeline.At(acceptAt, $"{coach.FirstName} joins the team", async () =>
        {
            var accepted = await As<IInvitationApplicationService, InvitationAcceptanceResult>(
                DemoActor.Anonymous,
                (service, token) => service.AcceptAsync(
                    new AcceptClientInvitationRequest(link, coach.DisplayName, password),
                    token));
            Require(accepted.Status == InvitationAcceptanceStatus.Accepted, $"{coach.FirstName} accepts", accepted);
            staffUserIds[coach.Key] = await FindUserIdAsync(coach.Email);
        });
    }

    private void PlanPendingInvitations()
    {
        foreach (var invite in PendingInvites)
        {
            timeline.At(calendar.Ago(invite.Ago), $"invite {invite.FirstName}", async () =>
            {
                var result = await As<IInvitationApplicationService, InvitationCommandResult>(
                    StaffActor(invite.CoachKey),
                    (service, token) => service.CreateAsync(
                        new CreateClientInvitationRequest(invite.Email, invite.FirstName, invite.LastName, null, null),
                        token));
                Require(result.Status == InvitationCommandStatus.Success, $"invite {invite.FirstName}", result);
                tally.PendingInvitations++;
            });
        }
    }

    private DemoActor OwnerActor => StaffActor(Owner.Key);

    private DemoActor StaffActor(string key) => new(staffUserIds[key], tenantId);

    private Task<TResult> As<TService, TResult>(
        DemoActor actor,
        Func<TService, CancellationToken, Task<TResult>> call)
        where TService : notnull =>
        requests.AsAsync<TService, TResult>(actor, service => call(service, cancellationToken));

    /// <summary>The token from the link the invitee would have received, captured in development.</summary>
    private static string InvitationToken(InvitationSummary invitation)
    {
        var link = invitation.DevelopmentActionUrl
            ?? throw new DemoStepFailedException(
                $"invite {invitation.Email}",
                "No invitation link was captured. The demo needs the development mail capture, so leave email unconfigured.");
        return QueryHelpers.ParseQuery(new Uri(link).Query)["token"].ToString();
    }

    /// <summary>The owner confirms their address as they would from the email, without a mailbox.</summary>
    private async Task<Guid> ConfirmEmailAsync(string email)
    {
        await using var scope = services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = await users.FindByEmailAsync(email)
            ?? throw new DemoStepFailedException("confirm the owner's email", "The account was not created.");
        if (!user.EmailConfirmed)
        {
            var confirmation = await users.GenerateEmailConfirmationTokenAsync(user);
            var confirmed = await users.ConfirmEmailAsync(user, confirmation);
            Require(confirmed.Succeeded, "confirm the owner's email", confirmed.Errors);
        }

        return user.Id;
    }

    private async Task<Guid> FindUserIdAsync(string email)
    {
        await using var scope = services.CreateAsyncScope();
        var user = await scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>().FindByEmailAsync(email);
        return user?.Id ?? throw new DemoStepFailedException($"find {email}", "The account was not created.");
    }
}

/// <summary>What the demo did, for the command's closing summary.</summary>
internal sealed class DemoWorkspaceTally
{
    public int Steps { get; set; }

    public int Clients { get; set; }

    public int PendingInvitations { get; set; }

    public int Workouts { get; set; }

    public int Sets { get; set; }

    public int PersonalBests { get; set; }

    public int WeighIns { get; set; }

    public int Measurements { get; set; }

    public int CheckInsSubmitted { get; set; }

    public int CheckInsReviewed { get; set; }

    public int Messages { get; set; }
}

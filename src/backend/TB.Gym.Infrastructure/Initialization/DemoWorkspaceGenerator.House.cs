using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Invitations;
using TB.Gym.Modules.Tenancy;
using static TB.Gym.Infrastructure.Initialization.DemoStepFailedException;
using static TB.Gym.Infrastructure.Initialization.DemoWorkspaceCast;

namespace TB.Gym.Infrastructure.Initialization;

/// <summary>
/// TB Gym's own coaching space beside the demo's (notes plan N9a2, ADR 0041): its owner opens it as a coach
/// opens a space, the platform-admin command marks it as the house (the only way a space is marked, CLI-022),
/// and its coach joins the team by invitation. Nobody signs up: every way a trainee arrives needs the house's
/// settings filled, which are the platform admin's to type (CLI-023), so the demo leaves them empty and its
/// sign-up closed. A live pass fills them on its own copy from the House page.
/// </summary>
internal sealed partial class DemoWorkspaceGenerator
{
    private Guid houseTenantId;
    private Guid houseOwnerId;

    /// <summary>The morning the demo's business opens, a little before it: nothing of Atlas depends on it.</summary>
    private void PlanHouse()
    {
        var day = WorkspaceCreatedDay;
        timeline.At(calendar.At(day, 9, 5), "open TB Gym's coaching space", OpenHouseAsync);
        timeline.At(calendar.At(day, 9, 10), "mark it as the house", MarkHouseAsync);
        timeline.At(calendar.At(day, 9, 15), "invite the house's coach", InviteHouseCoachAsync);
    }

    private async Task OpenHouseAsync()
    {
        var legalDocuments = await LegalDocumentsAsync(LegalAudience.Owner);
        var result = await As<IWorkspaceApplicationService, WorkspaceRegistrationResult>(
            DemoActor.Anonymous,
            (service, token) => service.RegisterCoachAsync(
                new RegisterCoachRequest(
                    HouseOwner.DisplayName,
                    HouseOwner.Email,
                    password,
                    HouseName,
                    TimeZoneId,
                    "en-LB",
                    Currency,
                    DayOfWeek.Monday,
                    legalDocuments),
                token));
        Require(result.Status == WorkspaceRegistrationStatus.Created, "open TB Gym's coaching space", result);

        houseOwnerId = await ConfirmEmailAsync(HouseOwner.Email);
        await using var scope = services.CreateAsyncScope();
        var memberships = await scope.ServiceProvider.GetRequiredService<ITenantMembershipStore>()
            .ListForUserAsync(houseOwnerId, cancellationToken);
        houseTenantId = memberships.Single().TenantId;
        tally.House = true;
    }

    private async Task MarkHouseAsync()
    {
        using var said = new StringWriter();
        var exit = await PlatformAdminCommand.RunAsync(
            services,
            [PlatformAdminCommand.Name, "house", "set", houseTenantId.ToString()],
            said);
        Require(exit == 0, "mark it as the house", said.ToString());
    }

    private async Task InviteHouseCoachAsync()
    {
        var result = await As<IInvitationApplicationService, InvitationCommandResult>(
            new DemoActor(houseOwnerId, houseTenantId),
            (service, token) => service.CreateCoachAsync(
                new CreateCoachInvitationRequest(HouseCoach.Email, HouseCoach.FirstName, HouseCoach.LastName),
                token));
        var invitation = Require(
            result.Invitation,
            result.Status == InvitationCommandStatus.Success,
            $"invite {HouseCoach.FirstName}",
            result);
        var link = InvitationToken(invitation);
        timeline.At(calendar.At(WorkspaceCreatedDay + 1, 10, 0), $"{HouseCoach.FirstName} joins TB Gym's team", async () =>
        {
            var legalDocuments = await LegalDocumentsAsync(LegalAudience.Coach);
            var accepted = await As<IInvitationApplicationService, InvitationAcceptanceResult>(
                DemoActor.Anonymous,
                (service, token) => service.AcceptAsync(
                    new AcceptClientInvitationRequest(link, HouseCoach.DisplayName, password, legalDocuments),
                    token));
            Require(accepted.Status == InvitationAcceptanceStatus.Accepted, $"{HouseCoach.FirstName} accepts", accepted);
        });
    }
}

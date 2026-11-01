using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Training;

/// <summary>
/// What a coach keeps from a client's Training page (TRN-031, critique B19). One row per client once a
/// coach has chosen: no row is the default, so a client sees their finished programs until then. It
/// belongs to the client's profile, so a returning client, on a new profile, starts from the default.
/// </summary>
public sealed class ClientProgramVisibility : TenantEntity
{
    private ClientProgramVisibility()
    {
    }

    private ClientProgramVisibility(Guid tenantId, Guid clientProfileId, bool canSeeFinishedPrograms)
        : base(tenantId)
    {
        if (clientProfileId == Guid.Empty)
        {
            throw new ArgumentException("A client id is required.", nameof(clientProfileId));
        }

        ClientProfileId = clientProfileId;
        CanSeeFinishedPrograms = canSeeFinishedPrograms;
    }

    public Guid ClientProfileId { get; private set; }

    public bool CanSeeFinishedPrograms { get; private set; }

    public static ClientProgramVisibility Choose(
        Guid tenantId,
        Guid clientProfileId,
        bool canSeeFinishedPrograms) =>
        new(tenantId, clientProfileId, canSeeFinishedPrograms);

    public void SetCanSeeFinishedPrograms(bool canSee) => CanSeeFinishedPrograms = canSee;
}

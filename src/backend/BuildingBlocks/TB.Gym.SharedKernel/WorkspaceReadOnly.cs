namespace TB.Gym.SharedKernel;

/// <summary>
/// Endpoint metadata: this state-changing route stays open to an owner or coach while their workspace
/// is read-only for an unpaid bill (ADR 0028). Only for reads sent as POST and for a person's own
/// settings, never for workspace content. The tenant authorization handler is what reads it, and an
/// integration test pins the exact list, so adding one is a deliberate decision.
/// </summary>
public sealed class AllowedWhileWorkspaceReadOnly
{
    public static readonly AllowedWhileWorkspaceReadOnly Instance = new();

    private AllowedWhileWorkspaceReadOnly()
    {
    }
}

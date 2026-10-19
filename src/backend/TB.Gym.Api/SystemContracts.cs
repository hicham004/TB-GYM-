namespace TB.Gym.Api;

/// <param name="EmailAvailable">
/// False when this deployment sends no email at all (audit LOST-1), so invitations, the end of
/// coaching and every other mail would only wait. Screens read it before a coach acts, to say so
/// instead of promising an email. It describes the deployment, not a person, so it is public.
/// </param>
public sealed record SystemStatusResponse(
    string Name,
    string Architecture,
    string Framework,
    DateTimeOffset UtcTime,
    bool EmailAvailable);

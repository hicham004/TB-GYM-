namespace TB.Gym.Api;

/// <param name="EmailAvailable">
/// False when this deployment sends no email at all (audit LOST-1), so invitations, the end of
/// coaching and every other mail would only wait. Screens read it before a coach acts, to say so
/// instead of promising an email. It describes the deployment, not a person, so it is public.
/// </param>
/// <param name="MediaUploadsAvailable">
/// False when this deployment has no media storage or no upload scanner set up (ADR 0023 fails
/// closed), so every upload would be refused. Screens read it before a coach tries one, to say that
/// uploads are not set up here and that video links still work (critique T25). A provider that is
/// set up but not answering is an outage, said after the try, so it does not change this.
/// </param>
public sealed record SystemStatusResponse(
    string Name,
    string Architecture,
    string Framework,
    DateTimeOffset UtcTime,
    bool EmailAvailable,
    bool MediaUploadsAvailable);

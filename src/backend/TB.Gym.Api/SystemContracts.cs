namespace TB.Gym.Api;

public sealed record SystemStatusResponse(
    string Name,
    string Architecture,
    string Framework,
    DateTimeOffset UtcTime);

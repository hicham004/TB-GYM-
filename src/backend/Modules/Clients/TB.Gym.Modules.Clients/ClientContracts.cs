using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Clients;

public interface IClientProfileRepository
{
    Task<IReadOnlyList<ClientSummary>> ListAsync(CancellationToken cancellationToken);

    Task AddAsync(ClientProfile profile, CancellationToken cancellationToken);
}

public sealed record ClientSummary(
    Guid Id,
    string FirstName,
    string LastName,
    string Email,
    DateOnly? BirthDate,
    bool IsCoachBlocked,
    uint Version);

public sealed record CreateClientRequest(
    string FirstName,
    string LastName,
    string Email,
    DateOnly? BirthDate);

public sealed class ClientsModule : IModuleMarker
{
    public const string Name = "Clients";
}

using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Clients;

namespace TB.Gym.Infrastructure.Persistence;

internal sealed class ClientProfileRepository(GymDbContext dbContext) : IClientProfileRepository
{
    public async Task<IReadOnlyList<ClientSummary>> ListAsync(CancellationToken cancellationToken) =>
        await dbContext.ClientProfiles
            .AsNoTracking()
            .OrderBy(client => client.FirstName)
            .ThenBy(client => client.LastName)
            .Select(client => new ClientSummary(
                client.Id,
                client.FirstName,
                client.LastName,
                client.Email,
                client.BirthDate,
                client.IsCoachBlocked,
                client.Version))
            .ToListAsync(cancellationToken);

    public async Task AddAsync(ClientProfile profile, CancellationToken cancellationToken)
    {
        var exists = await dbContext.ClientProfiles.AnyAsync(
            client => client.NormalizedEmail == profile.NormalizedEmail,
            cancellationToken);

        if (exists)
        {
            throw new InvalidOperationException("A client with this email already exists in the active tenant.");
        }

        dbContext.ClientProfiles.Add(profile);
        await dbContext.SaveChangesAsync(cancellationToken);
    }
}

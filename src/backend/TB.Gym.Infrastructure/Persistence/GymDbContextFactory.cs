using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Persistence;

public sealed class GymDbContextFactory : IDesignTimeDbContextFactory<GymDbContext>
{
    public GymDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__Database");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException(
                "Set ConnectionStrings__Database before running EF Core design-time commands.");
        }

        var options = new DbContextOptionsBuilder<GymDbContext>()
            .UseNpgsql(connectionString, npgsql =>
                npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "platform"))
            .Options;

        return new GymDbContext(
            options,
            new DesignTimeClock(),
            new DesignTimeCurrentUser(),
            new DesignTimeTenantContext());
    }

    private sealed class DesignTimeClock : IClock
    {
        public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
    }

    private sealed class DesignTimeCurrentUser : ICurrentUser
    {
        public bool IsAuthenticated => false;

        public Guid? UserId => null;
    }

    private sealed class DesignTimeTenantContext : ITenantContext
    {
        public bool HasTenant => false;

        public Guid TenantId => Guid.Empty;
    }
}

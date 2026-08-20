using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Hosting;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Initialization;

public static class DatabaseInitializer
{
    private static readonly Action<ILogger, Exception?> ApplyingMigrations = LoggerMessage.Define(
        LogLevel.Information,
        new EventId(1001, nameof(ApplyingMigrations)),
        "Applying TB Gym database migrations.");

    private static readonly Action<ILogger, Exception?> MissingSeedConfiguration = LoggerMessage.Define(
        LogLevel.Warning,
        new EventId(1002, nameof(MissingSeedConfiguration)),
        "Development seeding is enabled but Seed:AdminEmail or Seed:AdminPassword is missing.");

    private static readonly Action<ILogger, Exception?> DevelopmentDataReady = LoggerMessage.Define(
        LogLevel.Information,
        new EventId(1003, nameof(DevelopmentDataReady)),
        "Development administrator and demo tenant are ready.");

    public static async Task InitializeDatabaseAsync(this WebApplication app)
    {
        var applyMigrations = app.Configuration.GetValue<bool>("Database:ApplyMigrationsOnStartup");
        var seedDevelopmentData = app.Configuration.GetValue<bool>("Seed:Enabled");

        if (seedDevelopmentData && !app.Environment.IsDevelopment())
        {
            throw new InvalidOperationException(
                "Seed:Enabled is a development-only setting and cannot run outside Development.");
        }

        if (!applyMigrations && !seedDevelopmentData)
        {
            return;
        }

        await using var scope = app.Services.CreateAsyncScope();
        var logger = scope.ServiceProvider
            .GetRequiredService<ILoggerFactory>()
            .CreateLogger("DatabaseInitializer");
        var dbContext = scope.ServiceProvider.GetRequiredService<GymDbContext>();

        if (applyMigrations)
        {
            ApplyingMigrations(logger, null);
            await dbContext.Database.MigrateAsync();
        }

        if (seedDevelopmentData)
        {
            await SeedDevelopmentDataAsync(scope.ServiceProvider, dbContext, app.Configuration, logger);
        }
    }

    private static async Task SeedDevelopmentDataAsync(
        IServiceProvider services,
        GymDbContext dbContext,
        IConfiguration configuration,
        ILogger logger)
    {
        var email = configuration["Seed:AdminEmail"]?.Trim().ToLowerInvariant();
        var password = configuration["Seed:AdminPassword"];

        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
        {
            MissingSeedConfiguration(logger, null);
            return;
        }

        var clock = services.GetRequiredService<IClock>();
        var roleManager = services.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
        var userManager = services.GetRequiredService<UserManager<ApplicationUser>>();

        if (!await roleManager.RoleExistsAsync(SystemRoles.PlatformAdmin))
        {
            var roleResult = await roleManager.CreateAsync(new IdentityRole<Guid>(SystemRoles.PlatformAdmin));
            EnsureSucceeded(roleResult, "create the platform administrator role");
        }

        var user = await userManager.FindByEmailAsync(email);
        if (user is null)
        {
            user = new ApplicationUser
            {
                Id = Guid.CreateVersion7(),
                UserName = email,
                Email = email,
                EmailConfirmed = true,
                DisplayName = "TB Gym Administrator",
                CreatedAtUtc = clock.UtcNow,
                UpdatedAtUtc = clock.UtcNow,
            };

            var userResult = await userManager.CreateAsync(user, password);
            EnsureSucceeded(userResult, "create the development administrator");
        }

        if (!await userManager.IsInRoleAsync(user, SystemRoles.PlatformAdmin))
        {
            var roleResult = await userManager.AddToRoleAsync(user, SystemRoles.PlatformAdmin);
            EnsureSucceeded(roleResult, "assign the platform administrator role");
        }

        var tenant = await dbContext.Tenants.SingleOrDefaultAsync(item => item.Slug == "demo-coach");
        if (tenant is null)
        {
            tenant = Tenant.Create("Demo Coach Workspace", "demo-coach");
            dbContext.Tenants.Add(tenant);
            await dbContext.SaveChangesAsync();
        }

        var membershipExists = await dbContext.TenantMemberships.AnyAsync(item =>
            item.TenantId == tenant.Id && item.UserId == user.Id);
        if (!membershipExists)
        {
            dbContext.TenantMemberships.Add(TenantMembership.Create(tenant.Id, user.Id, TenantRole.Owner));
            await dbContext.SaveChangesAsync();
        }

        DevelopmentDataReady(logger, null);
    }

    private static void EnsureSucceeded(IdentityResult result, string operation)
    {
        if (result.Succeeded)
        {
            return;
        }

        var errors = string.Join("; ", result.Errors.Select(error => error.Description));
        throw new InvalidOperationException($"Failed to {operation}: {errors}");
    }
}

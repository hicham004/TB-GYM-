using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The workspace's configured IANA time zone and week start, plus the local date it is there right
/// now. Every calendar decision in the product is made in this frame rather than the server's, and
/// <see cref="Today"/> comes from <see cref="IClock"/> so it stays deterministic under test.
/// </summary>
internal sealed record WorkspaceCalendar(string TimeZoneId, DayOfWeek WeekStartsOn, DateOnly Today);

internal static class WorkspaceCalendarReader
{
    public static async Task<WorkspaceCalendar> ReadAsync(
        GymDbContext dbContext,
        IClock clock,
        Guid tenantId,
        CancellationToken cancellationToken)
    {
        var tenant = await dbContext.Tenants
            .Where(item => item.Id == tenantId)
            .Select(item => new { item.TimeZoneId, item.WeekStartsOn })
            .SingleAsync(cancellationToken);
        var localNow = TimeZoneInfo.ConvertTime(
            clock.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById(tenant.TimeZoneId));
        return new WorkspaceCalendar(
            tenant.TimeZoneId,
            tenant.WeekStartsOn,
            DateOnly.FromDateTime(localNow.DateTime));
    }
}

using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Security;

internal sealed class SystemClock : IClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}

internal sealed class HttpCurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    public bool IsAuthenticated => accessor.HttpContext?.User.Identity?.IsAuthenticated == true;

    public Guid? UserId => Guid.TryParse(
        accessor.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier),
        out var userId)
            ? userId
            : null;
}

/// <summary>
/// The identity a background process writes under: none.
/// </summary>
/// <remarks>
/// A sweep is not acting for anybody. Reporting the coach or the client whose enrollment produced the
/// notification would put a person's identifier on audit rows for a decision they did not make, so
/// the audit stamp records no actor at all and the process is recognisable by that absence.
/// </remarks>
internal sealed class BackgroundSystemUser : ICurrentUser
{
    public bool IsAuthenticated => false;

    public Guid? UserId => null;
}

internal sealed class TenantContext : IMutableTenantContext
{
    public bool HasTenant => TenantId != Guid.Empty;

    public Guid TenantId { get; private set; }

    public void SetTenant(Guid tenantId)
    {
        if (tenantId == Guid.Empty)
        {
            throw new ArgumentException("A tenant id is required.", nameof(tenantId));
        }

        if (HasTenant && TenantId != tenantId)
        {
            throw new InvalidOperationException("The active tenant cannot change during a request.");
        }

        TenantId = tenantId;
    }
}

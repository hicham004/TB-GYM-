using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Initialization;

/// <summary>
/// The clock the demo generator walks forward through the past, so every row it writes carries the
/// time it would have carried had a coach and their clients really done it then.
/// </summary>
/// <remarks>
/// It only ever moves forward, and never past <see cref="Ceiling"/> (the real time the command started):
/// the demo must not contain anything that has not happened yet.
/// </remarks>
internal sealed class DemoClock : IClock
{
    public DemoClock()
    {
        Ceiling = DateTimeOffset.UtcNow;
        UtcNow = Ceiling;
    }

    public DateTimeOffset Ceiling { get; private set; }

    public DateTimeOffset UtcNow { get; private set; }

    /// <summary>Starts the walk: back to <paramref name="start"/>, with the ceiling at real now.</summary>
    public void Rewind(DateTimeOffset start)
    {
        Ceiling = DateTimeOffset.UtcNow;
        UtcNow = start < Ceiling ? start : Ceiling;
    }

    public void MoveTo(DateTimeOffset instant)
    {
        if (instant > UtcNow)
        {
            UtcNow = instant < Ceiling ? instant : Ceiling;
        }
    }

    public void Advance(TimeSpan duration) => MoveTo(UtcNow.Add(duration));
}

/// <summary>Workspace-local dates and times, anchored on the real today in the workspace time zone.</summary>
internal sealed class DemoCalendar
{
    private readonly TimeZoneInfo zone;

    public DemoCalendar(DateTimeOffset now, string timeZoneId)
    {
        Now = now;
        zone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        Today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, zone).DateTime);
    }

    public DateTimeOffset Now { get; }

    public DateOnly Today { get; }

    public DateOnly Day(int offset) => Today.AddDays(offset);

    public DateTimeOffset At(int dayOffset, int hour, int minute) => At(Day(dayOffset), hour, minute);

    public DateTimeOffset At(DateOnly date, int hour, int minute)
    {
        var local = date.ToDateTime(new TimeOnly(hour, minute));
        return new DateTimeOffset(local, zone.GetUtcOffset(local)).ToUniversalTime();
    }

    /// <summary>A moment relative to now, for the things that happened "this morning" or "an hour ago".</summary>
    public DateTimeOffset Ago(TimeSpan duration) => Now - duration;

    /// <summary>
    /// Like <see cref="Ago"/>, but never before today started: "earlier today" must stay today even
    /// when the command runs just after midnight.
    /// </summary>
    public DateTimeOffset EarlierToday(TimeSpan duration)
    {
        var startOfToday = At(Today, 0, 1);
        var earliest = startOfToday < Now ? startOfToday : Now;
        var at = Now - duration;
        return at > earliest ? at : earliest;
    }

    public DateOnly DateOf(DateTimeOffset instant) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, zone).DateTime);
}

/// <summary>Who a demo step runs as: a signed-in person in a workspace, or nobody.</summary>
internal sealed record DemoActor(Guid? UserId, Guid? TenantId)
{
    public static readonly DemoActor Anonymous = new(null, null);
}

/// <summary>
/// Runs one application-service call the way one HTTP request would: in its own scope, as one person,
/// in one workspace. Each call gets a fresh scope, so nothing is cached between people.
/// </summary>
internal sealed class DemoRequests(IServiceProvider services)
{
    public async Task<TResult> AsAsync<TService, TResult>(
        DemoActor actor,
        Func<TService, Task<TResult>> call)
        where TService : notnull
    {
        await using var scope = services.CreateAsyncScope();
        var provider = scope.ServiceProvider;
        var accessor = provider.GetRequiredService<IHttpContextAccessor>();
        accessor.HttpContext = new DefaultHttpContext
        {
            RequestServices = provider,
            User = actor.UserId is { } userId
                ? new ClaimsPrincipal(new ClaimsIdentity(
                    [new Claim(ClaimTypes.NameIdentifier, userId.ToString())],
                    "DemoWorkspace"))
                : new ClaimsPrincipal(new ClaimsIdentity()),
        };
        try
        {
            if (actor.TenantId is { } tenantId)
            {
                provider.GetRequiredService<IMutableTenantContext>().SetTenant(tenantId);
            }

            return await call(provider.GetRequiredService<TService>());
        }
        finally
        {
            accessor.HttpContext = null;
        }
    }
}

/// <summary>
/// Every step of the demo, placed at the moment it happens and run in time order. A running step may
/// schedule a later one (a submitted check-in schedules its review). Steps that would happen after
/// the command started are dropped, which is how "not yet" states such as an unreviewed check-in arise.
/// </summary>
internal sealed class DemoTimeline(DemoClock clock)
{
    private readonly PriorityQueue<DemoStep, (DateTimeOffset At, long Order)> steps = new();
    private long order;

    public void At(DateTimeOffset at, string label, Func<Task> action)
    {
        // A follow-up can never happen before the step that scheduled it.
        var when = at < clock.UtcNow ? clock.UtcNow : at;
        if (when <= clock.Ceiling)
        {
            steps.Enqueue(new DemoStep(label, action), (when, order++));
        }
    }

    public async Task<int> RunAsync(TextWriter output, CancellationToken cancellationToken)
    {
        var completed = 0;
        var reportedDate = default(DateOnly);
        while (steps.TryDequeue(out var step, out var priority))
        {
            cancellationToken.ThrowIfCancellationRequested();
            clock.MoveTo(priority.At);
            try
            {
                await step.Action();
            }
            catch (Exception exception) when (exception is not DemoStepFailedException)
            {
                throw new DemoStepFailedException(step.Label, exception.Message, exception);
            }

            completed++;
            var date = DateOnly.FromDateTime(priority.At.UtcDateTime);
            if (date.DayNumber - reportedDate.DayNumber >= 7)
            {
                reportedDate = date;
                await output.WriteLineAsync($"  {date:dd MMM}: {completed} steps done");
            }
        }

        return completed;
    }

    private sealed record DemoStep(string Label, Func<Task> Action);
}

internal sealed class DemoStepFailedException(string step, string detail, Exception? inner = null)
    : Exception($"Demo step '{step}' failed: {detail}", inner)
{
    private static readonly JsonSerializerOptions Json = new()
    {
        Converters = { new JsonStringEnumConverter() },
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>Returns the value, or stops the demo with the service's own answer.</summary>
    public static T Require<T>(T? value, bool succeeded, string step, object result)
        where T : class =>
        succeeded && value is not null
            ? value
            : throw new DemoStepFailedException(step, JsonSerializer.Serialize(result, Json));

    public static void Require(bool succeeded, string step, object result)
    {
        if (!succeeded)
        {
            throw new DemoStepFailedException(step, JsonSerializer.Serialize(result, Json));
        }
    }
}

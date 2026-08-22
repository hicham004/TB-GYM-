using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using TB.Gym.Api;
using TB.Gym.Infrastructure;
using TB.Gym.Infrastructure.Initialization;
using TB.Gym.Infrastructure.Security;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.ExerciseLibrary;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Invitations;
using TB.Gym.Modules.Media;
using TB.Gym.Modules.Messaging;
using TB.Gym.Modules.Strength;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;
using TB.Gym.Modules.Training;
using TB.Gym.Modules.Nutrition;
using TB.Gym.SharedKernel;

var builder = WebApplication.CreateBuilder(args);

builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole(options =>
{
    options.TimestampFormat = "yyyy-MM-ddTHH:mm:ss.fffZ";
    options.UseUtcTimestamp = true;
});

builder.Services.AddProblemDetails();
builder.Services.AddOpenApi();
builder.Services.AddSignalR();
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(
        new JsonStringEnumConverter(namingPolicy: null, allowIntegerValues: false)));
builder.Services.AddTbGymInfrastructure(builder.Configuration, builder.Environment);

var app = builder.Build();

app.UseExceptionHandler();
app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
});
app.UseTbGymSecurityHeaders();
app.UseRequestLocalization();
app.UseRateLimiter();

if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

app.UseAuthentication();
app.UseTbGymPlatformAccess();
app.UseAuthorization();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi().AllowAnonymous();
}

app.MapHealthChecks("/health/live", new HealthCheckOptions
{
    Predicate = registration => registration.Tags.Contains("live"),
    ResponseWriter = WriteHealthResponseAsync,
}).AllowAnonymous();

app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = registration => registration.Tags.Contains("ready"),
    ResponseWriter = WriteHealthResponseAsync,
}).AllowAnonymous();

app.MapGet("/api/system/status", (IClock clock) => Results.Ok(new SystemStatusResponse(
    "TB Gym API",
    "Modular Monolith",
    ".NET 10",
    clock.UtcNow)))
.AllowAnonymous()
.WithName("GetSystemStatus")
.WithTags("System")
.Produces<SystemStatusResponse>();

app.MapIdentityModule();
app.MapLegalConsentEndpoints();
app.MapTenancyModule();
app.MapInvitationsModule();
app.MapClientsModule();
app.MapSubscriptionsModule();
app.MapExerciseLibraryModule();
app.MapStrengthModule();
app.MapTrainingModule();
app.MapNutritionModule();
app.MapMediaModule();
app.MapHub<ChatHub>("/hubs/chat").RequireAuthorization(AuthorizationPolicies.TenantMember);

await app.InitializeDatabaseAsync();
await app.RunAsync();

static Task WriteHealthResponseAsync(HttpContext context, HealthReport report)
{
    context.Response.ContentType = "application/json";
    var response = new
    {
        status = report.Status.ToString(),
        checks = report.Entries.ToDictionary(
            entry => entry.Key,
            entry => new
            {
                status = entry.Value.Status.ToString(),
                description = entry.Value.Description,
            }),
    };

    return context.Response.WriteAsync(JsonSerializer.Serialize(response));
}

public partial class Program;

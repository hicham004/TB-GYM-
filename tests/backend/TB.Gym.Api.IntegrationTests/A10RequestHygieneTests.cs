using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Connections.Features;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Configuration;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Infrastructure.Security;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Messaging;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The pieces of the audit's batch A10a that need no database: where a NUL sits in a body, a search's
/// wildcards, Identity's words, a refusal's sentence without the framework's suffix, a chat connection the
/// browser abandons, and a Production host answering an unreadable request as Development does.
/// </summary>
[TestClass]
public sealed class A10RequestHygieneTests
{
    [TestMethod]
    public void TheFirstNulInABodyIsNamedByItsPath()
    {
        static string? Path(string json) => StorableTextMiddleware.UnstorableField(Encoding.UTF8.GetBytes(json));

        Assert.AreEqual("sets[0].note", Path("""{"sets":[{"note":"a\u0000"}]}"""));
        Assert.AreEqual("tags[2]", Path("""{"name":"x","tags":["a","b","\u0000"]}"""));
        Assert.AreEqual("days[1].meals[0].name", Path("""{"days":[{},{"meals":[{"name":"\u0000","n":1}]}]}"""));
        Assert.AreEqual("[1]", Path("""["ok","\u0000"]"""));
        Assert.AreEqual(string.Empty, Path("\"\\u0000\""));
        Assert.AreEqual("outer", Path("""{"outer":{"a\u0000b":1}}"""), "A NUL in a key names the object holding it.");
        // Not a NUL: an escaped backslash before the letters, and text that only looks like the escape.
        Assert.IsNull(Path("""{"note":"C:\\u0000","n":[1,2,{"x":null}]}"""));
        Assert.IsNull(Path("""{"note":"plain"}"""));
        // Malformed JSON is left to the binder, which names its own field.
        Assert.IsNull(Path("""{"note": """));
    }

    [TestMethod]
    public void ASearchsWildcardsAreEscapedToMatchThemselves()
    {
        Assert.AreEqual("%row%", LikePattern.Containing("  row "));
        Assert.AreEqual(@"%100\%%", LikePattern.Containing("100%"));
        Assert.AreEqual(@"%row\_machine%", LikePattern.Containing("row_machine"));
        Assert.AreEqual(@"%a\\b%", LikePattern.Containing(@"a\b"));
    }

    [TestMethod]
    public void IdentitysRefusalsKeepTheirCodesInTheAppsWords()
    {
        var words = new PersonIdentityErrorDescriber();

        Assert.AreEqual(("PasswordTooShort", "Use at least 12 characters."), Describe(words.PasswordTooShort(12)));
        Assert.AreEqual(("PasswordRequiresNonAlphanumeric", "Add a symbol, such as ! or #."), Describe(words.PasswordRequiresNonAlphanumeric()));
        Assert.AreEqual(("PasswordMismatch", "Your current password isn't right."), Describe(words.PasswordMismatch()));
        Assert.AreEqual(("InvalidToken", "This link has expired or was already used."), Describe(words.InvalidToken()));
        Assert.AreEqual(("DuplicateEmail", "An account already uses this email."), Describe(words.DuplicateEmail("a@b.test")));

        static (string, string) Describe(Microsoft.AspNetCore.Identity.IdentityError error) => (error.Code, error.Description);
    }

    [TestMethod]
    public void AnUnreadableRequestIsAnsweredWithItsOwnStatusAndWords()
    {
        // Kestrel's refusal of a body past the route's limit (the contact form's 16 KB, audit BEB-3).
        Assert.AreEqual(
            new UnreadableRequestAnswer("request_too_large", null, "This request is too large to be read."),
            UnreadableRequestExceptionHandler.Describe(new BadHttpRequestException("Request body too large.", StatusCodes.Status413PayloadTooLarge)));
        Assert.AreEqual(
            new UnreadableRequestAnswer("request_unsupported_media_type", null, "Send this request as JSON."),
            UnreadableRequestExceptionHandler.Describe(new BadHttpRequestException(
                "Expected a supported JSON media type but got \"text/plain\".", StatusCodes.Status415UnsupportedMediaType)));
        Assert.AreEqual(
            new UnreadableRequestAnswer("request_invalid", null, "This request needs its fields as a JSON body."),
            UnreadableRequestExceptionHandler.Describe(new BadHttpRequestException(
                "Implicit body inferred for parameter \"request\" but no body was provided. Did you mean to use a Service instead?")));
        Assert.AreEqual(
            new UnreadableRequestAnswer("request_invalid", "take", "The value of take could not be read. Check it and send the request again."),
            UnreadableRequestExceptionHandler.Describe(new BadHttpRequestException("Failed to bind parameter \"int? take\" from \"abc\".")));
    }

    [TestMethod]
    public void ARefusalsSentenceDropsWhatDotNetAppendsForDevelopers()
    {
        Assert.AreEqual(
            "Enter a time zone such as Asia/Beirut.",
            new ArgumentException("Enter a time zone such as Asia/Beirut.", "timeZoneId").PersonMessage());
        Assert.AreEqual(
            "Load must be greater than zero and at most 2,000.",
            new ArgumentOutOfRangeException("value", 2500m, "Load must be greater than zero and at most 2,000.").PersonMessage());
        Assert.AreEqual("Only an active program can start.", new InvalidOperationException("Only an active program can start.").PersonMessage());
        Assert.AreEqual("No parameter here.", new ArgumentException("No parameter here.").PersonMessage());
    }

    [TestMethod]
    public async Task ABrowserThatLeavesWhileItsConnectionIsCheckedIsNotAHubError()
    {
        using var left = new CancellationTokenSource();
        await left.CancelAsync();
        var context = new LeavingCaller(left.Token);
        var hub = new ChatHub(new CancelledAuthorizer(), new SignedIn()) { Context = context };

        // The membership read is cancelled because the browser left (audit AUTH-13): nothing is bound, nothing is
        // aborted twice, and no exception reaches SignalR to be logged with its stack.
        await hub.OnConnectedAsync();
        Assert.IsFalse(context.Aborted);
        Assert.IsFalse(await hub.SubscribeConversation(Guid.NewGuid()));

        // Cancellation that is not the browser leaving is still a failure.
        var stillHere = new LeavingCaller(CancellationToken.None);
        var failing = new ChatHub(new CancelledAuthorizer(), new SignedIn()) { Context = stillHere };
        await Assert.ThrowsAsync<OperationCanceledException>(() => failing.OnConnectedAsync());
    }

    [TestMethod]
    public async Task AProductionHostAnswersAnUnreadableRequestAsDevelopmentDoes()
    {
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Production");
            foreach (var (key, value) in ProductionSettings)
            {
                builder.UseSetting(key, value);
            }

            builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(ProductionSettings));
        });
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://app.tbgym.test") });

        // Production used to answer a bare 400 that named nothing (audit SEC-1); the body is read before any
        // database or token, so this host needs neither.
        using var wrongType = await client.PostAsync(
            "/api/auth/login",
            new StringContent("""{"email": 12, "password": "x"}""", Encoding.UTF8, "application/json"));
        Assert.AreEqual(HttpStatusCode.BadRequest, wrongType.StatusCode);
        var answer = await wrongType.Content.ReadFromJsonAsync<JsonElement>();
        Assert.AreEqual("request_invalid", answer.GetProperty("code").GetString());
        Assert.AreEqual("email", answer.GetProperty("field").GetString());
        using var empty = await client.PostAsync("/api/auth/login", new StringContent(string.Empty, Encoding.UTF8, "application/json"));
        Assert.AreEqual(HttpStatusCode.BadRequest, empty.StatusCode);
        Assert.AreEqual(
            "This request needs its fields as a JSON body.",
            (await empty.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("message").GetString());
    }

    private static readonly Dictionary<string, string?> ProductionSettings = new()
    {
        ["ConnectionStrings:Database"] = "Host=unused.invalid;Database=unused;Username=unused;Password=unused",
        ["Database:ApplyMigrationsOnStartup"] = "false",
        ["Seed:Enabled"] = "false",
        ["Application:PublicBaseUrl"] = "https://app.tbgym.test",
        ["Application:PublicOriginAllowlist:0"] = "https://app.tbgym.test",
        ["Messaging:Realtime:AllowedOrigins:0"] = "https://app.tbgym.test",
        ["DataProtection:KeyPath"] = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "tb-gym-a10-keys"),
        ["Notifications:Email:Adapter"] = "Resend",
        ["Notifications:Email:Provider:ApiKey"] = "re_not_a_real_key",
        ["Notifications:Email:Provider:FromAddress"] = "TB Gym <notifications@mail.tbgym.test>",
        ["Notifications:Email:Provider:WebhookSigningSecret"] = "whsec_bm90LWEtcmVhbC13ZWJob29rLXNlY3JldA==",
        ["Notifications:Email:Provider:FingerprintKeyId"] = "a10",
        ["Notifications:Email:Provider:FingerprintKeys:a10"] = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    };

    private sealed class CancelledAuthorizer : IMessagingRealtimeAuthorizer
    {
        public Task<bool> BindVerifiedTenantAsync(Guid tenantId, Guid userId, CancellationToken cancellationToken) =>
            Task.FromCanceled<bool>(new CancellationToken(canceled: true));

        public Task<bool> CanAccessConversationAsync(Guid tenantId, Guid userId, Guid conversationId, CancellationToken cancellationToken) =>
            Task.FromCanceled<bool>(new CancellationToken(canceled: true));
    }

    private sealed class SignedIn : ICurrentUser
    {
        public bool IsAuthenticated => true;

        public Guid? UserId { get; } = Guid.NewGuid();
    }

    /// <summary>A caller whose connection is already closed, with a workspace in its query.</summary>
    private sealed class LeavingCaller : HubCallerContext
    {
        private readonly FeatureCollection features = new();

        public LeavingCaller(CancellationToken aborted)
        {
            ConnectionAborted = aborted;
            var http = new DefaultHttpContext();
            http.Request.QueryString = new QueryString($"?{ChatHub.TenantQueryParameter}={Guid.NewGuid()}");
            features.Set<IHttpContextFeature>(new HttpContextFeature { HttpContext = http });
        }

        public bool Aborted { get; private set; }

        public override string ConnectionId { get; } = "a10-connection";

        public override string? UserIdentifier => null;

        public override ClaimsPrincipal? User => null;

        public override IDictionary<object, object?> Items { get; } = new Dictionary<object, object?>();

        public override IFeatureCollection Features => features;

        public override CancellationToken ConnectionAborted { get; }

        public override void Abort() => Aborted = true;
    }

    private sealed class HttpContextFeature : IHttpContextFeature
    {
        public HttpContext? HttpContext { get; set; }
    }
}

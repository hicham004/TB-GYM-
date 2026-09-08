using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;
using TB.Gym.Modules.Media;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    /// <summary>
    /// Lets a middleware integration test supply distinct connection addresses without trusting a
    /// forwarded-for header in production. The test-only header is consumed before the application
    /// pipeline (and therefore before rate limiting) is built.
    /// </summary>
    private sealed class TestRemoteAddressStartupFilter : Microsoft.AspNetCore.Hosting.IStartupFilter
    {
        public Action<Microsoft.AspNetCore.Builder.IApplicationBuilder> Configure(
            Action<Microsoft.AspNetCore.Builder.IApplicationBuilder> next) => application =>
            {
                application.Use(continuation => async context =>
                {
                    if (context.Request.Headers.TryGetValue("X-Test-Remote-Ip", out var rawAddress))
                    {
                        if (IPAddress.TryParse(rawAddress.ToString(), out var address))
                        {
                            context.Connection.RemoteIpAddress = address;
                        }
                    }

                    await continuation(context);
                });
                next(application);
            };
    }

    /// <summary>
    /// Holds every request at the moment it is about to insert into one named table, and releases
    /// them together.
    /// </summary>
    /// <remarks>
    /// A duplicate-key race is only a race if both requests get past their pre-check before either
    /// one writes. Firing two requests at once and hoping the scheduler interleaves them is a
    /// coin toss that passes on a fast machine and proves nothing; this makes the interleaving the
    /// test asserts on the one that actually happens.
    /// <para>
    /// The seam is EF's command interceptor rather than anything in production code: the barrier
    /// sits between the pre-check that has already run and the insert that has not, which is
    /// exactly the window the defect lives in, and the application is unaware of it.
    /// </para>
    /// </remarks>
    internal sealed class InsertBarrier : DbCommandInterceptor
    {
        private readonly Lock sync = new();
        private readonly List<TaskCompletionSource> arrivals = [];
        private string? table;
        private int participants;
        private int arrived;
        private TaskCompletionSource? release;

        /// <summary>
        /// Starts holding inserts that mention <paramref name="tableFragment"/> until
        /// <paramref name="participantCount"/> of them have arrived.
        /// </summary>
        public void Arm(string tableFragment, int participantCount)
        {
            lock (sync)
            {
                table = tableFragment;
                participants = participantCount;
                arrived = 0;
                arrivals.Clear();
                release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            }
        }

        /// <summary>
        /// How many inserts the barrier actually held. Asserted by the race tests so a barrier that
        /// silently matched nothing — a renamed table, a changed statement shape — fails loudly
        /// instead of letting a race test pass without ever having raced.
        /// </summary>
        public int Arrived
        {
            get
            {
                lock (sync)
                {
                    return arrived;
                }
            }
        }

        public void Disarm()
        {
            lock (sync)
            {
                table = null;
                // Anything still held is let go, so a failed assertion cannot leave a request
                // parked on a connection for the rest of the run.
                release?.TrySetResult();
                release = null;
            }
        }

        /// <summary>
        /// Completes once <paramref name="count"/> requests are waiting at the barrier. Lets a test
        /// start the second request only after the first is genuinely past its pre-check.
        /// </summary>
        public Task ArrivedAsync(int count)
        {
            lock (sync)
            {
                while (arrivals.Count < count)
                {
                    arrivals.Add(new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously));
                }

                if (arrived >= count)
                {
                    arrivals[count - 1].TrySetResult();
                }

                return arrivals[count - 1].Task;
            }
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default) =>
            HoldAsync(command, result, cancellationToken);

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default) =>
            HoldAsync(command, result, cancellationToken);

        private async ValueTask<TResult> HoldAsync<TResult>(
            DbCommand command,
            TResult result,
            CancellationToken cancellationToken)
        {
            TaskCompletionSource? gate;
            lock (sync)
            {
                if (table is null ||
                    !command.CommandText.Contains("INSERT INTO", StringComparison.OrdinalIgnoreCase) ||
                    !command.CommandText.Contains(table, StringComparison.Ordinal))
                {
                    return result;
                }

                arrived++;
                if (arrived <= arrivals.Count)
                {
                    arrivals[arrived - 1].TrySetResult();
                }

                if (arrived >= participants)
                {
                    release!.TrySetResult();
                }

                gate = release;
            }

            // Bounded, so a barrier that is never satisfied fails the test instead of hanging the
            // whole run on a held database connection.
            await gate!.Task.WaitAsync(TimeSpan.FromSeconds(30), cancellationToken);
            return result;
        }
    }

    private InsertBarrier RequiredInsertBarrier =>
        insertBarrier ?? throw new InvalidOperationException("The insert barrier is not initialized.");

    /// <summary>
    /// A scanner the test can switch off, standing in for a deployment whose scanning adapter is
    /// unavailable. It reports itself unavailable and refuses everything, which is what
    /// <c>UnavailableMediaScanner</c> does outside Development.
    /// </summary>
    internal sealed class ScannerSwitch
    {
        public bool IsAvailable { get; set; } = true;

        public bool RejectScans { get; set; }

        public bool ThrowOnScan { get; set; }

        /// <summary>
        /// A provider that answers with a verdict but without a usable identity for it. Nothing can
        /// be bound to the stored bytes, so there is no evidence — which is an operational failure
        /// of the scanner, not a statement about the caller's file.
        /// </summary>
        public bool ProduceMalformedResult { get; set; }

        public bool WaitForCancellation { get; set; }

        public int ScanCallCount => Volatile.Read(ref scanCallCount);

        public Task ScanStarted => scanStarted.Task;

        private readonly TaskCompletionSource scanStarted =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int scanCallCount;

        public void RecordScanStarted()
        {
            Interlocked.Increment(ref scanCallCount);
            scanStarted.TrySetResult();
        }
    }

    private sealed class SwitchableMediaScanner(ScannerSwitch state) : IMediaScanner
    {
        public bool IsAvailable => state.IsAvailable;

        public async Task<MediaScanResult> ScanAsync(
            StorageObjectLocator locator,
            string verifiedContentType,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            state.RecordScanStarted();
            if (state.WaitForCancellation)
            {
                await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            }

            if (state.ThrowOnScan)
            {
                throw new IOException("The scanner transport is unavailable.");
            }

            if (state.ProduceMalformedResult)
            {
                return new MediaScanResult(true, "   ", "1.0", null);
            }

            return state.IsAvailable && !state.RejectScans
                ? new MediaScanResult(true, "SwitchableTestScanner", "1.0", null)
                : new MediaScanResult(false, "SwitchableTestScanner", "1.0", "scan_refused");
        }
    }

    private ScannerSwitch RequiredScannerSwitch =>
        scannerSwitch ?? throw new InvalidOperationException("The scanner switch is not initialized.");

    private static async Task<long> Phase6CountAsync(string connectionString, string sql, Guid id)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddWithValue("id", id);
        return Convert.ToInt64(await command.ExecuteScalarAsync(), System.Globalization.CultureInfo.InvariantCulture);
    }

    private async Task Phase6ExecuteAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        await command.ExecuteNonQueryAsync();
    }

    /// <summary>
    /// Posts a progress photo without asserting the outcome, so a test can inspect a refusal.
    /// </summary>
    private static async Task<HttpResponseMessage> Phase6PostPhotoAsync(
        HttpClient caller,
        string url,
        byte[]? image = null,
        CancellationToken cancellationToken = default)
    {
        await RefreshCsrfAsync(caller);
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(image ?? ProgressPhotoImageFactory.PlainJpeg(120, 160));
        file.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/jpeg");
        form.Add(file, "file", "progress.jpg");
        return await caller.PostAsync(url, form, cancellationToken);
    }

    /// <summary>
    /// Mints a grant for one asset and returns the paths the browser would then fetch.
    /// </summary>
    private async Task<Phase6Grant> Phase6GrantAsync(HttpClient caller, Guid mediaAssetId)
    {
        // The grant carries an absolute expiry the data-protection provider also checks against real
        // wall time, so the pinned test clock is resynced before one is minted.
        RequiredTestClock.Set(DateTimeOffset.UtcNow);
        await RefreshCsrfAsync(caller);
        var response = await caller.PostAsync($"/api/media/{mediaAssetId}/access", null);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<Phase6Grant>(response);
    }

    private static async Task<HttpResponseMessage> Phase6GrantBatchAsync(
        HttpClient caller,
        params Guid[] assetIds)
    {
        await RefreshCsrfAsync(caller);
        return await caller.PostAsJsonAsync("/api/media/access", new { assetIds });
    }

    private sealed record Phase6Grant(Guid AssetId, string Url, string? ThumbnailUrl);

    private sealed record Phase6GrantBatch(Phase6Grant[] Items);

    private sealed record Phase6Workspace(
        Guid Id,
        string TimeZoneId,
        DateOnly CurrentDate,
        uint Version);

    private sealed record Phase6DashboardPhoto(Guid Id, Guid MediaAssetId, string? ThumbnailUrl);

    private sealed record Phase6DashboardPose(string Pose, Phase6DashboardPhoto[] Photos);

    private sealed record Phase6DashboardPhotos(
        Phase6DashboardPose[] Poses,
        int PhotoCount,
        int MissingThumbnailCount,
        int PreviewPhotoCount);

    private sealed record Phase6DashboardWeek(
        DateOnly WeekStart,
        DateOnly WeekEndExclusive,
        decimal? DisplayMean,
        int ObservedDayCount);

    private sealed record Phase6DashboardBodyweight(
        Phase6DashboardWeek[] Weeks,
        int ObservedDayCount);

    private sealed record Phase6DashboardTraining(
        int WindowScheduledSessionCount,
        int WindowCompletedWorkoutCount,
        int WindowInProgressWorkoutCount);

    private sealed record Phase6DashboardSection<TContext>(string Availability, TContext? Context);

    private sealed record Phase6Dashboard(
        Phase6DashboardBodyweight Bodyweight,
        Phase6DashboardPhotos Photos,
        Phase6DashboardSection<Phase6DashboardTraining> Training);
}

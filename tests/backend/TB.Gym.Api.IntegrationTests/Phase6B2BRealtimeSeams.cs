using System.Collections.Concurrent;
using System.Data.Common;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Messaging;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase6B2BRealtimeMessagingTests
{
    /// <summary>A clock the test moves, so leases and schedules are asserted without waiting.</summary>
    internal sealed class MutableClock(DateTimeOffset utcNow) : IClock
    {
        private long ticks = utcNow.UtcTicks;

        public DateTimeOffset UtcNow => new(Interlocked.Read(ref ticks), TimeSpan.Zero);

        public void Advance(TimeSpan duration) => Interlocked.Add(ref ticks, duration.Ticks);
    }

    /// <summary>
    /// A hub context that records what was published instead of sending it.
    /// </summary>
    /// <remarks>
    /// What these tests need to know is which frames a sweep produced, which server-generated group
    /// each went to, and — for every suppression case — that it produced none. A real hub with no
    /// connected clients would accept all of it silently and prove neither. The socket itself is
    /// proved separately, against Kestrel and a real browser-shaped client.
    /// <para>
    /// It can also be told to fail, which is how a backplane outage is simulated deterministically in
    /// the durable tests; the real thing is exercised by stopping a real Redis container in the
    /// scale-out suite.
    /// </para>
    /// </remarks>
    internal sealed class RecordingHubProxy : IHubContext<ChatHub, IMessagingRealtimeClient>
    {
        private readonly ConcurrentQueue<PublishedFrame> frames = new();
        private int failures;

        public IReadOnlyList<PublishedFrame> Frames => [.. frames];

        public IHubClients<IMessagingRealtimeClient> Clients => new Recorder(this);

        public IGroupManager Groups => new UnusedGroupManager();

        /// <summary>Fails the next <paramref name="count"/> sends, as an unreachable backplane would.</summary>
        public void FailNext(int count) => Interlocked.Exchange(ref failures, count);

        public void Reset()
        {
            frames.Clear();
            Interlocked.Exchange(ref failures, 0);
        }

        public IReadOnlyList<PublishedFrame> FullEventsFor(Guid tenantId, Guid conversationId, Guid userId)
        {
            var group = MessagingRealtimeGroups.ConversationUser(tenantId, conversationId, userId);
            return [.. Frames.Where(frame =>
                frame.Kind == FrameKind.FullEvent &&
                string.Equals(frame.Group, group, StringComparison.Ordinal))];
        }

        public IReadOnlyList<PublishedFrame> InvalidationsFor(Guid tenantId, Guid userId)
        {
            var group = MessagingRealtimeGroups.TenantUser(tenantId, userId);
            return [.. Frames.Where(frame =>
                frame.Kind == FrameKind.Invalidation &&
                string.Equals(frame.Group, group, StringComparison.Ordinal))];
        }

        private void Record(PublishedFrame frame)
        {
            while (true)
            {
                var remaining = Volatile.Read(ref failures);
                if (remaining <= 0)
                {
                    break;
                }

                if (Interlocked.CompareExchange(ref failures, remaining - 1, remaining) == remaining)
                {
                    // Shaped like a lifetime-manager failure rather than an arbitrary exception, so
                    // the dispatcher's own classification is what decides it is transient.
                    throw new HubException("The backplane is unavailable.");
                }
            }

            frames.Enqueue(frame);
        }

        private sealed class Recorder(RecordingHubProxy owner) : IHubClients<IMessagingRealtimeClient>
        {
            public IMessagingRealtimeClient All => new Sink(owner, "<all>");

            public IMessagingRealtimeClient AllExcept(IReadOnlyList<string> excludedConnectionIds) =>
                new Sink(owner, "<all-except>");

            public IMessagingRealtimeClient Client(string connectionId) => new Sink(owner, "<client>");

            public IMessagingRealtimeClient Clients(IReadOnlyList<string> connectionIds) =>
                new Sink(owner, "<clients>");

            public IMessagingRealtimeClient Group(string groupName) => new Sink(owner, groupName);

            public IMessagingRealtimeClient GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) =>
                new Sink(owner, groupName);

            public IMessagingRealtimeClient Groups(IReadOnlyList<string> groupNames) =>
                new Sink(owner, string.Join('|', groupNames));

            public IMessagingRealtimeClient User(string userId) => new Sink(owner, "<user>");

            public IMessagingRealtimeClient Users(IReadOnlyList<string> userIds) => new Sink(owner, "<users>");
        }

        private sealed class Sink(RecordingHubProxy owner, string group) : IMessagingRealtimeClient
        {
            public Task ConversationChanged(RealtimeConversationInvalidation invalidation)
            {
                owner.Record(new PublishedFrame(FrameKind.Invalidation, group, null, invalidation));
                return Task.CompletedTask;
            }

            public Task RealtimeEvent(RealtimeEventView realtimeEvent)
            {
                owner.Record(new PublishedFrame(FrameKind.FullEvent, group, realtimeEvent, null));
                return Task.CompletedTask;
            }
        }

        /// <summary>
        /// Group membership is a connection concern. The dispatcher publishes to groups and never
        /// manages them, so this exists only to satisfy the interface and fails loudly if used.
        /// </summary>
        private sealed class UnusedGroupManager : IGroupManager
        {
            public Task AddToGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default) =>
                throw new AssertFailedException("The dispatcher must not manage group membership.");

            public Task RemoveFromGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default) =>
                throw new AssertFailedException("The dispatcher must not manage group membership.");
        }
    }

    internal enum FrameKind
    {
        FullEvent = 1,
        Invalidation = 2,
    }

    internal sealed record PublishedFrame(
        FrameKind Kind,
        string Group,
        RealtimeEventView? Event,
        RealtimeConversationInvalidation? Invalidation);

    /// <summary>
    /// Holds one exact publication at one exact point in the sweep.
    /// </summary>
    /// <remarks>
    /// Two windows matter and neither can be reached with a sleep: after the claim has committed and
    /// before authorization is rechecked, which is where a revocation has to be able to suppress a
    /// frame; and after the hub accepted the frame and before the row is finalized, which is where a
    /// crash produces the duplicate this design accepts.
    /// <para>
    /// A second arrival for the same row passes straight through, so a test can hold one worker while
    /// a second reclaims and finishes the row underneath it.
    /// </para>
    /// </remarks>
    internal sealed class DispatchCheckpointBarrier : IMessagingRealtimeDispatchCheckpoint
    {
        private readonly Lock sync = new();
        private Guid? afterClaimRecipientId;
        private Guid? afterPublishRecipientId;
        private bool claimHeld;
        private bool publishHeld;
        private TaskCompletionSource? arrivedAtClaim;
        private TaskCompletionSource? releaseClaim;
        private TaskCompletionSource? arrivedAtPublish;
        private TaskCompletionSource? releasePublish;

        public void ArmAfterClaim(Guid recipientId)
        {
            lock (sync)
            {
                afterClaimRecipientId = recipientId;
                claimHeld = false;
                arrivedAtClaim = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                releaseClaim = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            }
        }

        public void ArmAfterPublish(Guid recipientId)
        {
            lock (sync)
            {
                afterPublishRecipientId = recipientId;
                publishHeld = false;
                arrivedAtPublish = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                releasePublish = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            }
        }

        /// <summary>
        /// Waits for the sweep to reach the checkpoint, with a deadline.
        /// </summary>
        /// <remarks>
        /// Bounded so a checkpoint that is never reached — a row already terminal, a claim that went
        /// elsewhere — fails the test with something to read rather than hanging the whole run.
        /// </remarks>
        public async Task ArrivedAfterClaimAsync()
        {
            Task arrival;
            lock (sync)
            {
                arrival = arrivedAtClaim?.Task
                    ?? throw new InvalidOperationException("The claim checkpoint is not armed.");
            }

            try
            {
                await arrival.WaitAsync(TimeSpan.FromSeconds(120));
            }
            catch (TimeoutException)
            {
                Assert.Fail("No sweep reached the post-claim checkpoint for the armed publication.");
            }
        }

        public async Task ArrivedAfterPublishAsync()
        {
            Task arrival;
            lock (sync)
            {
                arrival = arrivedAtPublish?.Task
                    ?? throw new InvalidOperationException("The publish checkpoint is not armed.");
            }

            try
            {
                await arrival.WaitAsync(TimeSpan.FromSeconds(120));
            }
            catch (TimeoutException)
            {
                Assert.Fail("No sweep reached the post-publication checkpoint for the armed publication.");
            }
        }

        public void ReleaseClaim()
        {
            lock (sync)
            {
                releaseClaim?.TrySetResult();
            }
        }

        public void ReleasePublish()
        {
            lock (sync)
            {
                releasePublish?.TrySetResult();
            }
        }

        public void Disarm()
        {
            lock (sync)
            {
                afterClaimRecipientId = null;
                afterPublishRecipientId = null;
                releaseClaim?.TrySetResult();
                releasePublish?.TrySetResult();
                arrivedAtClaim = null;
                releaseClaim = null;
                arrivedAtPublish = null;
                releasePublish = null;
                claimHeld = false;
                publishHeld = false;
            }
        }

        public async Task AfterClaimCommittedAsync(
            Guid tenantId,
            Guid recipientId,
            Guid claimToken,
            CancellationToken cancellationToken)
        {
            Task? gate = null;
            lock (sync)
            {
                if (!claimHeld && afterClaimRecipientId == recipientId)
                {
                    claimHeld = true;
                    arrivedAtClaim!.TrySetResult();
                    gate = releaseClaim!.Task;
                }
            }

            if (gate is not null)
            {
                await gate.WaitAsync(TimeSpan.FromSeconds(30), cancellationToken);
            }
        }

        public async Task AfterPublishedBeforeFinalizeAsync(
            Guid tenantId,
            Guid recipientId,
            Guid claimToken,
            CancellationToken cancellationToken)
        {
            Task? gate = null;
            lock (sync)
            {
                if (!publishHeld && afterPublishRecipientId == recipientId)
                {
                    publishHeld = true;
                    arrivedAtPublish!.TrySetResult();
                    gate = releasePublish!.Task;
                }
            }

            if (gate is not null)
            {
                await gate.WaitAsync(TimeSpan.FromSeconds(30), cancellationToken);
            }
        }
    }

    /// <summary>
    /// Fails the commit of the next transaction, after every statement inside it has run.
    /// </summary>
    /// <remarks>
    /// Failing an individual statement would prove nothing about atomicity: the later ones would
    /// never have run. Failing the commit is the only way to reach the state where the message, its
    /// revision, the conversation tip, the realtime event and its recipient rows have all been
    /// written and the transaction still has to leave none of them behind.
    /// </remarks>
    internal sealed class CommitFault : Microsoft.EntityFrameworkCore.Diagnostics.DbTransactionInterceptor
    {
        private int armed;

        public bool Fired { get; private set; }

        public void ArmOnce() => Interlocked.Exchange(ref armed, 1);

        public void Disarm() => Interlocked.Exchange(ref armed, 0);

        public override ValueTask<Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult> TransactionCommittingAsync(
            System.Data.Common.DbTransaction transaction,
            Microsoft.EntityFrameworkCore.Diagnostics.TransactionEventData eventData,
            Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult result,
            CancellationToken cancellationToken = default)
        {
            if (Interlocked.CompareExchange(ref armed, 0, 1) == 1)
            {
                Fired = true;
                throw new InvalidOperationException("Injected commit failure.");
            }

            return ValueTask.FromResult(result);
        }
    }

    /// <summary>Records which tables the application actually asked the database about.</summary>
    /// <remarks>
    /// A suppressed publication must not load a body — not load it and then discard it, which would
    /// leave the content in this process's memory and in the query log for somebody who may no longer
    /// read it. Only the wire between the application and PostgreSQL can tell the two apart.
    /// </remarks>
    internal sealed class CommandRecorder : DbCommandInterceptor
    {
        private readonly ConcurrentQueue<string> statements = new();

        public void Clear() => statements.Clear();

        public bool Touched(string fragment) =>
            statements.Any(statement => statement.Contains(fragment, StringComparison.Ordinal));

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            statements.Enqueue(command.CommandText);
            return ValueTask.FromResult(result);
        }

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            statements.Enqueue(command.CommandText);
            return ValueTask.FromResult(result);
        }
    }

    /// <summary>
    /// Holds every command matching a text fragment until a given number have arrived, then releases
    /// them together.
    /// </summary>
    /// <remarks>
    /// A race is only a race if both participants reach the contended point before either gets past
    /// it. Starting two requests and hoping the scheduler interleaves them is a coin toss that passes
    /// on a fast machine and proves nothing.
    /// </remarks>
    internal sealed class CommandBarrier : DbCommandInterceptor
    {
        private readonly Lock sync = new();
        private readonly List<TaskCompletionSource> arrivals = [];
        private string? fragment;
        private int participants;
        private int arrived;
        private TaskCompletionSource? release;

        public void Arm(string commandFragment, int participantCount)
        {
            lock (sync)
            {
                fragment = commandFragment;
                participants = participantCount;
                arrived = 0;
                arrivals.Clear();
                release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            }
        }

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
                fragment = null;
                release?.TrySetResult();
                release = null;
            }
        }

        public async Task ArrivedAsync(int count)
        {
            Task arrival;
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

                arrival = arrivals[count - 1].Task;
            }

            try
            {
                // Bounded, so a race that never actually contends fails with a message rather than
                // hanging the run and leaving nothing to read. Generous, because the first arrival
                // holds an open transaction while the suite runs four methods in parallel, and a
                // loaded machine is not the same thing as a broken barrier.
                await arrival.WaitAsync(TimeSpan.FromSeconds(120));
            }
            catch (TimeoutException)
            {
                Disarm();
                Assert.Fail($"Only {Arrived} of {count} requests reached the command barrier.");
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
                if (fragment is null || !command.CommandText.Contains(fragment, StringComparison.Ordinal))
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

            if (gate is not null)
            {
                await gate.Task.WaitAsync(cancellationToken);
            }

            return result;
        }
    }
}

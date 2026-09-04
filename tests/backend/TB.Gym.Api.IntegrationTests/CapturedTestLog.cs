using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Everything the host logged, so a test can assert what did not reach it.
/// </summary>
/// <remarks>
/// Shared by the realtime suites because both need the same negative assertion: no message body, no
/// moderation reason, no participant name, no address, no workspace or conversation identifier, no
/// backplane endpoint. A log is where sensitive data escapes most quietly, and the only way to prove
/// it did not is to keep all of it and look.
/// </remarks>
internal sealed class CapturedLog : ILoggerProvider
{
    private readonly ConcurrentQueue<string> messages = new();

    public string Text => string.Join(Environment.NewLine, messages);

    public ILogger CreateLogger(string categoryName) => new QueueLogger(messages);

    public void Dispose()
    {
    }

    private sealed class QueueLogger(ConcurrentQueue<string> messages) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        // The exception is appended deliberately: a dispatcher that logged an exception object would
        // be exactly the leak these assertions look for.
        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter) =>
            messages.Enqueue(formatter(state, exception) + (exception is null ? string.Empty : " " + exception));
    }
}

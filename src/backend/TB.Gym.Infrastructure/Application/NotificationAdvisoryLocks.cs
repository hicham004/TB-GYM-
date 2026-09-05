using Microsoft.EntityFrameworkCore;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Serializes one member's email-policy decision with the final materialization recheck.
/// </summary>
/// <remarks>
/// If an opt-out commits first, the dispatcher observes it and suppresses. If materialization holds
/// the lock first, the opt-out cannot claim to have completed before the capture. This closes the
/// otherwise unavoidable gap between an ordinary preference SELECT and the transport call.
/// </remarks>
internal static class NotificationAdvisoryLocks
{
    private const long RecipientPolicyNamespace = 0x6B3_1000_0000_0000L;

    public static Task LockRecipientPolicyAsync(
        GymDbContext context,
        Guid tenantId,
        Guid userId,
        CancellationToken cancellationToken) =>
        context.Database.ExecuteSqlAsync(
            $"SELECT pg_advisory_xact_lock({RecipientPolicyKey(tenantId, userId)}) /* notification-recipient-policy */",
            cancellationToken);

    /// <summary>
    /// Holds the recipient-policy lock across the separate transaction that commits a Started attempt
    /// and the transaction that captures the email. A transaction-scoped lock cannot cover that
    /// boundary, while a dedicated PostgreSQL session can. Preference writes use the transaction lock
    /// above, so whichever operation acquires the shared key first has an unambiguous order.
    /// </summary>
    public static async Task<IAsyncDisposable> AcquireRecipientPolicySessionAsync(
        GymDbContext context,
        Guid tenantId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var connectionString = context.Database.GetConnectionString()
            ?? throw new InvalidOperationException("Notification dispatch requires a relational connection string.");
        var connection = new NpgsqlConnection(connectionString);
        try
        {
            await connection.OpenAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT pg_advisory_lock(@key) /* notification-recipient-policy-session */";
            command.Parameters.AddWithValue("key", RecipientPolicyKey(tenantId, userId));
            await command.ExecuteNonQueryAsync(cancellationToken);
            return new RecipientPolicySessionLease(connection, RecipientPolicyKey(tenantId, userId));
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }

    private static long RecipientPolicyKey(Guid tenantId, Guid userId) =>
        BitConverter.ToInt64(tenantId.ToByteArray(), 0)
        ^ BitConverter.ToInt64(tenantId.ToByteArray(), 8)
        ^ BitConverter.ToInt64(userId.ToByteArray(), 0)
        ^ BitConverter.ToInt64(userId.ToByteArray(), 8)
        ^ RecipientPolicyNamespace;

    private sealed class RecipientPolicySessionLease(NpgsqlConnection connection, long key) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync()
        {
            try
            {
                if (connection.State == System.Data.ConnectionState.Open)
                {
                    await using var command = connection.CreateCommand();
                    command.CommandText = "SELECT pg_advisory_unlock(@key)";
                    command.Parameters.AddWithValue("key", key);
                    await command.ExecuteNonQueryAsync(CancellationToken.None);
                }
            }
            catch (NpgsqlException)
            {
                // Closing or disposing the dedicated session releases its advisory locks. An unlock
                // command can fail only with the connection already unusable, so disposal is the
                // fail-safe release path and must not mask the dispatch result.
            }
            finally
            {
                await connection.DisposeAsync();
            }
        }
    }
}

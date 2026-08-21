using Npgsql;

namespace TB.Gym.Api.IntegrationTests;

internal static class PostgreSqlTestEnvironment
{
    private const string AdminConnectionVariable = "TB_GYM_TEST_ADMIN_CONNECTION";
    private const string RequiredVariable = "TB_GYM_REQUIRE_POSTGRES_TESTS";

    public static string RequireAdminConnection()
    {
        var connection = Environment.GetEnvironmentVariable(AdminConnectionVariable);
        if (!string.IsNullOrWhiteSpace(connection))
        {
            return connection;
        }

        Unavailable($"{AdminConnectionVariable} is not configured.");
        throw new InvalidOperationException("Unreachable PostgreSQL test gate.");
    }

    public static void Unavailable(string reason)
    {
        var required = string.Equals(
            Environment.GetEnvironmentVariable(RequiredVariable),
            "true",
            StringComparison.OrdinalIgnoreCase);
        if (required)
        {
            Assert.Fail($"Required PostgreSQL integration tests cannot run: {reason}");
        }

        Assert.Inconclusive($"PostgreSQL integration test skipped: {reason}");
    }

    public static async Task<string> CreateDatabaseAsync(string prefix)
    {
        var adminConnection = RequireAdminConnection();
        var databaseName = $"{prefix}_{Guid.NewGuid():N}";
        try
        {
            await using var connection = new NpgsqlConnection(adminConnection);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = $"CREATE DATABASE \"{databaseName}\"";
            await command.ExecuteNonQueryAsync();
            return databaseName;
        }
        catch (NpgsqlException exception)
        {
            Unavailable(exception.Message);
            throw new InvalidOperationException("Unreachable PostgreSQL test gate.", exception);
        }
    }
}

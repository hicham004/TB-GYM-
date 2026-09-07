using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Media;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Proves the Phase 5B-2 migration against a database that already holds media, because the coach
/// library now filters on the new discriminator: an unbackfilled row would silently disappear from
/// the exercise library of every existing workspace.
/// </summary>
[TestClass]
public sealed class Phase5B2MigrationBackfillTests
{
    /// <summary>The last migration before the progress-photo discriminator existed.</summary>
    private const string MigrationBeforeProgressPhotos = "Phase5B1BodyMeasurements";

    private static readonly Guid TenantId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid OwnerUserId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid LegacyAssetId = Guid.Parse("33333333-3333-3333-3333-333333333333");

    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_p5b2mig");
        databaseConnection = new NpgsqlConnectionStringBuilder(adminConnection)
        {
            Database = databaseName,
        }.ConnectionString;
    }

    [TestCleanup]
    public async Task CleanupAsync()
    {
        NpgsqlConnection.ClearAllPools();
        if (databaseName is null || adminConnection is null)
        {
            return;
        }

        await using var connection = new NpgsqlConnection(adminConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"DROP DATABASE IF EXISTS \"{databaseName}\" WITH (FORCE)";
        await command.ExecuteNonQueryAsync();
    }

    [TestMethod]
    public async Task Phase5B2MigrationBackfillsPreExistingMediaToExerciseMediaAndKeepsItInTheLibrary()
    {
        // Stage 1: bring the database to the schema that shipped before progress photos.
        await using (var beforeUpgrade = CreateContext())
        {
            await beforeUpgrade.Database.GetInfrastructure()
                .GetRequiredService<IMigrator>()
                .MigrateAsync(MigrationBeforeProgressPhotos);
        }

        // Stage 2: seed a media asset exactly as an existing workspace would already hold it. The
        // Purpose column does not exist yet, so this really is a pre-upgrade row.
        await ExecuteAsync(
            """
            INSERT INTO identity."Users"
                ("Id", "DisplayName", "IsPlatformBlocked", "EmailConfirmed", "PhoneNumberConfirmed",
                 "TwoFactorEnabled", "LockoutEnabled", "AccessFailedCount")
            VALUES (@userId, 'Legacy Coach', FALSE, TRUE, FALSE, FALSE, TRUE, 0);

            INSERT INTO media."Assets"
                ("Id", "TenantId", "OwnerUserId", "Title", "Kind", "Source", "Status",
                 "IsCoachProtected", "OriginalFileName", "DeclaredContentType",
                 "VerifiedContentType", "Length", "Sha256", "StorageKey")
            VALUES (@assetId, @tenantId, @userId, 'Legacy squat demo', 'Video', 'Upload', 'Ready',
                    TRUE, 'squat.mp4', 'video/mp4', 'video/mp4', 2048, @sha, @storageKey);
            """,
            command =>
            {
                command.Parameters.AddWithValue("userId", OwnerUserId);
                command.Parameters.AddWithValue("assetId", LegacyAssetId);
                command.Parameters.AddWithValue("tenantId", TenantId);
                command.Parameters.AddWithValue("sha", new string('a', 64));
                command.Parameters.AddWithValue("storageKey", $"{TenantId:N}/legacy-object");
            });

        Assert.IsFalse(await ColumnExistsAsync("media", "Assets", "Purpose"));

        // Stage 3: apply the remaining migrations, including the backfill.
        await using (var afterUpgrade = CreateContext())
        {
            await afterUpgrade.Database.MigrateAsync();
        }

        // The legacy row is classified as exercise media rather than left on the empty default.
        Assert.AreEqual("ExerciseMedia", await ScalarAsync(
            """SELECT "Purpose" FROM media."Assets" WHERE "Id" = @assetId;""",
            command => command.Parameters.AddWithValue("assetId", LegacyAssetId)));

        // No row anywhere was left unclassified, and the placeholder default is gone so future
        // inserts must state a purpose.
        Assert.AreEqual(0L, await ScalarAsync("""SELECT COUNT(*) FROM media."Assets" WHERE "Purpose" = '';"""));
        Assert.IsNull(await ScalarAsync(
            """
            SELECT column_default FROM information_schema.columns
            WHERE table_schema = 'media' AND table_name = 'Assets' AND column_name = 'Purpose';
            """));

        // It still satisfies the predicate the coach exercise-media library selects on, so the
        // asset remains visible where it was before the upgrade.
        await using var verification = CreateContext(TenantId);
        var libraryIds = await verification.MediaAssets
            .AsNoTracking()
            .Where(item => item.Purpose == MediaPurpose.ExerciseMedia)
            .Select(item => item.Id)
            .ToArrayAsync();
        CollectionAssert.Contains(libraryIds, LegacyAssetId);
    }

    private GymDbContext CreateContext(Guid? tenantId = null)
    {
        var options = new DbContextOptionsBuilder<GymDbContext>()
            .UseNpgsql(databaseConnection, npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "platform"))
            .Options;
        var tenantContext = new MigrationTestTenantContext();
        if (tenantId is { } value)
        {
            tenantContext.SetTenant(value);
        }

        return new GymDbContext(options, new MigrationTestClock(), new MigrationTestCurrentUser(), tenantContext);
    }

    private async Task ExecuteAsync(string sql, Action<NpgsqlCommand>? configure = null)
    {
        await using var connection = new NpgsqlConnection(databaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        configure?.Invoke(command);
        await command.ExecuteNonQueryAsync();
    }

    private async Task<object?> ScalarAsync(string sql, Action<NpgsqlCommand>? configure = null)
    {
        await using var connection = new NpgsqlConnection(databaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        configure?.Invoke(command);
        var value = await command.ExecuteScalarAsync();
        return value is DBNull ? null : value;
    }

    private async Task<bool> ColumnExistsAsync(string schema, string table, string column)
    {
        var value = await ScalarAsync(
            """
            SELECT COUNT(*) FROM information_schema.columns
            WHERE table_schema = @schema AND table_name = @table AND column_name = @column;
            """,
            command =>
            {
                command.Parameters.AddWithValue("schema", schema);
                command.Parameters.AddWithValue("table", table);
                command.Parameters.AddWithValue("column", column);
            });
        return Convert.ToInt64(value, System.Globalization.CultureInfo.InvariantCulture) > 0;
    }

    private sealed class MigrationTestTenantContext : IMutableTenantContext
    {
        public Guid TenantId { get; private set; }

        public bool HasTenant => TenantId != Guid.Empty;

        public void SetTenant(Guid tenantId) => TenantId = tenantId;
    }

    private sealed class MigrationTestCurrentUser : ICurrentUser
    {
        public Guid? UserId => OwnerUserId;

        public bool IsAuthenticated => true;
    }

    private sealed class MigrationTestClock : IClock
    {
        public DateTimeOffset UtcNow => new(2026, 8, 23, 12, 0, 0, TimeSpan.Zero);
    }
}

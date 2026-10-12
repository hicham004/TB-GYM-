using System.Net;
using System.Net.Http.Json;
using Npgsql;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Infrastructure.Persistence;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// R6.1b, PRG-013: a client's before-and-after is recorded on the server (who, when, which two photos;
/// never the picture) before the picture is made on their device. Only the client's own active photos of
/// one pose can be used, and the record is append-only (CLI-008).
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string R61bExportsUrl = "/api/progress/me/photo-exports";

    /// <summary>Who, when and which photos, with the audit stamps: there is nowhere to keep a picture.</summary>
    private static readonly string[] R61bExportColumns =
    [
        "Id", "TenantId", "ClientProfileId", "Pose", "BeforePhotoId", "AfterPhotoId", "ExportedAtUtc",
        "ExportedByUserId", "CreatedAtUtc", "CreatedByUserId", "UpdatedAtUtc", "UpdatedByUserId",
    ];

    [TestMethod]
    public async Task R61bAClientsBeforeAndAfterIsRecordedEveryTimeAndTheRecordIsAppendOnly()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r61b-record-coach@example.test", "Coach", "Record Gym");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "r61b-record-client@example.test", true);
        SetTenant(client, tenant);
        var august = await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Front&photoDate=2026-08-03");
        var october = await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Front&photoDate=2026-10-03");
        var side = await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Side&photoDate=2026-09-01");

        var made = await R61bExportAsync(client, august.Id, october.Id);
        await AssertStatusAsync(made, HttpStatusCode.OK);
        var export = await RequiredJsonAsync<R61bExport>(made);
        Assert.AreEqual("Front", export.Pose);
        Assert.AreEqual(
            (august.Id, new DateOnly(2026, 8, 3), august.MediaAssetId),
            (export.Before.Id, export.Before.PhotoDate, export.Before.MediaAssetId));
        Assert.AreEqual(
            (october.Id, new DateOnly(2026, 10, 3), october.MediaAssetId),
            (export.After.Id, export.After.PhotoDate, export.After.MediaAssetId));

        // Who, when and which photos are stored, and nothing else.
        var userId = (await RequiredJsonAsync<TeamClientDetails>(await coach.GetAsync($"/api/clients/{clientId}"))).UserId!.Value;
        Assert.AreEqual(1L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            $"""
            SELECT count(*) FROM progress."ProgressPhotoExports"
            WHERE "Id" = @id AND "TenantId" = '{tenant}' AND "ClientProfileId" = '{clientId}' AND "Pose" = 'Front'
              AND "BeforePhotoId" = '{august.Id}' AND "AfterPhotoId" = '{october.Id}' AND "ExportedByUserId" = '{userId}'
            """,
            export.Id));
        CollectionAssert.AreEquivalent(R61bExportColumns, await R61bExportColumnsAsync());

        // Every export is its own record: the same two photos again make a second one.
        await AssertStatusAsync(await R61bExportAsync(client, august.Id, october.Id), HttpStatusCode.OK);
        Assert.AreEqual(2L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            """SELECT count(*) FROM progress."ProgressPhotoExports" WHERE "ClientProfileId" = @id""",
            clientId));

        // Append-only at the database, whatever the application does.
        await R61bAssertRefusedAsync(
            "23514",
            null,
            """UPDATE progress."ProgressPhotoExports" SET "ExportedAtUtc" = now() WHERE "Id" = @id""",
            ("id", export.Id));
        await R61bAssertRefusedAsync(
            "23514",
            null,
            """DELETE FROM progress."ProgressPhotoExports" WHERE "Id" = @id""",
            ("id", export.Id));

        // Two photos of one pose, the earlier first.
        foreach (var (before, after) in new[]
                 {
                     (october.Id, august.Id),
                     (august.Id, august.Id),
                     (august.Id, side.Id),
                     (Guid.Empty, october.Id),
                 })
        {
            await AssertStatusAsync(await R61bExportAsync(client, before, after), HttpStatusCode.BadRequest);
        }

        // Only the client makes one: not their coach, and not someone signed out.
        await AssertStatusAsync(await R61bExportAsync(coach, august.Id, october.Id), HttpStatusCode.Forbidden);
        using var anonymous = CreateClient();
        await AssertStatusAsync(
            await anonymous.PostAsJsonAsync(R61bExportsUrl, new { beforePhotoId = august.Id, afterPhotoId = october.Id }),
            HttpStatusCode.Unauthorized);
        Assert.AreEqual(2L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            """SELECT count(*) FROM progress."ProgressPhotoExports" WHERE "ClientProfileId" = @id""",
            clientId));
    }

    [TestMethod]
    public async Task R61bOnlyTheClientsOwnActivePhotosCanBeUsed()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r61b-own-coach@example.test", "Coach", "Own Gym");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "r61b-own-client@example.test", true);
        SetTenant(client, tenant);
        var august = await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Back&photoDate=2026-08-05");
        var september = await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Back&photoDate=2026-09-05");
        var october = await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Back&photoDate=2026-10-05");

        // Another client of the same coach, holding the identifiers, finds nothing; nor with one of theirs.
        using var other = CreateClient();
        await InviteAndAcceptAsync(coach, other, "r61b-own-other@example.test", true);
        SetTenant(other, tenant);
        var othersOwn = await UploadProgressPhotoAsync(other, "/api/progress/me/photos?pose=Back&photoDate=2026-08-05");
        await AssertStatusAsync(await R61bExportAsync(other, august.Id, october.Id), HttpStatusCode.NotFound);
        await AssertStatusAsync(await R61bExportAsync(other, othersOwn.Id, october.Id), HttpStatusCode.NotFound);
        await AssertStatusAsync(await R61bExportAsync(client, othersOwn.Id, october.Id), HttpStatusCode.NotFound);

        // Another workspace: its client finds nothing here, and this client is refused at its door.
        using var foreignCoach = CreateClient();
        var foreign = await RegisterCoachAsync(foreignCoach, "r61b-own-foreign@example.test", "Foreign", "Coach");
        using var foreignClient = CreateClient();
        await InviteAndAcceptAsync(foreignCoach, foreignClient, "r61b-own-foreign-client@example.test", true);
        SetTenant(foreignClient, foreign);
        await AssertStatusAsync(await R61bExportAsync(foreignClient, august.Id, october.Id), HttpStatusCode.NotFound);
        SetTenant(client, foreign);
        await AssertStatusAsync(await R61bExportAsync(client, august.Id, october.Id), HttpStatusCode.Forbidden);
        SetTenant(client, tenant);

        // A removed photo stays in the client's own history but cannot leave in a picture.
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                $"/api/progress/me/photos/{october.Id}/remove",
                new { reason = "Bad light.", version = october.Version }),
            HttpStatusCode.OK);
        var refused = await R61bExportAsync(client, august.Id, october.Id);
        await AssertStatusAsync(refused, HttpStatusCode.Conflict);
        StringAssert.Contains(await refused.Content.ReadAsStringAsync(), "ProgressPhotoRemoved");
        Assert.AreEqual(0L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            """SELECT count(*) FROM progress."ProgressPhotoExports" WHERE "ClientProfileId" = @id""",
            clientId));

        // The database refuses it too, should a removal commit between the check and the insert.
        var userId = (await RequiredJsonAsync<TeamClientDetails>(await coach.GetAsync($"/api/clients/{clientId}"))).UserId!.Value;
        await R61bAssertRefusedAsync(
            "23514",
            DatabaseConstraintNames.ProgressPhotoExportNamesActivePhotos,
            """
            INSERT INTO progress."ProgressPhotoExports"
                ("Id", "TenantId", "ClientProfileId", "Pose", "BeforePhotoId", "AfterPhotoId", "ExportedAtUtc", "ExportedByUserId")
            VALUES (@id, @tenant, @client, 'Back', @before, @after, now(), @user)
            """,
            ("id", Guid.NewGuid()), ("tenant", tenant), ("client", clientId),
            ("before", august.Id), ("after", october.Id), ("user", userId));

        // A coach's block leaves the client's own progress theirs (PRG-008), this included.
        var details = await RequiredJsonAsync<Phase5B2ClientDetails>(await coach.GetAsync($"/api/clients/{clientId}"));
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                $"/api/clients/{clientId}/relationship/block",
                new { reason = "Paused for the export test.", details.Version }),
            HttpStatusCode.OK);
        await AssertStatusAsync(await R61bExportAsync(client, august.Id, september.Id), HttpStatusCode.OK);
    }

    [TestMethod]
    public async Task R61bAFormerClientIsRefusedAndAReturningClientHasOnlyTheirNewPhotos()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "r61b-back-owner@example.test", "Owner", "Back Gym");
        using var client = CreateClient();
        var oldId = await InviteAndAcceptAsync(owner, client, "r61b-back-client@example.test", true);
        SetTenant(client, tenant);
        var august = await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Side&photoDate=2026-08-10");
        var october = await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Side&photoDate=2026-10-10");
        await AssertStatusAsync(await R61bExportAsync(client, august.Id, october.Id), HttpStatusCode.OK);

        // Ending coaching closes the workspace to the former client at once (ADR 0027).
        await ReleaseAsync(owner, oldId, "Moved abroad");
        await AssertStatusAsync(await R61bExportAsync(client, august.Id, october.Id), HttpStatusCode.Forbidden);

        // Invited back, they start a new relationship: the old profile's photos are no longer theirs here.
        var link = await InviteClientAsync(owner, "r61b-back-client@example.test");
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                "/api/invitations/accept",
                new { token = QueryValue(link, "token"), displayName = (string?)null, password = (string?)null }),
            HttpStatusCode.OK);
        SetTenant(client, tenant);
        await AssertStatusAsync(await R61bExportAsync(client, august.Id, october.Id), HttpStatusCode.NotFound);

        var first = await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Side&photoDate=2026-08-10");
        var latest = await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Side&photoDate=2026-10-10");
        await AssertStatusAsync(await R61bExportAsync(client, first.Id, latest.Id), HttpStatusCode.OK);
        Assert.AreEqual(1L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            """SELECT count(*) FROM progress."ProgressPhotoExports" WHERE "ClientProfileId" = @id""",
            oldId));
    }

    [TestMethod]
    public async Task R61bAnExportThatRacesARemovalIsRefusedAndRecordsNothing()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r61b-race-coach@example.test", "Coach", "Race Gym");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "r61b-race-client@example.test", true);
        SetTenant(client, tenant);
        var august = await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Front&photoDate=2026-08-07");
        var october = await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Front&photoDate=2026-10-07");

        // The export passes its own checks and is held just before its insert; the photo is removed
        // meanwhile, and only then is the insert let go. The trigger sees the removal.
        RequiredInsertBarrier.Arm("progress.\"ProgressPhotoExports\"", 2);
        HttpResponseMessage exported;
        try
        {
            var pending = R61bExportAsync(client, august.Id, october.Id);
            await RequiredInsertBarrier.ArrivedAsync(1).WaitAsync(TimeSpan.FromSeconds(60));
            await RefreshCsrfAsync(coach);
            await AssertStatusAsync(
                await coach.PostAsJsonAsync(
                    $"/api/progress/clients/{clientId}/photos/{october.Id}/remove",
                    new { reason = "Wrong pose.", version = october.Version }),
                HttpStatusCode.OK);
            RequiredInsertBarrier.Disarm();
            exported = await pending;
            Assert.AreEqual(1, RequiredInsertBarrier.Arrived, "The export never reached its insert.");
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }

        // A stable 409 naming the removed photo, never a 500, and no record of an export that did not happen.
        await AssertStatusAsync(exported, HttpStatusCode.Conflict);
        Assert.AreEqual("ProgressPhotoRemoved", (await RequiredJsonAsync<Phase6Problem>(exported)).Code);
        Assert.AreEqual(0L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            """SELECT count(*) FROM progress."ProgressPhotoExports" WHERE "ClientProfileId" = @id""",
            clientId));
    }

    [TestMethod]
    public void R61bOnlyTheActivePhotosTriggerMeansARemovedPhoto()
    {
        Assert.IsTrue(ProgressApplicationService.IsRemovedPhotoExport(
            R61bCheckViolation(DatabaseConstraintNames.ProgressPhotoExportNamesActivePhotos)));
        Assert.IsFalse(ProgressApplicationService.IsRemovedPhotoExport(
            R61bCheckViolation("CK_ProgressPhotoExports_TwoPhotos")));
        Assert.IsFalse(ProgressApplicationService.IsRemovedPhotoExport(
            Phase6UniqueViolation(DatabaseConstraintNames.ProgressPhotoExportNamesActivePhotos)));
    }

    private static async Task<HttpResponseMessage> R61bExportAsync(HttpClient caller, Guid before, Guid after)
    {
        await RefreshCsrfAsync(caller);
        return await caller.PostAsJsonAsync(R61bExportsUrl, new { beforePhotoId = before, afterPhotoId = after });
    }

    private async Task<string[]> R61bExportColumnsAsync()
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        // xmin is the system column EF reads as the row version; it is not one of the table's own.
        command.CommandText = """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'progress' AND table_name = 'ProgressPhotoExports'
            """;
        var columns = new List<string>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            columns.Add(reader.GetString(0));
        }

        return [.. columns];
    }

    private async Task R61bAssertRefusedAsync(
        string sqlState,
        string? constraintName,
        string sql,
        params (string Name, object Value)[] parameters)
    {
        var failure = await Assert.ThrowsExactlyAsync<PostgresException>(() => Phase6ExecuteAsync(sql, parameters));
        Assert.AreEqual(sqlState, failure.SqlState, failure.MessageText);
        if (constraintName is not null)
        {
            Assert.AreEqual(constraintName, failure.ConstraintName, failure.MessageText);
        }
    }

    private static Microsoft.EntityFrameworkCore.DbUpdateException R61bCheckViolation(string constraintName) =>
        new(
            "The database rejected the write.",
            new PostgresException(
                "A photo export names two active photos, the earlier one first",
                "ERROR",
                "ERROR",
                PostgresErrorCodes.CheckViolation,
                constraintName: constraintName));

    private sealed record R61bExport(Guid Id, string Pose, R61bExportPhoto Before, R61bExportPhoto After, DateTimeOffset ExportedAtUtc);

    private sealed record R61bExportPhoto(Guid Id, DateOnly PhotoDate, Guid MediaAssetId);
}

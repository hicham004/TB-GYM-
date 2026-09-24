using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Release client (ADR 0027): the owner ends a client's relationship with the workspace. Access ends
/// at once, open plans and programmes close, nothing is deleted, the record stays read-only for the
/// owner, the client is emailed once, and the database refuses any undo. Runs in the Phase 3 harness
/// beside the team tests, because it needs training, commercial and the team helpers together.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task ReleaseEndsAccessAtOnceClosesOpenWorkAndKeepsTheRecordReadOnly()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "rel-owner@example.test", "Rel Owner", "Release Gym");
        using var coach = CreateClient();
        var coachUserId = await JoinAsCoachAsync(owner, coach, "rel-coach@example.test", "Rel Coach");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "rel-client@example.test", true);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 1, TenantToday());
        var block = await AssignAsync(coach, clientId, resources, TenantToday());
        var paid = await CreatePaidMessagingEnrollmentAsync(owner, clientId, 50m);
        await AssertStatusAsync(await client.GetAsync("/api/client-profile/me"), HttpStatusCode.OK);
        var ownerUserId = (await TeamMembersAsync(owner)).Single(member => member.Role == "Owner").UserId;
        var details = await RequiredJsonAsync<ReleasedDetails>(await owner.GetAsync($"/api/clients/{clientId}"));
        Assert.IsNull(details.Release);

        // Only the owner releases, with a reason, against the version they saw.
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync($"/api/clients/{clientId}/release", new { reason = "Mine to give", version = details.Version }),
            HttpStatusCode.Forbidden);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/clients/{clientId}/release", new { reason = "  ", version = details.Version }),
            HttpStatusCode.BadRequest);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/clients/{clientId}/release", new { reason = "Stale", version = details.Version + 1 }),
            HttpStatusCode.Conflict);

        var response = await owner.PostAsJsonAsync(
            $"/api/clients/{clientId}/release",
            new { reason = "Followed their coach to another gym", version = details.Version });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var released = await RequiredJsonAsync<ReleasedDetails>(response);
        Assert.IsNotNull(released.Release);
        Assert.AreEqual("Followed their coach to another gym", released.Release.Reason);
        Assert.AreEqual("Rel Owner", released.Release.ReleasedByName);
        Assert.AreEqual(ownerUserId, released.AssignedCoachUserId, "A former client is kept by the owner.");

        // The client is out of the workspace on their very next request; their account still works.
        await AssertStatusAsync(await client.GetAsync("/api/client-profile/me"), HttpStatusCode.Forbidden);
        var workspaces = await client.GetFromJsonAsync<TeamWorkspace[]>("/api/tenants") ?? [];
        Assert.IsFalse(workspaces.Any(item => item.TenantId == tenant), "The workspace left the client's list.");

        // Their coach no longer has them; the owner sees them only under Former clients.
        Assert.IsEmpty(await coach.GetFromJsonAsync<TeamClient[]>("/api/clients") ?? []);
        await AssertStatusAsync(await coach.GetAsync($"/api/clients/{clientId}"), HttpStatusCode.NotFound);
        Assert.IsFalse((await owner.GetFromJsonAsync<TeamClient[]>("/api/clients") ?? []).Any(item => item.Id == clientId));
        var former = await owner.GetFromJsonAsync<FormerClient[]>("/api/clients/former") ?? [];
        Assert.AreEqual("Followed their coach to another gym", former.Single(item => item.Id == clientId).Reason);
        await AssertStatusAsync(await coach.GetAsync("/api/clients/former"), HttpStatusCode.Forbidden);
        Assert.AreEqual(0, (await TeamMembersAsync(owner)).Single(member => member.Role == "Owner").AssignedClientCount);

        // The record is readable and nothing about it changes, however the write reaches it.
        await AssertStatusAsync(await owner.GetAsync($"/api/clients/{clientId}"), HttpStatusCode.OK);
        await AssertStatusAsync(await owner.GetAsync($"/api/training/mesocycles/{block.Id}"), HttpStatusCode.OK);
        await RefreshCsrfAsync(owner);
        HttpResponseMessage[] refusals =
        [
            await owner.PutAsJsonAsync($"/api/clients/{clientId}/coach-notes", new { notes = "late note", version = released.Version }),
            await owner.PostAsJsonAsync($"/api/clients/{clientId}/relationship/block", new { reason = "x", version = released.Version }),
            await owner.PostAsJsonAsync($"/api/clients/{clientId}/release", new { reason = "Again", version = released.Version }),
            await owner.PostAsJsonAsync(
                $"/api/progress/clients/{clientId}/bodyweight",
                new { value = 80m, unit = "Kilogram", measurementDate = TenantToday() }),
            await owner.PutAsJsonAsync($"/api/training/mesocycles/{block.Id}/visibility", new { revealAllWeeks = true, version = block.Version }),
            await owner.PostAsJsonAsync(
                $"/api/commercial/enrollments/{paid.Id}/payments",
                new
                {
                    amount = 5m,
                    currencyCode = "USD",
                    receivedAtUtc = DateTimeOffset.UtcNow,
                    method = "Cash",
                    reference = (string?)null,
                    note = (string?)null,
                    idempotencyKey = Guid.NewGuid(),
                }),
            await owner.PostAsJsonAsync(
                $"/api/commercial/enrollments/{paid.Id}/renew",
                new { offerId = paid.OfferId, startDate = TenantToday().AddDays(28), idempotencyKey = Guid.NewGuid() }),
        ];
        foreach (var refused in refusals)
        {
            await AssertStatusAsync(refused, HttpStatusCode.Conflict);
            StringAssert.Contains(await refused.Content.ReadAsStringAsync(), "client_released");
        }

        // Open work closed through its own audited transitions; money history untouched.
        Assert.AreEqual(
            2L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """SELECT count(*) FROM subscriptions."ClientEnrollments" WHERE "ClientProfileId" = @id AND "Status" = 'Cancelled'""",
                clientId),
            "Both the training plan and the paid messaging plan are cancelled.");
        Assert.AreEqual(
            1L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """SELECT count(*) FROM subscriptions."PaymentRecords" WHERE "EnrollmentId" = @id""",
                paid.Id),
            "The payment stays; there is no refund.");
        Assert.AreEqual(
            1L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """
                SELECT count(*) FROM training."Mesocycles" AS m
                JOIN training."MesocycleLifecycleEvents" AS e ON e."MesocycleId" = m."Id"
                WHERE m."Id" = @id AND m."Status" = 'Cancelled' AND e."EventType" = 'Cancelled'
                  AND e."Reason" LIKE 'Closed because the client was released%'
                """,
                block.Id));
        Assert.AreEqual(
            1L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """SELECT count(*) FROM clients."ClientRelationshipEvents" WHERE "ClientProfileId" = @id AND "EventType" = 'Released'""",
                clientId));

        // The coach history says who had the client and why they moved.
        var history = await RequiredJsonAsync<TeamAssignment[]>(
            await owner.GetAsync($"/api/clients/{clientId}/coach-assignments"));
        Assert.AreEqual("Released", history[^1].Reason);
        Assert.AreEqual(coachUserId, history[^1].PreviousCoachUserId);
        Assert.AreEqual(ownerUserId, history[^1].CoachUserId);

        // Not re-invitable, as a client or as a coach.
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync("/api/invitations", new
            {
                email = "rel-client@example.test",
                firstName = "Again",
                lastName = "Client",
                phoneNumber = "+96170000000",
                birthDate = "1995-04-02",
            }),
            HttpStatusCode.Conflict);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync("/api/team/invitations", new { email = "rel-client@example.test", firstName = "A", lastName = "B" }),
            HttpStatusCode.Conflict);

        // Told once, by email, in wording that names no workspace, coach or reason.
        CapturedNoticeMail.Clear();
        var sweep = await SweepWorkspaceNoticesAsync();
        Assert.AreEqual(1, sweep.Materialized);
        var mail = CapturedNoticeMail.Captured.Single(item => item.Scope == ActionMailScopes.WorkspaceNotice);
        Assert.AreEqual("rel-client@example.test", mail.RecipientAddress);
        Assert.Contains("ended your access", mail.TextBody);
        Assert.DoesNotContain("Release Gym", mail.TextBody);
        Assert.DoesNotContain("Rel Coach", mail.TextBody);
        Assert.DoesNotContain("another gym", mail.TextBody);
        Assert.AreEqual(0, (await SweepWorkspaceNoticesAsync()).Total, "A notice is sent once.");
    }

    [TestMethod]
    public async Task ReleaseLeavesAProgrammeWithAWorkoutInProgressAsItIs()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "rel-wip-owner@example.test", "Owner", "Workout Gym");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(owner, client, "rel-wip-client@example.test", true);
        var resources = await CreateTrainingResourcesAsync(owner, clientId, 8, 1, TenantToday());
        var block = await AssignAsync(owner, clientId, resources, TenantToday());
        var schedule = await RequiredJsonAsync<Mesocycle>(await owner.GetAsync($"/api/training/mesocycles/{block.Id}"));
        await RefreshCsrfAsync(client);
        var started = await client.PostAsync($"/api/training/me/sessions/{schedule.Weeks[0].Sessions[0].Id}/start", null);
        await AssertStatusAsync(started, HttpStatusCode.OK);
        var execution = await RequiredJsonAsync<Execution>(started);

        await ReleaseAsync(owner, clientId, "Stopped training");

        Assert.AreEqual(
            0L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """SELECT count(*) FROM training."Mesocycles" WHERE "Id" = @id AND "Status" = 'Cancelled'""",
                block.Id),
            "A programme cannot be cancelled mid-workout, and a release must not fail because of it.");
        Assert.AreEqual(
            1L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """SELECT count(*) FROM subscriptions."ClientEnrollments" WHERE "Id" = @id AND "Status" = 'Cancelled'""",
                resources.Enrollment.Id));

        // The client cannot finish it, and the owner cannot annotate it any more.
        await AssertStatusAsync(
            await client.PostAsync($"/api/training/me/workouts/{execution.Id}/complete", null),
            HttpStatusCode.Forbidden);
        await RefreshCsrfAsync(owner);
        var note = await owner.PostAsJsonAsync($"/api/training/workouts/{execution.Id}/notes", new { text = "Too late" });
        await AssertStatusAsync(note, HttpStatusCode.Conflict);
        StringAssert.Contains(await note.Content.ReadAsStringAsync(), "client_released");
    }

    [TestMethod]
    public async Task ReleaseIsPermanentAndTheDatabaseRefusesAnyUndo()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "rel-db-owner@example.test", "Owner", "Permanent Gym");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(owner, client, "rel-db-client@example.test", true);
        using var other = CreateClient();
        var otherId = await InviteAndAcceptAsync(owner, other, "rel-db-other@example.test", true);
        var clientUserId = (await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{clientId}"))).UserId!.Value;
        var otherUserId = (await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{otherId}"))).UserId!.Value;

        // Another workspace's owner cannot release this client.
        using var foreignOwner = CreateClient();
        await RegisterCoachAsync(foreignOwner, "rel-db-foreign@example.test", "Foreign", "Foreign Release Gym");
        await RefreshCsrfAsync(foreignOwner);
        await AssertStatusAsync(
            await foreignOwner.PostAsJsonAsync($"/api/clients/{clientId}/release", new { reason = "Not mine", version = 0u }),
            HttpStatusCode.NotFound);

        await ReleaseAsync(owner, clientId, "Quit the gym");

        // No un-release, no edits, no deletion of the record.
        await AssertSqlStateAsync(
            "55000",
            """UPDATE clients."ClientProfiles" SET "ReleasedAtUtc" = NULL WHERE "Id" = @client""",
            ("client", clientId));
        await AssertSqlStateAsync(
            "55000",
            """UPDATE clients."ClientProfiles" SET "CoachNotes" = 'rewritten' WHERE "Id" = @client""",
            ("client", clientId));
        await AssertSqlStateAsync(
            "55000",
            """DELETE FROM clients."ClientProfiles" WHERE "Id" = @client""",
            ("client", clientId));

        // No way back into the workspace.
        await AssertSqlStateAsync(
            "23514",
            """UPDATE tenancy."Memberships" SET "Status" = 'Active' WHERE "TenantId" = @tenant AND "UserId" = @user""",
            ("tenant", tenant),
            ("user", clientUserId));

        // The no-undo guard is about releases only: an ordinary membership change is not refused.
        await Phase6ExecuteAsync(
            """UPDATE tenancy."Memberships" SET "Status" = 'Suspended' WHERE "TenantId" = @tenant AND "UserId" = @user""",
            ("tenant", tenant),
            ("user", otherUserId));
        await Phase6ExecuteAsync(
            """UPDATE tenancy."Memberships" SET "Status" = 'Active' WHERE "TenantId" = @tenant AND "UserId" = @user""",
            ("tenant", tenant),
            ("user", otherUserId));

        // And no half-release: marking a client released without ending their access is refused.
        await AssertSqlStateAsync(
            "23514",
            """UPDATE clients."ClientProfiles" SET "ReleasedAtUtc" = CURRENT_TIMESTAMP WHERE "Id" = @client""",
            ("client", otherId));
        await AssertStatusAsync(await other.GetAsync("/api/client-profile/me"), HttpStatusCode.OK);
    }

    // ---------- release helpers ----------

    private CapturedActionEmailTransport CapturedNoticeMail =>
        RequiredFactory.Services.GetRequiredService<CapturedActionEmailTransport>();

    private async Task<WorkspaceNoticeMailDispatchOutcome> SweepWorkspaceNoticesAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        return await scope.ServiceProvider
            .GetRequiredService<IWorkspaceNoticeMailDispatchService>()
            .DispatchDueAsync(CancellationToken.None);
    }

    private static async Task ReleaseAsync(HttpClient owner, Guid clientId, string reason)
    {
        var details = await RequiredJsonAsync<ReleasedDetails>(await owner.GetAsync($"/api/clients/{clientId}"));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/clients/{clientId}/release", new { reason, version = details.Version }),
            HttpStatusCode.OK);
    }

    /// <summary>A priced Messaging plan, paid in full with one cash receipt.</summary>
    private static async Task<PaidEnrollment> CreatePaidMessagingEnrollmentAsync(HttpClient owner, Guid clientId, decimal price)
    {
        await RefreshCsrfAsync(owner);
        var productResponse = await owner.PostAsJsonAsync("/api/commercial/products", new
        {
            name = $"Paid chat {Guid.NewGuid():N}",
            description = "Release scenario",
            initialOffer = new
            {
                label = "4 weeks",
                durationCount = 4,
                durationUnit = "Week",
                priceAmount = price,
                priceCurrency = "USD",
                features = new[] { new { feature = "Messaging", allowsConcurrentCoverage = false } },
            },
        });
        await AssertStatusAsync(productResponse, HttpStatusCode.OK);
        var offerId = (await RequiredJsonAsync<Product>(productResponse)).Offers[0].Id;
        await RefreshCsrfAsync(owner);
        var enrollmentResponse = await owner.PostAsJsonAsync(
            $"/api/commercial/clients/{clientId}/enrollments",
            new { offerId, startDate = TenantToday(), idempotencyKey = Guid.NewGuid() });
        await AssertStatusAsync(enrollmentResponse, HttpStatusCode.OK);
        var enrollment = await RequiredJsonAsync<Enrollment>(enrollmentResponse);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(
                $"/api/commercial/enrollments/{enrollment.Id}/payments",
                new
                {
                    amount = price,
                    currencyCode = "USD",
                    receivedAtUtc = DateTimeOffset.UtcNow,
                    method = "Cash",
                    reference = (string?)null,
                    note = (string?)null,
                    idempotencyKey = Guid.NewGuid(),
                }),
            HttpStatusCode.OK);
        return new PaidEnrollment(enrollment.Id, offerId);
    }

    private sealed record PaidEnrollment(Guid Id, Guid OfferId);
    private sealed record ReleaseView(DateTimeOffset ReleasedAtUtc, string Reason, Guid? ReleasedByUserId, string ReleasedByName);
    private sealed record ReleasedDetails(Guid Id, Guid AssignedCoachUserId, uint Version, ReleaseView? Release);
    private sealed record FormerClient(Guid Id, string Email, DateTimeOffset ReleasedAtUtc, string Reason);
}

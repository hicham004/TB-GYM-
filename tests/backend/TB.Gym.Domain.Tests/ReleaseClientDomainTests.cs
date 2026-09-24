using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Domain.Tests;

/// <summary>Release client (ADR 0027): a permanent, read-only end to a client's workspace relationship.</summary>
[TestClass]
public sealed class ReleaseClientDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-000000000027");
    private static readonly Guid ClientUserId = Guid.Parse("20000000-0000-0000-0000-000000000011");
    private static readonly Guid OwnerUserId = Guid.Parse("20000000-0000-0000-0000-000000000012");
    private static readonly Guid CoachUserId = Guid.Parse("20000000-0000-0000-0000-000000000013");
    private static readonly DateTimeOffset Now = new(2026, 9, 23, 11, 0, 0, TimeSpan.Zero);

    [TestMethod]
    public void AReleasedClientIsMarkedOnceAndOnlyFromTheOwner()
    {
        var profile = CreateProfile(CoachUserId);

        Assert.Throws<InvalidOperationException>(
            () => profile.Release(OwnerUserId, Now),
            "A client still with a coach is moved to the owner first.");
        Assert.IsFalse(profile.IsReleased);

        profile.AssignCoach(OwnerUserId);
        profile.Release(OwnerUserId, Now);

        Assert.IsTrue(profile.IsReleased);
        Assert.AreEqual(Now, profile.ReleasedAtUtc);
        Assert.Throws<ClientReleasedException>(() => profile.Release(OwnerUserId, Now.AddMinutes(1)));
        Assert.AreEqual(Now, profile.ReleasedAtUtc, "A release is never re-dated.");
    }

    [TestMethod]
    public void AReleasedClientsRecordRefusesEveryChange()
    {
        var profile = CreateProfile(OwnerUserId);
        profile.Release(OwnerUserId, Now);

        Assert.Throws<ClientReleasedException>(() => profile.UpdateCoachNotes("still here?"));
        Assert.Throws<ClientReleasedException>(() => profile.AssignCoach(CoachUserId));
        Assert.Throws<ClientReleasedException>(() => profile.BlockCoachAccess());
        Assert.Throws<ClientReleasedException>(() => profile.UnblockCoachAccess());
        Assert.Throws<ClientReleasedException>(() => profile.UpdateIntake(
            new ClientIntakeInput("Mira", "Haddad", null, null, null, null, null, null, null, null, null, null, null, null, null),
            new DateOnly(2026, 9, 23)));
        Assert.AreEqual(OwnerUserId, profile.AssignedCoachUserId);
        Assert.IsNull(profile.CoachNotes);
    }

    [TestMethod]
    public void AReleaseIsRecordedInTheCoachHistoryAsItsOwnReason()
    {
        var entry = ClientCoachAssignment.ForChange(
            TenantId,
            Guid.NewGuid(),
            3,
            CoachUserId,
            OwnerUserId,
            ClientCoachAssignmentReason.Released,
            null,
            Now);

        Assert.AreEqual(ClientCoachAssignmentReason.Released, entry.Reason);
        Assert.AreEqual(CoachUserId, entry.PreviousCoachUserId);
        Assert.AreEqual(OwnerUserId, entry.CoachUserId);
    }

    [TestMethod]
    public void OnlyAnActiveClientMembershipCanBeReleased()
    {
        var client = TenantMembership.Create(TenantId, ClientUserId, TenantRole.Client);
        client.ReleaseClient();
        Assert.AreEqual(MembershipStatus.Removed, client.Status);
        Assert.Throws<InvalidOperationException>(client.ReleaseClient, "A release happens once.");

        var coach = TenantMembership.Create(TenantId, CoachUserId, TenantRole.Coach);
        Assert.Throws<InvalidOperationException>(coach.ReleaseClient);
        var owner = TenantMembership.Create(TenantId, OwnerUserId, TenantRole.Owner);
        Assert.Throws<InvalidOperationException>(owner.ReleaseClient);
        Assert.Throws<InvalidOperationException>(client.RejoinAsCoach, "A released client is not a coach.");
    }

    [TestMethod]
    public void AReleaseNoticeIsQueuedForTheClientAboutTheirProfile()
    {
        var profileId = Guid.NewGuid();
        var request = WorkspaceNoticeMailRequest.ClientReleased(TenantId, ClientUserId, profileId, OwnerUserId, Now);

        Assert.AreEqual(WorkspaceNoticeKind.ClientReleased, request.Kind);
        Assert.AreEqual(ClientUserId, request.RecipientUserId);
        Assert.AreEqual(profileId, request.SubjectId);
        Assert.AreEqual(WorkspaceNoticeMailStatus.Pending, request.Status);
        Assert.IsTrue(request.IsClaimable(Now));
        Assert.IsFalse(request.IsClaimable(Now.AddTicks(-1)));
    }

    [TestMethod]
    public void ANoticeIsClaimedAttemptedAndMaterializedOnlyUnderItsOwnClaim()
    {
        var request = WorkspaceNoticeMailRequest.ClientReleased(TenantId, ClientUserId, Guid.NewGuid(), OwnerUserId, Now);
        var claim = request.Claim(Now, TimeSpan.FromMinutes(2), 4);

        Assert.AreEqual(WorkspaceNoticeMailStatus.Processing, request.Status);
        Assert.IsFalse(request.IsClaimable(Now.AddMinutes(1)), "A live claim is not claimable again.");
        Assert.IsTrue(request.IsClaimable(Now.AddMinutes(2)), "An expired claim can be taken over.");
        Assert.Throws<InvalidOperationException>(() => request.StartAttempt(Guid.NewGuid(), 4));

        Assert.AreEqual(1, request.StartAttempt(claim, 4));
        request.MarkMaterialized(claim, Now, "captured");

        Assert.AreEqual(WorkspaceNoticeMailStatus.Materialized, request.Status);
        Assert.IsTrue(request.IsTerminal);
        Assert.IsNull(request.ClaimToken);
        Assert.IsNull(request.FailureCode);
    }

    [TestMethod]
    public void ARetriedNoticeMovesForwardAndAnExhaustedOneIsDeadLettered()
    {
        var request = WorkspaceNoticeMailRequest.ClientReleased(TenantId, ClientUserId, Guid.NewGuid(), null, Now);
        var claim = request.Claim(Now, TimeSpan.FromMinutes(2), 1);
        request.StartAttempt(claim, 1);

        Assert.IsNull(
            WorkspaceNoticeMailRetryPolicy.NextAttemptAtUtc(1, 1, Now),
            "The last permitted attempt has no retry.");
        request.MarkDeadLettered(claim, Now, WorkspaceNoticeMailCodes.TransportTransient);
        Assert.AreEqual(WorkspaceNoticeMailStatus.DeadLettered, request.Status);
        Assert.AreEqual(Now, request.DeadLetteredAtUtc);

        var retried = WorkspaceNoticeMailRequest.ClientReleased(TenantId, ClientUserId, Guid.NewGuid(), null, Now);
        var second = retried.Claim(Now, TimeSpan.FromMinutes(2), 4);
        retried.StartAttempt(second, 4);
        Assert.Throws<ArgumentOutOfRangeException>(
            () => retried.MarkRetrying(second, Now, WorkspaceNoticeMailCodes.TransportTransient),
            "A retry must move forward in time.");
        retried.MarkRetrying(second, Now.AddMinutes(1), WorkspaceNoticeMailCodes.TransportTransient);
        Assert.AreEqual(WorkspaceNoticeMailStatus.Pending, retried.Status);
        Assert.AreEqual(Now.AddMinutes(1), retried.NextAttemptAtUtc);
    }

    [TestMethod]
    public void TheProviderKeyNamesTheRequestTheAttemptAndATruncatedFingerprint()
    {
        var requestId = Guid.Parse("7a0b6e4e-5d0e-4d3c-9a11-0d3c1d2e3f40");
        var fingerprint = new string('a', 64);

        Assert.AreEqual(
            $"workspace-notice:{requestId:N}:a2:v1:{new string('a', 32)}",
            WorkspaceNoticeMailAttempt.BuildProviderIdempotencyKey(requestId, 2, fingerprint));
        Assert.Throws<ArgumentException>(
            () => WorkspaceNoticeMailAttempt.BuildProviderIdempotencyKey(requestId, 1, "mira@example.com"),
            "A raw address is never accepted in place of its fingerprint.");
    }

    [TestMethod]
    public void TheReleaseEmailNamesNoWorkspaceCoachClientOrReason()
    {
        var content = WorkspaceNoticeEmailTemplates.Render(WorkspaceNoticeKind.ClientReleased);

        Assert.AreEqual(WorkspaceNoticeEmailTemplates.ClientReleasedKey, content.TemplateKey);
        Assert.Contains("ended your access", content.Body);
        Assert.Contains("Nothing you recorded there was deleted", content.Body);
        Assert.DoesNotContain("http", content.Body, "The notice carries no link.");
        Assert.DoesNotContain("{", content.Body, "Nothing is composed into the wording.");
    }

    private static ClientProfile CreateProfile(Guid coachUserId) =>
        ClientProfile.CreateForAcceptedInvitation(
            TenantId,
            ClientUserId,
            coachUserId,
            "Mira",
            "Haddad",
            "mira@example.com",
            null,
            null);
}

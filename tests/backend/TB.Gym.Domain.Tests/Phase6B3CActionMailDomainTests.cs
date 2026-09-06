using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Invitations;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Phase 6B-3C domain rules: logical-send generations, token evidence, and the action-mail lifecycle.
/// </summary>
[TestClass]
public sealed class Phase6B3CActionMailDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("2f4c2f52-1a3f-4b70-9c6a-8fbd8b6f3a11");

    private static readonly Guid InvitationId = Guid.Parse("9a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d");

    private static readonly Guid RequestId = Guid.Parse("11111111-2222-4333-8444-555555555555");

    private static readonly Guid AttemptId = Guid.Parse("66666666-7777-4888-8999-aaaaaaaaaaaa");

    private static readonly Guid ActorId = Guid.Parse("bbbbbbbb-cccc-4ddd-8eee-ffffffffffff");

    private static readonly DateTimeOffset Now = new(2026, 9, 5, 6, 0, 0, TimeSpan.Zero);

    private static readonly string StampHash = new('a', 64);

    /// <summary>
    /// The two modules publish the same named retry schedule and the same attempt bounds.
    /// </summary>
    /// <remarks>
    /// They are declared twice because a module owns its own rules and may not reference another, and
    /// this is what stops that duplication drifting silently into two different policies wearing one
    /// name. If somebody deliberately changes one, this fails and they have to change the ADR too.
    /// </remarks>
    [TestMethod]
    public void BothActionMailQueuesPublishTheSameNamedRetryPolicy()
    {
        // Compared through arrays rather than directly, because these are compile-time constants and
        // a direct comparison is one the analyzer can fold away - which would leave the duplication
        // unguarded at exactly the moment somebody changes one of them.
        string[] names = [AccountActionMailRetryPolicy.Name, InvitationActionMailRetryPolicy.Name];
        Assert.AreEqual(
            1,
            names.Distinct(StringComparer.Ordinal).Count(),
            "The two queues publish different policy names for what the ADR calls one policy.");

        CollectionAssert.AreEqual(
            AccountActionMailRetryPolicy.Schedule.ToArray(),
            InvitationActionMailRetryPolicy.Schedule.ToArray(),
            "The two queues' backoff tables have drifted apart.");

        int[] defaults =
            [AccountActionMailLimits.DefaultMaximumAttempts, InvitationActionMailLimits.DefaultMaximumAttempts];
        int[] minimums =
            [AccountActionMailLimits.MinimumMaximumAttempts, InvitationActionMailLimits.MinimumMaximumAttempts];
        int[] maximums =
            [AccountActionMailLimits.MaximumMaximumAttempts, InvitationActionMailLimits.MaximumMaximumAttempts];

        Assert.AreEqual(1, defaults.Distinct().Count(), "The default attempt budgets have drifted apart.");
        Assert.AreEqual(1, minimums.Distinct().Count(), "The minimum attempt bounds have drifted apart.");
        Assert.AreEqual(1, maximums.Distinct().Count(), "The maximum attempt bounds have drifted apart.");
    }

    /// <summary>
    /// The schedule is a fixed table, asserted exactly, so changing it is a visible decision.
    /// </summary>
    /// <remarks>
    /// Tighter than the commercial notification schedule on purpose: a credential decays in minutes,
    /// and every durable retry mints another live one.
    /// </remarks>
    [TestMethod]
    public void TheActionMailScheduleIsOneMinuteFiveMinutesThenAThirtyMinuteCeiling()
    {
        Assert.AreEqual(
            Now.AddMinutes(1),
            AccountActionMailRetryPolicy.NextAttemptAtUtc(1, 4, Now));
        Assert.AreEqual(
            Now.AddMinutes(5),
            AccountActionMailRetryPolicy.NextAttemptAtUtc(2, 4, Now));
        Assert.AreEqual(
            Now.AddMinutes(30),
            AccountActionMailRetryPolicy.NextAttemptAtUtc(3, 4, Now));
        Assert.IsNull(
            AccountActionMailRetryPolicy.NextAttemptAtUtc(4, 4, Now),
            "The last permitted attempt dead-letters instead of waiting again.");
        Assert.AreEqual(TimeSpan.FromMinutes(36), AccountActionMailRetryPolicy.MaximumRetrySpan(4));
    }

    /// <summary>
    /// A request either names a subject and the credential state it was made against, or neither.
    /// </summary>
    /// <remarks>
    /// The "neither" shape is what an unknown address produces, and it must carry nothing an address
    /// could be recovered from. A half-populated shape would be a row that says an account exists
    /// without saying which, which is worse than either.
    /// </remarks>
    [TestMethod]
    public void AnActionMailRequestCarriesASubjectAndItsCredentialStateOrNeither()
    {
        var resolved = AccountActionMailRequest.For(
            ActorId,
            StampHash,
            AccountActionKind.ResetPassword,
            AccountActionMailSources.PublicPasswordRecovery,
            null,
            Now);
        Assert.AreEqual(ActorId, resolved.SubjectUserId);
        Assert.AreEqual(StampHash, resolved.SubjectSecurityStampHash);

        var unresolved = AccountActionMailRequest.ForUnresolvedSubject(
            AccountActionKind.ResetPassword,
            AccountActionMailSources.PublicPasswordRecovery,
            Now);
        Assert.IsNull(unresolved.SubjectUserId);
        Assert.IsNull(unresolved.SubjectSecurityStampHash);
        Assert.AreEqual(AccountActionMailStatus.Pending, unresolved.Status);
        Assert.AreEqual(0, unresolved.AttemptCount);

        Assert.Throws<ArgumentException>(() => AccountActionMailRequest.For(
            ActorId,
            "not-a-digest",
            AccountActionKind.ConfirmEmail,
            AccountActionMailSources.CoachRegistration,
            null,
            Now));
    }

    /// <summary>
    /// A committed claim is a lease on work. Only its holder may finalize it.
    /// </summary>
    [TestMethod]
    public void OnlyTheHolderOfTheCurrentClaimCanFinalizeAnActionMailRequest()
    {
        var request = AccountActionMailRequest.For(
            ActorId,
            StampHash,
            AccountActionKind.ConfirmEmail,
            AccountActionMailSources.CoachRegistration,
            ActorId,
            Now);
        var claim = request.Claim(Now, TimeSpan.FromMinutes(2), 4);

        Assert.Throws<InvalidOperationException>(() =>
            request.MarkMaterialized(Guid.NewGuid(), Now, "captured"));

        request.StartAttempt(claim, 4);
        request.MarkMaterialized(claim, Now, "captured");
        Assert.AreEqual(AccountActionMailStatus.Materialized, request.Status);
        Assert.IsNull(request.ClaimToken, "A finalized request releases its lease.");
        Assert.IsTrue(request.IsTerminal);

        Assert.Throws<InvalidOperationException>(() =>
            request.SuppressBeforeClaim(Now, AccountActionMailCodes.AlreadyConfirmed));
    }

    /// <summary>
    /// The provider idempotency key names its own request and attempt, and binds the mailbox.
    /// </summary>
    /// <remarks>
    /// Per attempt rather than per message, because a re-minted token changes the payload and a
    /// provider answers one key presented with two bodies by refusing rather than sending.
    /// </remarks>
    [TestMethod]
    public void EachMaterializationPresentsItsOwnProviderIdempotencyKey()
    {
        var fingerprint = new string('c', 64);
        var first = AccountActionMailAttempt.BuildProviderIdempotencyKey(RequestId, 1, fingerprint);
        var second = AccountActionMailAttempt.BuildProviderIdempotencyKey(RequestId, 2, fingerprint);

        Assert.AreNotEqual(first, second, "Two materializations must not present one provider key.");
        Assert.StartsWith($"account-action:{RequestId:N}:a1:v1:", first);
        Assert.EndsWith(fingerprint[..32], first);
        Assert.IsLessThan(256, first.Length, "The key must stay inside the provider's limit.");

        // A different mailbox is a different key, so a corrected address cannot collide with a key
        // the provider still remembers for the old one.
        Assert.AreNotEqual(
            first,
            AccountActionMailAttempt.BuildProviderIdempotencyKey(RequestId, 1, new string('d', 64)));

        // And an address is refused where a fingerprint belongs.
        Assert.Throws<ArgumentException>(() =>
            AccountActionMailAttempt.BuildProviderIdempotencyKey(RequestId, 1, "someone@example.test"));
    }

    /// <summary>
    /// One attempt mints one token, and a completed attempt is a historical fact.
    /// </summary>
    [TestMethod]
    public void OneAttemptMintsOneTokenAndIsImmutableOnceComplete()
    {
        var attempt = InvitationActionMailAttempt.Start(
            TenantId,
            RequestId,
            InvitationId,
            1,
            1,
            Guid.NewGuid(),
            InvitationActionMailAttempt.BuildProviderIdempotencyKey(RequestId, 1, new string('e', 64)),
            Now);

        attempt.RecordTokenMinted(Now);
        Assert.AreEqual(Now, attempt.TokenMintedAtUtc);
        Assert.Throws<InvalidOperationException>(() => attempt.RecordTokenMinted(Now.AddSeconds(1)));

        attempt.Succeed(Now.AddSeconds(1));
        Assert.IsTrue(attempt.IsCompleted);
        Assert.Throws<InvalidOperationException>(() =>
            attempt.FailTransiently(Now.AddSeconds(2), InvitationActionMailCodes.TransportTransient));
    }

    /// <summary>
    /// A token is redeemable only for the current generation, unrevoked, unredeemed and unexpired.
    /// </summary>
    /// <remarks>
    /// The generation term is what makes a transport retry safe and a deliberate resend decisive: two
    /// tokens of one generation both work, and every token of an earlier one does not.
    /// </remarks>
    [TestMethod]
    public void AnIssuedTokenIsRedeemableOnlyForTheCurrentGenerationAndOnlyOnce()
    {
        var issue = Issue(generation: 2, expiresAtUtc: Now.AddDays(7));

        Assert.IsTrue(issue.IsRedeemable(2, Now));
        Assert.IsFalse(issue.IsRedeemable(3, Now), "A superseded generation's token is dead.");
        Assert.IsFalse(issue.IsRedeemable(2, Now.AddDays(8)), "An expired token is dead.");

        issue.Redeem(ActorId, Now);
        Assert.AreEqual(ActorId, issue.RedeemedByUserId);
        Assert.IsFalse(issue.IsRedeemable(2, Now));
        Assert.Throws<InvalidOperationException>(() => issue.Redeem(ActorId, Now));
        Assert.IsFalse(
            issue.Revoke(Now, InvitationActionMailCodes.TokenSupersededByResend),
            "Revoking a redeemed token would erase that it was used.");
    }

    /// <summary>Revocation is write-once, and a revoked token can never be redeemed.</summary>
    [TestMethod]
    public void RevocationIsWriteOnceAndBlocksRedemption()
    {
        var issue = Issue(generation: 1, expiresAtUtc: Now.AddDays(7));

        Assert.IsTrue(issue.Revoke(Now, InvitationActionMailCodes.TokenSupersededByResend));
        Assert.AreEqual(InvitationActionMailCodes.TokenSupersededByResend, issue.RevocationReason);
        Assert.IsFalse(
            issue.Revoke(Now.AddMinutes(1), InvitationActionMailCodes.TokenInvitationRevoked),
            "A second revocation must be a no-op rather than a rewrite.");
        Assert.AreEqual(Now, issue.RevokedAtUtc);
        Assert.Throws<InvalidOperationException>(() => issue.Redeem(ActorId, Now.AddMinutes(2)));
    }

    /// <summary>A token must name a real materialization attempt and a plausible lifetime.</summary>
    [TestMethod]
    public void AnIssuedTokenNamesItsMaterializationAndCannotExpireBeforeItIsIssued()
    {
        Assert.Throws<ArgumentException>(() => InvitationTokenIssue.Issue(
            TenantId,
            InvitationId,
            1,
            RequestId,
            Guid.Empty,
            1,
            new string('f', 64),
            Now,
            Now.AddDays(7)));

        Assert.Throws<ArgumentOutOfRangeException>(() => InvitationTokenIssue.Issue(
            TenantId,
            InvitationId,
            1,
            RequestId,
            AttemptId,
            1,
            new string('f', 64),
            Now,
            Now));

        Assert.Throws<ArgumentException>(() => InvitationTokenIssue.Issue(
            TenantId,
            InvitationId,
            1,
            RequestId,
            AttemptId,
            1,
            "NOT-A-LOWERCASE-DIGEST",
            Now,
            Now.AddDays(7)));
    }

    /// <summary>
    /// An expired invitation cannot begin a new logical send, and an accepted one cannot either.
    /// </summary>
    /// <remarks>
    /// A resend is a decision about a live invitation. Allowing one on a dead invitation would create a
    /// generation whose tokens could never be redeemed, which is a queue row nobody can explain.
    /// </remarks>
    [TestMethod]
    public void OnlyALiveInvitationCanBeginANewLogicalSend()
    {
        var expired = NewInvitation();
        Assert.Throws<InvalidOperationException>(() =>
            expired.BeginNewLogicalSend(Now.AddDays(15), Now.AddDays(8)));

        var accepted = NewInvitation();
        accepted.MarkAccepted(ActorId, Now.AddMinutes(1));
        Assert.Throws<InvalidOperationException>(() =>
            accepted.BeginNewLogicalSend(Now.AddDays(14), Now.AddMinutes(2)));
        Assert.AreEqual(ClientInvitation.FirstLogicalSendGeneration, accepted.LogicalSendGeneration);
    }

    /// <summary>Mailability is the single question the dispatcher asks the aggregate.</summary>
    [TestMethod]
    public void AnInvitationIsMailableOnlyWhilePendingAndUnexpired()
    {
        var invitation = NewInvitation();
        Assert.IsTrue(invitation.IsMailable(Now.AddMinutes(1)));
        Assert.IsFalse(invitation.IsMailable(Now.AddDays(8)), "An expired invitation is not mailable.");

        invitation.Revoke(Now.AddMinutes(2));
        Assert.IsFalse(invitation.IsMailable(Now.AddMinutes(3)));
    }

    private static ClientInvitation NewInvitation() => ClientInvitation.Create(
        TenantId,
        "invited@example.test",
        "Mira",
        "Haddad",
        null,
        new DateOnly(1995, 4, 2),
        Now.AddDays(7),
        Now);

    private static InvitationTokenIssue Issue(int generation, DateTimeOffset expiresAtUtc) =>
        InvitationTokenIssue.Issue(
            TenantId,
            InvitationId,
            generation,
            RequestId,
            AttemptId,
            1,
            new string('f', 64),
            Now,
            expiresAtUtc);
}

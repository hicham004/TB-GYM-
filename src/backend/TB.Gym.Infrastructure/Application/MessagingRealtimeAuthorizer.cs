using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Messaging;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The current answer to "may this person read this conversation, right now", read from PostgreSQL.
/// </summary>
/// <remarks>
/// Used by the hub on connect and on every subscribe, and by the dispatcher immediately before it
/// materializes anything. It is deliberately a fresh read every time. SignalR caches the principal
/// for the life of a connection, so a socket opened while somebody was an entitled participant keeps
/// presenting that principal after their membership is revoked, their account is blocked, the coaching
/// relationship is blocked or the Messaging entitlement lapses. Nothing about a connection expires on
/// its own, and a committed dispatch claim is a lease rather than continuing permission to deliver.
/// <para>
/// The answer is a single boolean on purpose. Unknown conversation, another workspace's conversation,
/// a same-workspace non-participant and a denied entitlement are the same "no" here, exactly as the
/// REST surface refuses them indistinguishably — a socket that could tell them apart would be an
/// oracle the HTTP API deliberately is not.
/// </para>
/// </remarks>
internal sealed class MessagingRealtimeAuthorizer(
    GymDbContext dbContext,
    IMutableTenantContext tenantContext,
    ICoachingFeatureAccessService featureAccessService)
    : IMessagingRealtimeAuthorizer
{
    public async Task<bool> BindVerifiedTenantAsync(
        Guid tenantId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        if (tenantId == Guid.Empty || userId == Guid.Empty)
        {
            return false;
        }

        // Read before the tenant context is set, and without a query filter that would be scoped by
        // the very value being verified. The workspace itself must be active: a closed workspace is
        // not a place anybody is currently a member of.
        var isActiveMember = await dbContext.TenantMemberships
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(
                membership =>
                    membership.TenantId == tenantId &&
                    membership.UserId == userId &&
                    membership.Status == MembershipStatus.Active &&
                    dbContext.Tenants.Any(tenant => tenant.Id == tenantId && tenant.IsActive) &&
                    dbContext.Users.Any(user => user.Id == userId && !user.IsPlatformBlocked),
                cancellationToken);
        if (!isActiveMember)
        {
            return false;
        }

        // Only now. Every tenant-filtered query in this scope is scoped to a workspace whose
        // membership has just been re-established, rather than to a query-string value.
        tenantContext.SetTenant(tenantId);
        return true;
    }

    public async Task<bool> CanAccessConversationAsync(
        Guid tenantId,
        Guid userId,
        Guid conversationId,
        CancellationToken cancellationToken)
    {
        if (conversationId == Guid.Empty ||
            !await BindVerifiedTenantAsync(tenantId, userId, cancellationToken))
        {
            return false;
        }

        // Explicit participation. Workspace membership grants nothing here; another Owner or Coach of
        // the same workspace is refused exactly as a stranger is.
        var conversation = await dbContext.Conversations
            .AsNoTracking()
            .Where(candidate =>
                candidate.Id == conversationId &&
                dbContext.ConversationParticipants.Any(participant =>
                    participant.ConversationId == conversationId && participant.UserId == userId))
            .Select(candidate => new { candidate.ClientProfileId })
            .SingleOrDefaultAsync(cancellationToken);
        if (conversation is null)
        {
            return false;
        }

        // The workspace relationship block, which the feature decision already folds in, plus the
        // entitlement itself. Access is a property of the coaching relationship rather than of who is
        // asking, so a lapsed entitlement closes the conversation for the coach as well as the client.
        var decision = await featureAccessService.EvaluateAsync(
            tenantId,
            conversation.ClientProfileId,
            CoachingFeature.Messaging,
            cancellationToken);
        return decision.IsAllowed;
    }

    /// <summary>
    /// The dispatcher's version of the same question, with the reason it said no.
    /// </summary>
    /// <remarks>
    /// A stable suppression code rather than a boolean, because a suppressed publication has to
    /// record why it will never be sent — and that record has to be safe to read for somebody who is
    /// not in the conversation, so it names a condition and never a person, a body or a reason
    /// somebody wrote.
    /// </remarks>
    public async Task<string?> SuppressionReasonAsync(
        Guid tenantId,
        Guid conversationId,
        Guid recipientUserId,
        CancellationToken cancellationToken)
    {
        var tenantIsActive = await dbContext.Tenants
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(tenant => tenant.Id == tenantId && tenant.IsActive, cancellationToken);
        if (!tenantIsActive)
        {
            return MessagingRealtimeSuppressionCodes.TenantInactive;
        }

        var recipientIsBlocked = await dbContext.Users
            .AsNoTracking()
            .AnyAsync(user => user.Id == recipientUserId && user.IsPlatformBlocked, cancellationToken);
        if (recipientIsBlocked)
        {
            return MessagingRealtimeSuppressionCodes.RecipientBlocked;
        }

        var membershipIsActive = await dbContext.TenantMemberships
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(
                membership =>
                    membership.TenantId == tenantId &&
                    membership.UserId == recipientUserId &&
                    membership.Status == MembershipStatus.Active,
                cancellationToken);
        if (!membershipIsActive)
        {
            return MessagingRealtimeSuppressionCodes.MembershipInactive;
        }

        tenantContext.SetTenant(tenantId);
        var conversation = await dbContext.Conversations
            .AsNoTracking()
            .Where(candidate => candidate.Id == conversationId)
            .Select(candidate => new { candidate.ClientProfileId })
            .SingleOrDefaultAsync(cancellationToken);
        if (conversation is null)
        {
            return MessagingRealtimeFailureCodes.AggregateMismatch;
        }

        var isParticipant = await dbContext.ConversationParticipants
            .AsNoTracking()
            .AnyAsync(
                participant =>
                    participant.ConversationId == conversationId &&
                    participant.UserId == recipientUserId,
                cancellationToken);
        if (!isParticipant)
        {
            return MessagingRealtimeSuppressionCodes.NotAParticipant;
        }

        // The relationship block is reported separately from the entitlement even though the feature
        // decision folds it in, because "your coach blocked you" and "this plan has lapsed" are
        // different operational facts and a single code could not tell an operator which happened.
        var relationshipIsBlocked = await dbContext.ClientProfiles
            .AsNoTracking()
            .AnyAsync(
                profile => profile.Id == conversation.ClientProfileId && profile.IsCoachBlocked,
                cancellationToken);
        if (relationshipIsBlocked)
        {
            return MessagingRealtimeSuppressionCodes.RelationshipBlocked;
        }

        var decision = await featureAccessService.EvaluateAsync(
            tenantId,
            conversation.ClientProfileId,
            CoachingFeature.Messaging,
            cancellationToken);
        return decision.IsAllowed ? null : MessagingRealtimeSuppressionCodes.FeatureDenied;
    }
}

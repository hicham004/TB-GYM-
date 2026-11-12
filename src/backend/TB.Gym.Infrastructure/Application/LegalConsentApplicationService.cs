using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

internal sealed class LegalConsentApplicationService(
    GymDbContext dbContext,
    LegalAcceptanceGate gate,
    IClock clock,
    ICurrentUser currentUser)
    : ILegalConsentApplicationService
{
    public async Task<IReadOnlyList<LegalDocumentToAccept>> ListToAcceptAsync(
        LegalAudience audience,
        CancellationToken cancellationToken)
    {
        var current = await gate.CurrentAsync(cancellationToken);
        if (current.Count == 0)
        {
            return [];
        }

        // A signed-in person is not asked again for a platform document they accepted. A workspace one is
        // shown again to someone rejoining it, since this read names no workspace; ticking it again
        // records nothing new. A new owner always registers a new account, so their session counts for
        // nothing there.
        var accepted = audience == LegalAudience.Owner
            ? new HashSet<Guid>()
            : await gate.AcceptedAsync(currentUser.UserId, null, cancellationToken);
        var shown = LegalAcceptanceRule.ToShow(current, audience, accepted).Select(item => item.Id).ToArray();
        var documents = await dbContext.LegalDocumentVersions
            .AsNoTracking()
            .Where(item => shown.Contains(item.Id))
            .Select(item => new LegalDocumentToAccept(
                item.Id,
                item.Kind,
                item.VersionLabel,
                item.Culture,
                item.Context,
                item.AcceptanceStatement,
                item.ContentUri,
                item.PublishedAtUtc!.Value))
            .ToListAsync(cancellationToken);
        return documents.OrderBy(item => Array.IndexOf(shown, item.Id)).ToArray();
    }

    public async Task<LegalDocumentText?> GetPublishedAsync(
        Guid documentVersionId,
        CancellationToken cancellationToken) =>
        await dbContext.LegalDocumentVersions
            .AsNoTracking()
            .Where(item =>
                item.Id == documentVersionId &&
                item.ReviewStatus == LegalReviewStatus.Approved &&
                item.PublishedAtUtc != null)
            .Select(item => new LegalDocumentText(
                item.Id,
                item.Kind,
                item.VersionLabel,
                item.Culture,
                item.Context,
                item.Content,
                item.AcceptanceStatement,
                item.ContentSha256,
                item.PublishedAtUtc!.Value,
                item.RetiredAtUtc))
            .SingleOrDefaultAsync(cancellationToken);

    public async Task<IReadOnlyList<LegalDocumentView>> ListCurrentAsync(
        Guid? workspaceId,
        CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId)
        {
            return [];
        }

        var includeWorkspaceDocuments = workspaceId is { } selectedWorkspaceId &&
            await dbContext.TenantMemberships.AnyAsync(
                item =>
                    item.TenantId == selectedWorkspaceId &&
                    item.UserId == userId &&
                    item.Status == MembershipStatus.Active,
                cancellationToken);
        var documents = await dbContext.LegalDocumentVersions
            .AsNoTracking()
            .Where(item =>
                item.ReviewStatus == LegalReviewStatus.Approved &&
                item.PublishedAtUtc != null &&
                item.RetiredAtUtc == null &&
                (item.Context == LegalConsentContext.Platform || includeWorkspaceDocuments))
            .OrderBy(item => item.Kind)
            .ThenBy(item => item.Culture)
            .Select(item => new
            {
                item.Id,
                item.Kind,
                item.VersionLabel,
                item.Culture,
                item.Context,
                item.ContentUri,
                item.ContentSha256,
                item.PublishedAtUtc,
            })
            .ToListAsync(cancellationToken);
        // The consumer terms are the house's alone (ADR 0041): anyone else is neither shown nor asked them.
        if (documents.Any(document => document.Kind == LegalDocumentKind.ConsumerTerms))
        {
            var houseId = await HouseClientOfAsync(userId, cancellationToken);
            documents.RemoveAll(document =>
                document.Kind == LegalDocumentKind.ConsumerTerms &&
                (houseId is null || (document.Context == LegalConsentContext.Workspace && workspaceId != houseId)));
        }

        var acceptances = await dbContext.LegalConsentAcceptances
            .AsNoTracking()
            .Where(item =>
                item.UserId == userId &&
                (item.Context == LegalConsentContext.Platform ||
                 (includeWorkspaceDocuments && item.TenantId == workspaceId)))
            .Select(item => new { item.DocumentVersionId, item.Context, item.TenantId })
            .ToListAsync(cancellationToken);

        return documents.Select(document => new LegalDocumentView(
            document.Id,
            document.Kind,
            document.VersionLabel,
            document.Culture,
            document.Context,
            document.ContentUri,
            document.ContentSha256,
            document.PublishedAtUtc!.Value,
            acceptances.Any(acceptance =>
                acceptance.DocumentVersionId == document.Id &&
                acceptance.Context == document.Context &&
                acceptance.TenantId == (document.Context == LegalConsentContext.Workspace
                    ? workspaceId
                    : null)))).ToArray();
    }

    public async Task<LegalConsentCommandResult> AcceptAsync(
        AcceptLegalDocumentRequest request,
        CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId)
        {
            return new LegalConsentCommandResult(LegalConsentCommandStatus.Forbidden);
        }

        var document = await dbContext.LegalDocumentVersions
            .AsNoTracking()
            .SingleOrDefaultAsync(item =>
                item.Id == request.DocumentVersionId &&
                item.ReviewStatus == LegalReviewStatus.Approved &&
                item.PublishedAtUtc != null &&
                item.RetiredAtUtc == null,
                cancellationToken);
        if (document is null)
        {
            return new LegalConsentCommandResult(LegalConsentCommandStatus.NotFound);
        }

        // The consumer terms are accepted by a client of the house, in the house (ADR 0041); for anyone else
        // the document answers like one that does not exist.
        if (document.Kind == LegalDocumentKind.ConsumerTerms)
        {
            var houseId = await HouseClientOfAsync(userId, cancellationToken);
            if (houseId is null ||
                (document.Context == LegalConsentContext.Workspace && request.TenantId != houseId))
            {
                return new LegalConsentCommandResult(LegalConsentCommandStatus.NotFound);
            }
        }

        if (document.Context == LegalConsentContext.Workspace)
        {
            if (request.TenantId is not { } tenantId)
            {
                return Invalid("A workspace document requires a workspace context.");
            }

            var isMember = await dbContext.TenantMemberships.AnyAsync(
                item =>
                    item.TenantId == tenantId &&
                    item.UserId == userId &&
                    item.Status == MembershipStatus.Active,
                cancellationToken);
            if (!isMember)
            {
                return new LegalConsentCommandResult(LegalConsentCommandStatus.Forbidden);
            }
        }
        else if (request.TenantId is not null)
        {
            return Invalid("A platform document cannot be accepted in a workspace context.");
        }

        var contextKey = request.TenantId?.ToString("N") ?? "platform";
        var existing = await dbContext.LegalConsentAcceptances
            .AsNoTracking()
            .SingleOrDefaultAsync(item =>
                item.UserId == userId &&
                item.DocumentVersionId == document.Id &&
                item.ContextKey == contextKey,
                cancellationToken);
        if (existing is not null)
        {
            return Success(existing);
        }

        var acceptance = LegalConsentAcceptance.Accept(
            userId,
            document.Id,
            document.Context,
            request.TenantId,
            clock.UtcNow);
        dbContext.LegalConsentAcceptances.Add(acceptance);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            return Success(acceptance);
        }
        catch (DbUpdateException)
        {
            dbContext.ChangeTracker.Clear();
            var concurrent = await dbContext.LegalConsentAcceptances
                .AsNoTracking()
                .SingleOrDefaultAsync(item =>
                    item.UserId == userId &&
                    item.DocumentVersionId == document.Id &&
                    item.ContextKey == contextKey,
                    cancellationToken);
            return concurrent is null
                ? Invalid("The consent could not be recorded.")
                : Success(concurrent);
        }
    }

    /// <summary>The house's id when the person is one of its clients today; null for everyone else.</summary>
    private async Task<Guid?> HouseClientOfAsync(Guid userId, CancellationToken cancellationToken) =>
        await (
            from membership in dbContext.TenantMemberships.AsNoTracking()
            join tenant in dbContext.Tenants.AsNoTracking() on membership.TenantId equals tenant.Id
            where membership.UserId == userId &&
                  membership.Role == TenantRole.Client &&
                  membership.Status == MembershipStatus.Active &&
                  tenant.IsHouse
            select (Guid?)tenant.Id)
            .SingleOrDefaultAsync(cancellationToken);

    private static LegalConsentCommandResult Success(LegalConsentAcceptance acceptance) =>
        new(
            LegalConsentCommandStatus.Success,
            new LegalConsentAcceptanceView(
                acceptance.Id,
                acceptance.DocumentVersionId,
                acceptance.Context,
                acceptance.TenantId,
                acceptance.AcceptedAtUtc));

    private static LegalConsentCommandResult Invalid(string message) =>
        new(LegalConsentCommandStatus.Invalid, Message: message);
}

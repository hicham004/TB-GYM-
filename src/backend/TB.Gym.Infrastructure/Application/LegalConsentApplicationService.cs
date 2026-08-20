using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

internal sealed class LegalConsentApplicationService(
    GymDbContext dbContext,
    IClock clock,
    ICurrentUser currentUser)
    : ILegalConsentApplicationService
{
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
            .ToListAsync(cancellationToken);
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

using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Identity;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The one place registration, an invitation's acceptance and the public "to accept" read learn which
/// legal documents are in force and what a person accepted before (CLI-010, audit INV-3). Nothing is
/// asked until the platform admin publishes a document, so with none published every check passes.
/// </summary>
/// <remarks>
/// A join and a publish are serialized by one advisory lock: a join holds it shared from its check to its
/// commit, publishing and withdrawing hold it alone. So a publish waits for the joins under way, and a
/// join that starts during a publish checks what is in force once it commits; nobody joins having
/// accepted a version replaced in between, or without the first version of a document.
/// </remarks>
internal sealed class LegalAcceptanceGate(GymDbContext dbContext)
{
    private const long LegalDocumentsLockKey = 0x5442_4C45_4741_4C31L;

    /// <summary>Publishing and withdrawing take this inside their transaction, before reading what is in force.</summary>
    public static Task LockDocumentsAsync(GymDbContext context, CancellationToken cancellationToken) =>
        context.Database.ExecuteSqlAsync(
            $"SELECT pg_advisory_xact_lock({LegalDocumentsLockKey}) /* legal-documents */",
            cancellationToken);

    /// <summary>Every version in force, without its text.</summary>
    public async Task<IReadOnlyList<CurrentLegalDocument>> CurrentAsync(CancellationToken cancellationToken) =>
        await dbContext.LegalDocumentVersions
            .AsNoTracking()
            .Where(item =>
                item.ReviewStatus == LegalReviewStatus.Approved &&
                item.PublishedAtUtc != null &&
                item.RetiredAtUtc == null)
            .Select(item => new CurrentLegalDocument(item.Id, item.Kind, item.Context, item.Culture))
            .ToListAsync(cancellationToken);

    /// <summary>
    /// The versions a person has accepted that count here: their platform acceptances, and their
    /// acceptances in <paramref name="tenantId"/> when one is named. Another workspace's never count.
    /// </summary>
    public async Task<IReadOnlySet<Guid>> AcceptedAsync(
        Guid? userId,
        Guid? tenantId,
        CancellationToken cancellationToken)
    {
        if (userId is not { } user)
        {
            return new HashSet<Guid>();
        }

        var platform = LegalConsentAcceptance.KeyFor(null);
        var workspace = tenantId is { } tenant ? LegalConsentAcceptance.KeyFor(tenant) : platform;
        var accepted = await dbContext.LegalConsentAcceptances
            .AsNoTracking()
            .Where(item => item.UserId == user && (item.ContextKey == platform || item.ContextKey == workspace))
            .Select(item => item.DocumentVersionId)
            .ToListAsync(cancellationToken);
        return accepted.ToHashSet();
    }

    /// <summary>
    /// The versions to record for someone joining <paramref name="tenantId"/> as <paramref name="audience"/>,
    /// or null when what they named does not cover every document in force for them.
    /// </summary>
    public async Task<IReadOnlyList<CurrentLegalDocument>?> CheckAsync(
        LegalAudience audience,
        Guid? existingUserId,
        Guid tenantId,
        IReadOnlyCollection<Guid>? named,
        CancellationToken cancellationToken)
    {
        if (dbContext.Database.CurrentTransaction is null)
        {
            throw new InvalidOperationException("The legal check runs inside the transaction of the join it guards.");
        }

        // Held to the join's commit (see the remarks above).
        await dbContext.Database.ExecuteSqlAsync(
            $"SELECT pg_advisory_xact_lock_shared({LegalDocumentsLockKey}) /* legal-documents */",
            cancellationToken);
        var current = await CurrentAsync(cancellationToken);
        if (current.Count == 0 && (named is null || named.Count == 0))
        {
            return [];
        }

        var accepted = await AcceptedAsync(existingUserId, tenantId, cancellationToken);
        return LegalAcceptanceRule.Check(current, audience, accepted, named);
    }

    /// <summary>Adds the acceptances to the caller's unit of work, saved with the account or membership they join with.</summary>
    public void Record(
        IReadOnlyList<CurrentLegalDocument> versions,
        Guid userId,
        Guid tenantId,
        DateTimeOffset now)
    {
        foreach (var version in versions)
        {
            dbContext.LegalConsentAcceptances.Add(LegalConsentAcceptance.Accept(
                userId,
                version.Id,
                version.Context,
                version.Context == LegalConsentContext.Workspace ? tenantId : null,
                now));
        }
    }
}

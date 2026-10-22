using Microsoft.EntityFrameworkCore;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Identity;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The platform admin's legal documents (CLI-010, audit INV-3). TB Gym writes none of the words: the
/// admin publishes text and its acceptance sentence as a qualified reviewer approved them. A version,
/// once published, is replaced by publishing another or withdrawn so nobody is asked for it; its words
/// and dates stay as they were.
/// </summary>
internal sealed class LegalDocumentAdminService(GymDbContext dbContext, IClock clock)
    : ILegalDocumentAdminService
{
    public async Task<IReadOnlyList<LegalDocumentAdminView>> ListAsync(CancellationToken cancellationToken)
    {
        var counts = await AcceptanceCountsAsync(null, cancellationToken);
        var versions = await dbContext.LegalDocumentVersions
            .AsNoTracking()
            .Select(item => new
            {
                item.Id,
                item.Kind,
                item.VersionLabel,
                item.Culture,
                item.Context,
                item.AcceptanceStatement,
                item.ContentUri,
                item.ContentSha256,
                Characters = item.Content.Length,
                item.PublishedAtUtc,
                item.RetiredAtUtc,
            })
            .ToListAsync(cancellationToken);
        return versions
            .OrderBy(item => item.Kind)
            .ThenBy(item => item.Culture, StringComparer.Ordinal)
            .ThenByDescending(item => item.PublishedAtUtc)
            .Select(item => new LegalDocumentAdminView(
                item.Id,
                item.Kind,
                item.VersionLabel,
                item.Culture,
                item.Context,
                item.AcceptanceStatement,
                item.ContentUri,
                item.ContentSha256,
                item.Characters,
                item.PublishedAtUtc,
                item.RetiredAtUtc,
                counts.GetValueOrDefault(item.Id)))
            .ToArray();
    }

    public async Task<LegalDocumentCommandResult> PublishAsync(
        PublishLegalDocumentRequest request,
        CancellationToken cancellationToken)
    {
        if (!Enum.IsDefined(request.Kind) || !Enum.IsDefined(request.Context))
        {
            return Invalid("kind", "Choose the document and who accepts it.");
        }

        LegalDocumentVersion candidate;
        try
        {
            candidate = LegalDocumentVersion.CreateDraft(
                request.Kind,
                request.Version,
                request.Culture,
                request.Context,
                request.Content,
                request.AcceptanceStatement);
        }
        catch (ArgumentException exception)
        {
            return Invalid(FieldOf(exception.ParamName), exception.PersonMessage());
        }

        // The admin's own statement that the words were reviewed, asked for every version (CLI-010).
        if (!request.Reviewed)
        {
            return Invalid("reviewed", "Confirm that a qualified reviewer approved this exact text and sentence.");
        }

        try
        {
            return await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                // A retry starts from what is stored, never from a version an attempt retired in memory.
                dbContext.ChangeTracker.Clear();
                await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
                // Publishes one at a time, and none while a person is joining (LegalAcceptanceGate).
                await LegalAcceptanceGate.LockDocumentsAsync(dbContext, cancellationToken);
                if (await SameNamedAsync(candidate, cancellationToken) is { } named)
                {
                    return named;
                }

                // The version in force in this language, whoever accepts it: moving a document to the other
                // context replaces it too, so a page never shows two boxes of one name.
                var current = await dbContext.LegalDocumentVersions.SingleOrDefaultAsync(
                    item =>
                        item.Kind == candidate.Kind &&
                        item.Culture == candidate.Culture &&
                        item.PublishedAtUtc != null &&
                        item.RetiredAtUtc == null,
                    cancellationToken);
                if (current?.Id != request.ReplacesVersionId)
                {
                    return Changed();
                }

                var now = clock.UtcNow;
                if (current is not null)
                {
                    // Two saves: the version in force steps down before the new one takes its place, so the
                    // one-current-version index never sees two at once.
                    current.Retire(now);
                    await dbContext.SaveChangesAsync(cancellationToken);
                }

                var published = LegalDocumentVersion.PublishReviewed(
                    request.Kind,
                    request.Version,
                    request.Culture,
                    request.Context,
                    request.Content,
                    request.AcceptanceStatement,
                    now);
                dbContext.LegalDocumentVersions.Add(published);
                await dbContext.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return new LegalDocumentCommandResult(LegalConsentCommandStatus.Success, ToView(published, 0));
            });
        }
        catch (DbUpdateException exception) when (
            exception is DbUpdateConcurrencyException ||
            exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // Only a write made past the application can still race a publish under the lock; it answers as
            // anything else that changed meanwhile.
            dbContext.ChangeTracker.Clear();
            return await SameNamedAsync(candidate, cancellationToken) ?? Changed();
        }
    }

    public async Task<LegalDocumentCommandResult> WithdrawAsync(
        Guid documentVersionId,
        CancellationToken cancellationToken) =>
        await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            dbContext.ChangeTracker.Clear();
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            await LegalAcceptanceGate.LockDocumentsAsync(dbContext, cancellationToken);
            var document = await dbContext.LegalDocumentVersions.SingleOrDefaultAsync(
                item => item.Id == documentVersionId && item.PublishedAtUtc != null,
                cancellationToken);
            if (document is null)
            {
                return new LegalDocumentCommandResult(LegalConsentCommandStatus.NotFound);
            }

            if (document.RetiredAtUtc is not null)
            {
                // A retry of this withdrawal finds nothing of this document in force; a version published
                // since is somebody else's change the admin has not seen.
                var replaced = await dbContext.LegalDocumentVersions.AnyAsync(
                    item =>
                        item.Kind == document.Kind &&
                        item.Culture == document.Culture &&
                        item.PublishedAtUtc != null &&
                        item.RetiredAtUtc == null,
                    cancellationToken);
                return replaced
                    ? Changed()
                    : new LegalDocumentCommandResult(
                        LegalConsentCommandStatus.Success,
                        ToView(document, await AcceptanceCountAsync(document.Id, cancellationToken)));
            }

            document.Retire(clock.UtcNow);
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new LegalDocumentCommandResult(
                LegalConsentCommandStatus.Success,
                ToView(document, await AcceptanceCountAsync(document.Id, cancellationToken)));
        });

    /// <summary>
    /// A version of this document and language already carrying the name. A retry of a publish finds it in
    /// force with the same words and context and answers with it; once replaced or withdrawn it answers as a
    /// change meanwhile, never as published now; other words or another context mean the name is taken.
    /// </summary>
    private async Task<LegalDocumentCommandResult?> SameNamedAsync(
        LegalDocumentVersion candidate,
        CancellationToken cancellationToken)
    {
        var existing = await dbContext.LegalDocumentVersions
            .AsNoTracking()
            .Where(item =>
                item.Kind == candidate.Kind &&
                item.VersionLabel == candidate.VersionLabel &&
                item.Culture == candidate.Culture)
            .Select(item => new
            {
                item.Id,
                item.Context,
                item.ContentSha256,
                item.AcceptanceStatement,
                item.PublishedAtUtc,
                item.RetiredAtUtc,
            })
            .FirstOrDefaultAsync(cancellationToken);
        if (existing is null)
        {
            return null;
        }

        var sameWords = existing.ContentSha256 == candidate.ContentSha256 &&
            existing.AcceptanceStatement == candidate.AcceptanceStatement &&
            existing.Context == candidate.Context &&
            existing.PublishedAtUtc is not null;
        if (sameWords && existing.RetiredAtUtc is null)
        {
            var stored = await dbContext.LegalDocumentVersions
                .AsNoTracking()
                .SingleAsync(item => item.Id == existing.Id, cancellationToken);
            return new LegalDocumentCommandResult(
                LegalConsentCommandStatus.Success,
                ToView(stored, await AcceptanceCountAsync(existing.Id, cancellationToken)));
        }

        return sameWords
            ? Changed()
            : new LegalDocumentCommandResult(
                LegalConsentCommandStatus.Conflict,
                ConflictCode: LegalConsentCodes.VersionTaken,
                ConflictMessage: $"This document already has a version called {candidate.VersionLabel}. Give this text a version name of its own.");
    }

    private async Task<Dictionary<Guid, int>> AcceptanceCountsAsync(Guid? only, CancellationToken cancellationToken) =>
        await dbContext.LegalConsentAcceptances
            .AsNoTracking()
            .Where(item => only == null || item.DocumentVersionId == only)
            .GroupBy(item => item.DocumentVersionId)
            .Select(group => new { Id = group.Key, Count = group.Count() })
            .ToDictionaryAsync(item => item.Id, item => item.Count, cancellationToken);

    private async Task<int> AcceptanceCountAsync(Guid id, CancellationToken cancellationToken) =>
        (await AcceptanceCountsAsync(id, cancellationToken)).GetValueOrDefault(id);

    private static LegalDocumentCommandResult Changed() =>
        new(
            LegalConsentCommandStatus.Conflict,
            ConflictCode: LegalConsentCodes.DocumentChanged,
            ConflictMessage: "Another version of this document was published or withdrawn meanwhile. Reload the page to see it before you change it.");

    private static LegalDocumentCommandResult Invalid(string field, string message) =>
        new(
            LegalConsentCommandStatus.Invalid,
            Errors: new Dictionary<string, string[]> { [field] = [message] });

    private static string FieldOf(string? parameterName) => parameterName switch
    {
        "version" => "version",
        "culture" => "culture",
        "content" => "content",
        "acceptanceStatement" => "acceptanceStatement",
        _ => "kind",
    };

    /// <summary>The characters counted as PostgreSQL's length counts them, the list's own count.</summary>
    private static LegalDocumentAdminView ToView(LegalDocumentVersion document, int acceptanceCount) =>
        new(
            document.Id,
            document.Kind,
            document.VersionLabel,
            document.Culture,
            document.Context,
            document.AcceptanceStatement,
            document.ContentUri,
            document.ContentSha256,
            document.Content.EnumerateRunes().Count(),
            document.PublishedAtUtc,
            document.RetiredAtUtc,
            acceptanceCount);
}

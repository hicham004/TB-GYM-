using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Invitations;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Invitation commands, with the token lifecycle moved onto ADR 0021's tokenless materialization.
/// </summary>
/// <remarks>
/// Nothing here mints a token any more. Creating an invitation and resending one both write a durable
/// <see cref="InvitationActionMailRequest"/> naming a logical-send generation, and the dispatcher mints,
/// records and mails against it later. That is what lets a transport retry be safe: the retry re-enters
/// the same request and the same generation, so a link already in somebody's mailbox keeps working,
/// while a deliberate resend creates a new request at a new generation and kills the old links on
/// purpose.
/// <para>
/// Acceptance therefore looks a token up in the append-only issue record rather than on the invitation,
/// and accepts any unexpired, unrevoked, unredeemed hash of the invitation's <i>current</i> generation.
/// </para>
/// </remarks>
internal sealed class InvitationApplicationService(
    GymDbContext dbContext,
    UserManager<ApplicationUser> userManager,
    SignInManager<ApplicationUser> signInManager,
    IInvitationActionMailDispatchService actionMail,
    IClock clock,
    ICurrentUser currentUser,
    ITenantContext tenantContext,
    IMutableTenantContext mutableTenantContext)
    : IInvitationApplicationService
{
    private static readonly TimeSpan InvitationLifetime = TimeSpan.FromDays(7);

    /// <summary>The unit separator that delimits fields inside a payload fingerprint.</summary>
    private const char FieldSeparator = '\u001F';

    public async Task<IReadOnlyList<InvitationSummary>> ListAsync(CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        var invitations = await dbContext.ClientInvitations
            .OrderByDescending(invitation => invitation.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        if (invitations.Aggregate(false, (changed, invitation) => invitation.MarkExpired(now) || changed))
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return invitations.Select(invitation => ToSummary(invitation)).ToArray();
    }

    public async Task<InvitationCommandResult> CreateAsync(
        CreateClientInvitationRequest request,
        CancellationToken cancellationToken)
    {
        if (!tenantContext.HasTenant)
        {
            return new InvitationCommandResult(InvitationCommandStatus.NotFound);
        }

        var tenant = await dbContext.Tenants.SingleOrDefaultAsync(
            item => item.Id == tenantContext.TenantId && item.IsActive,
            cancellationToken);
        if (tenant is null)
        {
            return new InvitationCommandResult(InvitationCommandStatus.NotFound);
        }

        var now = clock.UtcNow;
        var tenantToday = GetTenantDate(now, tenant.TimeZoneId);
        if (request.BirthDate is { } birthDate &&
            (birthDate.AddYears(18) > tenantToday || birthDate < tenantToday.AddYears(-120)))
        {
            return Invalid(
                "birthDate",
                "Client birth date must represent an adult between 18 and 120 years old.");
        }

        ClientInvitation invitation;
        try
        {
            invitation = ClientInvitation.Create(
                tenant.Id,
                request.Email,
                request.FirstName,
                request.LastName,
                request.PhoneNumber,
                request.BirthDate,
                now.Add(InvitationLifetime),
                now);
        }
        catch (ArgumentException exception)
        {
            return Invalid("invitation", exception.Message);
        }

        var idempotencyKey = request.IdempotencyKey ?? Guid.CreateVersion7();
        var fingerprint = Fingerprint(
            "create",
            tenant.Id.ToString(),
            invitation.NormalizedEmail,
            invitation.FirstName,
            invitation.LastName,
            invitation.PhoneNumber ?? string.Empty,
            invitation.BirthDate?.ToString("O", CultureInfo.InvariantCulture) ?? string.Empty);
        if (await ReplayAsync(idempotencyKey, fingerprint, cancellationToken) is { } replayed)
        {
            return replayed;
        }

        var existingRelationship = await dbContext.ClientProfiles.AnyAsync(
            client => client.NormalizedEmail == invitation.NormalizedEmail,
            cancellationToken);
        var existingUser = await userManager.FindByEmailAsync(invitation.Email);
        if (existingUser is not null)
        {
            existingRelationship |= await dbContext.TenantMemberships.AnyAsync(
                membership => membership.TenantId == tenant.Id && membership.UserId == existingUser.Id,
                cancellationToken);
        }

        if (existingRelationship)
        {
            return new InvitationCommandResult(InvitationCommandStatus.Conflict);
        }

        var pending = await dbContext.ClientInvitations.SingleOrDefaultAsync(
            item => item.NormalizedEmail == invitation.NormalizedEmail && item.Status == InvitationStatus.Pending,
            cancellationToken);
        if (pending is not null)
        {
            if (!pending.MarkExpired(now))
            {
                return new InvitationCommandResult(InvitationCommandStatus.Conflict);
            }

            await RevokeOutstandingTokensAsync(
                pending.Id,
                InvitationActionMailCodes.TokenInvitationRevoked,
                now,
                cancellationToken);
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        // The invitation and its first action-mail request commit together. An invitation nobody was
        // ever asked to mail is a row that looks fine and never reaches anybody.
        dbContext.ClientInvitations.Add(invitation);
        dbContext.InvitationActionMailRequests.Add(InvitationActionMailRequest.For(
            tenant.Id,
            invitation.Id,
            invitation.LogicalSendGeneration,
            idempotencyKey,
            fingerprint,
            InvitationActionMailSources.Creation,
            currentUser.UserId,
            now));

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            dbContext.ChangeTracker.Clear();
            return await ReplayAsync(idempotencyKey, fingerprint, cancellationToken)
                ?? new InvitationCommandResult(InvitationCommandStatus.Conflict);
        }

        return new InvitationCommandResult(
            InvitationCommandStatus.Success,
            ToSummary(invitation, await MaterializeInlineAsync(tenant.Id, invitation.Id, cancellationToken)));
    }

    public async Task<InvitationCommandResult> ResendAsync(
        Guid invitationId,
        ResendClientInvitationRequest request,
        CancellationToken cancellationToken)
    {
        if (request.IdempotencyKey == Guid.Empty)
        {
            return Invalid("idempotencyKey", "An idempotency key is required.");
        }

        var invitation = await dbContext.ClientInvitations.SingleOrDefaultAsync(
            item => item.Id == invitationId,
            cancellationToken);
        if (invitation is null)
        {
            return new InvitationCommandResult(InvitationCommandStatus.NotFound);
        }

        // Idempotency is checked before concurrency, deliberately. A retry of the same command with the
        // same key describes work that has already happened, and answering it with a version conflict
        // would make the caller believe somebody else changed the invitation.
        var fingerprint = Fingerprint(
            "resend",
            invitation.TenantId.ToString(),
            invitationId.ToString(),
            request.Version.ToString(CultureInfo.InvariantCulture));
        if (await ReplayAsync(request.IdempotencyKey, fingerprint, cancellationToken) is { } replayed)
        {
            return replayed;
        }

        if (invitation.Version != request.Version)
        {
            return new InvitationCommandResult(InvitationCommandStatus.Conflict);
        }

        var now = clock.UtcNow;
        if (invitation.MarkExpired(now))
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            return new InvitationCommandResult(InvitationCommandStatus.Conflict);
        }

        int generation;
        try
        {
            generation = invitation.BeginNewLogicalSend(now.Add(InvitationLifetime), now);
        }
        catch (InvalidOperationException)
        {
            return new InvitationCommandResult(InvitationCommandStatus.Conflict);
        }

        // A deliberate resend is decisive: every link of every earlier generation stops working now,
        // which is what the person pressing it asked for. A transport retry never reaches this code.
        await RevokeOutstandingTokensAsync(
            invitation.Id,
            InvitationActionMailCodes.TokenSupersededByResend,
            now,
            cancellationToken);

        dbContext.InvitationActionMailRequests.Add(InvitationActionMailRequest.For(
            invitation.TenantId,
            invitation.Id,
            generation,
            request.IdempotencyKey,
            fingerprint,
            InvitationActionMailSources.DeliberateResend,
            currentUser.UserId,
            now));

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Both failure shapes are handled identically, deliberately. A losing racer can be
            // rejected either by the unique idempotency key or by the invitation's own row version,
            // and which one fires depends on the order of statements inside a single transaction —
            // which is not something a caller should be able to observe. So both ask the same
            // question: is this key already spent on this exact payload? If it is, the command has
            // already happened and its result is the answer; if it is not, this is a real conflict.
            //
            // DbUpdateConcurrencyException derives from DbUpdateException, so one catch covers both.
            dbContext.ChangeTracker.Clear();
            return await ReplayAsync(request.IdempotencyKey, fingerprint, cancellationToken)
                ?? new InvitationCommandResult(InvitationCommandStatus.Conflict);
        }

        return new InvitationCommandResult(
            InvitationCommandStatus.Success,
            ToSummary(
                invitation,
                await MaterializeInlineAsync(invitation.TenantId, invitation.Id, cancellationToken)));
    }

    public async Task<InvitationCommandResult> RevokeAsync(
        Guid invitationId,
        RevokeClientInvitationRequest request,
        CancellationToken cancellationToken)
    {
        var invitation = await dbContext.ClientInvitations.SingleOrDefaultAsync(
            item => item.Id == invitationId,
            cancellationToken);
        if (invitation is null)
        {
            return new InvitationCommandResult(InvitationCommandStatus.NotFound);
        }

        if (invitation.Version != request.Version)
        {
            return new InvitationCommandResult(InvitationCommandStatus.Conflict);
        }

        try
        {
            var now = clock.UtcNow;
            invitation.Revoke(now);
            await RevokeOutstandingTokensAsync(
                invitation.Id,
                InvitationActionMailCodes.TokenInvitationRevoked,
                now,
                cancellationToken);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new InvitationCommandResult(InvitationCommandStatus.Success, ToSummary(invitation));
        }
        catch (InvalidOperationException)
        {
            return new InvitationCommandResult(InvitationCommandStatus.Conflict);
        }
        catch (DbUpdateConcurrencyException)
        {
            dbContext.ChangeTracker.Clear();
            return new InvitationCommandResult(InvitationCommandStatus.Conflict);
        }
    }

    public async Task<PublicInvitationDetails?> GetPublicAsync(
        string token,
        CancellationToken cancellationToken)
    {
        var resolved = await ResolveTokenAsync(token, cancellationToken);
        if (resolved is null)
        {
            return null;
        }

        var (issue, invitation) = resolved.Value;
        mutableTenantContext.SetTenant(invitation.TenantId);
        var now = clock.UtcNow;

        // A token from a superseded generation is not a link to look at; it is a link somebody
        // deliberately killed. It answers exactly like an unknown token, because telling the holder
        // that the invitation exists but their link was replaced discloses the workspace to whoever is
        // holding an old mail.
        if (issue.LogicalSendGeneration != invitation.LogicalSendGeneration ||
            (issue.RevokedAtUtc is not null && invitation.Status != InvitationStatus.Accepted))
        {
            return null;
        }

        if (invitation.MarkExpired(now))
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        var tenant = await dbContext.Tenants
            .AsNoTracking()
            .SingleAsync(item => item.Id == invitation.TenantId, cancellationToken);
        var existingUser = await userManager.FindByEmailAsync(invitation.Email);
        return new PublicInvitationDetails(
            tenant.Name,
            invitation.Email,
            invitation.FirstName,
            invitation.LastName,
            invitation.Status,
            invitation.ExpiresAtUtc,
            existingUser is not null && currentUser.UserId != existingUser.Id);
    }

    public async Task<InvitationAcceptanceResult> AcceptAsync(
        AcceptClientInvitationRequest request,
        CancellationToken cancellationToken)
    {
        var tokenHash = TryHashToken(request.Token);
        if (tokenHash is null)
        {
            return new InvitationAcceptanceResult(InvitationAcceptanceStatus.InvalidOrExpired);
        }

        try
        {
            var outcome = await AcceptCoreAsync(tokenHash, request, cancellationToken);
            if (outcome.UserToSignIn is not null)
            {
                await signInManager.SignInAsync(outcome.UserToSignIn, isPersistent: false);
                return outcome.Result with { SignedIn = true };
            }

            return outcome.Result;
        }
        catch (DbUpdateConcurrencyException)
        {
            dbContext.ChangeTracker.Clear();
            return await ResolveAcceptedAsync(tokenHash, cancellationToken)
                ?? new InvitationAcceptanceResult(InvitationAcceptanceStatus.Conflict);
        }
        catch (DbUpdateException)
        {
            dbContext.ChangeTracker.Clear();
            return await ResolveAcceptedAsync(tokenHash, cancellationToken)
                ?? new InvitationAcceptanceResult(InvitationAcceptanceStatus.Conflict);
        }
    }

    private async Task<AcceptanceOutcome> AcceptCoreAsync(
        string tokenHash,
        AcceptClientInvitationRequest request,
        CancellationToken cancellationToken)
    {
        var strategy = dbContext.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            var issue = await dbContext.InvitationTokenIssues
                .IgnoreQueryFilters()
                .SingleOrDefaultAsync(item => item.TokenHash == tokenHash, cancellationToken);
            if (issue is null)
            {
                return AcceptanceOutcome.From(InvitationAcceptanceStatus.InvalidOrExpired);
            }

            mutableTenantContext.SetTenant(issue.TenantId);
            var invitation = await dbContext.ClientInvitations
                .IgnoreQueryFilters()
                .SingleOrDefaultAsync(
                    item => item.Id == issue.InvitationId && item.TenantId == issue.TenantId,
                    cancellationToken);
            if (invitation is null)
            {
                return AcceptanceOutcome.From(InvitationAcceptanceStatus.InvalidOrExpired);
            }

            var now = clock.UtcNow;
            if (invitation.Status == InvitationStatus.Revoked)
            {
                return AcceptanceOutcome.From(InvitationAcceptanceStatus.Revoked);
            }

            if (invitation.Status == InvitationStatus.Accepted)
            {
                var accepted = await ResolveAcceptedAsync(tokenHash, cancellationToken);
                return new AcceptanceOutcome(
                    accepted ?? new InvitationAcceptanceResult(InvitationAcceptanceStatus.Conflict),
                    null);
            }

            if (invitation.MarkExpired(now) || invitation.Status == InvitationStatus.Expired)
            {
                await dbContext.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return AcceptanceOutcome.From(InvitationAcceptanceStatus.InvalidOrExpired);
            }

            // Any unexpired, unrevoked, unredeemed hash of the *current* generation is accepted, which
            // is what makes a transport retry harmless: two hashes may exist for one generation and
            // either link works. A hash of an earlier generation does not, because a person
            // deliberately replaced it.
            if (!issue.IsRedeemable(invitation.LogicalSendGeneration, now))
            {
                return AcceptanceOutcome.From(InvitationAcceptanceStatus.InvalidOrExpired);
            }

            var existingAccount = await userManager.FindByEmailAsync(invitation.Email);
            ApplicationUser user;
            var createdUser = false;
            if (currentUser.UserId is { } currentUserId)
            {
                user = await userManager.FindByIdAsync(currentUserId.ToString())
                    ?? throw new InvalidOperationException("The authenticated user no longer exists.");
                if (!string.Equals(user.NormalizedEmail, invitation.NormalizedEmail, StringComparison.Ordinal))
                {
                    return AcceptanceOutcome.From(InvitationAcceptanceStatus.WrongSignedInAccount);
                }
            }
            else if (existingAccount is not null)
            {
                return AcceptanceOutcome.From(InvitationAcceptanceStatus.ExistingAccountSignInRequired);
            }
            else
            {
                if (string.IsNullOrWhiteSpace(request.Password))
                {
                    return new AcceptanceOutcome(
                        new InvitationAcceptanceResult(
                            InvitationAcceptanceStatus.Invalid,
                            Errors: new Dictionary<string, string[]>
                            {
                                ["password"] = ["A password is required for a new account."],
                            }),
                        null);
                }

                var tenant = await dbContext.Tenants.AsNoTracking().SingleAsync(
                    item => item.Id == invitation.TenantId,
                    cancellationToken);
                user = new ApplicationUser
                {
                    Id = Guid.CreateVersion7(),
                    UserName = invitation.Email,
                    Email = invitation.Email,
                    EmailConfirmed = true,
                    DisplayName = string.IsNullOrWhiteSpace(request.DisplayName)
                        ? $"{invitation.FirstName} {invitation.LastName}"
                        : request.DisplayName.Trim(),
                    PreferredCulture = tenant.DefaultCulture,
                    CreatedAtUtc = now,
                    UpdatedAtUtc = now,
                };
                var identityResult = await userManager.CreateAsync(user, request.Password);
                if (!identityResult.Succeeded)
                {
                    return new AcceptanceOutcome(
                        new InvitationAcceptanceResult(
                            InvitationAcceptanceStatus.Invalid,
                            Errors: new Dictionary<string, string[]>
                            {
                                ["identity"] = identityResult.Errors.Select(error => error.Description).ToArray(),
                            }),
                        null);
                }

                createdUser = true;
            }

            var relationshipExists = await dbContext.TenantMemberships.AnyAsync(
                membership => membership.TenantId == invitation.TenantId && membership.UserId == user.Id,
                cancellationToken) ||
                await dbContext.ClientProfiles.AnyAsync(
                    profile => profile.UserId == user.Id || profile.NormalizedEmail == invitation.NormalizedEmail,
                    cancellationToken);
            if (relationshipExists)
            {
                return AcceptanceOutcome.From(InvitationAcceptanceStatus.Conflict);
            }

            var profile = ClientProfile.CreateForAcceptedInvitation(
                invitation.TenantId,
                user.Id,
                invitation.FirstName,
                invitation.LastName,
                invitation.Email,
                invitation.PhoneNumber,
                invitation.BirthDate);
            dbContext.TenantMemberships.Add(
                TenantMembership.Create(invitation.TenantId, user.Id, TenantRole.Client));
            dbContext.ClientProfiles.Add(profile);
            dbContext.ClientProfileChanges.Add(ClientProfileChange.Create(
                invitation.TenantId,
                profile.Id,
                ClientChangeSource.InvitationAcceptance,
                [nameof(ClientProfile.UserId), nameof(ClientProfile.Email)]));

            // Single-use, and concurrency-safe through two independent guards: the invitation row's
            // own optimistic concurrency refuses a second Pending -> Accepted transition, and the
            // redeemed token's write-once trigger refuses a second redemption of the same hash.
            issue.Redeem(user.Id, now);
            invitation.MarkAccepted(user.Id, now);

            // Every *other* outstanding token for this invitation is spent by the acceptance. The one
            // just redeemed is excluded explicitly rather than relying on the query to notice: the
            // redemption is not committed yet, so the database still reads it as unredeemed, and only
            // EF's identity resolution would return the instance that knows otherwise. Depending on
            // that would be depending on a detail of how the query happens to be written.
            await RevokeOutstandingTokensAsync(
                invitation.Id,
                InvitationActionMailCodes.TokenInvitationAccepted,
                now,
                cancellationToken,
                exceptIssueId: issue.Id);
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            return new AcceptanceOutcome(
                new InvitationAcceptanceResult(
                    InvitationAcceptanceStatus.Accepted,
                    invitation.TenantId,
                    profile.Id,
                    SignedIn: currentUser.UserId == user.Id),
                createdUser ? user : null);
        });
    }

    /// <summary>
    /// Kills every outstanding token of one invitation.
    /// </summary>
    /// <remarks>
    /// Called by a deliberate resend, a revocation and a successful acceptance — three things a person
    /// did — and never by the dispatcher. Already revoked and already redeemed rows are left exactly as
    /// they are: revocation is write-once, and rewriting a redemption would erase that a link was used.
    /// </remarks>
    private async Task RevokeOutstandingTokensAsync(
        Guid invitationId,
        string reasonCode,
        DateTimeOffset now,
        CancellationToken cancellationToken,
        Guid? exceptIssueId = null)
    {
        var outstanding = await dbContext.InvitationTokenIssues
            .Where(issue =>
                issue.InvitationId == invitationId &&
                issue.Id != exceptIssueId &&
                issue.RevokedAtUtc == null &&
                issue.RedeemedAtUtc == null)
            .ToListAsync(cancellationToken);
        foreach (var issue in outstanding)
        {
            issue.Revoke(now, reasonCode);
        }
    }

    /// <summary>
    /// Materializes this workspace's newest request for one invitation inline, and returns the captured
    /// link.
    /// </summary>
    /// <remarks>
    /// Development and test only, and refused in Production by startup validation. It runs the same
    /// claim, recheck, mint, commit-the-hash, render and transport sequence a Worker sweep runs; what it
    /// avoids is a development environment where nothing appears to happen until a second process is
    /// started.
    /// </remarks>
    private async Task<string?> MaterializeInlineAsync(
        Guid tenantId,
        Guid invitationId,
        CancellationToken cancellationToken)
    {
        if (actionMail is not InvitationActionMailService concrete || !concrete.InlineDispatchAvailable)
        {
            return null;
        }

        var requestId = await dbContext.InvitationActionMailRequests
            .AsNoTracking()
            .Where(item => item.InvitationId == invitationId)
            .OrderByDescending(item => item.LogicalSendGeneration)
            .Select(item => (Guid?)item.Id)
            .FirstOrDefaultAsync(cancellationToken);
        if (requestId is not { } id)
        {
            return null;
        }

        await concrete.DispatchRequestAsync(tenantId, id, cancellationToken);
        return concrete.CapturedActionUrl(id);
    }

    /// <summary>
    /// Replays a spent idempotency key, or reports that the same key was used for a different payload.
    /// </summary>
    private async Task<InvitationCommandResult?> ReplayAsync(
        Guid idempotencyKey,
        string payloadFingerprint,
        CancellationToken cancellationToken)
    {
        var spent = await dbContext.InvitationActionMailRequests
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.IdempotencyKey == idempotencyKey, cancellationToken);
        if (spent is null)
        {
            return null;
        }

        if (!string.Equals(spent.PayloadFingerprint, payloadFingerprint, StringComparison.Ordinal))
        {
            return new InvitationCommandResult(InvitationCommandStatus.Conflict);
        }

        var invitation = await dbContext.ClientInvitations
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == spent.InvitationId, cancellationToken);
        return invitation is null
            ? new InvitationCommandResult(InvitationCommandStatus.Conflict)
            : new InvitationCommandResult(InvitationCommandStatus.Success, ToSummary(invitation));
    }

    private async Task<(InvitationTokenIssue Issue, ClientInvitation Invitation)?> ResolveTokenAsync(
        string token,
        CancellationToken cancellationToken)
    {
        var tokenHash = TryHashToken(token);
        if (tokenHash is null)
        {
            return null;
        }

        var issue = await dbContext.InvitationTokenIssues
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.TokenHash == tokenHash, cancellationToken);
        if (issue is null)
        {
            return null;
        }

        mutableTenantContext.SetTenant(issue.TenantId);
        var invitation = await dbContext.ClientInvitations
            .IgnoreQueryFilters()
            .SingleOrDefaultAsync(
                item => item.Id == issue.InvitationId && item.TenantId == issue.TenantId,
                cancellationToken);
        return invitation is null ? null : (issue, invitation);
    }

    private async Task<InvitationAcceptanceResult?> ResolveAcceptedAsync(
        string tokenHash,
        CancellationToken cancellationToken)
    {
        var accepted = await dbContext.InvitationTokenIssues
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(issue => issue.TokenHash == tokenHash)
            .Join(
                dbContext.ClientInvitations.IgnoreQueryFilters().AsNoTracking(),
                issue => new { issue.TenantId, InvitationId = issue.InvitationId },
                invitation => new { invitation.TenantId, InvitationId = invitation.Id },
                (issue, invitation) => new
                {
                    invitation.TenantId,
                    invitation.Status,
                    invitation.AcceptedByUserId,
                })
            .SingleOrDefaultAsync(cancellationToken);
        if (accepted is null ||
            accepted.Status != InvitationStatus.Accepted ||
            accepted.AcceptedByUserId is not { } acceptedByUserId)
        {
            return null;
        }

        mutableTenantContext.SetTenant(accepted.TenantId);
        var profileId = await dbContext.ClientProfiles
            .AsNoTracking()
            .Where(profile => profile.UserId == acceptedByUserId)
            .Select(profile => (Guid?)profile.Id)
            .SingleOrDefaultAsync(cancellationToken);
        return profileId is null
            ? null
            : new InvitationAcceptanceResult(
                InvitationAcceptanceStatus.Accepted,
                accepted.TenantId,
                profileId,
                SignedIn: currentUser.UserId == acceptedByUserId);
    }

    private static InvitationCommandResult Invalid(string field, string message) =>
        new(
            InvitationCommandStatus.Invalid,
            Errors: new Dictionary<string, string[]> { [field] = [message] });

    private static InvitationSummary ToSummary(
        ClientInvitation invitation,
        string? developmentActionUrl = null) =>
        new(
            invitation.Id,
            invitation.Email,
            invitation.FirstName,
            invitation.LastName,
            invitation.Status,
            invitation.ExpiresAtUtc,
            invitation.SendCount,
            invitation.LogicalSendGeneration,
            invitation.CreatedAtUtc,
            invitation.Version,
            developmentActionUrl);

    private static DateOnly GetTenantDate(DateTimeOffset now, string timeZoneId) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById(timeZoneId)).DateTime);

    /// <summary>
    /// The normalized command payload one idempotency key was spent on.
    /// </summary>
    /// <remarks>
    /// Fields are joined with a unit separator rather than a printable delimiter, so no combination of
    /// values can produce the same fingerprint as a different combination by moving a delimiter across
    /// a field boundary.
    /// </remarks>
    private static string Fingerprint(params string[] parts) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join(FieldSeparator, parts))));

    private static string? TryHashToken(string token) =>
        string.IsNullOrWhiteSpace(token) || token.Length > 512
            ? null
            : InvitationActionMailService.HashToken(token);

    private sealed record AcceptanceOutcome(
        InvitationAcceptanceResult Result,
        ApplicationUser? UserToSignIn)
    {
        public static AcceptanceOutcome From(InvitationAcceptanceStatus status) =>
            new(new InvitationAcceptanceResult(status), null);
    }
}

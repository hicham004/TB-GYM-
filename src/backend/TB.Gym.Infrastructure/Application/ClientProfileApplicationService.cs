using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Nutrition;
using TB.Gym.Modules.Progress;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;
using TB.Gym.Modules.Training;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

internal sealed class ClientProfileApplicationService(
    GymDbContext dbContext,
    IClock clock,
    ICurrentUser currentUser,
    ITenantContext tenantContext,
    CoachClientScope coachClientScope,
    HouseTierReader houseTiers)
    : IClientProfileApplicationService
{
    /// <summary>What a release writes on each plan and program it closes.</summary>
    internal const string ReleaseClosureReason = "Closed because the client was released from the workspace.";

    /// <summary>What a client leaving writes on each plan and program it closes.</summary>
    internal const string LeaveClosureReason = "Closed because the client left the workspace.";

    /// <summary>
    /// The Owner lists every current client; a Coach lists only the clients assigned to them. Released
    /// clients are listed separately, by <see cref="ListFormerAsync"/>.
    /// </summary>
    public async Task<IReadOnlyList<ClientSummary>> ListAsync(CancellationToken cancellationToken)
    {
        var query = dbContext.ClientProfiles.AsNoTracking().Where(client => client.ReleasedAtUtc == null);
        if (await coachClientScope.RestrictedCoachUserIdAsync(cancellationToken) is { } coachUserId)
        {
            query = query.Where(client => client.AssignedCoachUserId == coachUserId);
        }

        // A left join: a client waiting for a coach (CLI-012) stays on the Owner's list, with no coach.
        return await (
            from client in query
            join coach in dbContext.Users.AsNoTracking() on client.AssignedCoachUserId equals coach.Id into coaches
            from coach in coaches.DefaultIfEmpty()
            orderby client.FirstName, client.LastName
            select new ClientSummary(
                client.Id,
                client.FirstName,
                client.LastName,
                client.Email,
                client.PhoneNumber,
                client.OnboardingStatus,
                client.IsCoachBlocked,
                client.Version,
                client.AssignedCoachUserId,
                coach == null ? null : coach.DisplayName))
            .ToListAsync(cancellationToken);
    }

    public async Task<CoachClientDetails?> GetForCoachAsync(
        Guid clientId,
        CancellationToken cancellationToken)
    {
        var client = await dbContext.ClientProfiles
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == clientId, cancellationToken);
        return client is null ? null : await ToCoachDetailsAsync(client, cancellationToken);
    }

    public async Task<ClientCommandResult> ReassignCoachAsync(
        Guid clientId,
        ReassignClientCoachRequest request,
        CancellationToken cancellationToken)
    {
        if (request.CoachUserId == Guid.Empty)
        {
            return Invalid("coachUserId", "Choose a coach.");
        }

        try
        {
            return await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                dbContext.ChangeTracker.Clear();
                await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
                var profile = await dbContext.ClientProfiles.SingleOrDefaultAsync(
                    client => client.Id == clientId,
                    cancellationToken);
                if (profile is null)
                {
                    return new ClientCommandResult(ClientCommandStatus.NotFound);
                }

                // Shares the target coach's membership row with other assignments and conflicts with
                // a concurrent removal of that coach, which locks it for update. Whichever commits
                // second sees the other: a removal waits and then leaves this client waiting too, or
                // this request waits and then finds the coach no longer active.
                if (!await CoachTeam.LockActiveStaffAsync(dbContext, tenantContext.TenantId, request.CoachUserId, cancellationToken))
                {
                    return Invalid("coachUserId", "Choose an active coach of this workspace.");
                }

                dbContext.Entry(profile).Property(client => client.Version).OriginalValue = request.Version;
                // Whether the house coaches this trainee today (CLI-026, SUB-021), read before anything changes; no read
                // for anyone who is not self-directed.
                var coachedOnMax = await houseTiers.CoachedOnMaxAsync(profile.Id, profile.IsSelfDirected, cancellationToken);
                // Null while the client waits for a coach: the owner gives them one here, themselves included.
                var previousCoachUserId = profile.AssignedCoachUserId;
                if (profile.AssignCoach(request.CoachUserId))
                {
                    var now = clock.UtcNow;
                    var sequence = await CoachTeam.NextAssignmentSequenceAsync(dbContext, profile.Id, cancellationToken);
                    var entry = ClientCoachAssignment.ForChange(
                        profile.TenantId,
                        profile.Id,
                        sequence,
                        previousCoachUserId,
                        request.CoachUserId,
                        ClientCoachAssignmentReason.Reassigned,
                        request.Note,
                        now);
                    dbContext.ClientCoachAssignments.Add(entry);
                    // Every coach change is told to the client, the owner taking them included (C8, CLI-014), in
                    // the same unit of work and once per history entry, since it changes who may read their private
                    // side. A self-directed trainee trains as their own coach (CLI-026), so they are told in words of
                    // their own: who on the team can now see their training. One the house coaches on Max hears they
                    // have a new coach, as a coach's client does.
                    if (profile.UserId is { } clientUserId)
                    {
                        var timeZoneId = await WorkspaceRelationshipNotices.TenantTimeZoneAsync(
                            dbContext,
                            profile.TenantId,
                            cancellationToken);
                        if (profile.IsSelfDirected && !coachedOnMax)
                        {
                            WorkspaceRelationshipNotices.TraineeStaffChanged(
                                dbContext, profile.TenantId, timeZoneId, clientUserId, profile.Id, entry.Id, now);
                        }
                        else
                        {
                            WorkspaceRelationshipNotices.CoachAssigned(
                                dbContext, profile.TenantId, timeZoneId, clientUserId, profile.Id, entry.Id, now);
                        }
                    }

                    await dbContext.SaveChangesAsync(cancellationToken);
                }
                else if (profile.Version != request.Version)
                {
                    // Already with that coach, but the caller's view is stale: say so rather than
                    // reporting success for a screen that did not see the latest state.
                    return new ClientCommandResult(ClientCommandStatus.Conflict);
                }

                await transaction.CommitAsync(cancellationToken);
                return new ClientCommandResult(
                    ClientCommandStatus.Success,
                    CoachDetails: await ToCoachDetailsAsync(profile, coachedOnMax, cancellationToken));
            });
        }
        catch (ArgumentException exception)
        {
            dbContext.ChangeTracker.Clear();
            return Invalid("coachUserId", exception.PersonMessage());
        }
        catch (DbUpdateException)
        {
            // A stale version, or a concurrent reassignment that took the same history number.
            dbContext.ChangeTracker.Clear();
            return new ClientCommandResult(ClientCommandStatus.Conflict);
        }
    }

    public async Task<IReadOnlyList<FormerClientSummary>> ListFormerAsync(CancellationToken cancellationToken)
    {
        var rows = await dbContext.ClientProfiles
            .AsNoTracking()
            .Where(client => client.ReleasedAtUtc != null)
            .OrderByDescending(client => client.ReleasedAtUtc)
            .ThenBy(client => client.FirstName)
            .Select(client => new
            {
                client.Id,
                client.FirstName,
                client.LastName,
                client.Email,
                ReleasedAtUtc = client.ReleasedAtUtc!.Value,
                Ending = dbContext.ClientRelationshipEvents
                    .Where(item =>
                        item.ClientProfileId == client.Id &&
                        (item.EventType == ClientRelationshipEventType.Released ||
                         item.EventType == ClientRelationshipEventType.Left))
                    .Select(item => new { item.Reason, item.EventType })
                    .FirstOrDefault(),
            })
            .ToListAsync(cancellationToken);
        return rows
            .Select(row => new FormerClientSummary(
                row.Id,
                row.FirstName,
                row.LastName,
                row.Email,
                row.ReleasedAtUtc,
                row.Ending?.Reason ?? string.Empty,
                DepartureKindOf(row.Ending?.EventType)))
            .ToArray();
    }

    /// <summary>
    /// Releases a client (ADR 0027): the owner ends the relationship, and the client is emailed.
    /// </summary>
    public Task<ClientCommandResult> ReleaseAsync(
        Guid clientId,
        ReleaseClientRequest request,
        CancellationToken cancellationToken) =>
        string.IsNullOrWhiteSpace(request.Reason)
            ? Task.FromResult(Invalid("reason", "Say why this client is being released."))
            : EndRelationshipAsync(
                client => client.Id == clientId,
                request.Reason,
                request.Version,
                ClientDepartureKind.ReleasedByOwner,
                cancellationToken);

    /// <summary>
    /// The signed-in client leaves (ADR 0027): the same ending as a release, recorded as theirs, with
    /// the owner and their coach told in-app instead of the client being emailed.
    /// </summary>
    public Task<ClientCommandResult> LeaveAsync(LeaveWorkspaceRequest request, CancellationToken cancellationToken) =>
        currentUser.UserId is not { } userId
            ? Task.FromResult(new ClientCommandResult(ClientCommandStatus.NotFound))
            : EndRelationshipAsync(
                client => client.UserId == userId && client.ReleasedAtUtc == null,
                string.IsNullOrWhiteSpace(request.Reason) ? LeftWithoutReason : request.Reason,
                request.Version,
                ClientDepartureKind.LeftByClient,
                cancellationToken);

    /// <summary>What a client who gave no reason for leaving is recorded with.</summary>
    internal const string LeftWithoutReason = "The client left without giving a reason.";

    /// <summary>
    /// Ends a client's relationship with the workspace in one transaction. Everything that made them a
    /// current client ends; nothing that happened is deleted or rewritten.
    /// </summary>
    /// <remarks>
    /// In order: the client moves to the owner (with a history entry) so no coach keeps them; the
    /// profile is marked ended and the reason recorded as a release or a departure; their membership
    /// ends, which cuts every client route at once; open or future plans, programs and meal plans are
    /// cancelled through their own audited transitions, payments untouched; and the notices are
    /// queued — an email to a released client, in-app notices to the owner and their coach, if they
    /// have one, when a client leaves. A client waiting for a coach moves to the owner the same way, from
    /// nobody. A program with a workout in progress is left as it is, because the training
    /// rules refuse to cancel one mid-workout and ending a relationship must not fail for that.
    /// </remarks>
    private async Task<ClientCommandResult> EndRelationshipAsync(
        System.Linq.Expressions.Expression<Func<ClientProfile, bool>> which,
        string reason,
        uint version,
        ClientDepartureKind kind,
        CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } actorUserId)
        {
            return new ClientCommandResult(ClientCommandStatus.NotFound);
        }

        var releasedByOwner = kind == ClientDepartureKind.ReleasedByOwner;
        try
        {
            return await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                dbContext.ChangeTracker.Clear();
                await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
                var profile = await dbContext.ClientProfiles.SingleOrDefaultAsync(which, cancellationToken);
                if (profile is null)
                {
                    return new ClientCommandResult(ClientCommandStatus.NotFound);
                }

                if (profile.IsReleased || profile.Version != version)
                {
                    return new ClientCommandResult(ClientCommandStatus.Conflict);
                }

                dbContext.Entry(profile).Property(client => client.Version).OriginalValue = version;
                await EndInsideTransactionAsync(
                    profile,
                    reason,
                    kind,
                    releasedByOwner ? ReleaseClosureReason : LeaveClosureReason,
                    actorUserId,
                    clock.UtcNow,
                    cancellationToken);

                await dbContext.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return new ClientCommandResult(
                    ClientCommandStatus.Success,
                    CoachDetails: releasedByOwner ? await ToCoachDetailsAsync(profile, cancellationToken) : null);
            });
        }
        catch (ArgumentException exception)
        {
            dbContext.ChangeTracker.Clear();
            return Invalid("reason", exception.PersonMessage());
        }
        catch (DbUpdateException)
        {
            // A stale version, or a concurrent change to the same client that committed first.
            dbContext.ChangeTracker.Clear();
            return new ClientCommandResult(ClientCommandStatus.Conflict);
        }
    }

    /// <summary>
    /// The ending itself, inside a transaction its caller owns and saves: <see cref="EndRelationshipAsync"/> for a
    /// release or a leave, and closing an account (CLI-027) for each space the person leaves by closing it.
    /// </summary>
    internal async Task EndInsideTransactionAsync(
        ClientProfile profile,
        string reason,
        ClientDepartureKind kind,
        string closureReason,
        Guid actorUserId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var releasedByOwner = kind == ClientDepartureKind.ReleasedByOwner;
        var tenantId = tenantContext.TenantId;
        // Whether the house coaches this trainee today (CLI-026, SUB-021), read before anything changes: the ending
        // below cancels their Max. Only a leaving tells staff, so a release reads nothing, nor does a coach's client.
        var coachedOnMax = !releasedByOwner &&
            await houseTiers.CoachedOnMaxAsync(profile.Id, profile.IsSelfDirected, cancellationToken);
        var ownerUserId = await CoachTeam.OwnerUserIdAsync(dbContext, tenantId, cancellationToken);
        await CoachTeam.LockActiveStaffAsync(dbContext, tenantId, ownerUserId, cancellationToken);
        // Null while the client waits for a coach: the owner becomes the record's keeper from nobody.
        var previousCoachUserId = profile.AssignedCoachUserId;
        if (profile.AssignCoach(ownerUserId))
        {
            dbContext.ClientCoachAssignments.Add(ClientCoachAssignment.ForChange(
                tenantId,
                profile.Id,
                await CoachTeam.NextAssignmentSequenceAsync(dbContext, profile.Id, cancellationToken),
                previousCoachUserId,
                ownerUserId,
                releasedByOwner ? ClientCoachAssignmentReason.Released : ClientCoachAssignmentReason.ClientLeft,
                null,
                now));
        }

        profile.Release(ownerUserId, now);
        dbContext.ClientRelationshipEvents.Add(ClientRelationshipEvent.Create(
            tenantId,
            profile.Id,
            releasedByOwner ? ClientRelationshipEventType.Released : ClientRelationshipEventType.Left,
            reason,
            now));

        if (profile.UserId is { } clientUserId &&
            await dbContext.TenantMemberships.SingleOrDefaultAsync(
                membership =>
                    membership.TenantId == tenantId &&
                    membership.UserId == clientUserId &&
                    membership.Role == TenantRole.Client,
                cancellationToken) is { } membership)
        {
            if (membership.Status == MembershipStatus.Active)
            {
                membership.ReleaseClient();
            }

            if (releasedByOwner)
            {
                dbContext.WorkspaceNoticeMailRequests.Add(WorkspaceNoticeMailRequest.ClientReleased(
                    tenantId,
                    clientUserId,
                    profile.Id,
                    actorUserId,
                    now));
            }
        }

        // A self-directed trainee's leaving tells no staff inbox (CLI-026); the history above keeps it. One the house
        // coaches on Max tells the owner and their coach, as a coach's client does, closing their account included.
        if (!releasedByOwner && (!profile.IsSelfDirected || coachedOnMax))
        {
            var timeZoneId = await WorkspaceRelationshipNotices.TenantTimeZoneAsync(dbContext, tenantId, cancellationToken);
            // A waiting client had no coach to tell, so the owner alone hears it.
            foreach (var staffUserId in new[] { ownerUserId, previousCoachUserId }.OfType<Guid>().Distinct())
            {
                WorkspaceRelationshipNotices.ClientLeft(dbContext, tenantId, timeZoneId, staffUserId, profile.Id, now);
            }
        }

        // The profile's own row lock, taken after the staff's as the save would take it, and before the plans are
        // read: a Free row the Worker adds for this client (SUB-019) either commits first and is cancelled below,
        // or waits for this commit and finds them gone.
        await dbContext.Database.ExecuteSqlAsync(
            $"""SELECT 1 FROM clients."ClientProfiles" WHERE "Id" = {profile.Id} FOR UPDATE /* end-relationship */""",
            cancellationToken);
        await CloseOpenCoachingAsync(
            profile.Id,
            await GetTenantTodayAsync(cancellationToken),
            actorUserId,
            closureReason,
            now,
            cancellationToken);
    }

    /// <summary>
    /// Cancels the released client's running and future plans, programmes and meal plans through the
    /// same domain transitions and audit rows their own screens use. Ended ones stay as they were.
    /// </summary>
    private async Task CloseOpenCoachingAsync(
        Guid clientProfileId,
        DateOnly tenantToday,
        Guid actorUserId,
        string closureReason,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var tenantId = tenantContext.TenantId;
        var enrollments = await dbContext.ClientEnrollments
            .Include(item => item.Entitlements)
            .Where(item =>
                item.ClientProfileId == clientProfileId &&
                (item.Status == EnrollmentStatus.PendingPayment ||
                 item.Status == EnrollmentStatus.Active ||
                 item.Status == EnrollmentStatus.Paused) &&
                item.EndDateExclusive > tenantToday)
            .ToListAsync(cancellationToken);
        foreach (var enrollment in enrollments)
        {
            // The relationship ended, so the house's Free ends with it (SUB-019), as nothing else may end it.
            enrollment.Cancel(now, closureReason, relationshipEnded: true);
            await CommercialApplicationService.CancelScheduledNotificationsAsync(
                dbContext,
                enrollment.Id,
                kind: null,
                now,
                cancellationToken);
        }

        var mesocycles = await dbContext.TrainingMesocycles
            .Include(item => item.Weeks).ThenInclude(item => item.Sessions)
            .Where(item =>
                item.ClientProfileId == clientProfileId &&
                item.Status != MesocycleStatus.Completed &&
                item.Status != MesocycleStatus.Cancelled)
            .ToListAsync(cancellationToken);
        foreach (var mesocycle in mesocycles.Where(item =>
                     !item.Weeks.SelectMany(week => week.Sessions).Any(session => session.HasStarted && !session.IsCompleted)))
        {
            var previous = mesocycle.Cancel(now);
            dbContext.MesocycleLifecycleEvents.Add(MesocycleLifecycleEvent.Record(
                tenantId,
                mesocycle.Id,
                MesocycleLifecycleEventType.Cancelled,
                previous,
                MesocycleStatus.Cancelled,
                closureReason,
                now));
        }

        var plans = await dbContext.ClientNutritionPlans
            .Where(item =>
                item.ClientProfileId == clientProfileId &&
                item.Status == ClientNutritionPlanStatus.Active &&
                item.EndDateExclusive > tenantToday)
            .ToListAsync(cancellationToken);
        foreach (var plan in plans)
        {
            var previous = plan.Status;
            plan.Cancel();
            dbContext.NutritionPlanLifecycleEvents.Add(NutritionPlanLifecycleEvent.Record(
                tenantId,
                plan.Id,
                NutritionPlanLifecycleEventType.Cancelled,
                previous,
                plan.Status,
                closureReason,
                actorUserId,
                now));
        }
    }

    public async Task<IReadOnlyList<ClientCoachAssignmentView>?> ListCoachAssignmentsAsync(
        Guid clientId,
        CancellationToken cancellationToken)
    {
        if (!await dbContext.ClientProfiles.AsNoTracking().AnyAsync(client => client.Id == clientId, cancellationToken))
        {
            return null;
        }

        var history = await dbContext.ClientCoachAssignments
            .AsNoTracking()
            .Where(item => item.ClientProfileId == clientId)
            .OrderBy(item => item.Sequence)
            .ToListAsync(cancellationToken);
        // An entry that names nobody is a wait for a coach (CLI-012): it has no name to read.
        var userIds = history
            .SelectMany(item => new[] { item.CoachUserId, item.PreviousCoachUserId })
            .OfType<Guid>()
            .Distinct()
            .ToList();
        var names = await dbContext.Users
            .AsNoTracking()
            .Where(user => userIds.Contains(user.Id))
            .ToDictionaryAsync(user => user.Id, user => user.DisplayName, cancellationToken);
        return history
            .Select(item => new ClientCoachAssignmentView(
                item.Id,
                item.Sequence,
                item.CoachUserId,
                item.CoachUserId is { } coach ? names.GetValueOrDefault(coach, string.Empty) : null,
                item.PreviousCoachUserId,
                item.PreviousCoachUserId is { } previous ? names.GetValueOrDefault(previous, string.Empty) : null,
                item.Reason,
                item.Note,
                item.AssignedAtUtc,
                item.CreatedByUserId))
            .ToArray();
    }

    public async Task<ClientSelfProfile?> GetSelfAsync(CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId)
        {
            return null;
        }

        var client = await dbContext.ClientProfiles
            .AsNoTracking()
            .CurrentFor(userId).SingleOrDefaultAsync(cancellationToken);
        return client is null ? null : await ToSelfProfileAsync(client, coachedOnMax: null, cancellationToken);
    }

    public async Task<OwnCoachView?> GetOwnCoachAsync(CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId) return null;
        var profile = await dbContext.ClientProfiles.AsNoTracking()
            .CurrentFor(userId)
            .Select(item => new { item.TenantId, item.AssignedCoachUserId })
            .SingleOrDefaultAsync(cancellationToken);
        // A client waiting for a coach (CLI-012) has none to show, as a client with no coach never had.
        if (profile?.AssignedCoachUserId is not { } coachUserId) return null;
        var name = await dbContext.Users.AsNoTracking()
            .Where(item => item.Id == coachUserId)
            .Select(item => item.DisplayName)
            .SingleOrDefaultAsync(cancellationToken);
        if (name is null) return null;

        // The Founding coach badge is the space owner's (notes plan N3a): composed here from platform
        // billing's records, so the Clients module knows nothing of billing. The certificate lines the
        // coach shows (notes plan N4b) come from the Identity record the same way.
        return new OwnCoachView(
            name,
            await FoundingReader.ShowsBadgeToClientsAsync(dbContext, profile.TenantId, coachUserId, cancellationToken),
            await CoachCertificateReader.ShownToClientsAsync(dbContext, profile.TenantId, coachUserId, cancellationToken));
    }

    public Task<ClientCommandResult> UpdateForCoachAsync(
        Guid clientId,
        UpdateClientIntakeRequest request,
        CancellationToken cancellationToken) =>
        UpdateAsync(clientId, request, ClientChangeSource.Coach, returnSelf: false, cancellationToken);

    public async Task<ClientCommandResult> UpdateSelfAsync(
        UpdateClientIntakeRequest request,
        CancellationToken cancellationToken)
    {
        var profile = await FindSelfAsync(cancellationToken);
        return profile is null
            ? new ClientCommandResult(ClientCommandStatus.NotFound)
            : await UpdateAsync(
                profile.Id,
                request,
                ClientChangeSource.Client,
                returnSelf: true,
                cancellationToken);
    }

    public Task<ClientCommandResult> CompleteForCoachAsync(
        Guid clientId,
        CompleteClientOnboardingRequest request,
        CancellationToken cancellationToken) =>
        CompleteAsync(
            clientId,
            request,
            BodyweightSource.Coach,
            returnSelf: false,
            cancellationToken);

    public async Task<ClientCommandResult> CompleteSelfAsync(
        CompleteClientOnboardingRequest request,
        CancellationToken cancellationToken)
    {
        var profile = await FindSelfAsync(cancellationToken);
        return profile is null
            ? new ClientCommandResult(ClientCommandStatus.NotFound)
            : await CompleteAsync(
                profile.Id,
                request,
                BodyweightSource.Client,
                returnSelf: true,
                cancellationToken);
    }

    public async Task<ClientCommandResult> UpdateCoachNotesAsync(
        Guid clientId,
        UpdateCoachNotesRequest request,
        CancellationToken cancellationToken)
    {
        var profile = await dbContext.ClientProfiles.SingleOrDefaultAsync(
            client => client.Id == clientId,
            cancellationToken);
        if (profile is null)
        {
            return new ClientCommandResult(ClientCommandStatus.NotFound);
        }

        try
        {
            dbContext.Entry(profile).Property(client => client.Version).OriginalValue = request.Version;
            if (profile.UpdateCoachNotes(request.Notes))
            {
                dbContext.ClientProfileChanges.Add(ClientProfileChange.Create(
                    profile.TenantId,
                    profile.Id,
                    ClientChangeSource.Coach,
                    [nameof(ClientProfile.CoachNotes)]));
                await dbContext.SaveChangesAsync(cancellationToken);
            }

            return new ClientCommandResult(
                ClientCommandStatus.Success,
                CoachDetails: await ToCoachDetailsAsync(profile, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return Invalid("coachNotes", exception.PersonMessage());
        }
        catch (DbUpdateConcurrencyException)
        {
            return new ClientCommandResult(ClientCommandStatus.Conflict);
        }
    }

    public Task<ClientCommandResult> BlockRelationshipAsync(
        Guid clientId,
        ChangeClientRelationshipRequest request,
        CancellationToken cancellationToken) =>
        ChangeRelationshipAsync(clientId, request, block: true, cancellationToken);

    public Task<ClientCommandResult> UnblockRelationshipAsync(
        Guid clientId,
        ChangeClientRelationshipRequest request,
        CancellationToken cancellationToken) =>
        ChangeRelationshipAsync(clientId, request, block: false, cancellationToken);

    private async Task<ClientCommandResult> ChangeRelationshipAsync(
        Guid clientId,
        ChangeClientRelationshipRequest request,
        bool block,
        CancellationToken cancellationToken)
    {
        var profile = await dbContext.ClientProfiles.SingleOrDefaultAsync(
            client => client.Id == clientId,
            cancellationToken);
        if (profile is null)
        {
            return new ClientCommandResult(ClientCommandStatus.NotFound);
        }

        try
        {
            dbContext.Entry(profile).Property(client => client.Version).OriginalValue = request.Version;
            var changed = block ? profile.BlockCoachAccess() : profile.UnblockCoachAccess();
            if (changed)
            {
                dbContext.ClientRelationshipEvents.Add(ClientRelationshipEvent.Create(
                    profile.TenantId,
                    profile.Id,
                    block ? ClientRelationshipEventType.Blocked : ClientRelationshipEventType.Unblocked,
                    request.Reason,
                    clock.UtcNow));
                await dbContext.SaveChangesAsync(cancellationToken);
            }

            return new ClientCommandResult(
                ClientCommandStatus.Success,
                CoachDetails: await ToCoachDetailsAsync(profile, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return Invalid("reason", exception.PersonMessage());
        }
        catch (DbUpdateConcurrencyException)
        {
            return new ClientCommandResult(ClientCommandStatus.Conflict);
        }
    }

    private async Task<ClientCommandResult> UpdateAsync(
        Guid clientId,
        UpdateClientIntakeRequest request,
        ClientChangeSource source,
        bool returnSelf,
        CancellationToken cancellationToken)
    {
        var profile = await dbContext.ClientProfiles.SingleOrDefaultAsync(
            client => client.Id == clientId,
            cancellationToken);
        if (profile is null)
        {
            return new ClientCommandResult(ClientCommandStatus.NotFound);
        }

        try
        {
            var tenantToday = await GetTenantTodayAsync(cancellationToken);
            if (await HouseAgeRefusalAsync(profile, request.BirthDate, tenantToday, cancellationToken) is { } refusal)
            {
                return Invalid("intake", refusal);
            }

            // After the house's age, whose refusal is about a value: the Health step's is about the plan (CLI-028).
            var coachedOnMax = await houseTiers.CoachedOnMaxAsync(profile.Id, profile.IsSelfDirected, cancellationToken);
            dbContext.Entry(profile).Property(client => client.Version).OriginalValue = request.Version;
            var changedFields = profile.UpdateIntake(
                request.ToInput(),
                tenantToday,
                HealthStepOpen(profile, coachedOnMax));
            if (changedFields.Count > 0)
            {
                dbContext.ClientProfileChanges.Add(ClientProfileChange.Create(
                    profile.TenantId,
                    profile.Id,
                    source,
                    changedFields));
                await dbContext.SaveChangesAsync(cancellationToken);
            }

            return await SuccessAsync(profile, returnSelf, coachedOnMax, cancellationToken);
        }
        catch (HealthStepClosedException)
        {
            return new ClientCommandResult(ClientCommandStatus.HealthStepClosed);
        }
        catch (ArgumentException exception)
        {
            return Invalid("intake", exception.PersonMessage());
        }
        catch (DbUpdateConcurrencyException)
        {
            return new ClientCommandResult(ClientCommandStatus.Conflict);
        }
    }

    private async Task<ClientCommandResult> CompleteAsync(
        Guid clientId,
        CompleteClientOnboardingRequest request,
        BodyweightSource bodyweightSource,
        bool returnSelf,
        CancellationToken cancellationToken)
    {
        var profile = await dbContext.ClientProfiles.SingleOrDefaultAsync(
            client => client.Id == clientId,
            cancellationToken);
        if (profile is null)
        {
            return new ClientCommandResult(ClientCommandStatus.NotFound);
        }

        // The authoritative first weigh-in, so it has to skip voided rows: a mis-dated entry that has
        // been corrected away must not become the client's onboarding weight.
        var existingObservation = await dbContext.BodyweightObservations
            .Where(observation => observation.Status == BodyweightObservationStatus.Active)
            .OrderBy(observation => observation.MeasurementDate)
            .ThenBy(observation => observation.CreatedAtUtc)
            .FirstOrDefaultAsync(
                observation => observation.ClientProfileId == clientId,
                cancellationToken);
        if (profile.OnboardingStatus == ClientOnboardingStatus.Completed && existingObservation is not null)
        {
            var requestedKilograms = BodyweightUnitConverter.ToKilograms(
                request.InitialBodyweightValue,
                request.InitialBodyweightUnit == BodyweightUnit.Kilogram
                    ? RecordedMassUnit.Kilogram
                    : RecordedMassUnit.Pound);
            return existingObservation.MeasurementDate == request.MeasurementDate &&
                   decimal.Abs(existingObservation.ValueKilograms - requestedKilograms) < 0.001m
                ? await SuccessAsync(profile, returnSelf, coachedOnMax: null, cancellationToken)
                : new ClientCommandResult(ClientCommandStatus.Conflict);
        }

        try
        {
            var tenantToday = await GetTenantTodayAsync(cancellationToken);
            if (request.MeasurementDate > tenantToday)
            {
                return Invalid("measurementDate", "Initial bodyweight cannot be dated in the future.");
            }

            if (existingObservation is not null)
            {
                var requestedKilograms = BodyweightUnitConverter.ToKilograms(
                    request.InitialBodyweightValue,
                    request.InitialBodyweightUnit == BodyweightUnit.Kilogram
                        ? RecordedMassUnit.Kilogram
                        : RecordedMassUnit.Pound);
                if (existingObservation.MeasurementDate != request.MeasurementDate ||
                    existingObservation.ValueKilograms != requestedKilograms)
                {
                    return new ClientCommandResult(ClientCommandStatus.Conflict);
                }
            }

            if (await HouseAgeRefusalAsync(profile, request.Intake.BirthDate, tenantToday, cancellationToken) is { } refusal)
            {
                return Invalid("onboarding", refusal);
            }

            // After the house's age, as the intake's own save weighs them (CLI-028).
            var coachedOnMax = await houseTiers.CoachedOnMaxAsync(profile.Id, profile.IsSelfDirected, cancellationToken);
            dbContext.Entry(profile).Property(client => client.Version).OriginalValue = request.Intake.Version;
            var changedFields = profile.CompleteOnboarding(
                request.Intake.ToInput(),
                tenantToday,
                clock.UtcNow,
                HealthStepOpen(profile, coachedOnMax));
            var unit = request.InitialBodyweightUnit == BodyweightUnit.Kilogram
                ? RecordedMassUnit.Kilogram
                : RecordedMassUnit.Pound;
            if (existingObservation is null)
            {
                dbContext.BodyweightObservations.Add(BodyweightObservation.CreateInitial(
                    profile.TenantId,
                    profile.Id,
                    request.MeasurementDate,
                    request.InitialBodyweightValue,
                    unit,
                    bodyweightSource));
            }

            // The start is a record of its own beside that weigh-in (critique B6, PRG-014), unless the
            // profile already has one, filled in from a weigh-in logged before setup was finished.
            if (!await dbContext.StartingWeights.AnyAsync(
                    item => item.ClientProfileId == profile.Id,
                    cancellationToken))
            {
                dbContext.StartingWeights.Add(StartingWeight.Record(
                    profile.TenantId,
                    profile.Id,
                    request.MeasurementDate,
                    request.InitialBodyweightValue,
                    unit,
                    StartingWeightOrigin.Intake));
            }
            dbContext.ClientProfileChanges.Add(ClientProfileChange.Create(
                profile.TenantId,
                profile.Id,
                ClientChangeSource.OnboardingCompletion,
                changedFields.Append("InitialBodyweight")));
            await dbContext.SaveChangesAsync(cancellationToken);
            return await SuccessAsync(profile, returnSelf, coachedOnMax, cancellationToken);
        }
        catch (HealthStepClosedException)
        {
            return new ClientCommandResult(ClientCommandStatus.HealthStepClosed);
        }
        catch (ArgumentException exception)
        {
            return Invalid("onboarding", exception.PersonMessage());
        }
        catch (InvalidOperationException exception)
        {
            return Invalid("onboarding", exception.PersonMessage());
        }
        catch (DbUpdateConcurrencyException)
        {
            return new ClientCommandResult(ClientCommandStatus.Conflict);
        }
        catch (DbUpdateException)
        {
            return new ClientCommandResult(ClientCommandStatus.Conflict);
        }
    }

    /// <summary>
    /// A self-directed trainee's date of birth keeps to the age the house asked at sign-up (CLI-024): an intake
    /// that changes it to a younger one is refused, in the house's own words. Null for anyone else, and for an
    /// unchanged or emptied date, which the profile's own rule weighs.
    /// </summary>
    private async Task<string?> HouseAgeRefusalAsync(
        ClientProfile profile,
        DateOnly? birthDate,
        DateOnly tenantToday,
        CancellationToken cancellationToken)
    {
        if (!profile.IsSelfDirected || birthDate is not { } typed || typed == profile.BirthDate)
        {
            return null;
        }

        return await HouseReader.MinimumSignUpAgeAsync(dbContext, profile.TenantId, cancellationToken) is { } minimumAge &&
               TraineeSignUpRule.CheckBirthDate(typed, minimumAge, tenantToday) == TraineeBirthDateCheck.TooYoung
            ? string.Create(
                System.Globalization.CultureInfo.InvariantCulture,
                $"This coaching space is open to people aged {minimumAge} or older.")
            : null;
    }

    private Task<ClientProfile?> FindSelfAsync(CancellationToken cancellationToken) =>
        currentUser.UserId is not { } userId
            ? Task.FromResult<ClientProfile?>(null)
            : dbContext.ClientProfiles.CurrentFor(userId).SingleOrDefaultAsync(cancellationToken);

    private async Task<DateOnly> GetTenantTodayAsync(CancellationToken cancellationToken)
    {
        if (!tenantContext.HasTenant)
        {
            throw new InvalidOperationException("An active workspace is required.");
        }

        var timeZoneId = await dbContext.Tenants
            .Where(tenant => tenant.Id == tenantContext.TenantId)
            .Select(tenant => tenant.TimeZoneId)
            .SingleAsync(cancellationToken);
        var localNow = TimeZoneInfo.ConvertTime(
            clock.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById(timeZoneId));
        return DateOnly.FromDateTime(localNow.DateTime);
    }

    /// <summary>
    /// The answer of an intake or set-up save: the person's own profile, or the staff's view of the client. A tier the
    /// save already read is passed on, so a request reads it once.
    /// </summary>
    private async Task<ClientCommandResult> SuccessAsync(
        ClientProfile profile,
        bool returnSelf,
        bool? coachedOnMax,
        CancellationToken cancellationToken) =>
        returnSelf
            ? new ClientCommandResult(
                ClientCommandStatus.Success,
                SelfProfile: await ToSelfProfileAsync(profile, coachedOnMax, cancellationToken))
            : new ClientCommandResult(
                ClientCommandStatus.Success,
                CoachDetails: await ToCoachDetailsAsync(profile, coachedOnMax, cancellationToken));

    /// <summary>
    /// The Health step opens on Max alone (CLI-028, decision 33): always for a coach's client and a client the house
    /// invited, and for a house trainee only while the house coaches them on Max today.
    /// </summary>
    private static bool HealthStepOpen(ClientProfile profile, bool coachedOnMax) =>
        !profile.IsSelfDirected || coachedOnMax;

    /// <summary>
    /// The person's own profile, with whether the house coaches them today and whether their Health step is open
    /// (CLI-026, CLI-028): read from the house's plans for a self-directed trainee alone, unless the caller read it.
    /// </summary>
    private async Task<ClientSelfProfile> ToSelfProfileAsync(
        ClientProfile client,
        bool? coachedOnMax,
        CancellationToken cancellationToken)
    {
        var coached = coachedOnMax ??
            await houseTiers.CoachedOnMaxAsync(client.Id, client.IsSelfDirected, cancellationToken);
        return ToSelfProfile(client) with
        {
            CoachedByTheHouse = coached,
            HealthStepOpen = HealthStepOpen(client, coached),
        };
    }

    private Task<CoachClientDetails> ToCoachDetailsAsync(
        ClientProfile client,
        CancellationToken cancellationToken) =>
        ToCoachDetailsAsync(client, coachedOnMax: null, cancellationToken);

    /// <summary>
    /// The staff's view of a client: the business side to whoever may manage them, the private side to their coach
    /// alone, and whether the Health step is open, a fact of the plan the house reads for a self-directed trainee alone
    /// (unless the caller read it), so a coach's client costs nothing more.
    /// </summary>
    private async Task<CoachClientDetails> ToCoachDetailsAsync(
        ClientProfile client,
        bool? coachedOnMax,
        CancellationToken cancellationToken)
    {
        // A client waiting for a coach (CLI-012) names nobody: an empty name, as the screens already read one.
        var coachName = client.AssignedCoachUserId is { } coachUserId
            ? await dbContext.Users
                .AsNoTracking()
                .Where(user => user.Id == coachUserId)
                .Select(user => user.DisplayName)
                .SingleOrDefaultAsync(cancellationToken)
            : null;
        var coached = coachedOnMax ??
            await houseTiers.CoachedOnMaxAsync(client.Id, client.IsSelfDirected, cancellationToken);
        var details = ToCoachDetails(client, coachName ?? string.Empty, await ReleaseViewAsync(client, cancellationToken)) with
        {
            HealthStepOpen = HealthStepOpen(client, coached),
        };

        // The business side to whoever may manage the client; the intake answers, the health fields and the coach's
        // notes, the private side, only to the client's own coach (C8, ADR 0026).
        var mayCoach = await coachClientScope.StaffUserIdAsync(cancellationToken) is { } staffUserId &&
            await coachClientScope.MayCoachAsync(staffUserId, client.Id, cancellationToken);
        return mayCoach ? details : WithoutPrivateSide(details);
    }

    private static CoachClientDetails WithoutPrivateSide(CoachClientDetails details) =>
        details with
        {
            BirthDate = null,
            HeightCentimeters = null,
            HeightEnteredValue = null,
            HeightEnteredUnit = null,
            WorkType = null,
            AverageDailySteps = null,
            TrainingBackground = null,
            FoodPreferences = null,
            FoodAversions = null,
            Goals = null,
            Allergies = null,
            Medications = null,
            PreviousInjuries = null,
            CoachNotes = null,
            MayCoach = false,
        };

    private async Task<ClientReleaseView?> ReleaseViewAsync(ClientProfile client, CancellationToken cancellationToken)
    {
        if (client.ReleasedAtUtc is not { } releasedAtUtc)
        {
            return null;
        }

        var release = await (
            from item in dbContext.ClientRelationshipEvents.AsNoTracking()
            where item.ClientProfileId == client.Id &&
                  (item.EventType == ClientRelationshipEventType.Released ||
                   item.EventType == ClientRelationshipEventType.Left)
            join user in dbContext.Users.AsNoTracking() on item.CreatedByUserId equals user.Id into actors
            from actor in actors.DefaultIfEmpty()
            select new
            {
                item.Reason,
                item.EventType,
                item.CreatedByUserId,
                Name = actor == null ? null : actor.DisplayName,
            })
            .FirstOrDefaultAsync(cancellationToken);
        return new ClientReleaseView(
            releasedAtUtc,
            release?.Reason ?? string.Empty,
            release?.CreatedByUserId,
            release?.Name ?? string.Empty,
            DepartureKindOf(release?.EventType));
    }

    private static ClientDepartureKind DepartureKindOf(ClientRelationshipEventType? eventType) =>
        eventType == ClientRelationshipEventType.Left
            ? ClientDepartureKind.LeftByClient
            : ClientDepartureKind.ReleasedByOwner;

    private static ClientCommandResult Invalid(string field, string message) =>
        new(
            ClientCommandStatus.Invalid,
            Errors: new Dictionary<string, string[]> { [field] = [message] });

    private static CoachClientDetails ToCoachDetails(
        ClientProfile client,
        string coachName,
        ClientReleaseView? release) =>
        new(
            client.Id,
            client.UserId,
            client.FirstName,
            client.LastName,
            client.Email,
            client.PhoneNumber,
            client.BirthDate,
            client.HeightCentimeters,
            client.HeightEnteredValue,
            client.HeightEnteredUnit,
            client.WorkType,
            client.AverageDailySteps,
            client.TrainingBackground,
            client.FoodPreferences,
            client.FoodAversions,
            client.Goals,
            client.Allergies,
            client.Medications,
            client.PreviousInjuries,
            client.CoachNotes,
            client.OnboardingStatus,
            client.OnboardingCompletedAtUtc,
            client.IsCoachBlocked,
            client.Version,
            client.AssignedCoachUserId,
            coachName,
            release);

    private static ClientSelfProfile ToSelfProfile(ClientProfile client) =>
        new(
            client.Id,
            client.FirstName,
            client.LastName,
            client.Email,
            client.PhoneNumber,
            client.BirthDate,
            client.HeightCentimeters,
            client.HeightEnteredValue,
            client.HeightEnteredUnit,
            client.WorkType,
            client.AverageDailySteps,
            client.TrainingBackground,
            client.FoodPreferences,
            client.FoodAversions,
            client.Goals,
            client.Allergies,
            client.Medications,
            client.PreviousInjuries,
            client.OnboardingStatus,
            client.OnboardingCompletedAtUtc,
            client.Version,
            client.IsSelfDirected);
}

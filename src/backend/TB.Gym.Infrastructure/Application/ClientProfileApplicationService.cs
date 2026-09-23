using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Progress;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

internal sealed class ClientProfileApplicationService(
    GymDbContext dbContext,
    IClock clock,
    ICurrentUser currentUser,
    ITenantContext tenantContext,
    CoachClientScope coachClientScope)
    : IClientProfileApplicationService
{
    /// <summary>The Owner lists every client; a Coach lists only the clients assigned to them.</summary>
    public async Task<IReadOnlyList<ClientSummary>> ListAsync(CancellationToken cancellationToken)
    {
        var query = dbContext.ClientProfiles.AsNoTracking();
        if (await coachClientScope.RestrictedCoachUserIdAsync(cancellationToken) is { } coachUserId)
        {
            query = query.Where(client => client.AssignedCoachUserId == coachUserId);
        }

        return await (
            from client in query
            join coach in dbContext.Users.AsNoTracking() on client.AssignedCoachUserId equals coach.Id
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
                coach.DisplayName))
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
                // second sees the other: a removal waits and then moves this client too, or this
                // request waits and then finds the coach no longer active.
                if (!await CoachTeam.LockActiveStaffAsync(dbContext, tenantContext.TenantId, request.CoachUserId, cancellationToken))
                {
                    return Invalid("coachUserId", "Choose an active coach of this workspace.");
                }

                dbContext.Entry(profile).Property(client => client.Version).OriginalValue = request.Version;
                var previousCoachUserId = profile.AssignedCoachUserId;
                if (profile.AssignCoach(request.CoachUserId))
                {
                    var sequence = await CoachTeam.NextAssignmentSequenceAsync(dbContext, profile.Id, cancellationToken);
                    dbContext.ClientCoachAssignments.Add(ClientCoachAssignment.ForChange(
                        profile.TenantId,
                        profile.Id,
                        sequence,
                        previousCoachUserId,
                        request.CoachUserId,
                        ClientCoachAssignmentReason.Reassigned,
                        request.Note,
                        clock.UtcNow));
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
                    CoachDetails: await ToCoachDetailsAsync(profile, cancellationToken));
            });
        }
        catch (ArgumentException exception)
        {
            dbContext.ChangeTracker.Clear();
            return Invalid("coachUserId", exception.Message);
        }
        catch (DbUpdateException)
        {
            // A stale version, or a concurrent reassignment that took the same history number.
            dbContext.ChangeTracker.Clear();
            return new ClientCommandResult(ClientCommandStatus.Conflict);
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
        var userIds = history
            .SelectMany(item => new[] { item.CoachUserId, item.PreviousCoachUserId ?? Guid.Empty })
            .Where(id => id != Guid.Empty)
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
                names.GetValueOrDefault(item.CoachUserId, string.Empty),
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
            .SingleOrDefaultAsync(item => item.UserId == userId, cancellationToken);
        return client is null ? null : ToSelfProfile(client);
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
            return Invalid("coachNotes", exception.Message);
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
            return Invalid("reason", exception.Message);
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
            dbContext.Entry(profile).Property(client => client.Version).OriginalValue = request.Version;
            var changedFields = profile.UpdateIntake(request.ToInput(), tenantToday);
            if (changedFields.Count > 0)
            {
                dbContext.ClientProfileChanges.Add(ClientProfileChange.Create(
                    profile.TenantId,
                    profile.Id,
                    source,
                    changedFields));
                await dbContext.SaveChangesAsync(cancellationToken);
            }

            return await SuccessAsync(profile, returnSelf, cancellationToken);
        }
        catch (ArgumentException exception)
        {
            return Invalid("intake", exception.Message);
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
                ? await SuccessAsync(profile, returnSelf, cancellationToken)
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

            dbContext.Entry(profile).Property(client => client.Version).OriginalValue = request.Intake.Version;
            var changedFields = profile.CompleteOnboarding(
                request.Intake.ToInput(),
                tenantToday,
                clock.UtcNow);
            if (existingObservation is null)
            {
                dbContext.BodyweightObservations.Add(BodyweightObservation.CreateInitial(
                    profile.TenantId,
                    profile.Id,
                    request.MeasurementDate,
                    request.InitialBodyweightValue,
                    request.InitialBodyweightUnit == BodyweightUnit.Kilogram
                        ? RecordedMassUnit.Kilogram
                        : RecordedMassUnit.Pound,
                    bodyweightSource));
            }
            dbContext.ClientProfileChanges.Add(ClientProfileChange.Create(
                profile.TenantId,
                profile.Id,
                ClientChangeSource.OnboardingCompletion,
                changedFields.Append("InitialBodyweight")));
            await dbContext.SaveChangesAsync(cancellationToken);
            return await SuccessAsync(profile, returnSelf, cancellationToken);
        }
        catch (ArgumentException exception)
        {
            return Invalid("onboarding", exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return Invalid("onboarding", exception.Message);
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

    private Task<ClientProfile?> FindSelfAsync(CancellationToken cancellationToken) =>
        currentUser.UserId is not { } userId
            ? Task.FromResult<ClientProfile?>(null)
            : dbContext.ClientProfiles.SingleOrDefaultAsync(
                client => client.UserId == userId,
                cancellationToken);

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

    private async Task<ClientCommandResult> SuccessAsync(
        ClientProfile profile,
        bool returnSelf,
        CancellationToken cancellationToken) =>
        returnSelf
            ? new ClientCommandResult(ClientCommandStatus.Success, SelfProfile: ToSelfProfile(profile))
            : new ClientCommandResult(
                ClientCommandStatus.Success,
                CoachDetails: await ToCoachDetailsAsync(profile, cancellationToken));

    private async Task<CoachClientDetails> ToCoachDetailsAsync(
        ClientProfile client,
        CancellationToken cancellationToken)
    {
        var coachName = await dbContext.Users
            .AsNoTracking()
            .Where(user => user.Id == client.AssignedCoachUserId)
            .Select(user => user.DisplayName)
            .SingleOrDefaultAsync(cancellationToken);
        return ToCoachDetails(client, coachName ?? string.Empty);
    }

    private static ClientCommandResult Invalid(string field, string message) =>
        new(
            ClientCommandStatus.Invalid,
            Errors: new Dictionary<string, string[]> { [field] = [message] });

    private static CoachClientDetails ToCoachDetails(ClientProfile client, string coachName) =>
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
            coachName);

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
            client.Version);
}

using System.Net.Mail;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;
using TB.Gym.Modules.Website;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// What every part of the house's sign-up reads: which workspace is the house, its settings in force and the
/// places of a week already taken. The reads name the house's id themselves, because the public routes that call
/// them carry no workspace.
/// </summary>
internal static class HouseReader
{
    public static Task<Tenant?> FindAsync(GymDbContext dbContext, CancellationToken cancellationToken) =>
        dbContext.Tenants
            .AsNoTracking()
            .SingleOrDefaultAsync(tenant => tenant.IsHouse && tenant.IsActive, cancellationToken);

    /// <summary>The house's settings as they stand: the latest change of each (CLI-023).</summary>
    public static async Task<HouseSettings> SettingsAsync(
        GymDbContext dbContext,
        Guid houseId,
        CancellationToken cancellationToken)
    {
        var latest = await dbContext.HouseSettingChanges
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(change =>
                change.TenantId == houseId &&
                !dbContext.HouseSettingChanges.Any(later =>
                    later.TenantId == houseId &&
                    later.Setting == change.Setting &&
                    later.Sequence > change.Sequence))
            .Select(change => new { change.Setting, change.Value })
            .ToListAsync(cancellationToken);
        return HouseSettings.From(latest.Select(change => KeyValuePair.Create(change.Setting, change.Value)));
    }

    /// <summary>
    /// The places of <c>[fromUtc, toUtc)</c> already taken: the sign-ups confirmed in it. A sign-up still waiting
    /// for its email holds none, so made-up addresses never fill a week (CLI-024).
    /// </summary>
    public static Task<int> ConfirmedBetweenAsync(
        GymDbContext dbContext,
        Guid houseId,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        CancellationToken cancellationToken) =>
        dbContext.TraineeSignUps
            .IgnoreQueryFilters()
            .CountAsync(
                signUp =>
                    signUp.TenantId == houseId &&
                    signUp.ConfirmedAtUtc >= fromUtc &&
                    signUp.ConfirmedAtUtc < toUtc,
                cancellationToken);

    /// <summary>
    /// The age the house asks of someone signing up, for a workspace that is the house and has filled it; null
    /// anywhere else, where the platform's own adults-only check stands alone.
    /// </summary>
    public static async Task<int?> MinimumSignUpAgeAsync(
        GymDbContext dbContext,
        Guid tenantId,
        CancellationToken cancellationToken)
    {
        var isHouse = await dbContext.Tenants
            .AsNoTracking()
            .AnyAsync(tenant => tenant.Id == tenantId && tenant.IsHouse, cancellationToken);
        return isHouse
            ? (await SettingsAsync(dbContext, tenantId, cancellationToken)).MinimumSignUpAge
            : null;
    }

    /// <summary>
    /// The house's own media storage in bytes (MED-019), for a workspace that is the house today and has filled it;
    /// null anywhere else, a former house included, where the platform's allowance stands.
    /// </summary>
    public static async Task<long?> MediaStorageBytesAsync(
        GymDbContext dbContext,
        Guid tenantId,
        CancellationToken cancellationToken)
    {
        var isHouse = await dbContext.Tenants
            .AsNoTracking()
            .AnyAsync(tenant => tenant.Id == tenantId && tenant.IsHouse && tenant.IsActive, cancellationToken);
        return isHouse
            ? (await SettingsAsync(dbContext, tenantId, cancellationToken)).MediaStorageBytes
            : null;
    }
}

/// <summary>
/// Sign-up into the house with no invitation (CLI-024, ADR 0041), beside <see cref="WorkspaceApplicationService"/>'s
/// coach sign-up. It composes the Tenancy module's rule with Identity (the account, the legal gate, the confirmation
/// mail), Clients (the profile) and the Website's form stamp, as only Infrastructure may.
/// </summary>
/// <remarks>
/// A new account's sign-up stores the account, its legal acceptances and one <see cref="TraineeSignUp"/> row, and
/// nothing else: the membership and the client profile are created when the email is confirmed
/// (<see cref="CompleteAsync"/>), and that is also when a place of the week is taken. Until then the house's staff
/// see nobody, nothing can be attached to the person, a made-up address holds no place, and a sign-up never
/// confirmed is removed without touching one append-only record. Someone already signed in has a confirmed account
/// and joins at once.
/// <para>
/// Locks, always in this order: the account's own waiting sign-up row, then the house's advisory lock. A
/// confirmation, a signed-in join and the sweep all start with the row, so no two of them can wait on each other.
/// </para>
/// <para>
/// A log line names a reason code or an id, never a name, an email or a date of birth.
/// </para>
/// </remarks>
internal sealed class TraineeSignUpService(
    GymDbContext dbContext,
    UserManager<ApplicationUser> userManager,
    IAccountActionMailScheduler accountActionMail,
    LegalAcceptanceGate legal,
    TraineeSignUpStamps stamps,
    IClock clock,
    ICurrentUser currentUser,
    IMutableTenantContext tenantContext,
    HouseFreePlan freePlan,
    ILogger<TraineeSignUpService> logger)
    : ITraineeSignUpService
{
    /// <summary>
    /// "TBHOUSE1": one place of the house's week given at a time, held from the week's count to the commit. Whoever
    /// makes the house's Free plan holds it too (<see cref="HouseFreePlan"/>).
    /// </summary>
    internal const long SignUpLockKey = 0x5442_484F_5553_4531L;

    private static readonly Action<ILogger, Exception?> LogFreeNameTaken =
        LoggerMessage.Define(
            LogLevel.Warning,
            new EventId(6415, "TraineeFreePlanNameTaken"),
            "A trainee joined the house without Free: the house sells a plan of its own under Free's name. The Free plan sweep starts it once that plan is renamed.");

    private const string BirthDateMissing = "Enter your date of birth.";

    private const string BirthDateOutOfRange = "Check the year of your date of birth.";

    private static readonly Action<ILogger, Guid, Exception?> LogStored =
        LoggerMessage.Define<Guid>(
            LogLevel.Information,
            new EventId(6401, "TraineeSignUpStored"),
            "House sign-up {SignUpId} was stored.");

    private static readonly Action<ILogger, string, Exception?> LogRefused =
        LoggerMessage.Define<string>(
            LogLevel.Information,
            new EventId(6402, "TraineeSignUpRefused"),
            "A house sign-up was refused: {Reason}.");

    public async Task<TraineeSignUpStatusView> GetStatusAsync(CancellationToken cancellationToken)
    {
        var house = await HouseReader.FindAsync(dbContext, cancellationToken);
        if (house is null)
        {
            return new TraineeSignUpStatusView(TraineeSignUpStatus.Closed);
        }

        var settings = await HouseReader.SettingsAsync(dbContext, house.Id, cancellationToken);
        if (!TraineeSignUpRule.IsOpenFor(settings))
        {
            return new TraineeSignUpStatusView(TraineeSignUpStatus.Closed);
        }

        var now = clock.UtcNow;
        var week = WeekOf(house, now);
        var taken = await HouseReader.ConfirmedBetweenAsync(
            dbContext,
            house.Id,
            week.StartsAtUtc,
            week.EndsAtUtc,
            cancellationToken);
        var status = TraineeSignUpRule.Status(hasHouse: true, settings, taken);
        return new TraineeSignUpStatusView(
            status,
            house.Name,
            house.TimeZoneId,
            settings.MinimumSignUpAge,
            status == TraineeSignUpStatus.Full ? week.EndsOnExclusive : null,
            status == TraineeSignUpStatus.Open ? stamps.Issue(now) : null,
            await CallerSignUpAsync(house.Id, cancellationToken));
    }

    public async Task<TraineeRegistrationResult> RegisterAsync(
        RegisterTraineeRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var email = string.IsNullOrWhiteSpace(request.Email)
            ? string.Empty
            : request.Email.Trim().ToLowerInvariant();

        // The honeypot first, as Talk to us does (WEB-002): answered like a sign-up that worked, and its value
        // is neither stored nor logged.
        if (!string.IsNullOrWhiteSpace(request.Website))
        {
            LogRefused(logger, "honeypot", null);
            return new TraineeRegistrationResult(TraineeRegistrationStatus.Dropped, email);
        }

        // Closed before anything else is weighed: while no workspace is the house, or a setting that opens
        // sign-up is empty, nobody is told to fix a field.
        var house = await HouseReader.FindAsync(dbContext, cancellationToken);
        if (house is null ||
            !TraineeSignUpRule.IsOpenFor(await HouseReader.SettingsAsync(dbContext, house.Id, cancellationToken)))
        {
            return Refuse(TraineeRegistrationStatus.Closed, "closed", email);
        }

        var signedInUserId = currentUser.UserId;
        var errors = Validate(request, email, newAccount: signedInUserId is null);
        if (errors.Count > 0)
        {
            LogRefused(logger, "validation", null);
            return new TraineeRegistrationResult(TraineeRegistrationStatus.Invalid, email, Errors: errors);
        }

        var now = clock.UtcNow;
        switch (stamps.Check(request.FormStamp, now))
        {
            case ContactFormStampCheck.TooFast:
                return Refuse(TraineeRegistrationStatus.TooFast, "too-fast", email);
            case ContactFormStampCheck.Invalid:
                return Refuse(TraineeRegistrationStatus.StampInvalid, "stamp-invalid", email);
        }

        // The sign-up lands in the house, whatever the request carries: the route reads no workspace header,
        // and every tenant-owned row below is written inside the house's scope.
        tenantContext.SetTenant(house.Id);
        // The new account's id is chosen once, outside the retries: an attempt whose commit landed but whose
        // answer was lost is recognised by the next one, which then still asks for the confirmation email.
        var newUserId = Guid.CreateVersion7();
        Outcome outcome;
        try
        {
            outcome = await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(
                () => RegisterCoreAsync(house.Id, request, email, signedInUserId, newUserId, now, cancellationToken));
        }
        catch (DbUpdateException)
        {
            // Two requests for one account met at a unique index; the loser has stored nothing.
            dbContext.ChangeTracker.Clear();
            return Refuse(TraineeRegistrationStatus.Conflict, "conflict", email);
        }

        var result = outcome.Result;
        if (result.Status is not (TraineeRegistrationStatus.Created or TraineeRegistrationStatus.Joined))
        {
            LogRefused(logger, ReasonOf(result.Status), null);
            return result;
        }

        LogStored(logger, outcome.SignUpId, null);
        if (result.Status == TraineeRegistrationStatus.Joined)
        {
            return result;
        }

        // As for a coach: a durable request for the confirmation email, materialized by the dispatcher. Outside
        // Production the captured adapter hands the link back to the caller who typed the address. The account
        // is stored by now, so a caller who went away does not stop its email from being asked for.
        var dispatch = await accountActionMail.RequestAsync(
            new AccountActionMailCommand(
                outcome.UserId,
                AccountActionKind.ConfirmEmail,
                AccountActionMailSources.TraineeSignUp,
                outcome.UserId),
            CancellationToken.None);
        return result with
        {
            DevelopmentConfirmationUrl = dispatch.DevelopmentActionUrl,
            EmailAvailable = dispatch.EmailAvailable,
        };
    }

    /// <summary>
    /// Takes the row lock a confirmation, a signed-in join and the sweep all take first, on the account's waiting
    /// sign-up when it has one, so they never deadlock and never both act. Runs inside the caller's transaction.
    /// </summary>
    public Task LockPendingAsync(Guid userId, CancellationToken cancellationToken) =>
        dbContext.Database.ExecuteSqlAsync(
            $"""SELECT 1 FROM tenancy."TraineeSignUps" WHERE "UserId" = {userId} AND "ConfirmedAtUtc" IS NULL FOR UPDATE /* trainee-sign-up */""",
            cancellationToken);

    /// <summary>
    /// The email was confirmed: the account's waiting sign-up, when it has one, takes a place of the house's week
    /// and becomes a Client membership and a self-directed profile. Runs inside the confirmation's transaction,
    /// after <see cref="LockPendingAsync"/>, so the account is confirmed and joined together.
    /// </summary>
    /// <remarks>
    /// The place is given here, under the house's lock, and only while sign-up is open and the week has room. A
    /// confirmation into a week that has filled, or into a sign-up closed since, still confirms the email and
    /// leaves the sign-up waiting: the person joins with the signed-in form once there is room, and the sweep
    /// drops a waiting sign-up nobody came back for.
    /// </remarks>
    public async Task CompleteAsync(ApplicationUser user, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(user);
        var signUp = await dbContext.TraineeSignUps
            .IgnoreQueryFilters()
            .SingleOrDefaultAsync(
                item => item.UserId == user.Id && item.ConfirmedAtUtc == null,
                cancellationToken);
        // An account the platform blocked joins nothing, as the signed-in form refuses it too; its sign-up waits
        // and is swept.
        if (signUp is null || user.IsPlatformBlocked)
        {
            return;
        }

        tenantContext.SetTenant(signUp.TenantId);
        await LockHouseAsync(cancellationToken);
        var house = await HouseReader.FindAsync(dbContext, cancellationToken);
        if (house is null || house.Id != signUp.TenantId)
        {
            return;
        }

        var settings = await HouseReader.SettingsAsync(dbContext, house.Id, cancellationToken);
        var now = clock.UtcNow;
        var week = WeekOf(house, now);
        if (!TraineeSignUpRule.IsOpenFor(settings) ||
            await HouseReader.ConfirmedBetweenAsync(
                dbContext,
                house.Id,
                week.StartsAtUtc,
                week.EndsAtUtc,
                cancellationToken) >= settings.SignUpsPerWeek)
        {
            return;
        }

        var (membership, standing) = await MembershipAsync(house.Id, user, cancellationToken);
        if (standing != HouseStanding.MayJoin)
        {
            // The account became part of the house another way since it signed up. The waiting sign-up has
            // nothing left to do, and the sweep drops it without touching the account.
            return;
        }

        var profile = await JoinAsync(
            house.Id,
            user,
            membership,
            signUp.FirstName!,
            signUp.LastName!,
            signUp.BirthDate,
            now,
            cancellationToken);
        signUp.Confirm(profile.Id, now);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task<Outcome> RegisterCoreAsync(
        Guid houseId,
        RegisterTraineeRequest request,
        string email,
        Guid? signedInUserId,
        Guid newUserId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        // A retry starts from what is stored.
        dbContext.ChangeTracker.Clear();
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        if (signedInUserId is null &&
            await dbContext.Users.AsNoTracking().AnyAsync(user => user.Id == newUserId, cancellationToken))
        {
            // An earlier attempt of this same request was committed and only its answer was lost.
            var stored = await dbContext.TraineeSignUps
                .AsNoTracking()
                .Where(signUp => signUp.UserId == newUserId)
                .Select(signUp => signUp.Id)
                .FirstOrDefaultAsync(cancellationToken);
            return new Outcome(
                new TraineeRegistrationResult(TraineeRegistrationStatus.Created, email),
                newUserId,
                stored);
        }

        // The caller's own waiting sign-up first, then the house: the order a confirmation takes them in.
        if (signedInUserId is { } callerId)
        {
            await LockPendingAsync(callerId, cancellationToken);
        }

        // The week's count and the place it allows are read and written under one lock, so the last place of a
        // week is given once however many ask for it together.
        await LockHouseAsync(cancellationToken);

        // Read again under the lock: the mark and the settings are the admin's to change at any moment.
        var house = await HouseReader.FindAsync(dbContext, cancellationToken);
        if (house is null || house.Id != houseId)
        {
            return Outcome.Of(TraineeRegistrationStatus.Closed, email);
        }

        var settings = await HouseReader.SettingsAsync(dbContext, house.Id, cancellationToken);
        if (!TraineeSignUpRule.IsOpenFor(settings))
        {
            return Outcome.Of(TraineeRegistrationStatus.Closed, email);
        }

        // The age check, before any account is stored. Nothing of an under-age request is kept.
        var week = WeekOf(house, now);
        var minimumAge = settings.MinimumSignUpAge!.Value;
        var birthDate = request.BirthDate!.Value;
        switch (TraineeSignUpRule.CheckBirthDate(birthDate, minimumAge, week.Today))
        {
            case TraineeBirthDateCheck.OutOfRange:
                return new Outcome(new TraineeRegistrationResult(
                    TraineeRegistrationStatus.Invalid,
                    email,
                    Errors: new Dictionary<string, string[]> { ["birthDate"] = [BirthDateOutOfRange] }));
            case TraineeBirthDateCheck.TooYoung:
                return new Outcome(new TraineeRegistrationResult(
                    TraineeRegistrationStatus.AgeNotMet,
                    email,
                    MinimumAge: minimumAge));
        }

        var full = await HouseReader.ConfirmedBetweenAsync(
            dbContext,
            house.Id,
            week.StartsAtUtc,
            week.EndsAtUtc,
            cancellationToken) >= settings.SignUpsPerWeek;
        var names = TraineeSignUpRule.NormalizeNames(request.FirstName, request.LastName);
        if (signedInUserId is { } userId)
        {
            return await JoinSignedInAsync(
                house.Id,
                userId,
                request,
                email,
                names,
                birthDate,
                week,
                full,
                now,
                transaction,
                cancellationToken);
        }

        // A full week takes no new form. A form sent while there was room may still find the week full when its
        // email is confirmed; the place is given then (CompleteAsync).
        if (full)
        {
            return new Outcome(new TraineeRegistrationResult(
                TraineeRegistrationStatus.Full,
                email,
                OpensAgainOn: week.EndsOnExclusive));
        }

        // Sign-up asks nothing about other coaching spaces (decision 34): an email that already has an account
        // signs in first and then gains only the membership and the profile, as an invitation works.
        if (await userManager.FindByEmailAsync(email) is not null)
        {
            return Outcome.Of(TraineeRegistrationStatus.ExistingAccountSignInRequired, email);
        }

        // Asked before the account exists, so a refusal leaves nothing behind (CLI-010). With no document
        // published for a house trainee, none is asked.
        var acceptances = await legal.CheckAsync(
            LegalAudience.Trainee,
            existingUserId: null,
            house.Id,
            request.LegalDocumentIds,
            cancellationToken);
        if (acceptances is null)
        {
            return Outcome.Of(TraineeRegistrationStatus.LegalAcceptanceRequired, email);
        }

        var user = new ApplicationUser
        {
            Id = newUserId,
            UserName = email,
            Email = email,
            EmailConfirmed = false,
            DisplayName = $"{names.FirstName} {names.LastName}",
            PreferredCulture = house.DefaultCulture,
            CreatedAtUtc = now,
            UpdatedAtUtc = now,
        };
        var created = await userManager.CreateAsync(user, request.Password!);
        if (!created.Succeeded)
        {
            // A second sign-up with the same email can create the account between the check above and this
            // insert; the loser answers exactly like the caller who found it already there.
            return created.Errors.Any(error =>
                error.Code is nameof(IdentityErrorDescriber.DuplicateUserName)
                    or nameof(IdentityErrorDescriber.DuplicateEmail))
                ? Outcome.Of(TraineeRegistrationStatus.ExistingAccountSignInRequired, email)
                : new Outcome(new TraineeRegistrationResult(
                    TraineeRegistrationStatus.Invalid,
                    email,
                    Errors: new Dictionary<string, string[]>
                    {
                        ["identity"] = created.Errors.Select(error => error.Description).ToArray(),
                    }));
        }

        var signUp = TraineeSignUp.Request(house.Id, user.Id, names.FirstName, names.LastName, birthDate, now);
        dbContext.TraineeSignUps.Add(signUp);
        legal.Record(acceptances, user.Id, house.Id, now);
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new Outcome(
            new TraineeRegistrationResult(TraineeRegistrationStatus.Created, email),
            user.Id,
            signUp.Id);
    }

    private async Task<Outcome> JoinSignedInAsync(
        Guid houseId,
        Guid userId,
        RegisterTraineeRequest request,
        string email,
        (string FirstName, string LastName) names,
        DateOnly birthDate,
        TraineeSignUpWeek week,
        bool full,
        DateTimeOffset now,
        Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction transaction,
        CancellationToken cancellationToken)
    {
        var user = await userManager.FindByIdAsync(userId.ToString());
        if (user is null || user.IsPlatformBlocked || !user.EmailConfirmed)
        {
            return Outcome.Of(TraineeRegistrationStatus.Conflict, email);
        }

        if (!string.Equals(user.NormalizedEmail, userManager.NormalizeEmail(email), StringComparison.Ordinal))
        {
            return Outcome.Of(TraineeRegistrationStatus.WrongSignedInAccount, email);
        }

        var (membership, standing) = await MembershipAsync(houseId, user, cancellationToken);
        switch (standing)
        {
            case HouseStanding.AlreadyPart:
                return Outcome.Of(TraineeRegistrationStatus.AlreadyJoined, email);
            case HouseStanding.FormerStaff:
                return Outcome.Of(TraineeRegistrationStatus.FormerStaff, email);
            case HouseStanding.EndedByTheHouse:
                return Outcome.Of(TraineeRegistrationStatus.EndedByTheHouse, email);
        }

        // One sign-up an account in a house week: someone who left cannot come and go, taking a place and
        // leaving an ended record each time.
        if (await dbContext.TraineeSignUps.AnyAsync(
                signUp =>
                    signUp.UserId == user.Id &&
                    signUp.ConfirmedAtUtc >= week.StartsAtUtc &&
                    signUp.ConfirmedAtUtc < week.EndsAtUtc,
                cancellationToken))
        {
            return new Outcome(new TraineeRegistrationResult(
                TraineeRegistrationStatus.AlreadySignedUpThisWeek,
                email,
                OpensAgainOn: week.EndsOnExclusive));
        }

        if (full)
        {
            return new Outcome(new TraineeRegistrationResult(
                TraineeRegistrationStatus.Full,
                email,
                OpensAgainOn: week.EndsOnExclusive));
        }

        // Their platform acceptances count, as at an invitation; the house's own documents are theirs to tick.
        var acceptances = await legal.CheckAsync(
            LegalAudience.Trainee,
            user.Id,
            houseId,
            request.LegalDocumentIds,
            cancellationToken);
        if (acceptances is null)
        {
            return Outcome.Of(TraineeRegistrationStatus.LegalAcceptanceRequired, email);
        }

        var profile = await JoinAsync(
            houseId,
            user,
            membership,
            names.FirstName,
            names.LastName,
            birthDate,
            now,
            cancellationToken);
        // A sign-up of theirs that waited for a place, its email confirmed into a full week, is the one that
        // takes the place now; nobody has two.
        var signUp = await dbContext.TraineeSignUps.SingleOrDefaultAsync(
            item => item.UserId == user.Id && item.ConfirmedAtUtc == null,
            cancellationToken);
        if (signUp is not null)
        {
            signUp.Confirm(profile.Id, now);
        }
        else
        {
            signUp = TraineeSignUp.Joined(houseId, user.Id, profile.Id, now);
            dbContext.TraineeSignUps.Add(signUp);
        }

        legal.Record(acceptances, user.Id, houseId, now);
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new Outcome(
            new TraineeRegistrationResult(TraineeRegistrationStatus.Joined, email),
            user.Id,
            signUp.Id);
    }

    /// <summary>
    /// The person's one membership row in the house, and where they stand: whoever is part of it today is
    /// refused; a former coach or owner of its team is refused, since their one row is a team member's; a former
    /// client whose coaching the house ended, or who left while the house had blocked their access, is refused,
    /// since coming back is then the house's choice (an invitation, CLI-016), never the person's own; a former
    /// client who simply left rejoins on the row they had (ADR 0027); and anybody else may join.
    /// </summary>
    private async Task<(TenantMembership? Membership, HouseStanding Standing)> MembershipAsync(
        Guid houseId,
        ApplicationUser user,
        CancellationToken cancellationToken)
    {
        var membership = await dbContext.TenantMemberships.SingleOrDefaultAsync(
            item => item.TenantId == houseId && item.UserId == user.Id,
            cancellationToken);
        // Only a current profile is the person's: an ended one stays as it is.
        var hasProfile = await dbContext.ClientProfiles.AnyAsync(
            profile => profile.ReleasedAtUtc == null &&
                (profile.UserId == user.Id || profile.NormalizedEmail == user.NormalizedEmail),
            cancellationToken);
        if (hasProfile)
        {
            return (membership, HouseStanding.AlreadyPart);
        }

        if (membership is null)
        {
            return (null, HouseStanding.MayJoin);
        }

        if (membership.Status != MembershipStatus.Removed)
        {
            return (membership, HouseStanding.AlreadyPart);
        }

        if (membership.Role != TenantRole.Client)
        {
            return (membership, HouseStanding.FormerStaff);
        }

        // The block is frozen on the ended record as it stood when the relationship ended (ADR 0027).
        var ended = await dbContext.ClientProfiles
            .AsNoTracking()
            .Where(profile => profile.UserId == user.Id && profile.ReleasedAtUtc != null)
            .OrderByDescending(profile => profile.ReleasedAtUtc)
            .ThenByDescending(profile => profile.Id)
            .Select(profile => new { profile.Id, profile.IsCoachBlocked })
            .FirstOrDefaultAsync(cancellationToken);
        if (ended is not null &&
            (ended.IsCoachBlocked ||
             await dbContext.ClientRelationshipEvents.AsNoTracking().AnyAsync(
                 item => item.ClientProfileId == ended.Id &&
                         item.EventType == ClientRelationshipEventType.Released,
                 cancellationToken)))
        {
            return (membership, HouseStanding.EndedByTheHouse);
        }

        return (membership, HouseStanding.MayJoin);
    }

    /// <summary>
    /// The membership, the self-directed profile and the first entry of its coach history, added to the caller's
    /// unit of work. The record names the house's Coach, as every client's names one member of staff (ADR 0026).
    /// </summary>
    private async Task<ClientProfile> JoinAsync(
        Guid houseId,
        ApplicationUser user,
        TenantMembership? membership,
        string firstName,
        string lastName,
        DateOnly? birthDate,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var coachUserId = await HouseCoachAsync(houseId, cancellationToken);
        var profile = ClientProfile.CreateForHouseSignUp(
            houseId,
            user.Id,
            coachUserId,
            firstName,
            lastName,
            user.Email!,
            birthDate);
        if (membership is not null)
        {
            membership.RejoinAsClient();
        }
        else
        {
            dbContext.TenantMemberships.Add(TenantMembership.Create(houseId, user.Id, TenantRole.Client));
        }

        dbContext.ClientProfiles.Add(profile);
        dbContext.ClientCoachAssignments.Add(ClientCoachAssignment.ForSignUp(houseId, profile.Id, coachUserId, now));
        dbContext.ClientProfileChanges.Add(ClientProfileChange.Create(
            houseId,
            profile.Id,
            ClientChangeSource.SignUp,
            [nameof(ClientProfile.UserId), nameof(ClientProfile.Email)]));

        // Free starts the day they join, in the same unit of work (SUB-019). A plan of the staff's own already sold
        // under Free's name stops it here without stopping the join: the sweep starts Free once that plan is renamed.
        var house = await dbContext.Tenants.AsNoTracking().SingleAsync(tenant => tenant.Id == houseId, cancellationToken);
        try
        {
            await freePlan.StartAsync(house, profile.Id, now, cancellationToken);
        }
        catch (ProductNameTakenException)
        {
            LogFreeNameTaken(logger, null);
        }

        return profile;
    }

    /// <summary>
    /// The house's Coach: the active Coach who joined its team first, or the Owner while it has none (ADR 0026's
    /// own fallback). Locked like any assignment, so a removal under way commits first or waits.
    /// </summary>
    private async Task<Guid> HouseCoachAsync(Guid houseId, CancellationToken cancellationToken)
    {
        var coachUserId = await dbContext.TenantMemberships
            .AsNoTracking()
            .Where(membership =>
                membership.TenantId == houseId &&
                membership.Role == TenantRole.Coach &&
                membership.Status == MembershipStatus.Active)
            .OrderBy(membership => membership.CreatedAtUtc)
            .ThenBy(membership => membership.Id)
            .Select(membership => (Guid?)membership.UserId)
            .FirstOrDefaultAsync(cancellationToken);
        return await CoachTeam.ResolveStartingCoachAsync(dbContext, houseId, coachUserId, cancellationToken);
    }

    /// <summary>
    /// What the signed-in caller's own sign-up comes to, for the page that would otherwise offer them the form:
    /// a client of the house today, a sign-up of theirs waiting for a place, or nothing to say.
    /// </summary>
    private async Task<TraineeCallerSignUp?> CallerSignUpAsync(Guid houseId, CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId)
        {
            return null;
        }

        if (await dbContext.TenantMemberships.AsNoTracking().AnyAsync(
                membership =>
                    membership.TenantId == houseId &&
                    membership.UserId == userId &&
                    membership.Role == TenantRole.Client &&
                    membership.Status == MembershipStatus.Active,
                cancellationToken))
        {
            return TraineeCallerSignUp.Joined;
        }

        return await dbContext.TraineeSignUps.IgnoreQueryFilters().AsNoTracking().AnyAsync(
            signUp => signUp.TenantId == houseId && signUp.UserId == userId && signUp.ConfirmedAtUtc == null,
            cancellationToken)
            ? TraineeCallerSignUp.Waiting
            : null;
    }

    private async Task LockHouseAsync(CancellationToken cancellationToken) =>
        await dbContext.Database.ExecuteSqlAsync(
            $"SELECT pg_advisory_xact_lock({SignUpLockKey}) /* house-sign-up */",
            cancellationToken);

    private static Dictionary<string, string[]> Validate(RegisterTraineeRequest request, string email, bool newAccount)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(request.FirstName) ||
            request.FirstName.Trim().Length > TraineeSignUp.NameMaximumLength)
        {
            errors["firstName"] = ["First name is required and cannot exceed 100 characters."];
        }

        if (string.IsNullOrWhiteSpace(request.LastName) ||
            request.LastName.Trim().Length > TraineeSignUp.NameMaximumLength)
        {
            errors["lastName"] = ["Last name is required and cannot exceed 100 characters."];
        }

        if (!MailAddress.TryCreate(email, out _) || email.Length > 320)
        {
            errors["email"] = ["A valid email address is required."];
        }

        if (request.BirthDate is null)
        {
            errors["birthDate"] = [BirthDateMissing];
        }

        if (newAccount && string.IsNullOrWhiteSpace(request.Password))
        {
            errors["password"] = ["A password is required for a new account."];
        }

        return errors;
    }

    private TraineeRegistrationResult Refuse(TraineeRegistrationStatus status, string reason, string email)
    {
        LogRefused(logger, reason, null);
        return new TraineeRegistrationResult(status, email);
    }

    private static string ReasonOf(TraineeRegistrationStatus status) => status switch
    {
        TraineeRegistrationStatus.Closed => "closed",
        TraineeRegistrationStatus.Full => "full",
        TraineeRegistrationStatus.Invalid => "validation",
        TraineeRegistrationStatus.AgeNotMet => "age",
        TraineeRegistrationStatus.ExistingAccountSignInRequired => "existing-account",
        TraineeRegistrationStatus.WrongSignedInAccount => "wrong-account",
        TraineeRegistrationStatus.AlreadyJoined => "already-joined",
        TraineeRegistrationStatus.FormerStaff => "former-staff",
        TraineeRegistrationStatus.EndedByTheHouse => "ended-by-the-house",
        TraineeRegistrationStatus.AlreadySignedUpThisWeek => "once-a-week",
        TraineeRegistrationStatus.LegalAcceptanceRequired => "legal",
        _ => "conflict",
    };

    private static TraineeSignUpWeek WeekOf(Tenant house, DateTimeOffset now) =>
        TraineeSignUpRule.WeekOf(now, TimeZoneInfo.FindSystemTimeZoneById(house.TimeZoneId), house.WeekStartsOn);

    private enum HouseStanding
    {
        MayJoin,
        AlreadyPart,
        FormerStaff,
        EndedByTheHouse,
    }

    private sealed record Outcome(TraineeRegistrationResult Result, Guid UserId = default, Guid SignUpId = default)
    {
        public static Outcome Of(TraineeRegistrationStatus status, string email) =>
            new(new TraineeRegistrationResult(status, email));
    }
}

/// <summary>
/// Confirms an email and, in the same transaction, completes what the confirmation was waiting for: a sign-up
/// into the house (CLI-024). An account with no waiting sign-up is confirmed exactly as before.
/// </summary>
internal sealed class EmailConfirmationService(
    GymDbContext dbContext,
    UserManager<ApplicationUser> userManager,
    TraineeSignUpService signUps)
    : IEmailConfirmationService
{
    public async Task<bool> ConfirmAsync(Guid userId, string token, CancellationToken cancellationToken) =>
        await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            // A retry starts from what is stored: the account is read again inside each attempt.
            dbContext.ChangeTracker.Clear();
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            // The waiting sign-up first, then the account: the order the sweep takes them in too. A link tapped
            // twice at once waits here and then finds nothing waiting; a sweep that got here first has emptied
            // the account, and its changed stamp refuses the code below.
            await signUps.LockPendingAsync(userId, cancellationToken);
            var user = await userManager.FindByIdAsync(userId.ToString());
            if (user is null)
            {
                return false;
            }

            var result = await userManager.ConfirmEmailAsync(user, token);
            if (!result.Succeeded)
            {
                return false;
            }

            await signUps.CompleteAsync(user, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return true;
        });
}

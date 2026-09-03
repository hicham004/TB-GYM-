using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using TB.Gym.Modules.CheckIns;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.ExerciseLibrary;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Invitations;
using TB.Gym.Modules.Media;
using TB.Gym.Modules.Messaging;
using TB.Gym.Modules.Notifications;
using TB.Gym.Modules.Nutrition;
using TB.Gym.Modules.Progress;
using TB.Gym.Modules.Strength;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;
using TB.Gym.Modules.Training;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Persistence;

public sealed partial class GymDbContext(
    DbContextOptions<GymDbContext> options,
    IClock clock,
    ICurrentUser currentUser,
    ITenantContext tenantContext)
    : IdentityDbContext<ApplicationUser, IdentityRole<Guid>, Guid>(options)
{
    public DbSet<Tenant> Tenants => Set<Tenant>();

    public DbSet<TenantMembership> TenantMemberships => Set<TenantMembership>();

    public DbSet<ClientProfile> ClientProfiles => Set<ClientProfile>();

    public DbSet<ClientProfileChange> ClientProfileChanges => Set<ClientProfileChange>();

    public DbSet<ClientRelationshipEvent> ClientRelationshipEvents => Set<ClientRelationshipEvent>();

    public DbSet<ClientInvitation> ClientInvitations => Set<ClientInvitation>();

    public DbSet<InvitationDelivery> InvitationDeliveries => Set<InvitationDelivery>();

    public DbSet<AccountEmailDelivery> AccountEmailDeliveries => Set<AccountEmailDelivery>();

    public DbSet<BodyweightObservation> BodyweightObservations => Set<BodyweightObservation>();

    public DbSet<BodyweightCorrection> BodyweightCorrections => Set<BodyweightCorrection>();

    public DbSet<BodyweightObservationVoid> BodyweightObservationVoids => Set<BodyweightObservationVoid>();

    public DbSet<BodyMeasurement> BodyMeasurements => Set<BodyMeasurement>();

    public DbSet<BodyMeasurementCorrection> BodyMeasurementCorrections => Set<BodyMeasurementCorrection>();

    public DbSet<ProgressPhoto> ProgressPhotos => Set<ProgressPhoto>();

    public DbSet<ProgressPhotoRemoval> ProgressPhotoRemovals => Set<ProgressPhotoRemoval>();

    public DbSet<CoachingProduct> CoachingProducts => Set<CoachingProduct>();

    public DbSet<ProductOffer> ProductOffers => Set<ProductOffer>();

    public DbSet<OfferEntitlement> OfferEntitlements => Set<OfferEntitlement>();

    public DbSet<ClientEnrollment> ClientEnrollments => Set<ClientEnrollment>();

    public DbSet<EnrollmentEntitlement> EnrollmentEntitlements => Set<EnrollmentEntitlement>();

    public DbSet<PaymentRecord> PaymentRecords => Set<PaymentRecord>();

    public DbSet<NotificationOutboxItem> NotificationOutboxItems => Set<NotificationOutboxItem>();

    public DbSet<Notification> Notifications => Set<Notification>();

    public DbSet<NotificationDeliveryAttempt> NotificationDeliveryAttempts => Set<NotificationDeliveryAttempt>();

    public DbSet<LegalDocumentVersion> LegalDocumentVersions => Set<LegalDocumentVersion>();

    public DbSet<LegalConsentAcceptance> LegalConsentAcceptances => Set<LegalConsentAcceptance>();

    public DbSet<Exercise> Exercises => Set<Exercise>();

    public DbSet<ExerciseMuscle> ExerciseMuscles => Set<ExerciseMuscle>();

    public DbSet<ExerciseTag> ExerciseTags => Set<ExerciseTag>();

    public DbSet<ExerciseAlternative> ExerciseAlternatives => Set<ExerciseAlternative>();

    public DbSet<ExerciseMediaLink> ExerciseMediaLinks => Set<ExerciseMediaLink>();

    public DbSet<MediaAsset> MediaAssets => Set<MediaAsset>();

    public DbSet<MediaAssetDerivative> MediaAssetDerivatives => Set<MediaAssetDerivative>();

    public DbSet<MediaIngestObject> MediaIngestObjects => Set<MediaIngestObject>();

    public DbSet<StrengthMaxRecord> StrengthMaxRecords => Set<StrengthMaxRecord>();

    public DbSet<MesocycleWorkingMaxSnapshot> MesocycleWorkingMaxSnapshots => Set<MesocycleWorkingMaxSnapshot>();

    public DbSet<ProgramTemplate> ProgramTemplates => Set<ProgramTemplate>();

    public DbSet<ProgramTemplateVersion> ProgramTemplateVersions => Set<ProgramTemplateVersion>();

    public DbSet<ProgramTemplateWeek> ProgramTemplateWeeks => Set<ProgramTemplateWeek>();

    public DbSet<ProgramTemplateSession> ProgramTemplateSessions => Set<ProgramTemplateSession>();

    public DbSet<ProgramTemplateExercise> ProgramTemplateExercises => Set<ProgramTemplateExercise>();

    public DbSet<ProgramTemplateExerciseAlternative> ProgramTemplateExerciseAlternatives => Set<ProgramTemplateExerciseAlternative>();

    public DbSet<ProgramTemplateSet> ProgramTemplateSets => Set<ProgramTemplateSet>();

    public DbSet<SavedSessionTemplate> SavedSessionTemplates => Set<SavedSessionTemplate>();

    public DbSet<TrainingMesocycle> TrainingMesocycles => Set<TrainingMesocycle>();

    public DbSet<MesocycleLifecycleEvent> MesocycleLifecycleEvents => Set<MesocycleLifecycleEvent>();

    public DbSet<MesocycleWeek> MesocycleWeeks => Set<MesocycleWeek>();

    public DbSet<TrainingSession> TrainingSessions => Set<TrainingSession>();

    public DbSet<ExercisePrescription> ExercisePrescriptions => Set<ExercisePrescription>();

    public DbSet<ExercisePrescriptionAlternative> ExercisePrescriptionAlternatives => Set<ExercisePrescriptionAlternative>();

    public DbSet<ExercisePrescriptionMediaSnapshot> ExercisePrescriptionMediaSnapshots => Set<ExercisePrescriptionMediaSnapshot>();

    public DbSet<SetPrescription> SetPrescriptions => Set<SetPrescription>();

    public DbSet<WorkoutExecution> WorkoutExecutions => Set<WorkoutExecution>();

    public DbSet<WorkoutExercisePerformance> WorkoutExercisePerformances => Set<WorkoutExercisePerformance>();

    public DbSet<WorkoutExerciseAlternativeSnapshot> WorkoutExerciseAlternativeSnapshots => Set<WorkoutExerciseAlternativeSnapshot>();

    public DbSet<WorkoutExerciseMediaSnapshot> WorkoutExerciseMediaSnapshots => Set<WorkoutExerciseMediaSnapshot>();

    public DbSet<WorkoutSetPerformance> WorkoutSetPerformances => Set<WorkoutSetPerformance>();

    public DbSet<WorkoutNote> WorkoutNotes => Set<WorkoutNote>();

    public DbSet<ProgressionApplication> ProgressionApplications => Set<ProgressionApplication>();

    public DbSet<NutritionWorkspaceSettings> NutritionWorkspaceSettings => Set<NutritionWorkspaceSettings>();

    public DbSet<FoodItem> FoodItems => Set<FoodItem>();

    public DbSet<FoodItemVersion> FoodItemVersions => Set<FoodItemVersion>();

    public DbSet<FoodItemAllergen> FoodItemAllergens => Set<FoodItemAllergen>();

    public DbSet<CookingFactorRecord> CookingFactorRecords => Set<CookingFactorRecord>();

    public DbSet<Recipe> Recipes => Set<Recipe>();

    public DbSet<RecipeVersion> RecipeVersions => Set<RecipeVersion>();

    public DbSet<RecipeIngredient> RecipeIngredients => Set<RecipeIngredient>();

    public DbSet<RecipeVersionAllergen> RecipeVersionAllergens => Set<RecipeVersionAllergen>();

    public DbSet<NutritionCalculationSnapshot> NutritionCalculationSnapshots => Set<NutritionCalculationSnapshot>();

    public DbSet<MacroOverrideAudit> MacroOverrideAudits => Set<MacroOverrideAudit>();

    public DbSet<MealPlanTemplate> MealPlanTemplates => Set<MealPlanTemplate>();

    public DbSet<MealPlanTemplateVersion> MealPlanTemplateVersions => Set<MealPlanTemplateVersion>();

    public DbSet<MealPlanSlot> MealPlanSlots => Set<MealPlanSlot>();

    public DbSet<MealPlanChoice> MealPlanChoices => Set<MealPlanChoice>();

    public DbSet<ClientNutritionPlan> ClientNutritionPlans => Set<ClientNutritionPlan>();

    public DbSet<ClientNutritionPlanDay> ClientNutritionPlanDays => Set<ClientNutritionPlanDay>();

    public DbSet<ClientNutritionPlanSlot> ClientNutritionPlanSlots => Set<ClientNutritionPlanSlot>();

    public DbSet<ClientNutritionPlanChoice> ClientNutritionPlanChoices => Set<ClientNutritionPlanChoice>();

    public DbSet<DailyNutritionLog> DailyNutritionLogs => Set<DailyNutritionLog>();

    public DbSet<DailyNutritionLogEntry> DailyNutritionLogEntries => Set<DailyNutritionLogEntry>();

    public DbSet<NutritionPlanLifecycleEvent> NutritionPlanLifecycleEvents => Set<NutritionPlanLifecycleEvent>();

    public DbSet<AllergenConflictRecord> AllergenConflictRecords => Set<AllergenConflictRecord>();

    public DbSet<ClientDeclaredAllergen> ClientDeclaredAllergens => Set<ClientDeclaredAllergen>();

    public DbSet<AiMealDraftOperation> AiMealDraftOperations => Set<AiMealDraftOperation>();

    public DbSet<CheckInForm> CheckInForms => Set<CheckInForm>();

    public DbSet<CheckInFormVersion> CheckInFormVersions => Set<CheckInFormVersion>();

    public DbSet<CheckInQuestion> CheckInQuestions => Set<CheckInQuestion>();

    public DbSet<CheckInQuestionOption> CheckInQuestionOptions => Set<CheckInQuestionOption>();

    public DbSet<CheckInAssignment> CheckInAssignments => Set<CheckInAssignment>();

    public DbSet<CheckInLifecycleEvent> CheckInLifecycleEvents => Set<CheckInLifecycleEvent>();

    public DbSet<CheckInResponse> CheckInResponses => Set<CheckInResponse>();

    public DbSet<CheckInAnswer> CheckInAnswers => Set<CheckInAnswer>();

    public DbSet<CheckInAnswerChoice> CheckInAnswerChoices => Set<CheckInAnswerChoice>();

    public DbSet<CheckInResponseEvent> CheckInResponseEvents => Set<CheckInResponseEvent>();

    public DbSet<Conversation> Conversations => Set<Conversation>();

    public DbSet<ConversationParticipant> ConversationParticipants => Set<ConversationParticipant>();

    public DbSet<Message> Messages => Set<Message>();

    public DbSet<MessageRevision> MessageRevisions => Set<MessageRevision>();

    public DbSet<MessageDeletionEvent> MessageDeletionEvents => Set<MessageDeletionEvent>();

    public DbSet<MessagingCommandRecord> MessagingCommandRecords => Set<MessagingCommandRecord>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        ConfigureIdentity(builder);
        ConfigureTenancy(builder);
        ConfigureClients(builder);
        ConfigureInvitations(builder);
        ConfigureProgress(builder);
        ConfigureCommercial(builder);
        ConfigureNotifications(builder);
        ConfigureLegalConsent(builder);
        ConfigureExerciseLibrary(builder);
        ConfigureMedia(builder);
        ConfigureStrength(builder);
        ConfigureTraining(builder);
        ConfigureNutrition(builder);
        ConfigureCheckIns(builder);
        ConfigureMessaging(builder);
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        ApplyPersistenceRules();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(
        bool acceptAllChangesOnSuccess,
        CancellationToken cancellationToken = default)
    {
        ApplyPersistenceRules();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    private static void ConfigureIdentity(ModelBuilder builder)
    {
        builder.Entity<ApplicationUser>(entity =>
        {
            entity.ToTable("Users", "identity");
            entity.Property(user => user.DisplayName).HasMaxLength(200);
            entity.Property(user => user.PreferredCulture).HasMaxLength(20).HasDefaultValue("en-LB");
            entity.Property(user => user.CreatedAtUtc).HasDefaultValueSql("CURRENT_TIMESTAMP");
            entity.Property(user => user.UpdatedAtUtc).HasDefaultValueSql("CURRENT_TIMESTAMP");
        });

        builder.Entity<AccountEmailDelivery>(entity =>
        {
            entity.ToTable("AccountEmailDeliveries", "identity");
            entity.HasKey(delivery => delivery.Id);
            entity.Property(delivery => delivery.Recipient).HasMaxLength(320).IsRequired();
            entity.Property(delivery => delivery.Purpose).HasConversion<string>().HasMaxLength(32);
            entity.Property(delivery => delivery.Status).HasConversion<string>().HasMaxLength(32);
            entity.Property(delivery => delivery.ProviderMessageId).HasMaxLength(200);
            entity.Property(delivery => delivery.FailureCode).HasMaxLength(100);
            entity.HasIndex(delivery => new { delivery.UserId, delivery.CreatedAtUtc });
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(delivery => delivery.UserId)
                .OnDelete(DeleteBehavior.Cascade);
            ConfigureAuditable(entity);
        });

        builder.Entity<IdentityRole<Guid>>().ToTable("Roles", "identity");
        builder.Entity<IdentityUserRole<Guid>>().ToTable("UserRoles", "identity");
        builder.Entity<IdentityUserClaim<Guid>>().ToTable("UserClaims", "identity");
        builder.Entity<IdentityUserLogin<Guid>>().ToTable("UserLogins", "identity");
        builder.Entity<IdentityRoleClaim<Guid>>().ToTable("RoleClaims", "identity");
        builder.Entity<IdentityUserToken<Guid>>().ToTable("UserTokens", "identity");
    }

    private static void ConfigureTenancy(ModelBuilder builder)
    {
        builder.Entity<Tenant>(entity =>
        {
            entity.ToTable("Tenants", "tenancy");
            entity.HasKey(tenant => tenant.Id);
            entity.Property(tenant => tenant.Name).HasMaxLength(200).IsRequired();
            entity.Property(tenant => tenant.Slug).HasMaxLength(100).IsRequired();
            entity.Property(tenant => tenant.TimeZoneId)
                .HasMaxLength(100)
                .HasDefaultValue("Asia/Beirut")
                .IsRequired();
            entity.Property(tenant => tenant.DefaultCulture)
                .HasMaxLength(20)
                .HasDefaultValue("en-LB")
                .IsRequired();
            entity.Property(tenant => tenant.DefaultCurrencyCode)
                .HasMaxLength(3)
                .IsFixedLength()
                .HasDefaultValue("USD")
                .IsRequired();
            entity.Property(tenant => tenant.WeekStartsOn)
                .HasConversion<string>()
                .HasMaxLength(16)
                .HasDefaultValue(DayOfWeek.Monday)
                .HasSentinel((DayOfWeek)(-1));
            entity.HasIndex(tenant => tenant.Slug).IsUnique();
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_Tenants_DefaultCurrencyCode",
                "\"DefaultCurrencyCode\" ~ '^[A-Z]{3}$'"));
            ConfigureAuditable(entity);
        });

        builder.Entity<TenantMembership>(entity =>
        {
            entity.ToTable("Memberships", "tenancy");
            entity.HasKey(membership => membership.Id);
            entity.Property(membership => membership.Role).HasConversion<string>().HasMaxLength(32);
            entity.Property(membership => membership.Status).HasConversion<string>().HasMaxLength(32);
            entity.HasIndex(membership => new { membership.TenantId, membership.UserId }).IsUnique();
            entity.HasIndex(membership => new { membership.UserId, membership.Status });
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(membership => membership.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(membership => membership.UserId)
                .OnDelete(DeleteBehavior.Restrict);
            ConfigureAuditable(entity);
        });
    }

    private void ConfigureClients(ModelBuilder builder)
    {
        builder.Entity<ClientProfile>(entity =>
        {
            entity.ToTable("ClientProfiles", "clients");
            entity.HasKey(client => client.Id);
            entity.HasAlternateKey(client => new { client.TenantId, client.Id });
            entity.Property(client => client.FirstName).HasMaxLength(100).IsRequired();
            entity.Property(client => client.LastName).HasMaxLength(100).IsRequired();
            entity.Property(client => client.Email).HasMaxLength(320).IsRequired();
            entity.Property(client => client.NormalizedEmail).HasMaxLength(320).IsRequired();
            entity.Property(client => client.PhoneNumber).HasMaxLength(32);
            entity.Property(client => client.BirthDate).HasColumnType("date");
            entity.Property(client => client.HeightCentimeters).HasPrecision(6, 2);
            entity.Property(client => client.HeightEnteredValue).HasPrecision(7, 2);
            entity.Property(client => client.HeightEnteredUnit).HasConversion<string>().HasMaxLength(16);
            entity.Property(client => client.WorkType).HasMaxLength(200);
            entity.Property(client => client.TrainingBackground).HasMaxLength(4_000);
            entity.Property(client => client.FoodPreferences).HasMaxLength(4_000);
            entity.Property(client => client.FoodAversions).HasMaxLength(4_000);
            entity.Property(client => client.Goals).HasMaxLength(4_000);
            entity.Property(client => client.Allergies).HasMaxLength(4_000);
            entity.Property(client => client.Medications).HasMaxLength(4_000);
            entity.Property(client => client.PreviousInjuries).HasMaxLength(4_000);
            entity.Property(client => client.CoachNotes).HasMaxLength(8_000);
            entity.Property(client => client.OnboardingStatus)
                .HasConversion<string>()
                .HasMaxLength(32)
                .HasDefaultValue(ClientOnboardingStatus.NotStarted)
                .HasSentinel((ClientOnboardingStatus)0);
            entity.HasIndex(client => new { client.TenantId, client.NormalizedEmail }).IsUnique();
            entity.HasIndex(client => new { client.TenantId, client.UserId })
                .IsUnique()
                .HasFilter("\"UserId\" IS NOT NULL");
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(client => client.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(client => client.UserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(client =>
                tenantContext.HasTenant && client.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_ClientProfiles_HeightCentimeters",
                    "\"HeightCentimeters\" IS NULL OR (\"HeightCentimeters\" >= 50 AND \"HeightCentimeters\" <= 300)");
                table.HasCheckConstraint(
                    "CK_ClientProfiles_AverageDailySteps",
                    "\"AverageDailySteps\" IS NULL OR (\"AverageDailySteps\" >= 0 AND \"AverageDailySteps\" <= 100000)");
                table.HasCheckConstraint(
                    "CK_ClientProfiles_CompletedOnboarding",
                    "\"OnboardingStatus\" <> 'Completed' OR (\"BirthDate\" IS NOT NULL AND \"HeightCentimeters\" IS NOT NULL AND \"Goals\" IS NOT NULL AND \"OnboardingCompletedAtUtc\" IS NOT NULL)");
            });
            ConfigureAuditable(entity);
        });

        builder.Entity<ClientProfileChange>(entity =>
        {
            entity.ToTable("ClientProfileChanges", "clients");
            entity.HasKey(change => change.Id);
            entity.Property(change => change.Source).HasConversion<string>().HasMaxLength(32);
            entity.Property(change => change.ChangedFields).HasMaxLength(1_000).IsRequired();
            entity.HasIndex(change => new { change.TenantId, change.ClientProfileId, change.CreatedAtUtc });
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(change => new { change.TenantId, change.ClientProfileId })
                .HasPrincipalKey(client => new { client.TenantId, client.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(change =>
                tenantContext.HasTenant && change.TenantId == tenantContext.TenantId);
            ConfigureAuditable(entity);
        });

        builder.Entity<ClientRelationshipEvent>(entity =>
        {
            entity.ToTable("ClientRelationshipEvents", "clients");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.EventType).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.Reason).HasMaxLength(500).IsRequired();
            entity.HasIndex(item => new { item.TenantId, item.ClientProfileId, item.OccurredAtUtc });
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ClientProfileId })
                .HasPrincipalKey(client => new { client.TenantId, client.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            ConfigureAuditable(entity);
        });
    }

    private void ConfigureInvitations(ModelBuilder builder)
    {
        builder.Entity<ClientInvitation>(entity =>
        {
            entity.ToTable("ClientInvitations", "invitations");
            entity.HasKey(invitation => invitation.Id);
            entity.HasAlternateKey(invitation => new { invitation.TenantId, invitation.Id });
            entity.Property(invitation => invitation.Email).HasMaxLength(320).IsRequired();
            entity.Property(invitation => invitation.NormalizedEmail).HasMaxLength(320).IsRequired();
            entity.Property(invitation => invitation.FirstName).HasMaxLength(100).IsRequired();
            entity.Property(invitation => invitation.LastName).HasMaxLength(100).IsRequired();
            entity.Property(invitation => invitation.PhoneNumber).HasMaxLength(32);
            entity.Property(invitation => invitation.BirthDate).HasColumnType("date");
            entity.Property(invitation => invitation.TokenHash).HasMaxLength(64).IsFixedLength().IsRequired();
            entity.Property(invitation => invitation.Status).HasConversion<string>().HasMaxLength(32);
            entity.HasIndex(invitation => invitation.TokenHash).IsUnique();
            entity.HasIndex(invitation => new { invitation.TenantId, invitation.NormalizedEmail })
                .IsUnique()
                .HasFilter("\"Status\" = 'Pending'");
            entity.HasOne<Tenant>()
                .WithMany()
                .HasForeignKey(invitation => invitation.TenantId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ApplicationUser>()
                .WithMany()
                .HasForeignKey(invitation => invitation.AcceptedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(invitation =>
                tenantContext.HasTenant && invitation.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_ClientInvitations_SendCount",
                    "\"SendCount\" >= 1");
                table.HasCheckConstraint(
                    "CK_ClientInvitations_AcceptedState",
                    "\"Status\" <> 'Accepted' OR (\"AcceptedByUserId\" IS NOT NULL AND \"AcceptedAtUtc\" IS NOT NULL)");
                table.HasCheckConstraint(
                    "CK_ClientInvitations_TokenHash",
                    "char_length(\"TokenHash\") = 64");
            });
            ConfigureAuditable(entity);
        });

        builder.Entity<InvitationDelivery>(entity =>
        {
            entity.ToTable("InvitationDeliveries", "invitations");
            entity.HasKey(delivery => delivery.Id);
            entity.Property(delivery => delivery.Recipient).HasMaxLength(320).IsRequired();
            entity.Property(delivery => delivery.Channel).HasConversion<string>().HasMaxLength(16);
            entity.Property(delivery => delivery.Status).HasConversion<string>().HasMaxLength(32);
            entity.Property(delivery => delivery.ProviderMessageId).HasMaxLength(200);
            entity.Property(delivery => delivery.FailureCode).HasMaxLength(100);
            entity.HasIndex(delivery => new { delivery.TenantId, delivery.InvitationId, delivery.AttemptNumber })
                .IsUnique();
            entity.HasOne<ClientInvitation>()
                .WithMany()
                .HasForeignKey(delivery => new { delivery.TenantId, delivery.InvitationId })
                .HasPrincipalKey(invitation => new { invitation.TenantId, invitation.Id })
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasQueryFilter(delivery =>
                tenantContext.HasTenant && delivery.TenantId == tenantContext.TenantId);
            ConfigureAuditable(entity);
        });
    }

    private void ConfigureProgress(ModelBuilder builder)
    {
        builder.Entity<BodyweightObservation>(entity =>
        {
            entity.ToTable("BodyweightObservations", "progress");
            entity.HasKey(observation => observation.Id);
            entity.HasAlternateKey(observation => new { observation.TenantId, observation.Id });
            entity.Property(observation => observation.MeasurementDate).HasColumnType("date");
            entity.Property(observation => observation.ValueKilograms).HasPrecision(7, 3);
            entity.Property(observation => observation.EnteredValue).HasPrecision(8, 3);
            entity.Property(observation => observation.EnteredUnit).HasConversion<string>().HasMaxLength(16);
            entity.Property(observation => observation.Source).HasConversion<string>().HasMaxLength(32);
            entity.Property(observation => observation.Status).HasConversion<string>().HasMaxLength(16);

            // Partial on the active predicate: one weight per client per local date holds for current
            // truth, while a voided row keeps its date without reserving it, so the date can be
            // logged again after a mis-dated entry is corrected away from it.
            entity.HasIndex(observation => new
            {
                observation.TenantId,
                observation.ClientProfileId,
                observation.MeasurementDate,
            }).IsUnique().HasFilter("\"IsActive\"");
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(observation => new { observation.TenantId, observation.ClientProfileId })
                .HasPrincipalKey(client => new { client.TenantId, client.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(observation =>
                tenantContext.HasTenant && observation.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_BodyweightObservations_ValueKilograms",
                    "\"ValueKilograms\" >= 20 AND \"ValueKilograms\" <= 500");
                table.HasCheckConstraint(
                    "CK_BodyweightObservations_IsActive",
                    "(\"Status\" = 'Active') = \"IsActive\"");
            });
            ConfigureAuditable(entity);
        });

        builder.Entity<BodyweightObservationVoid>(entity =>
        {
            entity.ToTable("BodyweightObservationVoids", "progress");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.MeasurementDate).HasColumnType("date");
            entity.Property(item => item.ValueKilograms).HasPrecision(7, 3);
            entity.Property(item => item.EnteredValue).HasPrecision(8, 3);
            entity.Property(item => item.EnteredUnit).HasConversion<string>().HasMaxLength(16);
            entity.Property(item => item.Source).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.Reason).HasMaxLength(500).IsRequired();

            // One void per observation, so a voided row can never accumulate conflicting reasons.
            entity.HasIndex(item => new { item.TenantId, item.ObservationId }).IsUnique();
            entity.HasIndex(item => new { item.TenantId, item.ClientProfileId, item.VoidedAtUtc });
            entity.HasOne<BodyweightObservation>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ObservationId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<BodyweightObservation>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ReplacementObservationId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ClientProfileId })
                .HasPrincipalKey(client => new { client.TenantId, client.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_BodyweightObservationVoids_ValueKilograms",
                "\"ValueKilograms\" >= 20 AND \"ValueKilograms\" <= 500"));
            ConfigureAuditable(entity);
        });

        builder.Entity<BodyweightCorrection>(entity =>
        {
            entity.ToTable("BodyweightCorrections", "progress");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.MeasurementDate).HasColumnType("date");
            entity.Property(item => item.ValueKilograms).HasPrecision(7, 3);
            entity.Property(item => item.EnteredValue).HasPrecision(8, 3);
            entity.Property(item => item.EnteredUnit).HasConversion<string>().HasMaxLength(16);
            entity.Property(item => item.Source).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.Reason).HasMaxLength(500).IsRequired();
            entity.HasIndex(item => new { item.TenantId, item.ObservationId, item.SupersededAtUtc });
            entity.HasOne<BodyweightObservation>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ObservationId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ClientProfileId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_BodyweightCorrections_ValueKilograms",
                "\"ValueKilograms\" >= 20 AND \"ValueKilograms\" <= 500"));
            ConfigureAuditable(entity);
        });

        builder.Entity<BodyMeasurement>(entity =>
        {
            entity.ToTable("BodyMeasurements", "progress");
            entity.HasKey(item => item.Id);
            entity.HasAlternateKey(item => new { item.TenantId, item.Id });
            entity.Property(item => item.MeasurementDate).HasColumnType("date");
            entity.Property(item => item.MeasurementType).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.CanonicalValue).HasPrecision(7, 3);
            entity.Property(item => item.EnteredValue).HasPrecision(8, 3);
            entity.Property(item => item.EnteredUnit).HasConversion<string>().HasMaxLength(16);
            entity.Property(item => item.Source).HasConversion<string>().HasMaxLength(16);
            entity.HasIndex(item => new
            {
                item.TenantId,
                item.ClientProfileId,
                item.MeasurementDate,
                item.MeasurementType,
            }).IsUnique();
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ClientProfileId })
                .HasPrincipalKey(client => new { client.TenantId, client.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_BodyMeasurements_CanonicalValue",
                    "(\"MeasurementType\" = 'BodyFatPercentage' AND \"CanonicalValue\" BETWEEN 1 AND 75) OR " +
                    "(\"MeasurementType\" <> 'BodyFatPercentage' AND \"CanonicalValue\" BETWEEN 10 AND 300)");
                table.HasCheckConstraint(
                    "CK_BodyMeasurements_EnteredUnit",
                    "(\"MeasurementType\" = 'BodyFatPercentage' AND \"EnteredUnit\" = 'Percent') OR " +
                    "(\"MeasurementType\" <> 'BodyFatPercentage' AND \"EnteredUnit\" IN ('Centimetre', 'Inch'))");
            });
            ConfigureAuditable(entity);
        });

        builder.Entity<BodyMeasurementCorrection>(entity =>
        {
            entity.ToTable("BodyMeasurementCorrections", "progress");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.MeasurementDate).HasColumnType("date");
            entity.Property(item => item.MeasurementType).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.CanonicalValue).HasPrecision(7, 3);
            entity.Property(item => item.EnteredValue).HasPrecision(8, 3);
            entity.Property(item => item.EnteredUnit).HasConversion<string>().HasMaxLength(16);
            entity.Property(item => item.Source).HasConversion<string>().HasMaxLength(16);
            entity.Property(item => item.Reason).HasMaxLength(500).IsRequired();
            entity.HasIndex(item => new { item.TenantId, item.MeasurementId, item.SupersededAtUtc });
            entity.HasOne<BodyMeasurement>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.MeasurementId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ClientProfileId })
                .HasPrincipalKey(item => new { item.TenantId, item.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_BodyMeasurementCorrections_CanonicalValue",
                    "(\"MeasurementType\" = 'BodyFatPercentage' AND \"CanonicalValue\" BETWEEN 1 AND 75) OR " +
                    "(\"MeasurementType\" <> 'BodyFatPercentage' AND \"CanonicalValue\" BETWEEN 10 AND 300)");
                table.HasCheckConstraint(
                    "CK_BodyMeasurementCorrections_EnteredUnit",
                    "(\"MeasurementType\" = 'BodyFatPercentage' AND \"EnteredUnit\" = 'Percent') OR " +
                    "(\"MeasurementType\" <> 'BodyFatPercentage' AND \"EnteredUnit\" IN ('Centimetre', 'Inch'))");
            });
            ConfigureAuditable(entity);
        });

        builder.Entity<ProgressPhoto>(entity =>
        {
            entity.ToTable("ProgressPhotos", "progress");
            entity.HasKey(item => item.Id);
            entity.HasAlternateKey(item => new { item.TenantId, item.Id });
            entity.Property(item => item.PhotoDate).HasColumnType("date");
            entity.Property(item => item.Pose).HasConversion<string>().HasMaxLength(16);
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(16);
            entity.Property(item => item.Source).HasConversion<string>().HasMaxLength(16);
            entity.HasIndex(item => new
            {
                item.TenantId,
                item.ClientProfileId,
                item.PhotoDate,
                item.Pose,
            })
                .IsUnique()
                .HasDatabaseName(DatabaseConstraintNames.OneProgressPhotoPerDateAndPose);
            entity.HasIndex(item => new { item.TenantId, item.MediaAssetId }).IsUnique();
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ClientProfileId })
                .HasPrincipalKey(client => new { client.TenantId, client.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<MediaAsset>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.MediaAssetId })
                .HasPrincipalKey(asset => new { asset.TenantId, asset.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            ConfigureAuditable(entity);
        });

        builder.Entity<ProgressPhotoRemoval>(entity =>
        {
            entity.ToTable("ProgressPhotoRemovals", "progress");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.PhotoDate).HasColumnType("date");
            entity.Property(item => item.Pose).HasConversion<string>().HasMaxLength(16);
            entity.Property(item => item.Reason).HasMaxLength(500).IsRequired();
            entity.HasIndex(item => new { item.TenantId, item.ProgressPhotoId, item.RemovedAtUtc });
            entity.HasOne<ProgressPhoto>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ProgressPhotoId })
                .HasPrincipalKey(photo => new { photo.TenantId, photo.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ClientProfile>()
                .WithMany()
                .HasForeignKey(item => new { item.TenantId, item.ClientProfileId })
                .HasPrincipalKey(client => new { client.TenantId, client.Id })
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasQueryFilter(item =>
                tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
            ConfigureAuditable(entity);
        });
    }

    private static void ConfigureAuditable<TEntity>(
        Microsoft.EntityFrameworkCore.Metadata.Builders.EntityTypeBuilder<TEntity> entity)
        where TEntity : AuditableEntity
    {
        entity.Property(item => item.CreatedAtUtc).HasDefaultValueSql("CURRENT_TIMESTAMP");
        entity.Property(item => item.UpdatedAtUtc).HasDefaultValueSql("CURRENT_TIMESTAMP");
        entity.Property(item => item.Version).IsRowVersion();
    }

    private void ApplyPersistenceRules()
    {
        RejectAppendOnlyMutations<PaymentRecord>("Payment records are append-only.");
        RejectAppendOnlyMutations<ClientRelationshipEvent>("Client relationship events are append-only.");
        RejectAppendOnlyMutations<LegalConsentAcceptance>("Legal consent acceptances are append-only.");
        RejectAppendOnlyMutations<StrengthMaxRecord>("Strength max history is append-only.");
        RejectAppendOnlyMutations<MesocycleWorkingMaxSnapshot>("Working-max snapshots are append-only.");
        RejectAppendOnlyMutations<WorkoutNote>("Workout notes are append-only.");
        RejectAppendOnlyMutations<ProgressionApplication>("Progression applications are append-only.");
        RejectAppendOnlyMutations<MesocycleLifecycleEvent>("Mesocycle lifecycle events are append-only.");
        RejectAppendOnlyMutations<FoodItemVersion>("Food item versions are immutable.");
        RejectAppendOnlyMutations<CookingFactorRecord>("Cooking factors are versioned and immutable.");
        RejectAppendOnlyMutations<NutritionCalculationSnapshot>("Nutrition calculation snapshots are append-only.");
        RejectAppendOnlyMutations<MacroOverrideAudit>("Macro override audits are append-only.");
        RejectAppendOnlyMutations<AllergenConflictRecord>("Allergen conflict records are append-only.");
        RejectAppendOnlyMutations<BodyweightCorrection>("Bodyweight correction history is append-only.");
        RejectAppendOnlyMutations<BodyweightObservationVoid>("Bodyweight void history is append-only.");
        RejectAppendOnlyMutations<BodyMeasurementCorrection>("Body measurement correction history is append-only.");

        if (ChangeTracker.Entries<BodyweightObservation>().Any(item => item.State == EntityState.Deleted))
        {
            throw new InvalidOperationException("Bodyweight observations cannot be deleted; corrections preserve history.");
        }

        if (ChangeTracker.Entries<BodyMeasurement>().Any(item => item.State == EntityState.Deleted))
        {
            throw new InvalidOperationException("Body measurements cannot be deleted; corrections preserve history.");
        }

        RejectAppendOnlyMutations<ProgressPhotoRemoval>("Progress photo removal history is append-only.");

        if (ChangeTracker.Entries<ProgressPhoto>().Any(item => item.State == EntityState.Deleted))
        {
            throw new InvalidOperationException("Progress photos cannot be deleted; removal preserves history.");
        }

        RejectAppendOnlyMutations<CheckInLifecycleEvent>("Check-in lifecycle events are append-only.");

        if (ChangeTracker.Entries<CheckInAssignment>().Any(item => item.State is EntityState.Modified or EntityState.Deleted))
        {
            throw new InvalidOperationException(
                "A check-in assignment records what a client was asked and cannot be changed or deleted.");
        }

        // A published version is frozen. The database trigger is the guarantee, because a migration or
        // a future background job would not pass through the domain; this catches the mistake earlier
        // and with a message that names the intended operation.
        foreach (var entry in ChangeTracker.Entries<CheckInFormVersion>()
                     .Where(item => item.State is EntityState.Modified or EntityState.Deleted))
        {
            if (entry.State == EntityState.Deleted ||
                entry.OriginalValues.GetValue<CheckInFormVersionStatus>(nameof(CheckInFormVersion.Status))
                    == CheckInFormVersionStatus.Published)
            {
                throw new InvalidOperationException(
                    "A published check-in form version is immutable; derive a new draft version instead.");
            }
        }

        RejectAppendOnlyMutations<CheckInResponseEvent>("Check-in response events are append-only.");

        // Messaging history. A revision is what a message said at one point, a deletion event is the
        // fact that somebody removed it, and a command record is a spent idempotency key: all three
        // are written once and never rewritten. Database triggers are the guarantee; these catch the
        // mistake in the code path that made it, with a message that names the intended operation.
        RejectAppendOnlyMutations<MessageRevision>("Message revisions are immutable.");
        RejectAppendOnlyMutations<MessageDeletionEvent>("Message deletion events are append-only.");
        RejectAppendOnlyMutations<MessagingCommandRecord>("Messaging command records are append-only.");

        if (ChangeTracker.Entries<Conversation>().Any(item => item.State == EntityState.Deleted) ||
            ChangeTracker.Entries<ConversationParticipant>().Any(item => item.State == EntityState.Deleted) ||
            ChangeTracker.Entries<Message>().Any(item => item.State == EntityState.Deleted))
        {
            throw new InvalidOperationException(
                "Conversations, participants and messages are never deleted; removal is recorded state.");
        }

        // Removal is one-way. Restoring a message would republish something somebody deliberately
        // took back, or reverse a moderation without any record that it was reversed.
        foreach (var entry in ChangeTracker.Entries<Message>().Where(item => item.State == EntityState.Modified))
        {
            var wasDeleted = entry.OriginalValues.GetValue<DateTimeOffset?>(nameof(Message.DeletedAtUtc));
            if (wasDeleted is null)
            {
                continue;
            }

            if (entry.Entity.DeletedAtUtc is null)
            {
                throw new InvalidOperationException("A removed message cannot be restored.");
            }

            if (entry.Property(item => item.CurrentRevisionNumber).IsModified)
            {
                throw new InvalidOperationException("A removed message cannot be edited.");
            }
        }

        // A cursor is one participant's own progress and only ever moves forward.
        foreach (var entry in ChangeTracker.Entries<ConversationParticipant>()
                     .Where(item => item.State == EntityState.Modified))
        {
            if (entry.Entity.LastReadSequence <
                entry.OriginalValues.GetValue<long>(nameof(ConversationParticipant.LastReadSequence)))
            {
                throw new InvalidOperationException("A conversation read cursor cannot move backwards.");
            }
        }

        // Delivery history is the only thing that can explain a dead-lettered notification later, so
        // an attempt is never deleted and a finished one is never rewritten. The database trigger is
        // the guarantee; this catches the mistake in the code path that made it.
        if (ChangeTracker.Entries<NotificationDeliveryAttempt>().Any(item => item.State == EntityState.Deleted))
        {
            throw new InvalidOperationException("Notification delivery attempts are never deleted.");
        }

        foreach (var entry in ChangeTracker.Entries<NotificationDeliveryAttempt>()
                     .Where(item => item.State == EntityState.Modified))
        {
            if (entry.OriginalValues.GetValue<NotificationDeliveryOutcome>(nameof(NotificationDeliveryAttempt.Outcome))
                != NotificationDeliveryOutcome.Started)
            {
                throw new InvalidOperationException("A completed notification delivery attempt is immutable.");
            }
        }

        // A rendered notification is a historical snapshot of what somebody was told. Only read
        // state may change after it is written, and it is never removed.
        if (ChangeTracker.Entries<Notification>().Any(item => item.State == EntityState.Deleted))
        {
            throw new InvalidOperationException("Notifications are never deleted.");
        }

        foreach (var entry in ChangeTracker.Entries<Notification>()
                     .Where(item => item.State == EntityState.Modified))
        {
            if (entry.Property(item => item.Title).IsModified ||
                entry.Property(item => item.Body).IsModified ||
                entry.Property(item => item.TemplateKey).IsModified ||
                entry.Property(item => item.TemplateVersion).IsModified ||
                entry.Property(item => item.Culture).IsModified ||
                entry.Property(item => item.Kind).IsModified ||
                entry.Property(item => item.RecipientUserId).IsModified ||
                entry.Property(item => item.SourceOutboxItemId).IsModified)
            {
                throw new InvalidOperationException(
                    "A delivered notification is a snapshot; only its read state can change.");
            }
        }

        if (ChangeTracker.Entries<CheckInResponse>().Any(item => item.State == EntityState.Deleted))
        {
            throw new InvalidOperationException(
                "A check-in response records what a client answered and cannot be deleted.");
        }

        // A submitted response is frozen, and so is everything beneath it. The database trigger is the
        // guarantee; this catches the mistake in the code path that made it, with a message that says
        // which response refused.
        foreach (var entry in ChangeTracker.Entries<CheckInResponse>()
                     .Where(item => item.State == EntityState.Modified))
        {
            if (entry.OriginalValues.GetValue<CheckInResponseStatus>(nameof(CheckInResponse.Status))
                == CheckInResponseStatus.Reviewed)
            {
                throw new InvalidOperationException("A reviewed check-in response is immutable.");
            }
        }

        if (ChangeTracker.Entries<CheckInAnswer>().Any(IsAnswerOfFrozenResponse) ||
            ChangeTracker.Entries<CheckInAnswerChoice>().Any(IsChoiceOfFrozenAnswer))
        {
            throw new InvalidOperationException(
                "A submitted check-in response is frozen; its answers can no longer be changed.");
        }

        foreach (var entry in ChangeTracker.Entries<RecipeVersion>().Where(item => item.State == EntityState.Modified))
        {
            if (entry.OriginalValues.GetValue<PublicationStatus>(nameof(RecipeVersion.Status)) == PublicationStatus.Published)
            {
                throw new InvalidOperationException("Published recipe versions are immutable.");
            }
        }

        foreach (var entry in ChangeTracker.Entries<MealPlanTemplateVersion>().Where(item => item.State == EntityState.Modified))
        {
            if (entry.OriginalValues.GetValue<PublicationStatus>(nameof(MealPlanTemplateVersion.Status)) == PublicationStatus.Published)
            {
                throw new InvalidOperationException("Published meal-plan versions are immutable.");
            }
        }

        foreach (var entry in ChangeTracker.Entries<DailyNutritionLog>().Where(item => item.State == EntityState.Modified))
        {
            if (entry.OriginalValues.GetValue<DailyNutritionLogStatus>(nameof(DailyNutritionLog.Status)) == DailyNutritionLogStatus.Completed)
            {
                throw new InvalidOperationException("Completed daily nutrition logs are immutable.");
            }
        }

        foreach (var entry in ChangeTracker.Entries<ProductOffer>().Where(item => item.State == EntityState.Modified))
        {
            if (entry.Property(item => item.PriceAmount).IsModified ||
                entry.Property(item => item.PriceCurrency).IsModified ||
                entry.Property(item => item.DurationCount).IsModified ||
                entry.Property(item => item.DurationUnit).IsModified ||
                entry.Property(item => item.BillingModel).IsModified)
            {
                throw new InvalidOperationException("Published offer terms are immutable; create a new offer instead.");
            }
        }

        foreach (var entry in ChangeTracker.Entries<ClientEnrollment>().Where(item => item.State == EntityState.Modified))
        {
            if (entry.Property(item => item.ProductId).IsModified ||
                entry.Property(item => item.OfferId).IsModified ||
                entry.Property(item => item.PriceAmount).IsModified ||
                entry.Property(item => item.PriceCurrency).IsModified ||
                entry.Property(item => item.StartDate).IsModified ||
                entry.Property(item => item.EndDateExclusive).IsModified)
            {
                throw new InvalidOperationException("Enrollment commercial snapshots are immutable.");
            }
        }

        var now = clock.UtcNow;
        var userId = currentUser.UserId;

        foreach (var entry in ChangeTracker.Entries<AuditableEntity>())
        {
            if (entry.State == EntityState.Added)
            {
                entry.Entity.StampCreation(now, userId);
            }
            else if (entry.State == EntityState.Modified)
            {
                entry.Entity.StampUpdate(now, userId);
            }
        }

        foreach (var entry in ChangeTracker.Entries<ITenantOwnedEntity>()
                     .Where(item => item.State is EntityState.Added or EntityState.Modified or EntityState.Deleted))
        {
            if (!tenantContext.HasTenant || entry.Entity.TenantId != tenantContext.TenantId)
            {
                throw new InvalidOperationException("A tenant-owned record cannot be written outside the active tenant scope.");
            }
        }
    }

    private void RejectAppendOnlyMutations<TEntity>(string message)
        where TEntity : class
    {
        if (ChangeTracker.Entries<TEntity>().Any(item => item.State is EntityState.Modified or EntityState.Deleted))
        {
            throw new InvalidOperationException(message);
        }
    }

    private bool IsAnswerOfFrozenResponse(EntityEntry<CheckInAnswer> entry)
    {
        if (entry.State is not (EntityState.Added or EntityState.Modified or EntityState.Deleted))
        {
            return false;
        }

        var responseId = entry.State == EntityState.Deleted
            ? entry.OriginalValues.GetValue<Guid>(nameof(CheckInAnswer.ResponseId))
            : entry.Entity.ResponseId;
        var response = ChangeTracker.Entries<CheckInResponse>()
            .FirstOrDefault(item => item.Entity.Id == responseId);

        // An untracked response is not a pass: it simply cannot be judged here, and the trigger is
        // what refuses it. A response being added is a new draft and always writable.
        return response is not null &&
            response.State != EntityState.Added &&
            response.OriginalValues.GetValue<CheckInResponseStatus>(nameof(CheckInResponse.Status))
                != CheckInResponseStatus.Draft;
    }

    private bool IsChoiceOfFrozenAnswer(EntityEntry<CheckInAnswerChoice> entry)
    {
        if (entry.State is not (EntityState.Added or EntityState.Modified or EntityState.Deleted))
        {
            return false;
        }

        var answerId = entry.State == EntityState.Deleted
            ? entry.OriginalValues.GetValue<Guid>(nameof(CheckInAnswerChoice.AnswerId))
            : entry.Entity.AnswerId;
        var answer = ChangeTracker.Entries<CheckInAnswer>()
            .FirstOrDefault(item => item.Entity.Id == answerId);
        return answer is not null && IsAnswerOfFrozenResponse(answer);
    }
}

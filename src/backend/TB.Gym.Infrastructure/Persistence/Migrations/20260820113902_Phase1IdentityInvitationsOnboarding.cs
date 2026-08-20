using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase1IdentityInvitationsOnboarding : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ClientProfiles_Users_UserId",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.EnsureSchema(
                name: "progress");

            migrationBuilder.EnsureSchema(
                name: "invitations");

            migrationBuilder.AddColumn<string>(
                name: "PreferredCulture",
                schema: "identity",
                table: "Users",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "en-LB");

            migrationBuilder.AddColumn<string>(
                name: "DefaultCulture",
                schema: "tenancy",
                table: "Tenants",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "en-LB");

            migrationBuilder.AddColumn<string>(
                name: "DefaultCurrencyCode",
                schema: "tenancy",
                table: "Tenants",
                type: "character(3)",
                fixedLength: true,
                maxLength: 3,
                nullable: false,
                defaultValue: "USD");

            migrationBuilder.AddColumn<string>(
                name: "TimeZoneId",
                schema: "tenancy",
                table: "Tenants",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "Asia/Beirut");

            migrationBuilder.AddColumn<string>(
                name: "WeekStartsOn",
                schema: "tenancy",
                table: "Tenants",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Monday");

            migrationBuilder.AddColumn<string>(
                name: "Allergies",
                schema: "clients",
                table: "ClientProfiles",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "AverageDailySteps",
                schema: "clients",
                table: "ClientProfiles",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CoachNotes",
                schema: "clients",
                table: "ClientProfiles",
                type: "character varying(8000)",
                maxLength: 8000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FoodAversions",
                schema: "clients",
                table: "ClientProfiles",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FoodPreferences",
                schema: "clients",
                table: "ClientProfiles",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Goals",
                schema: "clients",
                table: "ClientProfiles",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "HeightCentimeters",
                schema: "clients",
                table: "ClientProfiles",
                type: "numeric(6,2)",
                precision: 6,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "HeightEnteredUnit",
                schema: "clients",
                table: "ClientProfiles",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "HeightEnteredValue",
                schema: "clients",
                table: "ClientProfiles",
                type: "numeric(7,2)",
                precision: 7,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Medications",
                schema: "clients",
                table: "ClientProfiles",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "OnboardingCompletedAtUtc",
                schema: "clients",
                table: "ClientProfiles",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OnboardingStatus",
                schema: "clients",
                table: "ClientProfiles",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "NotStarted");

            migrationBuilder.AddColumn<string>(
                name: "PreviousInjuries",
                schema: "clients",
                table: "ClientProfiles",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TrainingBackground",
                schema: "clients",
                table: "ClientProfiles",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WorkType",
                schema: "clients",
                table: "ClientProfiles",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_ClientProfiles_TenantId_Id",
                schema: "clients",
                table: "ClientProfiles",
                columns: new[] { "TenantId", "Id" });

            migrationBuilder.CreateTable(
                name: "AccountEmailDeliveries",
                schema: "identity",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Recipient = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                    Purpose = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ProviderMessageId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    FailureCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AccountEmailDeliveries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AccountEmailDeliveries_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BodyweightObservations",
                schema: "progress",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    MeasurementDate = table.Column<DateOnly>(type: "date", nullable: false),
                    ValueKilograms = table.Column<decimal>(type: "numeric(7,3)", precision: 7, scale: 3, nullable: false),
                    EnteredValue = table.Column<decimal>(type: "numeric(8,3)", precision: 8, scale: 3, nullable: false),
                    EnteredUnit = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Source = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BodyweightObservations", x => x.Id);
                    table.CheckConstraint("CK_BodyweightObservations_ValueKilograms", "\"ValueKilograms\" >= 20 AND \"ValueKilograms\" <= 500");
                    table.ForeignKey(
                        name: "FK_BodyweightObservations_ClientProfiles_TenantId_ClientProfil~",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ClientInvitations",
                schema: "invitations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Email = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                    NormalizedEmail = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                    FirstName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    LastName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    PhoneNumber = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    BirthDate = table.Column<DateOnly>(type: "date", nullable: true),
                    TokenHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ExpiresAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    AcceptedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    AcceptedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    RevokedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    SendCount = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ClientInvitations", x => x.Id);
                    table.UniqueConstraint("AK_ClientInvitations_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_ClientInvitations_AcceptedState", "\"Status\" <> 'Accepted' OR (\"AcceptedByUserId\" IS NOT NULL AND \"AcceptedAtUtc\" IS NOT NULL)");
                    table.CheckConstraint("CK_ClientInvitations_SendCount", "\"SendCount\" >= 1");
                    table.CheckConstraint("CK_ClientInvitations_TokenHash", "char_length(\"TokenHash\") = 64");
                    table.ForeignKey(
                        name: "FK_ClientInvitations_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalSchema: "tenancy",
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ClientInvitations_Users_AcceptedByUserId",
                        column: x => x.AcceptedByUserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ClientProfileChanges",
                schema: "clients",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    Source = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ChangedFields = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ClientProfileChanges", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ClientProfileChanges_ClientProfiles_TenantId_ClientProfileId",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "InvitationDeliveries",
                schema: "invitations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    InvitationId = table.Column<Guid>(type: "uuid", nullable: false),
                    Recipient = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                    Channel = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    AttemptNumber = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ProviderMessageId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    FailureCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InvitationDeliveries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_InvitationDeliveries_ClientInvitations_TenantId_InvitationId",
                        columns: x => new { x.TenantId, x.InvitationId },
                        principalSchema: "invitations",
                        principalTable: "ClientInvitations",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Tenants_DefaultCurrencyCode",
                schema: "tenancy",
                table: "Tenants",
                sql: "\"DefaultCurrencyCode\" ~ '^[A-Z]{3}$'");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientProfiles_AverageDailySteps",
                schema: "clients",
                table: "ClientProfiles",
                sql: "\"AverageDailySteps\" IS NULL OR (\"AverageDailySteps\" >= 0 AND \"AverageDailySteps\" <= 100000)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientProfiles_CompletedOnboarding",
                schema: "clients",
                table: "ClientProfiles",
                sql: "\"OnboardingStatus\" <> 'Completed' OR (\"BirthDate\" IS NOT NULL AND \"HeightCentimeters\" IS NOT NULL AND \"Goals\" IS NOT NULL AND \"OnboardingCompletedAtUtc\" IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientProfiles_HeightCentimeters",
                schema: "clients",
                table: "ClientProfiles",
                sql: "\"HeightCentimeters\" IS NULL OR (\"HeightCentimeters\" >= 50 AND \"HeightCentimeters\" <= 300)");

            migrationBuilder.CreateIndex(
                name: "IX_AccountEmailDeliveries_UserId_CreatedAtUtc",
                schema: "identity",
                table: "AccountEmailDeliveries",
                columns: new[] { "UserId", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_BodyweightObservations_TenantId_ClientProfileId_Measurement~",
                schema: "progress",
                table: "BodyweightObservations",
                columns: new[] { "TenantId", "ClientProfileId", "MeasurementDate" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ClientInvitations_AcceptedByUserId",
                schema: "invitations",
                table: "ClientInvitations",
                column: "AcceptedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_ClientInvitations_TenantId_NormalizedEmail",
                schema: "invitations",
                table: "ClientInvitations",
                columns: new[] { "TenantId", "NormalizedEmail" },
                unique: true,
                filter: "\"Status\" = 'Pending'");

            migrationBuilder.CreateIndex(
                name: "IX_ClientInvitations_TokenHash",
                schema: "invitations",
                table: "ClientInvitations",
                column: "TokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ClientProfileChanges_TenantId_ClientProfileId_CreatedAtUtc",
                schema: "clients",
                table: "ClientProfileChanges",
                columns: new[] { "TenantId", "ClientProfileId", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_InvitationDeliveries_TenantId_InvitationId_AttemptNumber",
                schema: "invitations",
                table: "InvitationDeliveries",
                columns: new[] { "TenantId", "InvitationId", "AttemptNumber" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_ClientProfiles_Users_UserId",
                schema: "clients",
                table: "ClientProfiles",
                column: "UserId",
                principalSchema: "identity",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ClientProfiles_Users_UserId",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropTable(
                name: "AccountEmailDeliveries",
                schema: "identity");

            migrationBuilder.DropTable(
                name: "BodyweightObservations",
                schema: "progress");

            migrationBuilder.DropTable(
                name: "ClientProfileChanges",
                schema: "clients");

            migrationBuilder.DropTable(
                name: "InvitationDeliveries",
                schema: "invitations");

            migrationBuilder.DropTable(
                name: "ClientInvitations",
                schema: "invitations");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Tenants_DefaultCurrencyCode",
                schema: "tenancy",
                table: "Tenants");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_ClientProfiles_TenantId_Id",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientProfiles_AverageDailySteps",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientProfiles_CompletedOnboarding",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientProfiles_HeightCentimeters",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropColumn(
                name: "PreferredCulture",
                schema: "identity",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "DefaultCulture",
                schema: "tenancy",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "DefaultCurrencyCode",
                schema: "tenancy",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "TimeZoneId",
                schema: "tenancy",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "WeekStartsOn",
                schema: "tenancy",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "Allergies",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropColumn(
                name: "AverageDailySteps",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropColumn(
                name: "CoachNotes",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropColumn(
                name: "FoodAversions",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropColumn(
                name: "FoodPreferences",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropColumn(
                name: "Goals",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropColumn(
                name: "HeightCentimeters",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropColumn(
                name: "HeightEnteredUnit",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropColumn(
                name: "HeightEnteredValue",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropColumn(
                name: "Medications",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropColumn(
                name: "OnboardingCompletedAtUtc",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropColumn(
                name: "OnboardingStatus",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropColumn(
                name: "PreviousInjuries",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropColumn(
                name: "TrainingBackground",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropColumn(
                name: "WorkType",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.AddForeignKey(
                name: "FK_ClientProfiles_Users_UserId",
                schema: "clients",
                table: "ClientProfiles",
                column: "UserId",
                principalSchema: "identity",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }
    }
}

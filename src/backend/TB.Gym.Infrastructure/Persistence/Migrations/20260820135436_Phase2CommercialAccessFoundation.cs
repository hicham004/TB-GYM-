using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase2CommercialAccessFoundation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "subscriptions");

            migrationBuilder.EnsureSchema(
                name: "notifications");

            migrationBuilder.CreateTable(
                name: "ClientRelationshipEvents",
                schema: "clients",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    EventType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    OccurredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ClientRelationshipEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ClientRelationshipEvents_ClientProfiles_TenantId_ClientProf~",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CoachingProducts",
                schema: "subscriptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CoachingProducts", x => x.Id);
                    table.UniqueConstraint("AK_CoachingProducts_TenantId_Id", x => new { x.TenantId, x.Id });
                });

            migrationBuilder.CreateTable(
                name: "LegalDocumentVersions",
                schema: "identity",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    VersionLabel = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Culture = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Context = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ContentUri = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    ContentSha256 = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    ReviewStatus = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    PublishedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RetiredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LegalDocumentVersions", x => x.Id);
                    table.CheckConstraint("CK_LegalDocumentVersions_ContentHash", "\"ContentSha256\" ~ '^[0-9a-f]{64}$'");
                });

            migrationBuilder.CreateTable(
                name: "OutboxItems",
                schema: "notifications",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipientUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    AggregateId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(48)", maxLength: 48, nullable: false),
                    DeduplicationKey = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    PayloadJson = table.Column<string>(type: "jsonb", nullable: false),
                    ScheduledAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    TenantTimeZoneId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    AttemptCount = table.Column<int>(type: "integer", nullable: false),
                    DispatchedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
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
                    table.PrimaryKey("PK_OutboxItems", x => x.Id);
                    table.CheckConstraint("CK_NotificationOutboxItems_AttemptCount", "\"AttemptCount\" >= 0");
                    table.ForeignKey(
                        name: "FK_OutboxItems_Users_RecipientUserId",
                        column: x => x.RecipientUserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ProductOffers",
                schema: "subscriptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    Label = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    BillingModel = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    DurationCount = table.Column<int>(type: "integer", nullable: false),
                    DurationUnit = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    PriceAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    PriceCurrency = table.Column<string>(type: "character(3)", fixedLength: true, maxLength: 3, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProductOffers", x => x.Id);
                    table.UniqueConstraint("AK_ProductOffers_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_ProductOffers_Duration", "\"DurationCount\" > 0 AND \"DurationCount\" <= 3650");
                    table.CheckConstraint("CK_ProductOffers_PriceAmount", "\"PriceAmount\" >= 0");
                    table.CheckConstraint("CK_ProductOffers_PriceCurrency", "\"PriceCurrency\" ~ '^[A-Z]{3}$'");
                    table.ForeignKey(
                        name: "FK_ProductOffers_CoachingProducts_TenantId_ProductId",
                        columns: x => new { x.TenantId, x.ProductId },
                        principalSchema: "subscriptions",
                        principalTable: "CoachingProducts",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "LegalConsentAcceptances",
                schema: "identity",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    DocumentVersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Context = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: true),
                    ContextKey = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    AcceptedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LegalConsentAcceptances", x => x.Id);
                    table.CheckConstraint("CK_LegalConsentAcceptances_Context", "(\"Context\" = 'Workspace' AND \"TenantId\" IS NOT NULL) OR (\"Context\" = 'Platform' AND \"TenantId\" IS NULL)");
                    table.ForeignKey(
                        name: "FK_LegalConsentAcceptances_LegalDocumentVersions_DocumentVersi~",
                        column: x => x.DocumentVersionId,
                        principalSchema: "identity",
                        principalTable: "LegalDocumentVersions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_LegalConsentAcceptances_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalSchema: "tenancy",
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_LegalConsentAcceptances_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ClientEnrollments",
                schema: "subscriptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    ProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    OfferId = table.Column<Guid>(type: "uuid", nullable: false),
                    ProductNameSnapshot = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    OfferLabelSnapshot = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    PriceAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    PriceCurrency = table.Column<string>(type: "character(3)", fixedLength: true, maxLength: 3, nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    EndDateExclusive = table.Column<DateOnly>(type: "date", nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ActivatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    PausedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CancelledAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ExpiredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    StatusReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    AssignmentCommandId = table.Column<Guid>(type: "uuid", nullable: false),
                    RenewedFromEnrollmentId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ClientEnrollments", x => x.Id);
                    table.UniqueConstraint("AK_ClientEnrollments_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_ClientEnrollments_CancelledState", "\"Status\" <> 'Cancelled' OR \"CancelledAtUtc\" IS NOT NULL");
                    table.CheckConstraint("CK_ClientEnrollments_ExpiredState", "\"Status\" <> 'Expired' OR \"ExpiredAtUtc\" IS NOT NULL");
                    table.CheckConstraint("CK_ClientEnrollments_Period", "\"EndDateExclusive\" > \"StartDate\"");
                    table.CheckConstraint("CK_ClientEnrollments_PriceAmount", "\"PriceAmount\" >= 0");
                    table.CheckConstraint("CK_ClientEnrollments_PriceCurrency", "\"PriceCurrency\" ~ '^[A-Z]{3}$'");
                    table.ForeignKey(
                        name: "FK_ClientEnrollments_ClientProfiles_TenantId_ClientProfileId",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ClientEnrollments_CoachingProducts_TenantId_ProductId",
                        columns: x => new { x.TenantId, x.ProductId },
                        principalSchema: "subscriptions",
                        principalTable: "CoachingProducts",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ClientEnrollments_ProductOffers_TenantId_OfferId",
                        columns: x => new { x.TenantId, x.OfferId },
                        principalSchema: "subscriptions",
                        principalTable: "ProductOffers",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "OfferEntitlements",
                schema: "subscriptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OfferId = table.Column<Guid>(type: "uuid", nullable: false),
                    Feature = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    AllowsConcurrentCoverage = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OfferEntitlements", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OfferEntitlements_ProductOffers_TenantId_OfferId",
                        columns: x => new { x.TenantId, x.OfferId },
                        principalSchema: "subscriptions",
                        principalTable: "ProductOffers",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "EnrollmentEntitlements",
                schema: "subscriptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EnrollmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    EndDateExclusive = table.Column<DateOnly>(type: "date", nullable: false),
                    Feature = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    BlocksOverlap = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EnrollmentEntitlements", x => x.Id);
                    table.CheckConstraint("CK_EnrollmentEntitlements_Period", "\"EndDateExclusive\" > \"StartDate\"");
                    table.ForeignKey(
                        name: "FK_EnrollmentEntitlements_ClientEnrollments_TenantId_Enrollmen~",
                        columns: x => new { x.TenantId, x.EnrollmentId },
                        principalSchema: "subscriptions",
                        principalTable: "ClientEnrollments",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_EnrollmentEntitlements_ClientProfiles_TenantId_ClientProfil~",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PaymentRecords",
                schema: "subscriptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EnrollmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    CurrencyCode = table.Column<string>(type: "character(3)", fixedLength: true, maxLength: 3, nullable: false),
                    ReceivedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Method = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Reference = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    RecordedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    IdempotencyKey = table.Column<Guid>(type: "uuid", nullable: false),
                    Operation = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
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
                    table.PrimaryKey("PK_PaymentRecords", x => x.Id);
                    table.CheckConstraint("CK_PaymentRecords_Amount", "\"Amount\" > 0");
                    table.CheckConstraint("CK_PaymentRecords_CurrencyCode", "\"CurrencyCode\" ~ '^[A-Z]{3}$'");
                    table.ForeignKey(
                        name: "FK_PaymentRecords_ClientEnrollments_TenantId_EnrollmentId",
                        columns: x => new { x.TenantId, x.EnrollmentId },
                        principalSchema: "subscriptions",
                        principalTable: "ClientEnrollments",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PaymentRecords_Users_RecordedByUserId",
                        column: x => x.RecordedByUserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ClientEnrollments_TenantId_AssignmentCommandId",
                schema: "subscriptions",
                table: "ClientEnrollments",
                columns: new[] { "TenantId", "AssignmentCommandId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ClientEnrollments_TenantId_ClientProfileId_StartDate",
                schema: "subscriptions",
                table: "ClientEnrollments",
                columns: new[] { "TenantId", "ClientProfileId", "StartDate" });

            migrationBuilder.CreateIndex(
                name: "IX_ClientEnrollments_TenantId_OfferId",
                schema: "subscriptions",
                table: "ClientEnrollments",
                columns: new[] { "TenantId", "OfferId" });

            migrationBuilder.CreateIndex(
                name: "IX_ClientEnrollments_TenantId_ProductId",
                schema: "subscriptions",
                table: "ClientEnrollments",
                columns: new[] { "TenantId", "ProductId" });

            migrationBuilder.CreateIndex(
                name: "IX_ClientEnrollments_TenantId_RenewedFromEnrollmentId",
                schema: "subscriptions",
                table: "ClientEnrollments",
                columns: new[] { "TenantId", "RenewedFromEnrollmentId" });

            migrationBuilder.CreateIndex(
                name: "IX_ClientRelationshipEvents_TenantId_ClientProfileId_OccurredA~",
                schema: "clients",
                table: "ClientRelationshipEvents",
                columns: new[] { "TenantId", "ClientProfileId", "OccurredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_CoachingProducts_TenantId_Name",
                schema: "subscriptions",
                table: "CoachingProducts",
                columns: new[] { "TenantId", "Name" });

            migrationBuilder.CreateIndex(
                name: "IX_EnrollmentEntitlements_TenantId_ClientProfileId_Feature_Sta~",
                schema: "subscriptions",
                table: "EnrollmentEntitlements",
                columns: new[] { "TenantId", "ClientProfileId", "Feature", "StartDate", "EndDateExclusive" });

            migrationBuilder.CreateIndex(
                name: "IX_EnrollmentEntitlements_TenantId_EnrollmentId_Feature",
                schema: "subscriptions",
                table: "EnrollmentEntitlements",
                columns: new[] { "TenantId", "EnrollmentId", "Feature" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_LegalConsentAcceptances_DocumentVersionId",
                schema: "identity",
                table: "LegalConsentAcceptances",
                column: "DocumentVersionId");

            migrationBuilder.CreateIndex(
                name: "IX_LegalConsentAcceptances_TenantId_UserId_AcceptedAtUtc",
                schema: "identity",
                table: "LegalConsentAcceptances",
                columns: new[] { "TenantId", "UserId", "AcceptedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_LegalConsentAcceptances_UserId_DocumentVersionId_ContextKey",
                schema: "identity",
                table: "LegalConsentAcceptances",
                columns: new[] { "UserId", "DocumentVersionId", "ContextKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_LegalDocumentVersions_Kind_Culture_PublishedAtUtc_RetiredAt~",
                schema: "identity",
                table: "LegalDocumentVersions",
                columns: new[] { "Kind", "Culture", "PublishedAtUtc", "RetiredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_LegalDocumentVersions_Kind_VersionLabel_Culture_Context",
                schema: "identity",
                table: "LegalDocumentVersions",
                columns: new[] { "Kind", "VersionLabel", "Culture", "Context" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OfferEntitlements_TenantId_OfferId_Feature",
                schema: "subscriptions",
                table: "OfferEntitlements",
                columns: new[] { "TenantId", "OfferId", "Feature" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OutboxItems_RecipientUserId",
                schema: "notifications",
                table: "OutboxItems",
                column: "RecipientUserId");

            migrationBuilder.CreateIndex(
                name: "IX_OutboxItems_Status_ScheduledAtUtc",
                schema: "notifications",
                table: "OutboxItems",
                columns: new[] { "Status", "ScheduledAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_OutboxItems_TenantId_AggregateId_Kind",
                schema: "notifications",
                table: "OutboxItems",
                columns: new[] { "TenantId", "AggregateId", "Kind" });

            migrationBuilder.CreateIndex(
                name: "IX_OutboxItems_TenantId_DeduplicationKey",
                schema: "notifications",
                table: "OutboxItems",
                columns: new[] { "TenantId", "DeduplicationKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PaymentRecords_RecordedByUserId",
                schema: "subscriptions",
                table: "PaymentRecords",
                column: "RecordedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentRecords_TenantId_EnrollmentId_ReceivedAtUtc",
                schema: "subscriptions",
                table: "PaymentRecords",
                columns: new[] { "TenantId", "EnrollmentId", "ReceivedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_PaymentRecords_TenantId_IdempotencyKey",
                schema: "subscriptions",
                table: "PaymentRecords",
                columns: new[] { "TenantId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProductOffers_TenantId_ProductId_IsActive",
                schema: "subscriptions",
                table: "ProductOffers",
                columns: new[] { "TenantId", "ProductId", "IsActive" });

            migrationBuilder.Sql(
                """
                CREATE EXTENSION IF NOT EXISTS btree_gist;

                ALTER TABLE subscriptions."EnrollmentEntitlements"
                ADD CONSTRAINT "EX_EnrollmentEntitlements_NoConflictingCoverage"
                EXCLUDE USING gist
                (
                    "TenantId" WITH =,
                    "ClientProfileId" WITH =,
                    "Feature" WITH =,
                    (daterange("StartDate", "EndDateExclusive", '[)')) WITH &&
                )
                WHERE ("BlocksOverlap");

                CREATE OR REPLACE FUNCTION platform.reject_append_only_mutation()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
                END;
                $function$;

                CREATE TRIGGER "TR_PaymentRecords_AppendOnly"
                BEFORE UPDATE OR DELETE ON subscriptions."PaymentRecords"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                CREATE TRIGGER "TR_ClientRelationshipEvents_AppendOnly"
                BEFORE UPDATE OR DELETE ON clients."ClientRelationshipEvents"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                CREATE TRIGGER "TR_LegalConsentAcceptances_AppendOnly"
                BEFORE UPDATE OR DELETE ON identity."LegalConsentAcceptances"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                CREATE TRIGGER "TR_OfferEntitlements_AppendOnly"
                BEFORE UPDATE OR DELETE ON subscriptions."OfferEntitlements"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                CREATE OR REPLACE FUNCTION subscriptions.protect_offer_terms()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF NEW."ProductId" IS DISTINCT FROM OLD."ProductId"
                       OR NEW."Label" IS DISTINCT FROM OLD."Label"
                       OR NEW."BillingModel" IS DISTINCT FROM OLD."BillingModel"
                       OR NEW."DurationCount" IS DISTINCT FROM OLD."DurationCount"
                       OR NEW."DurationUnit" IS DISTINCT FROM OLD."DurationUnit"
                       OR NEW."PriceAmount" IS DISTINCT FROM OLD."PriceAmount"
                       OR NEW."PriceCurrency" IS DISTINCT FROM OLD."PriceCurrency"
                       OR NEW."TenantId" IS DISTINCT FROM OLD."TenantId" THEN
                        RAISE EXCEPTION 'Published offer terms are immutable; create a new offer' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_ProductOffers_ProtectTerms"
                BEFORE UPDATE ON subscriptions."ProductOffers"
                FOR EACH ROW EXECUTE FUNCTION subscriptions.protect_offer_terms();

                CREATE OR REPLACE FUNCTION subscriptions.protect_enrollment_snapshot()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF NEW."ClientProfileId" IS DISTINCT FROM OLD."ClientProfileId"
                       OR NEW."ProductId" IS DISTINCT FROM OLD."ProductId"
                       OR NEW."OfferId" IS DISTINCT FROM OLD."OfferId"
                       OR NEW."ProductNameSnapshot" IS DISTINCT FROM OLD."ProductNameSnapshot"
                       OR NEW."OfferLabelSnapshot" IS DISTINCT FROM OLD."OfferLabelSnapshot"
                       OR NEW."PriceAmount" IS DISTINCT FROM OLD."PriceAmount"
                       OR NEW."PriceCurrency" IS DISTINCT FROM OLD."PriceCurrency"
                       OR NEW."StartDate" IS DISTINCT FROM OLD."StartDate"
                       OR NEW."EndDateExclusive" IS DISTINCT FROM OLD."EndDateExclusive"
                       OR NEW."AssignmentCommandId" IS DISTINCT FROM OLD."AssignmentCommandId"
                       OR NEW."RenewedFromEnrollmentId" IS DISTINCT FROM OLD."RenewedFromEnrollmentId"
                       OR NEW."TenantId" IS DISTINCT FROM OLD."TenantId" THEN
                        RAISE EXCEPTION 'Enrollment commercial snapshots are immutable' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_ClientEnrollments_ProtectSnapshot"
                BEFORE UPDATE ON subscriptions."ClientEnrollments"
                FOR EACH ROW EXECUTE FUNCTION subscriptions.protect_enrollment_snapshot();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ClientRelationshipEvents",
                schema: "clients");

            migrationBuilder.DropTable(
                name: "EnrollmentEntitlements",
                schema: "subscriptions");

            migrationBuilder.DropTable(
                name: "LegalConsentAcceptances",
                schema: "identity");

            migrationBuilder.DropTable(
                name: "OfferEntitlements",
                schema: "subscriptions");

            migrationBuilder.DropTable(
                name: "OutboxItems",
                schema: "notifications");

            migrationBuilder.DropTable(
                name: "PaymentRecords",
                schema: "subscriptions");

            migrationBuilder.DropTable(
                name: "LegalDocumentVersions",
                schema: "identity");

            migrationBuilder.DropTable(
                name: "ClientEnrollments",
                schema: "subscriptions");

            migrationBuilder.DropTable(
                name: "ProductOffers",
                schema: "subscriptions");

            migrationBuilder.DropTable(
                name: "CoachingProducts",
                schema: "subscriptions");

            migrationBuilder.Sql(
                """
                DROP FUNCTION IF EXISTS subscriptions.protect_enrollment_snapshot();
                DROP FUNCTION IF EXISTS subscriptions.protect_offer_terms();
                DROP FUNCTION IF EXISTS platform.reject_append_only_mutation();
                """);
        }
    }
}

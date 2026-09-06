using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase6B3CTokenlessActionMail : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Order matters here in a way the scaffolder cannot know. Everything is created and
            // every legacy fact is copied forward *before* anything is dropped, because
            // ClientInvitations.TokenHash is the only source for the token record this phase
            // introduces, and a scaffolded drop-first migration would delete it and then look for it.
            migrationBuilder.AddColumn<int>(
                name: "LogicalSendGeneration",
                schema: "invitations",
                table: "ClientInvitations",
                type: "integer",
                nullable: false,
                defaultValue: 1);
            // Every invitation ever sent had exactly as many deliberate sends as its SendCount, so
            // that count *is* its current generation. Backfilling any other value would either
            // orphan the live token or claim resends that never happened.
            migrationBuilder.Sql("""
                UPDATE invitations."ClientInvitations"
                SET "LogicalSendGeneration" = GREATEST("SendCount", 1)
                """);
            migrationBuilder.CreateTable(
                name: "ActionMailRequests",
                schema: "identity",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SubjectUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    SubjectSecurityStampHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: true),
                    ActionKind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    SchemaVersion = table.Column<int>(type: "integer", nullable: false),
                    RequestSource = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    RequestedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    RequestedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    AttemptCount = table.Column<int>(type: "integer", nullable: false),
                    NextAttemptAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ClaimToken = table.Column<Guid>(type: "uuid", nullable: true),
                    ClaimExpiresAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    MaterializedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CompletedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DeadLetteredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    FailureCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    TransportAdapter = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    ProviderMessageId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ProviderAcceptedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ActionMailRequests", x => x.Id);
                    table.UniqueConstraint("AK_ActionMailRequests_Id_ActionKind", x => new { x.Id, x.ActionKind });
                    table.CheckConstraint("CK_AccountActionMailRequests_CapturedHasNoProvider", "\"TransportAdapter\" <> 'captured' OR (\"ProviderMessageId\" IS NULL AND \"ProviderAcceptedAtUtc\" IS NULL)");
                    table.CheckConstraint("CK_AccountActionMailRequests_Claim", "(\"ClaimToken\" IS NULL) = (\"ClaimExpiresAtUtc\" IS NULL) AND ((\"Status\" = 'Processing') = (\"ClaimToken\" IS NOT NULL))");
                    table.CheckConstraint("CK_AccountActionMailRequests_Completion", "(\"Status\" IN ('Materialized', 'Suppressed', 'DeadLettered')) = (\"CompletedAtUtc\" IS NOT NULL)");
                    table.CheckConstraint("CK_AccountActionMailRequests_Counters", "\"AttemptCount\" >= 0 AND \"SchemaVersion\" >= 1");
                    table.CheckConstraint("CK_AccountActionMailRequests_DeadLettered", "(\"Status\" = 'DeadLettered') = (\"DeadLetteredAtUtc\" IS NOT NULL)");
                    table.CheckConstraint("CK_AccountActionMailRequests_Failure", "(\"Status\" = 'Materialized' AND \"FailureCode\" IS NULL) OR (\"Status\" IN ('Suppressed', 'DeadLettered') AND \"FailureCode\" IS NOT NULL) OR \"Status\" IN ('Pending', 'Processing')");
                    table.CheckConstraint("CK_AccountActionMailRequests_Materialized", "(\"Status\" = 'Materialized') = (\"MaterializedAtUtc\" IS NOT NULL)");
                    table.CheckConstraint("CK_AccountActionMailRequests_NextAttempt", "\"NextAttemptAtUtc\" >= \"RequestedAtUtc\"");
                    table.CheckConstraint("CK_AccountActionMailRequests_ProviderEvidence", "((\"ProviderMessageId\" IS NULL) = (\"ProviderAcceptedAtUtc\" IS NULL)) AND (\"ProviderMessageId\" IS NULL OR (\"Status\" = 'Materialized' AND \"TransportAdapter\" IN ('resend')))");
                    table.CheckConstraint("CK_AccountActionMailRequests_Subject", "((\"SubjectUserId\" IS NULL) = (\"SubjectSecurityStampHash\" IS NULL)) AND (\"SubjectSecurityStampHash\" IS NULL OR \"SubjectSecurityStampHash\" ~ '^[0-9a-f]{64}$')");
                    table.CheckConstraint("CK_AccountActionMailRequests_Transport", "\"TransportAdapter\" IS NULL OR \"Status\" = 'Materialized'");
                    table.CheckConstraint("CK_AccountActionMailRequests_Vocabulary", "\"ActionKind\" IN ('ConfirmEmail', 'ResetPassword') AND \"Status\" IN ('Pending', 'Processing', 'Materialized', 'Suppressed', 'DeadLettered')");
                    table.ForeignKey(
                        name: "FK_ActionMailRequests_Users_RequestedByUserId",
                        column: x => x.RequestedByUserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ActionMailRequests_Users_SubjectUserId",
                        column: x => x.SubjectUserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });
            migrationBuilder.CreateTable(
                name: "ActionMailRequests",
                schema: "invitations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    InvitationId = table.Column<Guid>(type: "uuid", nullable: false),
                    LogicalSendGeneration = table.Column<int>(type: "integer", nullable: false),
                    SchemaVersion = table.Column<int>(type: "integer", nullable: false),
                    IdempotencyKey = table.Column<Guid>(type: "uuid", nullable: false),
                    PayloadFingerprint = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestSource = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    RequestedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    RequestedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    AttemptCount = table.Column<int>(type: "integer", nullable: false),
                    NextAttemptAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ClaimToken = table.Column<Guid>(type: "uuid", nullable: true),
                    ClaimExpiresAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    MaterializedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CompletedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DeadLetteredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    FailureCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    TransportAdapter = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    ProviderMessageId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ProviderAcceptedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ActionMailRequests1", x => x.Id);
                    table.UniqueConstraint("AK_ActionMailRequests_TenantId_Id_InvitationId_LogicalSendGene~", x => new { x.TenantId, x.Id, x.InvitationId, x.LogicalSendGeneration });
                    table.UniqueConstraint("AK_ActionMailRequests_TenantId_Id_LogicalSendGeneration", x => new { x.TenantId, x.Id, x.LogicalSendGeneration });
                    table.CheckConstraint("CK_InvitationActionMailRequests_CapturedHasNoProvider", "\"TransportAdapter\" <> 'captured' OR (\"ProviderMessageId\" IS NULL AND \"ProviderAcceptedAtUtc\" IS NULL)");
                    table.CheckConstraint("CK_InvitationActionMailRequests_Claim", "(\"ClaimToken\" IS NULL) = (\"ClaimExpiresAtUtc\" IS NULL) AND ((\"Status\" = 'Processing') = (\"ClaimToken\" IS NOT NULL))");
                    table.CheckConstraint("CK_InvitationActionMailRequests_Completion", "(\"Status\" IN ('Materialized', 'Suppressed', 'DeadLettered')) = (\"CompletedAtUtc\" IS NOT NULL)");
                    table.CheckConstraint("CK_InvitationActionMailRequests_Counters", "\"AttemptCount\" >= 0 AND \"SchemaVersion\" >= 1 AND \"LogicalSendGeneration\" >= 1");
                    table.CheckConstraint("CK_InvitationActionMailRequests_DeadLettered", "(\"Status\" = 'DeadLettered') = (\"DeadLetteredAtUtc\" IS NOT NULL)");
                    table.CheckConstraint("CK_InvitationActionMailRequests_Failure", "(\"Status\" = 'Materialized' AND \"FailureCode\" IS NULL) OR (\"Status\" IN ('Suppressed', 'DeadLettered') AND \"FailureCode\" IS NOT NULL) OR \"Status\" IN ('Pending', 'Processing')");
                    table.CheckConstraint("CK_InvitationActionMailRequests_Materialized", "(\"Status\" = 'Materialized') = (\"MaterializedAtUtc\" IS NOT NULL)");
                    table.CheckConstraint("CK_InvitationActionMailRequests_NextAttempt", "\"NextAttemptAtUtc\" >= \"RequestedAtUtc\"");
                    table.CheckConstraint("CK_InvitationActionMailRequests_ProviderEvidence", "((\"ProviderMessageId\" IS NULL) = (\"ProviderAcceptedAtUtc\" IS NULL)) AND (\"ProviderMessageId\" IS NULL OR (\"Status\" = 'Materialized' AND \"TransportAdapter\" IN ('resend')))");
                    table.CheckConstraint("CK_InvitationActionMailRequests_Transport", "\"TransportAdapter\" IS NULL OR \"Status\" = 'Materialized'");
                    table.CheckConstraint("CK_InvitationActionMailRequests_Vocabulary", "\"Status\" IN ('Pending', 'Processing', 'Materialized', 'Suppressed', 'DeadLettered') AND \"PayloadFingerprint\" ~ '^[0-9a-f]{64}$'");
                    table.ForeignKey(
                        name: "FK_ActionMailRequests_ClientInvitations_TenantId_InvitationId",
                        columns: x => new { x.TenantId, x.InvitationId },
                        principalSchema: "invitations",
                        principalTable: "ClientInvitations",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ActionMailRequests_Users_RequestedByUserId",
                        column: x => x.RequestedByUserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });
            migrationBuilder.CreateTable(
                name: "ActionMailAttempts",
                schema: "identity",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActionKind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    AttemptNumber = table.Column<int>(type: "integer", nullable: false),
                    ClaimToken = table.Column<Guid>(type: "uuid", nullable: false),
                    ProviderIdempotencyKey = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    StartedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    TokenMintedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CompletedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Outcome = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    FailureCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    ProviderMessageId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ActionMailAttempts", x => x.Id);
                    table.CheckConstraint("CK_AccountActionMailAttempts_AttemptNumber", "\"AttemptNumber\" >= 1");
                    table.CheckConstraint("CK_AccountActionMailAttempts_Completion", "(\"Outcome\" = 'Started') = (\"CompletedAtUtc\" IS NULL)");
                    table.CheckConstraint("CK_AccountActionMailAttempts_ProviderEvidence", "\"ProviderMessageId\" IS NULL OR \"Outcome\" = 'Succeeded'");
                    table.CheckConstraint("CK_AccountActionMailAttempts_ProviderKeyShape", "\"ProviderIdempotencyKey\" = 'account-action:' || replace(\"RequestId\"::text, '-', '') || ':a' || \"AttemptNumber\"::text || ':v1:' || right(\"ProviderIdempotencyKey\", 32) AND right(\"ProviderIdempotencyKey\", 32) ~ '^[0-9a-f]{32}$'");
                    table.CheckConstraint("CK_AccountActionMailAttempts_Success", "(\"Outcome\" IN ('Started', 'Succeeded')) = (\"FailureCode\" IS NULL)");
                    table.CheckConstraint("CK_AccountActionMailAttempts_TokenMinted", "\"TokenMintedAtUtc\" IS NULL OR \"TokenMintedAtUtc\" >= \"StartedAtUtc\"");
                    table.CheckConstraint("CK_AccountActionMailAttempts_Vocabulary", "\"ActionKind\" IN ('ConfirmEmail', 'ResetPassword') AND \"Outcome\" IN ('Started', 'Succeeded', 'TransientFailure', 'PermanentFailure', 'Abandoned', 'Suppressed')");
                    table.ForeignKey(
                        name: "FK_ActionMailAttempts_ActionMailRequests_RequestId_ActionKind",
                        columns: x => new { x.RequestId, x.ActionKind },
                        principalSchema: "identity",
                        principalTable: "ActionMailRequests",
                        principalColumns: new[] { "Id", "ActionKind" },
                        onDelete: ReferentialAction.Restrict);
                });
            migrationBuilder.CreateTable(
                name: "ActionMailAttempts",
                schema: "invitations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestId = table.Column<Guid>(type: "uuid", nullable: false),
                    InvitationId = table.Column<Guid>(type: "uuid", nullable: false),
                    LogicalSendGeneration = table.Column<int>(type: "integer", nullable: false),
                    AttemptNumber = table.Column<int>(type: "integer", nullable: false),
                    ClaimToken = table.Column<Guid>(type: "uuid", nullable: false),
                    ProviderIdempotencyKey = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    StartedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    TokenMintedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CompletedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Outcome = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    FailureCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    ProviderMessageId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ActionMailAttempts1", x => x.Id);
                    table.UniqueConstraint("AK_ActionMailAttempts_TenantId_Id_RequestId_LogicalSendGenerat~", x => new { x.TenantId, x.Id, x.RequestId, x.LogicalSendGeneration, x.AttemptNumber });
                    table.CheckConstraint("CK_InvitationActionMailAttempts_AttemptNumber", "\"AttemptNumber\" >= 1 AND \"LogicalSendGeneration\" >= 1");
                    table.CheckConstraint("CK_InvitationActionMailAttempts_Completion", "(\"Outcome\" = 'Started') = (\"CompletedAtUtc\" IS NULL)");
                    table.CheckConstraint("CK_InvitationActionMailAttempts_ProviderEvidence", "\"ProviderMessageId\" IS NULL OR \"Outcome\" = 'Succeeded'");
                    table.CheckConstraint("CK_InvitationActionMailAttempts_ProviderKeyShape", "\"ProviderIdempotencyKey\" = 'invitation-action:' || replace(\"RequestId\"::text, '-', '') || ':a' || \"AttemptNumber\"::text || ':v1:' || right(\"ProviderIdempotencyKey\", 32) AND right(\"ProviderIdempotencyKey\", 32) ~ '^[0-9a-f]{32}$'");
                    table.CheckConstraint("CK_InvitationActionMailAttempts_Success", "(\"Outcome\" IN ('Started', 'Succeeded')) = (\"FailureCode\" IS NULL)");
                    table.CheckConstraint("CK_InvitationActionMailAttempts_TokenMinted", "\"TokenMintedAtUtc\" IS NULL OR \"TokenMintedAtUtc\" >= \"StartedAtUtc\"");
                    table.CheckConstraint("CK_InvitationActionMailAttempts_Vocabulary", "\"Outcome\" IN ('Started', 'Succeeded', 'TransientFailure', 'PermanentFailure', 'Abandoned', 'Suppressed')");
                    table.ForeignKey(
                        name: "FK_ActionMailAttempts_ActionMailRequests_TenantId_RequestId_Lo~",
                        columns: x => new { x.TenantId, x.RequestId, x.LogicalSendGeneration },
                        principalSchema: "invitations",
                        principalTable: "ActionMailRequests",
                        principalColumns: new[] { "TenantId", "Id", "LogicalSendGeneration" },
                        onDelete: ReferentialAction.Restrict);
                });
            migrationBuilder.CreateTable(
                name: "TokenIssues",
                schema: "invitations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    InvitationId = table.Column<Guid>(type: "uuid", nullable: false),
                    LogicalSendGeneration = table.Column<int>(type: "integer", nullable: false),
                    ActionMailRequestId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActionMailAttemptId = table.Column<Guid>(type: "uuid", nullable: false),
                    AttemptNumber = table.Column<int>(type: "integer", nullable: false),
                    TokenHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    IssuedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ExpiresAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    RevokedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RevocationReason = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    RedeemedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RedeemedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TokenIssues", x => x.Id);
                    table.CheckConstraint("CK_InvitationTokenIssues_Expiry", "\"ExpiresAtUtc\" > \"IssuedAtUtc\"");
                    table.CheckConstraint("CK_InvitationTokenIssues_Redemption", "(\"RedeemedAtUtc\" IS NULL) = (\"RedeemedByUserId\" IS NULL)");
                    table.CheckConstraint("CK_InvitationTokenIssues_Revocation", "(\"RevokedAtUtc\" IS NULL) = (\"RevocationReason\" IS NULL)");
                    table.CheckConstraint("CK_InvitationTokenIssues_Shape", "\"TokenHash\" ~ '^[0-9a-f]{64}$' AND \"LogicalSendGeneration\" >= 1 AND \"AttemptNumber\" >= 1");
                    table.CheckConstraint("CK_InvitationTokenIssues_SingleTerminalFact", "\"RevokedAtUtc\" IS NULL OR \"RedeemedAtUtc\" IS NULL");
                    table.ForeignKey(
                        name: "FK_TokenIssues_ActionMailAttempts_TenantId_ActionMailAttemptId~",
                        columns: x => new { x.TenantId, x.ActionMailAttemptId, x.ActionMailRequestId, x.LogicalSendGeneration, x.AttemptNumber },
                        principalSchema: "invitations",
                        principalTable: "ActionMailAttempts",
                        principalColumns: new[] { "TenantId", "Id", "RequestId", "LogicalSendGeneration", "AttemptNumber" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TokenIssues_ActionMailRequests_TenantId_ActionMailRequestId~",
                        columns: x => new { x.TenantId, x.ActionMailRequestId, x.InvitationId, x.LogicalSendGeneration },
                        principalSchema: "invitations",
                        principalTable: "ActionMailRequests",
                        principalColumns: new[] { "TenantId", "Id", "InvitationId", "LogicalSendGeneration" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TokenIssues_ClientInvitations_TenantId_InvitationId",
                        columns: x => new { x.TenantId, x.InvitationId },
                        principalSchema: "invitations",
                        principalTable: "ClientInvitations",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TokenIssues_Users_RedeemedByUserId",
                        column: x => x.RedeemedByUserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });
            migrationBuilder.CreateIndex(
                name: "IX_AccountActionMailAttempts_ProviderIdempotencyKey",
                schema: "identity",
                table: "ActionMailAttempts",
                column: "ProviderIdempotencyKey",
                unique: true);
            migrationBuilder.CreateIndex(
                name: "IX_AccountActionMailAttempts_RequestId_AttemptNumber",
                schema: "identity",
                table: "ActionMailAttempts",
                columns: new[] { "RequestId", "AttemptNumber" },
                unique: true);
            migrationBuilder.CreateIndex(
                name: "IX_AccountActionMailAttempts_RequestId_ClaimToken",
                schema: "identity",
                table: "ActionMailAttempts",
                columns: new[] { "RequestId", "ClaimToken" },
                unique: true);
            migrationBuilder.CreateIndex(
                name: "IX_ActionMailAttempts_RequestId_ActionKind",
                schema: "identity",
                table: "ActionMailAttempts",
                columns: new[] { "RequestId", "ActionKind" });
            migrationBuilder.CreateIndex(
                name: "IX_ActionMailAttempts_TenantId_RequestId_LogicalSendGeneration",
                schema: "invitations",
                table: "ActionMailAttempts",
                columns: new[] { "TenantId", "RequestId", "LogicalSendGeneration" });
            migrationBuilder.CreateIndex(
                name: "IX_InvitationActionMailAttempts_ProviderIdempotencyKey",
                schema: "invitations",
                table: "ActionMailAttempts",
                column: "ProviderIdempotencyKey",
                unique: true);
            migrationBuilder.CreateIndex(
                name: "IX_InvitationActionMailAttempts_TenantId_RequestId_AttemptNumber",
                schema: "invitations",
                table: "ActionMailAttempts",
                columns: new[] { "TenantId", "RequestId", "AttemptNumber" },
                unique: true);
            migrationBuilder.CreateIndex(
                name: "IX_InvitationActionMailAttempts_TenantId_RequestId_ClaimToken",
                schema: "invitations",
                table: "ActionMailAttempts",
                columns: new[] { "TenantId", "RequestId", "ClaimToken" },
                unique: true);
            migrationBuilder.CreateIndex(
                name: "IX_AccountActionMailRequests_Status_ClaimExpiresAtUtc",
                schema: "identity",
                table: "ActionMailRequests",
                columns: new[] { "Status", "ClaimExpiresAtUtc" });
            migrationBuilder.CreateIndex(
                name: "IX_AccountActionMailRequests_Status_NextAttemptAtUtc_Id",
                schema: "identity",
                table: "ActionMailRequests",
                columns: new[] { "Status", "NextAttemptAtUtc", "Id" });
            migrationBuilder.CreateIndex(
                name: "IX_AccountActionMailRequests_Subject_ActionKind_RequestedAtUtc",
                schema: "identity",
                table: "ActionMailRequests",
                columns: new[] { "SubjectUserId", "ActionKind", "RequestedAtUtc" });
            migrationBuilder.CreateIndex(
                name: "IX_ActionMailRequests_RequestedByUserId",
                schema: "identity",
                table: "ActionMailRequests",
                column: "RequestedByUserId");
            migrationBuilder.CreateIndex(
                name: "IX_ActionMailRequests_RequestedByUserId1",
                schema: "invitations",
                table: "ActionMailRequests",
                column: "RequestedByUserId");
            migrationBuilder.CreateIndex(
                name: "IX_InvitationActionMailRequests_Status_ClaimExpiresAtUtc",
                schema: "invitations",
                table: "ActionMailRequests",
                columns: new[] { "Status", "ClaimExpiresAtUtc" });
            migrationBuilder.CreateIndex(
                name: "IX_InvitationActionMailRequests_Status_NextAttemptAtUtc_Id",
                schema: "invitations",
                table: "ActionMailRequests",
                columns: new[] { "Status", "NextAttemptAtUtc", "Id" });
            migrationBuilder.CreateIndex(
                name: "IX_InvitationActionMailRequests_TenantId_IdempotencyKey",
                schema: "invitations",
                table: "ActionMailRequests",
                columns: new[] { "TenantId", "IdempotencyKey" },
                unique: true);
            migrationBuilder.CreateIndex(
                name: "IX_InvitationActionMailRequests_TenantId_InvitationId_Generation",
                schema: "invitations",
                table: "ActionMailRequests",
                columns: new[] { "TenantId", "InvitationId", "LogicalSendGeneration" },
                unique: true);
            migrationBuilder.CreateIndex(
                name: "IX_InvitationTokenIssues_TenantId_ActionMailRequestId",
                schema: "invitations",
                table: "TokenIssues",
                columns: new[] { "TenantId", "ActionMailRequestId" });
            migrationBuilder.CreateIndex(
                name: "IX_InvitationTokenIssues_TenantId_InvitationId_Generation",
                schema: "invitations",
                table: "TokenIssues",
                columns: new[] { "TenantId", "InvitationId", "LogicalSendGeneration" });
            migrationBuilder.CreateIndex(
                name: "IX_InvitationTokenIssues_TokenHash",
                schema: "invitations",
                table: "TokenIssues",
                column: "TokenHash",
                unique: true);
            migrationBuilder.CreateIndex(
                name: "IX_TokenIssues_RedeemedByUserId",
                schema: "invitations",
                table: "TokenIssues",
                column: "RedeemedByUserId");
            migrationBuilder.CreateIndex(
                name: "IX_TokenIssues_TenantId_ActionMailAttemptId_ActionMailRequestI~",
                schema: "invitations",
                table: "TokenIssues",
                columns: new[] { "TenantId", "ActionMailAttemptId", "ActionMailRequestId", "LogicalSendGeneration", "AttemptNumber" });
            migrationBuilder.CreateIndex(
                name: "IX_TokenIssues_TenantId_ActionMailRequestId_InvitationId_Logic~",
                schema: "invitations",
                table: "TokenIssues",
                columns: new[] { "TenantId", "ActionMailRequestId", "InvitationId", "LogicalSendGeneration" });
            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientInvitations_LogicalSendGeneration",
                schema: "invitations",
                table: "ClientInvitations",
                sql: "\"LogicalSendGeneration\" >= 1 AND \"LogicalSendGeneration\" <= \"SendCount\"");
            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientInvitations_NormalizedEmail",
                schema: "invitations",
                table: "ClientInvitations",
                sql: "\"NormalizedEmail\" = upper(\"Email\")");

            BackfillLegacyInvitationHistory(migrationBuilder);

            migrationBuilder.DropIndex(
                name: "IX_ClientInvitations_TokenHash",
                schema: "invitations",
                table: "ClientInvitations");
            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientInvitations_TokenHash",
                schema: "invitations",
                table: "ClientInvitations");
            migrationBuilder.DropColumn(
                name: "TokenHash",
                schema: "invitations",
                table: "ClientInvitations");
            // The two legacy delivery tables go last, and they are the one thing this migration
            // deliberately does not carry forward in full. Both stored a `Recipient` column holding a
            // plain email address, which is precisely what the tokenless design refuses to persist;
            // their remaining content was a status for mail that no deployment ever actually sent,
            // because the only senders that ever existed captured in memory. The invitation facts
            // worth keeping - identity, send count, expiry, revocation, acceptance and audit stamps -
            // live on ClientInvitations and are preserved untouched, and the send history is
            // reconstructed above as one request and one attempt per generation.
            migrationBuilder.DropTable(
                name: "AccountEmailDeliveries",
                schema: "identity");
            migrationBuilder.DropTable(
                name: "InvitationDeliveries",
                schema: "invitations");

            CreateActionMailProtections(migrationBuilder);
}

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Reverting is lossy and the order is what keeps it from being needlessly lossier. The
            // token record is the only place a live invitation link exists after this phase, so the
            // legacy column is restored from it before the table holding it is dropped.
            DropActionMailProtections(migrationBuilder);

            migrationBuilder.AddColumn<string>(
                name: "TokenHash",
                schema: "invitations",
                table: "ClientInvitations",
                type: "character(64)",
                fixedLength: true,
                maxLength: 64,
                nullable: true);

            RestoreLegacyInvitationTokenHash(migrationBuilder);

            migrationBuilder.AlterColumn<string>(
                name: "TokenHash",
                schema: "invitations",
                table: "ClientInvitations",
                type: "character(64)",
                fixedLength: true,
                maxLength: 64,
                nullable: false);

            migrationBuilder.DropTable(
                name: "ActionMailAttempts",
                schema: "identity");
            migrationBuilder.DropTable(
                name: "TokenIssues",
                schema: "invitations");
            migrationBuilder.DropTable(
                name: "ActionMailRequests",
                schema: "identity");
            migrationBuilder.DropTable(
                name: "ActionMailAttempts",
                schema: "invitations");
            migrationBuilder.DropTable(
                name: "ActionMailRequests",
                schema: "invitations");
            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientInvitations_LogicalSendGeneration",
                schema: "invitations",
                table: "ClientInvitations");
            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientInvitations_NormalizedEmail",
                schema: "invitations",
                table: "ClientInvitations");
            migrationBuilder.DropColumn(
                name: "LogicalSendGeneration",
                schema: "invitations",
                table: "ClientInvitations");
            migrationBuilder.CreateTable(
                name: "AccountEmailDeliveries",
                schema: "identity",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    FailureCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    ProviderMessageId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Purpose = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Recipient = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
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
                name: "InvitationDeliveries",
                schema: "invitations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AttemptNumber = table.Column<int>(type: "integer", nullable: false),
                    Channel = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    FailureCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    InvitationId = table.Column<Guid>(type: "uuid", nullable: false),
                    ProviderMessageId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Recipient = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
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
            migrationBuilder.CreateIndex(
                name: "IX_AccountEmailDeliveries_UserId_CreatedAtUtc",
                schema: "identity",
                table: "AccountEmailDeliveries",
                columns: new[] { "UserId", "CreatedAtUtc" });
            migrationBuilder.CreateIndex(
                name: "IX_InvitationDeliveries_TenantId_InvitationId_AttemptNumber",
                schema: "invitations",
                table: "InvitationDeliveries",
                columns: new[] { "TenantId", "InvitationId", "AttemptNumber" },
                unique: true);
            migrationBuilder.CreateIndex(
                name: "IX_ClientInvitations_TokenHash",
                schema: "invitations",
                table: "ClientInvitations",
                column: "TokenHash",
                unique: true);
            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientInvitations_TokenHash",
                schema: "invitations",
                table: "ClientInvitations",
                sql: "char_length(\"TokenHash\") = 64");
}

        /// <summary>
        /// Rebuilds this phase's send history and token record from the invitations already in the
        /// database, so an upgrade of a live workspace keeps every link that is currently in a mailbox.
        /// </summary>
        /// <remarks>
        /// Three inserts, in dependency order, and each one is derived from <c>ClientInvitations</c>
        /// rather than from the legacy delivery table. That is deliberate: the delivery table records
        /// what a capture adapter was asked to do, while the invitation records what is actually true,
        /// and an invitation whose delivery rows drifted must still end up with a request and an attempt
        /// for the generation its live token belongs to. Deriving from the aggregate makes that
        /// structurally guaranteed instead of merely likely.
        /// <para>
        /// The identifiers are derived deterministically from the invitation id and the generation with
        /// a truncated SHA-256 digest, so re-running the upgrade after a revert produces the same rows
        /// rather than a second set - which is what makes apply, revert and reapply converge.
        /// </para>
        /// <para>
        /// The restored token hash is lower-cased. Phase 1 wrote it with an upper-case hex encoder and
        /// this phase reads it with a lower-case one, so a link already in somebody's mailbox only keeps
        /// working if the stored digest is normalised here. Getting this wrong would invalidate every
        /// outstanding invitation silently.
        /// </para>
        /// </remarks>
        private static void BackfillLegacyInvitationHistory(MigrationBuilder migrationBuilder)
        {
            // One request per generation the invitation has had.
            migrationBuilder.Sql("""
                INSERT INTO invitations."ActionMailRequests" (
                    "Id", "TenantId", "InvitationId", "LogicalSendGeneration", "SchemaVersion",
                    "IdempotencyKey", "PayloadFingerprint", "RequestSource", "RequestedByUserId",
                    "RequestedAtUtc", "Status", "AttemptCount", "NextAttemptAtUtc",
                    "MaterializedAtUtc", "CompletedAtUtc", "TransportAdapter",
                    "CreatedAtUtc", "UpdatedAtUtc")
                SELECT
                    (left(encode(sha256(convert_to('tbgym.request:' || i."Id"::text || ':' || g.generation::text, 'UTF8')), 'hex'), 32)::uuid),
                    i."TenantId",
                    i."Id",
                    g.generation,
                    1,
                    (left(encode(sha256(convert_to('tbgym.key:' || i."Id"::text || ':' || g.generation::text, 'UTF8')), 'hex'), 32)::uuid),
                    encode(sha256(convert_to('legacy:' || i."Id"::text || ':' || g.generation::text, 'UTF8')), 'hex'),
                    CASE WHEN g.generation = 1 THEN 'invitation-created' ELSE 'invitation-resend' END,
                    NULL,
                    i."CreatedAtUtc",
                    'Materialized',
                    1,
                    i."CreatedAtUtc",
                    i."CreatedAtUtc",
                    i."CreatedAtUtc",
                    'captured',
                    i."CreatedAtUtc",
                    i."CreatedAtUtc"
                FROM invitations."ClientInvitations" i
                CROSS JOIN LATERAL generate_series(1, GREATEST(i."SendCount", 1)) AS g(generation)
                ON CONFLICT DO NOTHING
                """);

            // One attempt per request, so the token record below has the started materialization every
            // token row is required to name.
            migrationBuilder.Sql("""
                INSERT INTO invitations."ActionMailAttempts" (
                    "Id", "TenantId", "RequestId", "InvitationId", "LogicalSendGeneration",
                    "AttemptNumber", "ClaimToken", "ProviderIdempotencyKey", "StartedAtUtc",
                    "TokenMintedAtUtc", "CompletedAtUtc", "Outcome", "CreatedAtUtc", "UpdatedAtUtc")
                SELECT
                    (left(encode(sha256(convert_to('tbgym.attempt:' || r."Id"::text, 'UTF8')), 'hex'), 32)::uuid),
                    r."TenantId",
                    r."Id",
                    r."InvitationId",
                    r."LogicalSendGeneration",
                    1,
                    (left(encode(sha256(convert_to('tbgym.claim:' || r."Id"::text, 'UTF8')), 'hex'), 32)::uuid),
                    'invitation-action:' || replace(r."Id"::text, '-', '') || ':a1:v1:'
                        || left(encode(sha256(convert_to('legacy:' || r."Id"::text, 'UTF8')), 'hex'), 32),
                    r."RequestedAtUtc",
                    r."RequestedAtUtc",
                    r."RequestedAtUtc",
                    'Succeeded',
                    r."RequestedAtUtc",
                    r."RequestedAtUtc"
                FROM invitations."ActionMailRequests" r
                ON CONFLICT DO NOTHING
                """);

            // The live token, for the current generation only. Earlier generations' tokens were already
            // rotated away by the Phase 1 resend behaviour and no longer exist to record.
            migrationBuilder.Sql("""
                INSERT INTO invitations."TokenIssues" (
                    "Id", "TenantId", "InvitationId", "LogicalSendGeneration", "ActionMailRequestId",
                    "ActionMailAttemptId", "AttemptNumber", "TokenHash", "IssuedAtUtc", "ExpiresAtUtc",
                    "RevokedAtUtc", "RevocationReason", "RedeemedAtUtc", "RedeemedByUserId",
                    "CreatedAtUtc", "UpdatedAtUtc")
                SELECT
                    (left(encode(sha256(convert_to('tbgym.token:' || i."Id"::text, 'UTF8')), 'hex'), 32)::uuid),
                    i."TenantId",
                    i."Id",
                    i."LogicalSendGeneration",
                    r."Id",
                    a."Id",
                    a."AttemptNumber",
                    lower(trim(i."TokenHash")),
                    i."CreatedAtUtc",
                    i."ExpiresAtUtc",
                    CASE WHEN i."Status" = 'Revoked' THEN i."RevokedAtUtc" END,
                    CASE WHEN i."Status" = 'Revoked' THEN 'invitation-token-invitation-revoked' END,
                    CASE WHEN i."Status" = 'Accepted' THEN i."AcceptedAtUtc" END,
                    CASE WHEN i."Status" = 'Accepted' THEN i."AcceptedByUserId" END,
                    i."CreatedAtUtc",
                    i."CreatedAtUtc"
                FROM invitations."ClientInvitations" i
                JOIN invitations."ActionMailRequests" r
                  ON r."TenantId" = i."TenantId"
                 AND r."InvitationId" = i."Id"
                 AND r."LogicalSendGeneration" = i."LogicalSendGeneration"
                JOIN invitations."ActionMailAttempts" a
                  ON a."TenantId" = r."TenantId" AND a."RequestId" = r."Id"
                WHERE lower(trim(i."TokenHash")) ~ '^[0-9a-f]{64}$'
                  AND i."ExpiresAtUtc" > i."CreatedAtUtc"
                ON CONFLICT DO NOTHING
                """);
        }

        /// <summary>
        /// Puts the live invitation token back on the invitation, for a revert.
        /// </summary>
        /// <remarks>
        /// Upper-cased, because the schema being reverted to was written by an upper-case hex encoder
        /// and compares the stored value for equality. An invitation with no recorded token — one
        /// created after this phase and never materialized — gets a digest of its own identifier, which
        /// is a value no token can hash to and therefore a link nobody holds, rather than a blank the
        /// unique index would refuse on the second row.
        /// </remarks>
        private static void RestoreLegacyInvitationTokenHash(MigrationBuilder migrationBuilder) =>
            migrationBuilder.Sql("""
                UPDATE invitations."ClientInvitations" i
                SET "TokenHash" = COALESCE(
                    (SELECT upper(t."TokenHash")
                     FROM invitations."TokenIssues" t
                     WHERE t."TenantId" = i."TenantId"
                       AND t."InvitationId" = i."Id"
                       AND t."LogicalSendGeneration" = i."LogicalSendGeneration"
                     -- A live token first, then a revoked or redeemed one. The schema being reverted
                     -- to kept the hash on a revoked or accepted invitation and refused it by reading
                     -- the invitation's status instead, so dropping those would lose a fact the old
                     -- schema had rather than protect anything.
                     ORDER BY (t."RevokedAtUtc" IS NOT NULL), t."IssuedAtUtc" DESC
                     LIMIT 1),
                    upper(encode(sha256(convert_to('unissued:' || i."Id"::text, 'UTF8')), 'hex')))
                """);
        

        /// <summary>
        /// The guards that make the action-mail lifecycle something only a real dispatcher can produce.
        /// </summary>
        /// <remarks>
        /// Every rule here answers one question: could somebody with a database connection make this
        /// system believe a credential was issued, superseded, redeemed or sent when it was not? Check
        /// constraints alone cannot answer it, because the interesting invariants compare a row against
        /// its previous version or against a row in another table.
        /// <para>
        /// The two that matter most, and that exist nowhere else in this repository:
        /// </para>
        /// <list type="bullet">
        /// <item><description>an invitation's logical-send generation moves by exactly one, only
        /// forward, and only while it is still pending — so a transport retry cannot rotate it and a
        /// skipped generation cannot orphan a link somebody is holding;</description></item>
        /// <item><description>an invitation action-mail request cannot become Materialized unless the
        /// attempt that finalized it minted a token <b>and</b> that token's hash is already recorded.
        /// That is the "commit the hash before you send" ordering expressed as a database rule rather
        /// than as an ordering in one method that a later edit could quietly reverse.</description></item>
        /// </list>
        /// </remarks>
        private static void CreateActionMailProtections(MigrationBuilder migrationBuilder)
        {
            // ---------- invitations: the aggregate that owns the generation ----------
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION invitations.protect_client_invitation()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Invitations are never deleted; revocation and expiry are recorded state' USING ERRCODE = '23514';
                    END IF;

                    IF OLD."Id" <> NEW."Id" OR OLD."TenantId" <> NEW."TenantId" THEN
                        RAISE EXCEPTION 'An invitation identity is immutable' USING ERRCODE = '23514';
                    END IF;

                    -- The invited address is what every uniqueness rule, every token and every
                    -- authorization decision was evaluated against. Changing it would silently retarget
                    -- a credential that is already in somebody's mailbox.
                    IF OLD."Email" <> NEW."Email" OR OLD."NormalizedEmail" <> NEW."NormalizedEmail" THEN
                        RAISE EXCEPTION 'An invitation target address is immutable' USING ERRCODE = '23514';
                    END IF;

                    IF OLD."Status" <> 'Pending' AND NEW."Status" <> OLD."Status" THEN
                        RAISE EXCEPTION 'A terminal invitation status is final' USING ERRCODE = '23514';
                    END IF;

                    IF NEW."LogicalSendGeneration" NOT IN (OLD."LogicalSendGeneration", OLD."LogicalSendGeneration" + 1) THEN
                        RAISE EXCEPTION 'An invitation logical-send generation advances by exactly one' USING ERRCODE = '23514';
                    END IF;

                    IF NEW."LogicalSendGeneration" = OLD."LogicalSendGeneration" + 1 THEN
                        -- A deliberate resend, and only a person performs one.
                        IF OLD."Status" <> 'Pending' OR NEW."Status" <> 'Pending' THEN
                            RAISE EXCEPTION 'Only a pending invitation can begin a new logical send' USING ERRCODE = '23514';
                        END IF;
                        IF NEW."SendCount" <> OLD."SendCount" + 1 THEN
                            RAISE EXCEPTION 'A new logical send is exactly one more deliberate send' USING ERRCODE = '23514';
                        END IF;
                        IF NEW."ExpiresAtUtc" < OLD."ExpiresAtUtc" THEN
                            RAISE EXCEPTION 'A resend recalculates expiry forward, never backward' USING ERRCODE = '23514';
                        END IF;
                    ELSIF NEW."SendCount" <> OLD."SendCount" THEN
                        RAISE EXCEPTION 'A send count only changes with a new logical send generation' USING ERRCODE = '23514';
                    ELSIF NEW."ExpiresAtUtc" <> OLD."ExpiresAtUtc" THEN
                        RAISE EXCEPTION 'An invitation expiry only changes with a new logical send generation' USING ERRCODE = '23514';
                    END IF;

                    RETURN NEW;
                END;
                $function$;
                """);
            migrationBuilder.Sql("""
                CREATE TRIGGER trg_client_invitations_protect
                BEFORE UPDATE OR DELETE ON invitations."ClientInvitations"
                FOR EACH ROW EXECUTE FUNCTION invitations.protect_client_invitation();
                """);

            // ---------- invitations: append-only token evidence ----------
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION invitations.protect_invitation_token_issue()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE
                    current_generation integer;
                    invitation_status text;
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Issued invitation tokens are never deleted; they are the record of a credential that may still exist' USING ERRCODE = '23514';
                    END IF;

                    IF TG_OP = 'INSERT' THEN
                        IF NEW."RevokedAtUtc" IS NOT NULL OR NEW."RedeemedAtUtc" IS NOT NULL THEN
                            RAISE EXCEPTION 'An issued token is born neither revoked nor redeemed' USING ERRCODE = '23514';
                        END IF;
                        SELECT i."LogicalSendGeneration", i."Status" INTO current_generation, invitation_status
                        FROM invitations."ClientInvitations" i
                        WHERE i."TenantId" = NEW."TenantId" AND i."Id" = NEW."InvitationId";
                        IF current_generation IS NULL OR current_generation <> NEW."LogicalSendGeneration" THEN
                            RAISE EXCEPTION 'A token can only be issued for the invitation''s current logical send generation' USING ERRCODE = '23514';
                        END IF;
                        IF invitation_status <> 'Pending' THEN
                            RAISE EXCEPTION 'A token can only be issued for a pending invitation' USING ERRCODE = '23514';
                        END IF;
                        RETURN NEW;
                    END IF;

                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."InvitationId" <> NEW."InvitationId"
                       OR OLD."LogicalSendGeneration" <> NEW."LogicalSendGeneration"
                       OR OLD."ActionMailRequestId" <> NEW."ActionMailRequestId"
                       OR OLD."ActionMailAttemptId" <> NEW."ActionMailAttemptId"
                       OR OLD."AttemptNumber" <> NEW."AttemptNumber"
                       OR OLD."TokenHash" <> NEW."TokenHash"
                       OR OLD."IssuedAtUtc" <> NEW."IssuedAtUtc"
                       OR OLD."ExpiresAtUtc" <> NEW."ExpiresAtUtc" THEN
                        RAISE EXCEPTION 'Issued invitation token evidence is immutable' USING ERRCODE = '23514';
                    END IF;

                    IF OLD."RevokedAtUtc" IS NOT NULL AND
                       (NEW."RevokedAtUtc" IS DISTINCT FROM OLD."RevokedAtUtc"
                        OR NEW."RevocationReason" IS DISTINCT FROM OLD."RevocationReason") THEN
                        RAISE EXCEPTION 'An invitation token revocation is recorded once' USING ERRCODE = '23514';
                    END IF;

                    IF OLD."RedeemedAtUtc" IS NOT NULL AND
                       (NEW."RedeemedAtUtc" IS DISTINCT FROM OLD."RedeemedAtUtc"
                        OR NEW."RedeemedByUserId" IS DISTINCT FROM OLD."RedeemedByUserId") THEN
                        RAISE EXCEPTION 'An invitation token is single-use' USING ERRCODE = '23514';
                    END IF;

                    IF OLD."RedeemedAtUtc" IS NOT NULL AND NEW."RevokedAtUtc" IS NOT NULL THEN
                        RAISE EXCEPTION 'A redeemed invitation token cannot be revoked afterwards' USING ERRCODE = '23514';
                    END IF;

                    IF OLD."RedeemedAtUtc" IS NULL AND NEW."RedeemedAtUtc" IS NOT NULL THEN
                        IF OLD."RevokedAtUtc" IS NOT NULL THEN
                            RAISE EXCEPTION 'A revoked invitation token cannot be redeemed' USING ERRCODE = '23514';
                        END IF;
                        IF NEW."RedeemedAtUtc" > NEW."ExpiresAtUtc" THEN
                            RAISE EXCEPTION 'An expired invitation token cannot be redeemed' USING ERRCODE = '23514';
                        END IF;
                        SELECT i."LogicalSendGeneration" INTO current_generation
                        FROM invitations."ClientInvitations" i
                        WHERE i."TenantId" = NEW."TenantId" AND i."Id" = NEW."InvitationId";
                        IF current_generation IS DISTINCT FROM NEW."LogicalSendGeneration" THEN
                            RAISE EXCEPTION 'A superseded invitation token cannot be redeemed' USING ERRCODE = '23514';
                        END IF;
                    END IF;

                    RETURN NEW;
                END;
                $function$;
                """);
            migrationBuilder.Sql("""
                CREATE TRIGGER trg_invitation_token_issues_protect
                BEFORE INSERT OR UPDATE OR DELETE ON invitations."TokenIssues"
                FOR EACH ROW EXECUTE FUNCTION invitations.protect_invitation_token_issue();
                """);

            CreateActionMailRequestProtection(
                migrationBuilder,
                "identity",
                "protect_account_action_mail_request",
                "trg_account_action_mail_requests_protect",
                "ActionMailRequests",
                "ActionMailAttempts",
                tenantScoped: false,
                requiresMintedToken: false);
            CreateActionMailAttemptProtection(
                migrationBuilder,
                "identity",
                "protect_account_action_mail_attempt",
                "trg_account_action_mail_attempts_protect",
                "ActionMailAttempts",
                tenantScoped: false);
            CreateActionMailRequestProtection(
                migrationBuilder,
                "invitations",
                "protect_invitation_action_mail_request",
                "trg_invitation_action_mail_requests_protect",
                "ActionMailRequests",
                "ActionMailAttempts",
                tenantScoped: true,
                requiresMintedToken: true);
            CreateActionMailAttemptProtection(
                migrationBuilder,
                "invitations",
                "protect_invitation_action_mail_attempt",
                "trg_invitation_action_mail_attempts_protect",
                "ActionMailAttempts",
                tenantScoped: true);
        }

        /// <summary>
        /// The lifecycle guard for one action-mail request table.
        /// </summary>
        /// <remarks>
        /// The same rules for both queues, emitted twice because the two tables are deliberately not one
        /// table: the global queue has no <c>TenantId</c> to join on, and giving it one so the guard
        /// could be shared would reintroduce exactly the tenant-shaped global row ADR 0021 refuses.
        /// <para>
        /// <paramref name="requiresMintedToken"/> is the invitation-only rule, and it is the strongest
        /// thing here: a request may not be recorded as materialized unless the attempt that finalized
        /// it minted a token and that token's hash is already durable. A dispatcher that sent first and
        /// recorded afterwards would be refused by the database, which is what turns an ordering in one
        /// method into an invariant.
        /// </para>
        /// </remarks>
        private static void CreateActionMailRequestProtection(
            MigrationBuilder migrationBuilder,
            string schema,
            string function,
            string trigger,
            string requestTable,
            string attemptTable,
            bool tenantScoped,
            bool requiresMintedToken)
        {
            var tenantIdentity = tenantScoped
                ? "OR OLD.\"TenantId\" <> NEW.\"TenantId\" OR OLD.\"InvitationId\" <> NEW.\"InvitationId\" OR OLD.\"LogicalSendGeneration\" <> NEW.\"LogicalSendGeneration\" OR OLD.\"IdempotencyKey\" <> NEW.\"IdempotencyKey\" OR OLD.\"PayloadFingerprint\" <> NEW.\"PayloadFingerprint\""
                : "OR OLD.\"ActionKind\" <> NEW.\"ActionKind\" OR OLD.\"SubjectUserId\" IS DISTINCT FROM NEW.\"SubjectUserId\" OR OLD.\"SubjectSecurityStampHash\" IS DISTINCT FROM NEW.\"SubjectSecurityStampHash\"";
            var attemptScope = tenantScoped
                ? "a.\"TenantId\" = OLD.\"TenantId\" AND a.\"RequestId\" = OLD.\"Id\""
                : "a.\"RequestId\" = OLD.\"Id\"";
            var mintedTokenRule = requiresMintedToken
                ? """
                            IF NEW."Status" = 'Materialized' AND NOT EXISTS (
                                SELECT 1
                                FROM invitations."ActionMailAttempts" a
                                JOIN invitations."TokenIssues" t
                                  ON t."TenantId" = a."TenantId" AND t."ActionMailAttemptId" = a."Id"
                                WHERE a."TenantId" = OLD."TenantId"
                                  AND a."RequestId" = OLD."Id"
                                  AND a."ClaimToken" = OLD."ClaimToken"
                                  AND a."TokenMintedAtUtc" IS NOT NULL) THEN
                                RAISE EXCEPTION 'An invitation action mail request cannot be materialized before its token hash is recorded' USING ERRCODE = '23514';
                            END IF;
                    """
                : "";

            migrationBuilder.Sql($"""
                CREATE OR REPLACE FUNCTION {schema}.{function}()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Action mail requests are never deleted; a terminal outcome is recorded state' USING ERRCODE = '23514';
                    END IF;

                    IF TG_OP = 'INSERT' THEN
                        IF NEW."Status" <> 'Pending'
                           OR NEW."AttemptCount" <> 0
                           OR NEW."ClaimToken" IS NOT NULL
                           OR NEW."MaterializedAtUtc" IS NOT NULL
                           OR NEW."CompletedAtUtc" IS NOT NULL
                           OR NEW."DeadLetteredAtUtc" IS NOT NULL
                           OR NEW."TransportAdapter" IS NOT NULL
                           OR NEW."ProviderMessageId" IS NOT NULL
                           OR NEW."ProviderAcceptedAtUtc" IS NOT NULL THEN
                            RAISE EXCEPTION 'An action mail request must be created pending, unclaimed and unattempted' USING ERRCODE = '23514';
                        END IF;
                        RETURN NEW;
                    END IF;

                    IF OLD."Id" <> NEW."Id"
                       OR OLD."SchemaVersion" <> NEW."SchemaVersion"
                       OR OLD."RequestSource" <> NEW."RequestSource"
                       OR OLD."RequestedByUserId" IS DISTINCT FROM NEW."RequestedByUserId"
                       OR OLD."RequestedAtUtc" <> NEW."RequestedAtUtc"
                       {tenantIdentity} THEN
                        RAISE EXCEPTION 'An action mail request identity and provenance are immutable' USING ERRCODE = '23514';
                    END IF;

                    IF OLD."Status" IN ('Materialized', 'Suppressed', 'DeadLettered') THEN
                        RAISE EXCEPTION 'A terminal action mail request is immutable' USING ERRCODE = '23514';
                    END IF;

                    IF OLD."Status" = 'Pending' AND NEW."Status" = 'Processing' THEN
                        IF OLD."ClaimToken" IS NOT NULL OR NEW."ClaimToken" IS NULL
                           OR NEW."AttemptCount" <> OLD."AttemptCount" THEN
                            RAISE EXCEPTION 'A pending request is reserved without spending an attempt' USING ERRCODE = '23514';
                        END IF;
                    ELSIF OLD."Status" = 'Pending' AND NEW."Status" IN ('Suppressed', 'DeadLettered') THEN
                        IF NEW."AttemptCount" <> OLD."AttemptCount" THEN
                            RAISE EXCEPTION 'A pre-claim terminal decision cannot spend an attempt' USING ERRCODE = '23514';
                        END IF;
                    ELSIF OLD."Status" = 'Processing' AND NEW."Status" = 'Processing' THEN
                        IF OLD."ClaimToken" = NEW."ClaimToken" THEN
                            IF NEW."AttemptCount" <> OLD."AttemptCount" + 1
                               OR NEW."ClaimExpiresAtUtc" <> OLD."ClaimExpiresAtUtc" THEN
                                RAISE EXCEPTION 'A held claim starts exactly one attempt without changing its lease' USING ERRCODE = '23514';
                            END IF;
                        ELSE
                            IF OLD."ClaimExpiresAtUtc" > CURRENT_TIMESTAMP
                               OR NEW."AttemptCount" <> OLD."AttemptCount"
                               OR NEW."ClaimExpiresAtUtc" <= OLD."ClaimExpiresAtUtc" THEN
                                RAISE EXCEPTION 'Only an expired reservation may be taken over without spending an attempt' USING ERRCODE = '23514';
                            END IF;
                        END IF;
                    ELSIF OLD."Status" = 'Processing' AND NEW."Status" = 'Pending' THEN
                        IF NEW."AttemptCount" <> OLD."AttemptCount"
                           OR NEW."NextAttemptAtUtc" <= OLD."NextAttemptAtUtc" THEN
                            RAISE EXCEPTION 'A claimed request returns pending only for a later retry' USING ERRCODE = '23514';
                        END IF;
                        IF NOT EXISTS (
                            SELECT 1 FROM {schema}."{attemptTable}" a
                            WHERE {attemptScope}
                              AND a."ClaimToken" = OLD."ClaimToken"
                              AND a."AttemptNumber" = NEW."AttemptCount") THEN
                            RAISE EXCEPTION 'A retry must complete the attempt started by its claim' USING ERRCODE = '23514';
                        END IF;
                    ELSIF OLD."Status" = 'Processing' AND NEW."Status" IN ('Materialized', 'Suppressed', 'DeadLettered') THEN
                        IF NEW."AttemptCount" <> OLD."AttemptCount" THEN
                            RAISE EXCEPTION 'Finalizing a request cannot rewrite its attempt count' USING ERRCODE = '23514';
                        END IF;
                        -- A claim that started an attempt has to finalize that attempt, and may not name
                        -- a different one: that is what stops a finalization from claiming work it did
                        -- not do. A claim that has not started one may still end here, because the
                        -- authorization recheck runs before the attempt and a decision it makes costs no
                        -- attempt - which is the whole meaning of suppression not being a failure.
                        IF EXISTS (
                            SELECT 1 FROM {schema}."{attemptTable}" a
                            WHERE {attemptScope} AND a."ClaimToken" = OLD."ClaimToken")
                           AND NOT EXISTS (
                            SELECT 1 FROM {schema}."{attemptTable}" a
                            WHERE {attemptScope}
                              AND a."ClaimToken" = OLD."ClaimToken"
                              AND a."AttemptNumber" = NEW."AttemptCount") THEN
                            RAISE EXCEPTION 'A claim that started an attempt must finalize that attempt' USING ERRCODE = '23514';
                        END IF;
                        -- A materialization is different: something was produced, so the attempt that
                        -- produced it has to exist and has to be this claim's.
                        IF NEW."Status" = 'Materialized' AND NOT EXISTS (
                            SELECT 1 FROM {schema}."{attemptTable}" a
                            WHERE {attemptScope}
                              AND a."ClaimToken" = OLD."ClaimToken"
                              AND a."AttemptNumber" = NEW."AttemptCount") THEN
                            RAISE EXCEPTION 'A materialization must record the attempt that produced it' USING ERRCODE = '23514';
                        END IF;
                {mintedTokenRule}
                    ELSE
                        RAISE EXCEPTION 'Invalid action mail request transition' USING ERRCODE = '23514';
                    END IF;

                    -- Provider acceptance is written exactly once, in the statement that makes a request
                    -- terminal, and only by an adapter that actually contacted a provider.
                    IF OLD."ProviderMessageId" IS DISTINCT FROM NEW."ProviderMessageId"
                       OR OLD."ProviderAcceptedAtUtc" IS DISTINCT FROM NEW."ProviderAcceptedAtUtc" THEN
                        IF OLD."ProviderMessageId" IS NOT NULL OR OLD."ProviderAcceptedAtUtc" IS NOT NULL THEN
                            RAISE EXCEPTION 'Provider acceptance is recorded once and never rewritten' USING ERRCODE = '23514';
                        END IF;
                        IF NEW."Status" <> 'Materialized'
                           OR NEW."ProviderMessageId" IS NULL
                           OR NEW."ProviderAcceptedAtUtc" IS NULL
                           OR NEW."TransportAdapter" IS NULL
                           OR NEW."TransportAdapter" NOT IN ('resend') THEN
                            RAISE EXCEPTION 'Only a materialized request from a real provider adapter records provider acceptance' USING ERRCODE = '23514';
                        END IF;
                    END IF;

                    RETURN NEW;
                END;
                $function$;
                """);
            migrationBuilder.Sql($"""
                CREATE TRIGGER {trigger}
                BEFORE INSERT OR UPDATE OR DELETE ON {schema}."{requestTable}"
                FOR EACH ROW EXECUTE FUNCTION {schema}.{function}();
                """);
        }

        /// <summary>
        /// The attempt guard: every attempt is born started, a completed one is a historical fact, and
        /// one materialization mints at most one token.
        /// </summary>
        private static void CreateActionMailAttemptProtection(
            MigrationBuilder migrationBuilder,
            string schema,
            string function,
            string trigger,
            string attemptTable,
            bool tenantScoped)
        {
            var identity = tenantScoped
                ? "OR OLD.\"TenantId\" <> NEW.\"TenantId\" OR OLD.\"InvitationId\" <> NEW.\"InvitationId\" OR OLD.\"LogicalSendGeneration\" <> NEW.\"LogicalSendGeneration\""
                : "OR OLD.\"ActionKind\" <> NEW.\"ActionKind\"";

            migrationBuilder.Sql($"""
                CREATE OR REPLACE FUNCTION {schema}.{function}()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Action mail attempt history is never deleted' USING ERRCODE = '23514';
                    END IF;

                    IF TG_OP = 'INSERT' THEN
                        IF NEW."Outcome" <> 'Started'
                           OR NEW."CompletedAtUtc" IS NOT NULL
                           OR NEW."ProviderMessageId" IS NOT NULL THEN
                            RAISE EXCEPTION 'An action mail attempt is born started, with no outcome and no provider evidence' USING ERRCODE = '23514';
                        END IF;
                        RETURN NEW;
                    END IF;

                    IF OLD."Outcome" <> 'Started' THEN
                        RAISE EXCEPTION 'A completed action mail attempt is immutable' USING ERRCODE = '23514';
                    END IF;

                    IF OLD."Id" <> NEW."Id"
                       OR OLD."RequestId" <> NEW."RequestId"
                       OR OLD."AttemptNumber" <> NEW."AttemptNumber"
                       OR OLD."ClaimToken" <> NEW."ClaimToken"
                       OR OLD."ProviderIdempotencyKey" <> NEW."ProviderIdempotencyKey"
                       OR OLD."StartedAtUtc" <> NEW."StartedAtUtc"
                       {identity} THEN
                        RAISE EXCEPTION 'An action mail attempt identity and its provider key are immutable' USING ERRCODE = '23514';
                    END IF;

                    -- One materialization mints one token. A second mint under one attempt would be a
                    -- second live credential the attempt cannot account for.
                    IF OLD."TokenMintedAtUtc" IS NOT NULL AND NEW."TokenMintedAtUtc" IS DISTINCT FROM OLD."TokenMintedAtUtc" THEN
                        RAISE EXCEPTION 'One action mail attempt mints one token' USING ERRCODE = '23514';
                    END IF;

                    RETURN NEW;
                END;
                $function$;
                """);
            migrationBuilder.Sql($"""
                CREATE TRIGGER {trigger}
                BEFORE INSERT OR UPDATE OR DELETE ON {schema}."{attemptTable}"
                FOR EACH ROW EXECUTE FUNCTION {schema}.{function}();
                """);
        }

        private static void DropActionMailProtections(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""DROP TRIGGER IF EXISTS trg_invitation_action_mail_attempts_protect ON invitations."ActionMailAttempts";""");
            migrationBuilder.Sql("""DROP TRIGGER IF EXISTS trg_invitation_action_mail_requests_protect ON invitations."ActionMailRequests";""");
            migrationBuilder.Sql("""DROP TRIGGER IF EXISTS trg_account_action_mail_attempts_protect ON identity."ActionMailAttempts";""");
            migrationBuilder.Sql("""DROP TRIGGER IF EXISTS trg_account_action_mail_requests_protect ON identity."ActionMailRequests";""");
            migrationBuilder.Sql("""DROP TRIGGER IF EXISTS trg_invitation_token_issues_protect ON invitations."TokenIssues";""");
            migrationBuilder.Sql("""DROP TRIGGER IF EXISTS trg_client_invitations_protect ON invitations."ClientInvitations";""");
            migrationBuilder.Sql("DROP FUNCTION IF EXISTS invitations.protect_invitation_action_mail_attempt();");
            migrationBuilder.Sql("DROP FUNCTION IF EXISTS invitations.protect_invitation_action_mail_request();");
            migrationBuilder.Sql("DROP FUNCTION IF EXISTS identity.protect_account_action_mail_attempt();");
            migrationBuilder.Sql("DROP FUNCTION IF EXISTS identity.protect_account_action_mail_request();");
            migrationBuilder.Sql("DROP FUNCTION IF EXISTS invitations.protect_invitation_token_issue();");
            migrationBuilder.Sql("DROP FUNCTION IF EXISTS invitations.protect_client_invitation();");
        }
    }
}

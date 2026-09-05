using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase6B3BProviderEmailAndEvents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationChannelDeliveries_ProviderEvidence",
                schema: "notifications",
                table: "ChannelDeliveries");

            migrationBuilder.CreateTable(
                name: "ProviderMessages",
                schema: "notifications",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OutboxItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    ChannelDeliveryId = table.Column<Guid>(type: "uuid", nullable: false),
                    Channel = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    RecipientUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Adapter = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    ProviderMessageId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ProviderAcceptedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    RecipientAddressFingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    FingerprintKeyId = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    RecipientServerAcceptedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    BouncedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    BounceClass = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: true),
                    ComplainedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DelayedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    FailedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    FailureCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    ProviderSuppressedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    EventCount = table.Column<int>(type: "integer", nullable: false),
                    LastEventReceivedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProviderMessages", x => x.Id);
                    table.UniqueConstraint("AK_ProviderMessages_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_NotificationProviderMessages_Bounce", "(\"BouncedAtUtc\" IS NULL) = (\"BounceClass\" IS NULL)");
                    table.CheckConstraint("CK_NotificationProviderMessages_EventBookkeeping", "(\"EventCount\" = 0) = (\"LastEventReceivedAtUtc\" IS NULL)");
                    table.CheckConstraint("CK_NotificationProviderMessages_Failure", "(\"FailedAtUtc\" IS NULL) = (\"FailureCode\" IS NULL)");
                    table.CheckConstraint("CK_NotificationProviderMessages_Fingerprint", "\"RecipientAddressFingerprint\" ~ '^[0-9a-f]{64}$' AND btrim(\"FingerprintKeyId\") <> '' AND \"ProviderMessageId\" ~ '^[A-Za-z0-9_.:-]{1,200}$'");
                    table.CheckConstraint("CK_NotificationProviderMessages_Vocabulary", "\"Channel\" = 'Email' AND \"Adapter\" IN ('resend') AND (\"BounceClass\" IS NULL OR \"BounceClass\" IN ('Permanent', 'Transient', 'Undetermined')) AND \"EventCount\" >= 0");
                    table.ForeignKey(
                        name: "FK_ProviderMessages_ChannelDeliveries_TenantId_ChannelDelivery~",
                        columns: x => new { x.TenantId, x.ChannelDeliveryId, x.Channel },
                        principalSchema: "notifications",
                        principalTable: "ChannelDeliveries",
                        principalColumns: new[] { "TenantId", "Id", "Channel" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ProviderMessages_Memberships_TenantId_RecipientUserId",
                        columns: x => new { x.TenantId, x.RecipientUserId },
                        principalSchema: "tenancy",
                        principalTable: "Memberships",
                        principalColumns: new[] { "TenantId", "UserId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ProviderMessages_OutboxItems_TenantId_OutboxItemId",
                        columns: x => new { x.TenantId, x.OutboxItemId },
                        principalSchema: "notifications",
                        principalTable: "OutboxItems",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ProviderEvents",
                schema: "notifications",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProviderMessageRecordId = table.Column<Guid>(type: "uuid", nullable: false),
                    Adapter = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    ProviderEventId = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    EventType = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    BounceClass = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: true),
                    FailureCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    OccurredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ReceivedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    AppliedNewFact = table.Column<bool>(type: "boolean", nullable: false),
                    SignatureScheme = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    SignatureSchemeVersion = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProviderEvents", x => x.Id);
                    table.UniqueConstraint("AK_ProviderEvents_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_NotificationProviderEvents_Bounce", "(\"EventType\" = 'Bounced') = (\"BounceClass\" IS NOT NULL)");
                    table.CheckConstraint("CK_NotificationProviderEvents_EventId", "\"ProviderEventId\" ~ '^[A-Za-z0-9_.:-]{1,120}$'");
                    table.CheckConstraint("CK_NotificationProviderEvents_Vocabulary", "\"Adapter\" IN ('resend') AND \"EventType\" IN ('ProviderAccepted', 'RecipientServerAccepted', 'Bounced', 'Complained', 'DeliveryDelayed', 'Failed', 'ProviderSuppressed') AND \"SignatureSchemeVersion\" >= 1 AND btrim(\"SignatureScheme\") <> ''");
                    table.ForeignKey(
                        name: "FK_ProviderEvents_ProviderMessages_TenantId_ProviderMessageRec~",
                        columns: x => new { x.TenantId, x.ProviderMessageRecordId },
                        principalSchema: "notifications",
                        principalTable: "ProviderMessages",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "EmailSuppressions",
                schema: "notifications",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    AddressFingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    FingerprintKeyId = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Reason = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    SuppressedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    SourceProviderEventId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceProviderMessageId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmailSuppressions", x => x.Id);
                    table.CheckConstraint("CK_NotificationEmailSuppressions_Vocabulary", "\"Reason\" IN ('PermanentBounce', 'Complaint', 'ProviderSuppressed') AND \"AddressFingerprint\" ~ '^[0-9a-f]{64}$' AND btrim(\"FingerprintKeyId\") <> ''");
                    table.ForeignKey(
                        name: "FK_EmailSuppressions_Memberships_TenantId_UserId",
                        columns: x => new { x.TenantId, x.UserId },
                        principalSchema: "tenancy",
                        principalTable: "Memberships",
                        principalColumns: new[] { "TenantId", "UserId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_EmailSuppressions_ProviderEvents_TenantId_SourceProviderEve~",
                        columns: x => new { x.TenantId, x.SourceProviderEventId },
                        principalSchema: "notifications",
                        principalTable: "ProviderEvents",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_EmailSuppressions_ProviderMessages_TenantId_SourceProviderM~",
                        columns: x => new { x.TenantId, x.SourceProviderMessageId },
                        principalSchema: "notifications",
                        principalTable: "ProviderMessages",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationDeliveryAttempts_ProviderEvidence",
                schema: "notifications",
                table: "DeliveryAttempts",
                sql: "\"ProviderMessageId\" IS NULL OR (\"Channel\" = 'Email' AND \"Outcome\" = 'Succeeded')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationChannelDeliveries_CapturedHasNoProvider",
                schema: "notifications",
                table: "ChannelDeliveries",
                sql: "\"TransportAdapter\" <> 'captured' OR (\"ProviderMessageId\" IS NULL AND \"ProviderAcceptedAtUtc\" IS NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationChannelDeliveries_ProviderEvidence",
                schema: "notifications",
                table: "ChannelDeliveries",
                sql: "((\"ProviderMessageId\" IS NULL) = (\"ProviderAcceptedAtUtc\" IS NULL)) AND (\"ProviderMessageId\" IS NULL OR (\"Channel\" = 'Email' AND \"Status\" = 'Materialized' AND \"TransportAdapter\" IN ('resend')))");

            migrationBuilder.CreateIndex(
                name: "IX_EmailSuppressions_TenantId_SourceProviderEventId",
                schema: "notifications",
                table: "EmailSuppressions",
                columns: new[] { "TenantId", "SourceProviderEventId" });

            migrationBuilder.CreateIndex(
                name: "IX_EmailSuppressions_TenantId_SourceProviderMessageId",
                schema: "notifications",
                table: "EmailSuppressions",
                columns: new[] { "TenantId", "SourceProviderMessageId" });

            migrationBuilder.CreateIndex(
                name: "IX_EmailSuppressions_TenantId_UserId_AddressFingerprint",
                schema: "notifications",
                table: "EmailSuppressions",
                columns: new[] { "TenantId", "UserId", "AddressFingerprint" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProviderEvents_Adapter_ProviderEventId",
                schema: "notifications",
                table: "ProviderEvents",
                columns: new[] { "Adapter", "ProviderEventId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProviderEvents_TenantId_MessageRecordId_ReceivedAtUtc",
                schema: "notifications",
                table: "ProviderEvents",
                columns: new[] { "TenantId", "ProviderMessageRecordId", "ReceivedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_ProviderMessages_Adapter_ProviderMessageId",
                schema: "notifications",
                table: "ProviderMessages",
                columns: new[] { "Adapter", "ProviderMessageId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProviderMessages_TenantId_ChannelDeliveryId",
                schema: "notifications",
                table: "ProviderMessages",
                columns: new[] { "TenantId", "ChannelDeliveryId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProviderMessages_TenantId_ChannelDeliveryId_Channel",
                schema: "notifications",
                table: "ProviderMessages",
                columns: new[] { "TenantId", "ChannelDeliveryId", "Channel" });

            migrationBuilder.CreateIndex(
                name: "IX_ProviderMessages_TenantId_OutboxItemId",
                schema: "notifications",
                table: "ProviderMessages",
                columns: new[] { "TenantId", "OutboxItemId" });

            migrationBuilder.CreateIndex(
                name: "IX_ProviderMessages_TenantId_RecipientUserId_Fingerprint",
                schema: "notifications",
                table: "ProviderMessages",
                columns: new[] { "TenantId", "RecipientUserId", "RecipientAddressFingerprint" });

            CreateProviderProtections(migrationBuilder);
        }

        /// <summary>
        /// The guards that make provider evidence something only a real provider exchange can produce.
        /// </summary>
        /// <remarks>
        /// Every rule here answers the same question: could somebody with a database connection make
        /// this system believe a message was accepted, delivered, bounced or complained about when it
        /// was not? Check constraints alone cannot answer it, because the interesting invariants
        /// compare a row against its previous version or against a row in another table.
        /// <para>
        /// Two of them are deferred constraint triggers rather than ordinary ones, because they
        /// compare rows written in the same transaction and EF Core does not promise a statement
        /// order. Deferring to commit means the check sees the transaction's final state instead of an
        /// arbitrary intermediate one.
        /// </para>
        /// </remarks>
        private static void CreateProviderProtections(MigrationBuilder migrationBuilder)
        {
            // The 6B-3A delivery guard, with its blanket refusal of provider evidence replaced by the
            // narrow rule that now applies. Everything else about it is unchanged, including terminal
            // immutability: provider acceptance is written in the same statement that makes the
            // delivery terminal, never afterwards, which is exactly what keeps that rule intact.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION notifications.protect_channel_delivery()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Channel deliveries are never deleted; a terminal outcome is recorded state' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'INSERT' THEN
                        IF NEW."Status" <> 'Pending'
                           OR NEW."AttemptCount" <> 0
                           OR NEW."DeferralCount" <> 0
                           OR NEW."ClaimToken" IS NOT NULL
                           OR NEW."MaterializedAtUtc" IS NOT NULL
                           OR NEW."CompletedAtUtc" IS NOT NULL
                           OR NEW."DeadLetteredAtUtc" IS NOT NULL
                           OR NEW."TransportAdapter" IS NOT NULL
                           OR NEW."ProviderMessageId" IS NOT NULL
                           OR NEW."ProviderAcceptedAtUtc" IS NOT NULL THEN
                            RAISE EXCEPTION 'A channel delivery must be created pending, unclaimed and unattempted' USING ERRCODE = '23514';
                        END IF;
                        RETURN NEW;
                    END IF;

                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."OutboxItemId" <> NEW."OutboxItemId"
                       OR OLD."Channel" <> NEW."Channel"
                       OR OLD."Purpose" <> NEW."Purpose"
                       OR OLD."SelectionReason" <> NEW."SelectionReason"
                       OR OLD."SelectionPolicyVersion" <> NEW."SelectionPolicyVersion"
                       OR OLD."DueAtUtc" <> NEW."DueAtUtc" THEN
                        RAISE EXCEPTION 'A channel delivery identity and selection provenance are immutable' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Status" IN ('Materialized', 'Suppressed', 'DeadLettered') THEN
                        RAISE EXCEPTION 'A terminal channel delivery is immutable' USING ERRCODE = '23514';
                    END IF;

                    IF OLD."Status" = 'Pending' AND NEW."Status" = 'Processing' THEN
                        IF OLD."ClaimToken" IS NOT NULL OR NEW."ClaimToken" IS NULL
                           OR NEW."AttemptCount" <> OLD."AttemptCount" THEN
                            RAISE EXCEPTION 'A pending delivery is reserved without spending an attempt' USING ERRCODE = '23514';
                        END IF;
                    ELSIF OLD."Status" = 'Pending' AND NEW."Status" = 'Pending' THEN
                        IF NEW."AttemptCount" <> OLD."AttemptCount"
                           OR NEW."DeferralCount" <> OLD."DeferralCount" + 1
                           OR NEW."NextAttemptAtUtc" <= OLD."NextAttemptAtUtc" THEN
                            RAISE EXCEPTION 'A pending delivery only changes by a forward deferral' USING ERRCODE = '23514';
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
                           OR NEW."NextAttemptAtUtc" <= OLD."NextAttemptAtUtc"
                           OR NEW."DeferralCount" NOT IN (OLD."DeferralCount", OLD."DeferralCount" + 1) THEN
                            RAISE EXCEPTION 'A claimed delivery returns pending only for a retry or forward deferral' USING ERRCODE = '23514';
                        END IF;
                        IF NEW."DeferralCount" = OLD."DeferralCount" + 1 AND EXISTS (
                            SELECT 1 FROM notifications."DeliveryAttempts" a
                            WHERE a."TenantId" = OLD."TenantId"
                              AND a."ChannelDeliveryId" = OLD."Id"
                              AND a."ClaimToken" = OLD."ClaimToken") THEN
                            RAISE EXCEPTION 'Quiet-hours deferral cannot discard a started attempt' USING ERRCODE = '23514';
                        END IF;
                        IF NEW."DeferralCount" = OLD."DeferralCount" AND NOT EXISTS (
                            SELECT 1 FROM notifications."DeliveryAttempts" a
                            WHERE a."TenantId" = OLD."TenantId"
                              AND a."ChannelDeliveryId" = OLD."Id"
                              AND a."ClaimToken" = OLD."ClaimToken"
                              AND a."AttemptNumber" = NEW."AttemptCount") THEN
                            RAISE EXCEPTION 'A retry must complete the attempt started by its claim' USING ERRCODE = '23514';
                        END IF;
                    ELSIF OLD."Status" = 'Processing' AND NEW."Status" IN ('Materialized', 'Suppressed', 'DeadLettered') THEN
                        IF NEW."AttemptCount" <> OLD."AttemptCount" THEN
                            RAISE EXCEPTION 'Finalizing a delivery cannot rewrite its attempt count' USING ERRCODE = '23514';
                        END IF;
                        IF NOT EXISTS (
                            SELECT 1 FROM notifications."DeliveryAttempts" a
                            WHERE a."TenantId" = OLD."TenantId"
                              AND a."ChannelDeliveryId" = OLD."Id"
                              AND a."ClaimToken" = OLD."ClaimToken"
                              AND a."AttemptNumber" = NEW."AttemptCount")
                           AND NOT (
                               OLD."ClaimExpiresAtUtc" <= CURRENT_TIMESTAMP
                               AND NEW."Status" = 'Suppressed') THEN
                            RAISE EXCEPTION 'An active claim cannot finalize without its started attempt' USING ERRCODE = '23514';
                        END IF;
                    ELSE
                        RAISE EXCEPTION 'Invalid notification channel delivery transition' USING ERRCODE = '23514';
                    END IF;

                    -- Provider acceptance is written exactly once, in the statement that makes an
                    -- email delivery terminal, and only by an adapter that actually contacted a
                    -- provider. Everything the provider says afterwards belongs to
                    -- notifications."ProviderMessages", which is what lets this stay write-once and
                    -- lets a terminal delivery stay immutable.
                    IF OLD."ProviderMessageId" IS DISTINCT FROM NEW."ProviderMessageId"
                       OR OLD."ProviderAcceptedAtUtc" IS DISTINCT FROM NEW."ProviderAcceptedAtUtc" THEN
                        IF OLD."ProviderMessageId" IS NOT NULL OR OLD."ProviderAcceptedAtUtc" IS NOT NULL THEN
                            RAISE EXCEPTION 'Provider acceptance is recorded once and never rewritten' USING ERRCODE = '23514';
                        END IF;
                        IF NEW."Status" <> 'Materialized'
                           OR NEW."Channel" <> 'Email'
                           OR NEW."ProviderMessageId" IS NULL
                           OR NEW."ProviderAcceptedAtUtc" IS NULL
                           OR NEW."TransportAdapter" IS NULL
                           OR NEW."TransportAdapter" NOT IN ('resend') THEN
                            RAISE EXCEPTION 'Only a materialized email from a real provider adapter records provider acceptance' USING ERRCODE = '23514';
                        END IF;
                    END IF;
                    RETURN NEW;
                END;
                $function$;
                """);

            // The attempt guard, with the same substitution: a provider identifier is no longer
            // impossible, it is possible in exactly one transition and immutable afterwards.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION notifications.protect_delivery_attempt()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Notification delivery attempts are never deleted' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'INSERT' THEN
                        IF NEW."Outcome" <> 'Started'
                           OR NEW."CompletedAtUtc" IS NOT NULL
                           OR NEW."FailureCode" IS NOT NULL
                           OR NEW."ProviderMessageId" IS NOT NULL THEN
                            RAISE EXCEPTION 'A notification delivery attempt must start with outcome Started' USING ERRCODE = '23514';
                        END IF;
                        RETURN NEW;
                    END IF;
                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."ChannelDeliveryId" <> NEW."ChannelDeliveryId"
                       OR OLD."Channel" <> NEW."Channel"
                       OR OLD."AttemptNumber" <> NEW."AttemptNumber"
                       OR OLD."ClaimToken" <> NEW."ClaimToken"
                       OR OLD."IdempotencyKey" <> NEW."IdempotencyKey"
                       OR OLD."StartedAtUtc" <> NEW."StartedAtUtc" THEN
                        RAISE EXCEPTION 'A notification delivery attempt identity is immutable' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Outcome" <> 'Started' THEN
                        RAISE EXCEPTION 'A completed notification delivery attempt is immutable' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."ProviderMessageId" IS DISTINCT FROM NEW."ProviderMessageId" THEN
                        IF OLD."ProviderMessageId" IS NOT NULL THEN
                            RAISE EXCEPTION 'A provider message id is recorded once and never rewritten' USING ERRCODE = '23514';
                        END IF;
                        IF NEW."Channel" <> 'Email' OR NEW."Outcome" <> 'Succeeded' THEN
                            RAISE EXCEPTION 'Only a succeeded email attempt records a provider message id' USING ERRCODE = '23514';
                        END IF;
                    END IF;
                    RETURN NEW;
                END;
                $function$;
                """);

            // An attempt may not claim a provider identifier its own delivery does not hold. Deferred,
            // because the delivery and the attempt are updated in one transaction in either order.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION notifications.assert_attempt_provider_message()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF NEW."ProviderMessageId" IS NULL THEN
                        RETURN NULL;
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM notifications."ChannelDeliveries" d
                        WHERE d."TenantId" = NEW."TenantId"
                          AND d."Id" = NEW."ChannelDeliveryId"
                          AND d."ProviderMessageId" = NEW."ProviderMessageId") THEN
                        RAISE EXCEPTION 'An attempt cannot record a provider message its delivery does not own' USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE CONSTRAINT TRIGGER assert_attempt_provider_message
                AFTER INSERT OR UPDATE ON notifications."DeliveryAttempts"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION notifications.assert_attempt_provider_message();
                """);

            // The provider-message root. Its identity and the mailbox it was accepted for are fixed
            // for life, and every fact a later event contributes is written exactly once: this is what
            // makes an out-of-order event history safe, because no arrival order can overwrite what an
            // earlier one established.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION notifications.protect_provider_message()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Provider message relationships are never deleted' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'INSERT' THEN
                        IF NEW."EventCount" <> 0
                           OR NEW."LastEventReceivedAtUtc" IS NOT NULL
                           OR NEW."RecipientServerAcceptedAtUtc" IS NOT NULL
                           OR NEW."BouncedAtUtc" IS NOT NULL
                           OR NEW."BounceClass" IS NOT NULL
                           OR NEW."ComplainedAtUtc" IS NOT NULL
                           OR NEW."DelayedAtUtc" IS NOT NULL
                           OR NEW."FailedAtUtc" IS NOT NULL
                           OR NEW."ProviderSuppressedAtUtc" IS NOT NULL THEN
                            RAISE EXCEPTION 'A provider message is created with acceptance only; later facts arrive as events' USING ERRCODE = '23514';
                        END IF;
                        RETURN NEW;
                    END IF;

                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."OutboxItemId" <> NEW."OutboxItemId"
                       OR OLD."ChannelDeliveryId" <> NEW."ChannelDeliveryId"
                       OR OLD."Channel" <> NEW."Channel"
                       OR OLD."RecipientUserId" <> NEW."RecipientUserId"
                       OR OLD."Adapter" <> NEW."Adapter"
                       OR OLD."ProviderMessageId" <> NEW."ProviderMessageId"
                       OR OLD."ProviderAcceptedAtUtc" <> NEW."ProviderAcceptedAtUtc"
                       OR OLD."RecipientAddressFingerprint" <> NEW."RecipientAddressFingerprint"
                       OR OLD."FingerprintKeyId" <> NEW."FingerprintKeyId" THEN
                        RAISE EXCEPTION 'A provider message identity, recipient and acceptance are immutable' USING ERRCODE = '23514';
                    END IF;

                    IF (OLD."RecipientServerAcceptedAtUtc" IS NOT NULL
                            AND OLD."RecipientServerAcceptedAtUtc" IS DISTINCT FROM NEW."RecipientServerAcceptedAtUtc")
                       OR (OLD."BouncedAtUtc" IS NOT NULL
                            AND OLD."BouncedAtUtc" IS DISTINCT FROM NEW."BouncedAtUtc")
                       OR (OLD."BounceClass" IS NOT NULL
                            AND OLD."BounceClass" IS DISTINCT FROM NEW."BounceClass")
                       OR (OLD."ComplainedAtUtc" IS NOT NULL
                            AND OLD."ComplainedAtUtc" IS DISTINCT FROM NEW."ComplainedAtUtc")
                       OR (OLD."DelayedAtUtc" IS NOT NULL
                            AND OLD."DelayedAtUtc" IS DISTINCT FROM NEW."DelayedAtUtc")
                       OR (OLD."FailedAtUtc" IS NOT NULL
                            AND OLD."FailedAtUtc" IS DISTINCT FROM NEW."FailedAtUtc")
                       OR (OLD."FailureCode" IS NOT NULL
                            AND OLD."FailureCode" IS DISTINCT FROM NEW."FailureCode")
                       OR (OLD."ProviderSuppressedAtUtc" IS NOT NULL
                            AND OLD."ProviderSuppressedAtUtc" IS DISTINCT FROM NEW."ProviderSuppressedAtUtc") THEN
                        RAISE EXCEPTION 'A provider fact is recorded once; a later event never rewrites an earlier one' USING ERRCODE = '23514';
                    END IF;

                    IF NEW."EventCount" <> OLD."EventCount" + 1 THEN
                        RAISE EXCEPTION 'Each verified provider event advances the event count by exactly one' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."LastEventReceivedAtUtc" IS NULL
                       OR (OLD."LastEventReceivedAtUtc" IS NOT NULL
                            AND NEW."LastEventReceivedAtUtc" < OLD."LastEventReceivedAtUtc") THEN
                        RAISE EXCEPTION 'The last provider event instant never rewinds' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER protect_provider_message
                BEFORE INSERT OR UPDATE OR DELETE ON notifications."ProviderMessages"
                FOR EACH ROW EXECUTE FUNCTION notifications.protect_provider_message();
                """);

            // A provider message may exist only for a delivery that truthfully owns that acceptance.
            // This is the rule that stops provider evidence being fabricated by inserting a row:
            // without a delivery already materialized by a provider adapter and holding the same
            // identifier, there is nothing for the event route to resolve through. Deferred, because
            // the delivery update and this insert commit together.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION notifications.assert_provider_message_acceptance()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM notifications."ChannelDeliveries" d
                        WHERE d."TenantId" = NEW."TenantId"
                          AND d."Id" = NEW."ChannelDeliveryId"
                          AND d."Channel" = 'Email'
                          AND d."Status" = 'Materialized'
                          AND d."TransportAdapter" = NEW."Adapter"
                          AND d."ProviderMessageId" = NEW."ProviderMessageId"
                          AND d."ProviderAcceptedAtUtc" IS NOT NULL
                          AND d."OutboxItemId" = NEW."OutboxItemId") THEN
                        RAISE EXCEPTION 'A provider message must belong to an email delivery that recorded the same provider acceptance' USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE CONSTRAINT TRIGGER assert_provider_message_acceptance
                AFTER INSERT ON notifications."ProviderMessages"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION notifications.assert_provider_message_acceptance();
                """);

            // Webhook evidence is written once and never touched again. A history that can be edited
            // is not evidence, and one that can be deleted cannot explain a suppression afterwards.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION notifications.protect_provider_event()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    RAISE EXCEPTION 'Provider event evidence is append-only' USING ERRCODE = '23514';
                END;
                $function$;

                CREATE TRIGGER protect_provider_event
                BEFORE UPDATE OR DELETE ON notifications."ProviderEvents"
                FOR EACH ROW EXECUTE FUNCTION notifications.protect_provider_event();

                CREATE OR REPLACE FUNCTION notifications.assert_provider_event_fact()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE
                    message notifications."ProviderMessages"%ROWTYPE;
                BEGIN
                    SELECT * INTO message
                    FROM notifications."ProviderMessages" m
                    WHERE m."TenantId" = NEW."TenantId" AND m."Id" = NEW."ProviderMessageRecordId";
                    IF NOT FOUND THEN
                        RAISE EXCEPTION 'Provider evidence must describe a provider message of the same workspace' USING ERRCODE = '23514';
                    END IF;
                    IF message."Adapter" <> NEW."Adapter" THEN
                        RAISE EXCEPTION 'Provider evidence must name the adapter that accepted the message' USING ERRCODE = '23514';
                    END IF;

                    -- An event claiming to have established a fact must be able to point at it. This
                    -- is what stops a row that says "this bounced" from existing beside a message that
                    -- records no bounce.
                    IF NEW."AppliedNewFact" AND NOT (
                        (NEW."EventType" = 'RecipientServerAccepted' AND message."RecipientServerAcceptedAtUtc" IS NOT NULL)
                        OR (NEW."EventType" = 'Bounced' AND message."BouncedAtUtc" IS NOT NULL
                            AND message."BounceClass" = NEW."BounceClass")
                        OR (NEW."EventType" = 'Complained' AND message."ComplainedAtUtc" IS NOT NULL)
                        OR (NEW."EventType" = 'DeliveryDelayed' AND message."DelayedAtUtc" IS NOT NULL)
                        OR (NEW."EventType" = 'Failed' AND message."FailedAtUtc" IS NOT NULL)
                        OR (NEW."EventType" = 'ProviderSuppressed' AND message."ProviderSuppressedAtUtc" IS NOT NULL)) THEN
                        RAISE EXCEPTION 'A provider event that claims a new fact must have recorded it on its message' USING ERRCODE = '23514';
                    END IF;
                    -- The provider restating its own acceptance establishes nothing new by
                    -- construction, so a row claiming otherwise is a fabrication.
                    IF NEW."AppliedNewFact" AND NEW."EventType" = 'ProviderAccepted' THEN
                        RAISE EXCEPTION 'A provider acceptance event establishes no new fact' USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE CONSTRAINT TRIGGER assert_provider_event_fact
                AFTER INSERT ON notifications."ProviderEvents"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION notifications.assert_provider_event_fact();
                """);

            // A suppression is immutable, undeletable, and provable. It may not move between members,
            // workspaces or mailboxes, and it may exist only where an append-only event of a kind that
            // justifies it says so — for the exact mailbox that event's own message was sent to.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION notifications.protect_email_suppression()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    RAISE EXCEPTION 'Email suppressions are append-only; there is no override or clearing surface' USING ERRCODE = '23514';
                END;
                $function$;

                CREATE TRIGGER protect_email_suppression
                BEFORE UPDATE OR DELETE ON notifications."EmailSuppressions"
                FOR EACH ROW EXECUTE FUNCTION notifications.protect_email_suppression();

                CREATE OR REPLACE FUNCTION notifications.assert_email_suppression_evidence()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE
                    message notifications."ProviderMessages"%ROWTYPE;
                    evidence notifications."ProviderEvents"%ROWTYPE;
                BEGIN
                    SELECT * INTO message
                    FROM notifications."ProviderMessages" m
                    WHERE m."TenantId" = NEW."TenantId" AND m."Id" = NEW."SourceProviderMessageId";
                    IF NOT FOUND THEN
                        RAISE EXCEPTION 'A suppression must name a provider message of the same workspace' USING ERRCODE = '23514';
                    END IF;

                    SELECT * INTO evidence
                    FROM notifications."ProviderEvents" e
                    WHERE e."TenantId" = NEW."TenantId" AND e."Id" = NEW."SourceProviderEventId";
                    IF NOT FOUND OR evidence."ProviderMessageRecordId" <> message."Id" THEN
                        RAISE EXCEPTION 'A suppression must name the event that established it, on its own message' USING ERRCODE = '23514';
                    END IF;

                    IF message."RecipientUserId" <> NEW."UserId"
                       OR message."RecipientAddressFingerprint" <> NEW."AddressFingerprint"
                       OR message."FingerprintKeyId" <> NEW."FingerprintKeyId" THEN
                        RAISE EXCEPTION 'A suppression applies to the exact member and mailbox its evidence was sent to' USING ERRCODE = '23514';
                    END IF;

                    IF NOT (
                        (NEW."Reason" = 'PermanentBounce' AND evidence."EventType" = 'Bounced'
                            AND evidence."BounceClass" = 'Permanent')
                        OR (NEW."Reason" = 'Complaint' AND evidence."EventType" = 'Complained')
                        OR (NEW."Reason" = 'ProviderSuppressed' AND evidence."EventType" = 'ProviderSuppressed')) THEN
                        RAISE EXCEPTION 'A suppression reason must match the verified event that caused it' USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE CONSTRAINT TRIGGER assert_email_suppression_evidence
                AFTER INSERT ON notifications."EmailSuppressions"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION notifications.assert_email_suppression_evidence();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            RemoveProviderProtections(migrationBuilder);

            migrationBuilder.DropTable(
                name: "EmailSuppressions",
                schema: "notifications");

            migrationBuilder.DropTable(
                name: "ProviderEvents",
                schema: "notifications");

            migrationBuilder.DropTable(
                name: "ProviderMessages",
                schema: "notifications");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationDeliveryAttempts_ProviderEvidence",
                schema: "notifications",
                table: "DeliveryAttempts");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationChannelDeliveries_CapturedHasNoProvider",
                schema: "notifications",
                table: "ChannelDeliveries");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationChannelDeliveries_ProviderEvidence",
                schema: "notifications",
                table: "ChannelDeliveries");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationChannelDeliveries_ProviderEvidence",
                schema: "notifications",
                table: "ChannelDeliveries",
                sql: "(\"ProviderMessageId\" IS NULL AND \"ProviderAcceptedAtUtc\" IS NULL) OR (\"TransportAdapter\" IS NOT NULL AND \"Status\" = 'Materialized')");
        }

        /// <summary>
        /// Puts the Phase 6B-3A guards back exactly as they were.
        /// </summary>
        /// <remarks>
        /// Reverting discards provider-event history and suppressions, because the tables that hold
        /// them go with it. Every Phase 6B-3A fact survives untouched — intents, channel deliveries and
        /// their terminal outcomes, attempts, inbox rows, preferences and consent evidence — including
        /// the provider acceptance recorded on a delivery, whose columns predate this migration and
        /// satisfy the restored check.
        /// <para>
        /// That asymmetry is the reason production rollback is a forward repair migration rather than a
        /// down migration, which is what this repository has said since Phase 0. This path exists so
        /// the schema can be proven reversible in a test, not so it can be run against real data.
        /// </para>
        /// </remarks>
        private static void RemoveProviderProtections(MigrationBuilder migrationBuilder)
        {
            // Triggers first, then the functions they depend on, in two commands: PostgreSQL refuses
            // to drop a function whose dependent trigger was removed earlier in the same command.
            migrationBuilder.Sql(
                """
                DROP TRIGGER IF EXISTS assert_email_suppression_evidence ON notifications."EmailSuppressions";
                DROP TRIGGER IF EXISTS protect_email_suppression ON notifications."EmailSuppressions";
                DROP TRIGGER IF EXISTS assert_provider_event_fact ON notifications."ProviderEvents";
                DROP TRIGGER IF EXISTS protect_provider_event ON notifications."ProviderEvents";
                DROP TRIGGER IF EXISTS assert_provider_message_acceptance ON notifications."ProviderMessages";
                DROP TRIGGER IF EXISTS protect_provider_message ON notifications."ProviderMessages";
                DROP TRIGGER IF EXISTS assert_attempt_provider_message ON notifications."DeliveryAttempts";
                """);

            migrationBuilder.Sql(
                """
                DROP FUNCTION IF EXISTS notifications.assert_email_suppression_evidence();
                DROP FUNCTION IF EXISTS notifications.protect_email_suppression();
                DROP FUNCTION IF EXISTS notifications.assert_provider_event_fact();
                DROP FUNCTION IF EXISTS notifications.protect_provider_event();
                DROP FUNCTION IF EXISTS notifications.assert_provider_message_acceptance();
                DROP FUNCTION IF EXISTS notifications.protect_provider_message();
                DROP FUNCTION IF EXISTS notifications.assert_attempt_provider_message();
                """);

            // The two amended guards, restored to the bodies Phase 6B-3A left them with.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION notifications.protect_channel_delivery()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Channel deliveries are never deleted; a terminal outcome is recorded state' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'INSERT' THEN
                        IF NEW."Status" <> 'Pending'
                           OR NEW."AttemptCount" <> 0
                           OR NEW."DeferralCount" <> 0
                           OR NEW."ClaimToken" IS NOT NULL
                           OR NEW."MaterializedAtUtc" IS NOT NULL
                           OR NEW."CompletedAtUtc" IS NOT NULL
                           OR NEW."DeadLetteredAtUtc" IS NOT NULL
                           OR NEW."TransportAdapter" IS NOT NULL
                           OR NEW."ProviderMessageId" IS NOT NULL
                           OR NEW."ProviderAcceptedAtUtc" IS NOT NULL THEN
                            RAISE EXCEPTION 'A channel delivery must be created pending, unclaimed and unattempted' USING ERRCODE = '23514';
                        END IF;
                        RETURN NEW;
                    END IF;

                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."OutboxItemId" <> NEW."OutboxItemId"
                       OR OLD."Channel" <> NEW."Channel"
                       OR OLD."Purpose" <> NEW."Purpose"
                       OR OLD."SelectionReason" <> NEW."SelectionReason"
                       OR OLD."SelectionPolicyVersion" <> NEW."SelectionPolicyVersion"
                       OR OLD."DueAtUtc" <> NEW."DueAtUtc" THEN
                        RAISE EXCEPTION 'A channel delivery identity and selection provenance are immutable' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Status" IN ('Materialized', 'Suppressed', 'DeadLettered') THEN
                        RAISE EXCEPTION 'A terminal channel delivery is immutable' USING ERRCODE = '23514';
                    END IF;

                    IF OLD."Status" = 'Pending' AND NEW."Status" = 'Processing' THEN
                        IF OLD."ClaimToken" IS NOT NULL OR NEW."ClaimToken" IS NULL
                           OR NEW."AttemptCount" <> OLD."AttemptCount" THEN
                            RAISE EXCEPTION 'A pending delivery is reserved without spending an attempt' USING ERRCODE = '23514';
                        END IF;
                    ELSIF OLD."Status" = 'Pending' AND NEW."Status" = 'Pending' THEN
                        IF NEW."AttemptCount" <> OLD."AttemptCount"
                           OR NEW."DeferralCount" <> OLD."DeferralCount" + 1
                           OR NEW."NextAttemptAtUtc" <= OLD."NextAttemptAtUtc" THEN
                            RAISE EXCEPTION 'A pending delivery only changes by a forward deferral' USING ERRCODE = '23514';
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
                           OR NEW."NextAttemptAtUtc" <= OLD."NextAttemptAtUtc"
                           OR NEW."DeferralCount" NOT IN (OLD."DeferralCount", OLD."DeferralCount" + 1) THEN
                            RAISE EXCEPTION 'A claimed delivery returns pending only for a retry or forward deferral' USING ERRCODE = '23514';
                        END IF;
                        IF NEW."DeferralCount" = OLD."DeferralCount" + 1 AND EXISTS (
                            SELECT 1 FROM notifications."DeliveryAttempts" a
                            WHERE a."TenantId" = OLD."TenantId"
                              AND a."ChannelDeliveryId" = OLD."Id"
                              AND a."ClaimToken" = OLD."ClaimToken") THEN
                            RAISE EXCEPTION 'Quiet-hours deferral cannot discard a started attempt' USING ERRCODE = '23514';
                        END IF;
                        IF NEW."DeferralCount" = OLD."DeferralCount" AND NOT EXISTS (
                            SELECT 1 FROM notifications."DeliveryAttempts" a
                            WHERE a."TenantId" = OLD."TenantId"
                              AND a."ChannelDeliveryId" = OLD."Id"
                              AND a."ClaimToken" = OLD."ClaimToken"
                              AND a."AttemptNumber" = NEW."AttemptCount") THEN
                            RAISE EXCEPTION 'A retry must complete the attempt started by its claim' USING ERRCODE = '23514';
                        END IF;
                    ELSIF OLD."Status" = 'Processing' AND NEW."Status" IN ('Materialized', 'Suppressed', 'DeadLettered') THEN
                        IF NEW."AttemptCount" <> OLD."AttemptCount" THEN
                            RAISE EXCEPTION 'Finalizing a delivery cannot rewrite its attempt count' USING ERRCODE = '23514';
                        END IF;
                        IF NOT EXISTS (
                            SELECT 1 FROM notifications."DeliveryAttempts" a
                            WHERE a."TenantId" = OLD."TenantId"
                              AND a."ChannelDeliveryId" = OLD."Id"
                              AND a."ClaimToken" = OLD."ClaimToken"
                              AND a."AttemptNumber" = NEW."AttemptCount")
                           AND NOT (
                               OLD."ClaimExpiresAtUtc" <= CURRENT_TIMESTAMP
                               AND NEW."Status" = 'Suppressed') THEN
                            RAISE EXCEPTION 'An active claim cannot finalize without its started attempt' USING ERRCODE = '23514';
                        END IF;
                    ELSE
                        RAISE EXCEPTION 'Invalid notification channel delivery transition' USING ERRCODE = '23514';
                    END IF;

                    IF NEW."ProviderMessageId" IS NOT NULL OR NEW."ProviderAcceptedAtUtc" IS NOT NULL THEN
                        RAISE EXCEPTION 'No email provider exists yet; provider acknowledgement cannot be recorded' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE OR REPLACE FUNCTION notifications.protect_delivery_attempt()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Notification delivery attempts are never deleted' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'INSERT' THEN
                        IF NEW."Outcome" <> 'Started'
                           OR NEW."CompletedAtUtc" IS NOT NULL
                           OR NEW."FailureCode" IS NOT NULL
                           OR NEW."ProviderMessageId" IS NOT NULL THEN
                            RAISE EXCEPTION 'A notification delivery attempt must start with outcome Started' USING ERRCODE = '23514';
                        END IF;
                        RETURN NEW;
                    END IF;
                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."ChannelDeliveryId" <> NEW."ChannelDeliveryId"
                       OR OLD."Channel" <> NEW."Channel"
                       OR OLD."AttemptNumber" <> NEW."AttemptNumber"
                       OR OLD."ClaimToken" <> NEW."ClaimToken"
                       OR OLD."IdempotencyKey" <> NEW."IdempotencyKey"
                       OR OLD."StartedAtUtc" <> NEW."StartedAtUtc" THEN
                        RAISE EXCEPTION 'A notification delivery attempt identity is immutable' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Outcome" <> 'Started' THEN
                        RAISE EXCEPTION 'A completed notification delivery attempt is immutable' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."ProviderMessageId" IS NOT NULL THEN
                        RAISE EXCEPTION 'No email provider exists yet; a provider message id cannot be recorded' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;
                """);
        }
    }
}

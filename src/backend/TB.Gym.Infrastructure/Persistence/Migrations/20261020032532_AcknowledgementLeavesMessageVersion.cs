using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// The counterpart's realtime acknowledgement leaves the message row (audit NCM-12).
    /// </summary>
    /// <remarks>
    /// Copying the first counterpart acknowledgement onto the message rewrote the row whose version
    /// the sender edits and removes against, so within a second of delivery every Edit, Remove and
    /// "Remove as coach" was refused as stale. The fact itself was always the append-only
    /// acknowledgement row, and the deferred assertion this drops existed only to keep the copy equal
    /// to it; the delivery state is now read from those rows. Nothing is lost: the column held exactly
    /// the earliest counterpart acknowledgement, which the rows still say.
    /// </remarks>
    public partial class AcknowledgementLeavesMessageVersion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // First the protections that name the column, so no trigger runs against a column that
            // has gone. The message protection keeps every other rule exactly as the 6B-2B hardening
            // wrote it: immutable identity, a revision number that never moves backwards, one-way
            // removal, and a provider column nothing may set.
            migrationBuilder.Sql(
                """
                DROP TRIGGER IF EXISTS assert_message_realtime_acknowledgement ON messaging."RealtimeAcknowledgements";
                DROP TRIGGER IF EXISTS assert_message_realtime_acknowledgement ON messaging."Messages";
                DROP FUNCTION IF EXISTS messaging.assert_message_realtime_acknowledgement();

                CREATE OR REPLACE FUNCTION messaging.protect_message()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Messages are never deleted; removal is recorded state' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'INSERT' THEN
                        IF NEW."ProviderAcknowledgedAtUtc" IS NOT NULL THEN
                            RAISE EXCEPTION 'No provider channel exists to have acknowledged a message' USING ERRCODE = '23514';
                        END IF;
                        RETURN NEW;
                    END IF;
                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."ConversationId" <> NEW."ConversationId"
                       OR OLD."SenderUserId" <> NEW."SenderUserId"
                       OR OLD."Sequence" <> NEW."Sequence"
                       OR OLD."SentAtUtc" <> NEW."SentAtUtc"
                       OR OLD."AvailableAtUtc" <> NEW."AvailableAtUtc" THEN
                        RAISE EXCEPTION 'A message identity is immutable' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."CurrentRevisionNumber" < OLD."CurrentRevisionNumber" THEN
                        RAISE EXCEPTION 'A message revision number cannot move backwards' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."ProviderAcknowledgedAtUtc" IS NOT NULL THEN
                        RAISE EXCEPTION 'No provider channel exists to have acknowledged a message' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."DeletedAtUtc" IS NOT NULL THEN
                        IF NEW."DeletedAtUtc" IS NULL
                           OR NEW."DeletedAtUtc" <> OLD."DeletedAtUtc"
                           OR NEW."DeletionKind" <> OLD."DeletionKind"
                           OR NEW."DeletedByUserId" IS DISTINCT FROM OLD."DeletedByUserId"
                           OR NEW."ModerationReason" IS DISTINCT FROM OLD."ModerationReason" THEN
                            RAISE EXCEPTION 'Message removal is one way and its record is immutable' USING ERRCODE = '23514';
                        END IF;
                        IF NEW."CurrentRevisionNumber" <> OLD."CurrentRevisionNumber" THEN
                            RAISE EXCEPTION 'A removed message cannot be edited' USING ERRCODE = '23514';
                        END IF;
                    END IF;
                    RETURN NEW;
                END;
                $function$;
                """);

            migrationBuilder.DropCheckConstraint(
                name: "CK_Messages_Acknowledgements",
                schema: "messaging",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "RealtimeAcknowledgedAtUtc",
                schema: "messaging",
                table: "Messages");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Messages_Acknowledgements",
                schema: "messaging",
                table: "Messages",
                sql: "\"ProviderAcknowledgedAtUtc\" IS NULL OR \"ProviderAcknowledgedAtUtc\" >= \"AvailableAtUtc\"");
        }

        /// <summary>
        /// Puts the column back, filled from the acknowledgement rows it was always derived from, and
        /// restores the 6B-2B hardening's protections exactly as that migration wrote them.
        /// </summary>
        /// <remarks>
        /// As with every migration here, this exists so the schema is reversible for a database that
        /// has just been built. Production rollback means restoring a tested backup or deploying a
        /// forward repair migration, exactly as ARCHITECTURE.md section 7 says.
        /// </remarks>
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Messages_Acknowledgements",
                schema: "messaging",
                table: "Messages");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "RealtimeAcknowledgedAtUtc",
                schema: "messaging",
                table: "Messages",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.Sql(
                """
                UPDATE messaging."Messages" AS m
                SET "RealtimeAcknowledgedAtUtc" = first_ack."AcknowledgedAtUtc"
                FROM (
                    SELECT e."TenantId", e."MessageId", min(a."AcknowledgedAtUtc") AS "AcknowledgedAtUtc"
                    FROM messaging."RealtimeAcknowledgements" a
                    JOIN messaging."RealtimeEvents" e
                      ON e."TenantId" = a."TenantId" AND e."Id" = a."RealtimeEventId"
                    JOIN messaging."Messages" s
                      ON s."TenantId" = e."TenantId" AND s."Id" = e."MessageId"
                    WHERE a."AcknowledgedByUserId" <> s."SenderUserId"
                    GROUP BY e."TenantId", e."MessageId"
                ) AS first_ack
                WHERE m."TenantId" = first_ack."TenantId" AND m."Id" = first_ack."MessageId";
                """);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Messages_Acknowledgements",
                schema: "messaging",
                table: "Messages",
                sql: "(\"RealtimeAcknowledgedAtUtc\" IS NULL OR \"RealtimeAcknowledgedAtUtc\" >= \"AvailableAtUtc\") AND (\"ProviderAcknowledgedAtUtc\" IS NULL OR \"ProviderAcknowledgedAtUtc\" >= \"AvailableAtUtc\")");

            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION messaging.protect_message()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Messages are never deleted; removal is recorded state' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'INSERT' THEN
                        IF NEW."RealtimeAcknowledgedAtUtc" IS NOT NULL THEN
                            RAISE EXCEPTION 'A message cannot start with a counterpart acknowledgement' USING ERRCODE = '23514';
                        END IF;
                        IF NEW."ProviderAcknowledgedAtUtc" IS NOT NULL THEN
                            RAISE EXCEPTION 'No provider channel exists to have acknowledged a message' USING ERRCODE = '23514';
                        END IF;
                        RETURN NEW;
                    END IF;
                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."ConversationId" <> NEW."ConversationId"
                       OR OLD."SenderUserId" <> NEW."SenderUserId"
                       OR OLD."Sequence" <> NEW."Sequence"
                       OR OLD."SentAtUtc" <> NEW."SentAtUtc"
                       OR OLD."AvailableAtUtc" <> NEW."AvailableAtUtc" THEN
                        RAISE EXCEPTION 'A message identity is immutable' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."CurrentRevisionNumber" < OLD."CurrentRevisionNumber" THEN
                        RAISE EXCEPTION 'A message revision number cannot move backwards' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."RealtimeAcknowledgedAtUtc" IS NOT NULL
                       AND NEW."RealtimeAcknowledgedAtUtc" IS DISTINCT FROM OLD."RealtimeAcknowledgedAtUtc" THEN
                        RAISE EXCEPTION 'A realtime acknowledgement instant is written once and never moved' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."ProviderAcknowledgedAtUtc" IS NOT NULL THEN
                        RAISE EXCEPTION 'No provider channel exists to have acknowledged a message' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."DeletedAtUtc" IS NOT NULL THEN
                        IF NEW."DeletedAtUtc" IS NULL
                           OR NEW."DeletedAtUtc" <> OLD."DeletedAtUtc"
                           OR NEW."DeletionKind" <> OLD."DeletionKind"
                           OR NEW."DeletedByUserId" IS DISTINCT FROM OLD."DeletedByUserId"
                           OR NEW."ModerationReason" IS DISTINCT FROM OLD."ModerationReason" THEN
                            RAISE EXCEPTION 'Message removal is one way and its record is immutable' USING ERRCODE = '23514';
                        END IF;
                        IF NEW."CurrentRevisionNumber" <> OLD."CurrentRevisionNumber" THEN
                            RAISE EXCEPTION 'A removed message cannot be edited' USING ERRCODE = '23514';
                        END IF;
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE OR REPLACE FUNCTION messaging.assert_message_realtime_acknowledgement()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE
                    affected_tenant uuid;
                    affected_message uuid;
                    sender_user uuid;
                    stored_ack timestamp with time zone;
                    first_counterpart_ack timestamp with time zone;
                BEGIN
                    IF TG_TABLE_NAME = 'Messages' THEN
                        affected_tenant := NEW."TenantId";
                        affected_message := NEW."Id";
                    ELSE
                        SELECT e."TenantId", e."MessageId"
                        INTO affected_tenant, affected_message
                        FROM messaging."RealtimeEvents" e
                        WHERE e."TenantId" = NEW."TenantId" AND e."Id" = NEW."RealtimeEventId";
                    END IF;

                    IF affected_message IS NULL THEN
                        RETURN NULL;
                    END IF;

                    SELECT m."SenderUserId", m."RealtimeAcknowledgedAtUtc"
                    INTO sender_user, stored_ack
                    FROM messaging."Messages" m
                    WHERE m."TenantId" = affected_tenant AND m."Id" = affected_message;
                    IF NOT FOUND THEN
                        RETURN NULL;
                    END IF;

                    SELECT min(a."AcknowledgedAtUtc")
                    INTO first_counterpart_ack
                    FROM messaging."RealtimeAcknowledgements" a
                    JOIN messaging."RealtimeEvents" e
                      ON e."TenantId" = a."TenantId" AND e."Id" = a."RealtimeEventId"
                    WHERE e."TenantId" = affected_tenant
                      AND e."MessageId" = affected_message
                      AND a."AcknowledgedByUserId" <> sender_user;

                    IF stored_ack IS DISTINCT FROM first_counterpart_ack THEN
                        RAISE EXCEPTION 'A message counterpart acknowledgement must equal its first durable counterpart acknowledgement fact' USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE CONSTRAINT TRIGGER assert_message_realtime_acknowledgement
                AFTER INSERT OR UPDATE ON messaging."Messages"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION messaging.assert_message_realtime_acknowledgement();

                CREATE CONSTRAINT TRIGGER assert_message_realtime_acknowledgement
                AFTER INSERT ON messaging."RealtimeAcknowledgements"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION messaging.assert_message_realtime_acknowledgement();
                """);
        }
    }
}

using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase6B2BRealtimeIntegrityHardening : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Every event kind is the exact durable consequence of its source command. The previous
            // predicate distinguished only creation from non-creation, so one non-creation command
            // could be mislabeled as any other non-creation event.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION messaging.assert_realtime_event_source()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE
                    source_conversation uuid;
                    source_message uuid;
                    source_command text;
                    expected_kind text;
                BEGIN
                    SELECT r."ConversationId", r."MessageId", r."CommandType"
                    INTO source_conversation, source_message, source_command
                    FROM messaging."CommandRecords" r
                    WHERE r."TenantId" = NEW."TenantId" AND r."Id" = NEW."SourceCommandRecordId";
                    IF NOT FOUND THEN
                        RETURN NULL;
                    END IF;

                    IF source_conversation <> NEW."ConversationId" THEN
                        RAISE EXCEPTION 'A realtime event must belong to its source command conversation' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."MessageId" IS DISTINCT FROM source_message THEN
                        RAISE EXCEPTION 'A realtime event must name its source command message' USING ERRCODE = '23514';
                    END IF;

                    expected_kind := CASE source_command
                        WHEN 'CreateConversation' THEN 'ConversationCreated'
                        WHEN 'SendMessage' THEN 'MessageSent'
                        WHEN 'EditMessage' THEN 'MessageEdited'
                        WHEN 'DeleteMessage' THEN 'MessageSenderRemoved'
                        WHEN 'ModerateMessage' THEN 'MessageCoachModerated'
                        ELSE NULL
                    END;
                    IF expected_kind IS NULL OR NEW."Kind" <> expected_kind THEN
                        RAISE EXCEPTION 'A realtime event kind must match its source command type' USING ERRCODE = '23514';
                    END IF;

                    IF NEW."MessageId" IS NOT NULL THEN
                        IF NOT EXISTS (
                            SELECT 1 FROM messaging."Messages" m
                            WHERE m."TenantId" = NEW."TenantId"
                              AND m."Id" = NEW."MessageId"
                              AND m."Sequence" = NEW."MessageSequence"
                              AND m."CurrentRevisionNumber" >= NEW."MessageRevisionNumber") THEN
                            RAISE EXCEPTION 'A realtime event must name a real message position and an existing revision' USING ERRCODE = '23514';
                        END IF;
                    END IF;
                    RETURN NULL;
                END;
                $function$;
                """);

            // An attempt is born Started. Completion is the only permitted update, after which the
            // row remains immutable. A completed INSERT would otherwise fabricate history without a
            // dispatcher ever having held the claim.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION messaging.protect_realtime_attempt()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Realtime attempts are never deleted' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'INSERT' THEN
                        IF NEW."Outcome" <> 'Started'
                           OR NEW."CompletedAtUtc" IS NOT NULL
                           OR NEW."FailureCode" IS NOT NULL THEN
                            RAISE EXCEPTION 'A realtime attempt must start with outcome Started' USING ERRCODE = '23514';
                        END IF;
                        RETURN NEW;
                    END IF;
                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."RecipientId" <> NEW."RecipientId"
                       OR OLD."AttemptNumber" <> NEW."AttemptNumber"
                       OR OLD."ClaimToken" <> NEW."ClaimToken"
                       OR OLD."StartedAtUtc" <> NEW."StartedAtUtc" THEN
                        RAISE EXCEPTION 'A realtime attempt identity is immutable' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Outcome" <> 'Started' THEN
                        RAISE EXCEPTION 'A completed realtime attempt is immutable' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                DROP TRIGGER protect_realtime_attempt ON messaging."RealtimeAttempts";
                CREATE TRIGGER protect_realtime_attempt
                BEFORE INSERT OR UPDATE OR DELETE ON messaging."RealtimeAttempts"
                FOR EACH ROW EXECUTE FUNCTION messaging.protect_realtime_attempt();
                """);

            // The provider column is null even on INSERT, and the counterpart timestamp is checked
            // against the append-only acknowledgement facts at commit. Deferred checks allow EF to
            // insert the fact and update the message in either statement order within one transaction.
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

                DROP TRIGGER protect_message ON messaging."Messages";
                CREATE TRIGGER protect_message
                BEFORE INSERT OR UPDATE OR DELETE ON messaging."Messages"
                FOR EACH ROW EXECUTE FUNCTION messaging.protect_message();

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

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DROP TRIGGER IF EXISTS assert_message_realtime_acknowledgement ON messaging."RealtimeAcknowledgements";
                DROP TRIGGER IF EXISTS assert_message_realtime_acknowledgement ON messaging."Messages";
                DROP FUNCTION IF EXISTS messaging.assert_message_realtime_acknowledgement();

                CREATE OR REPLACE FUNCTION messaging.assert_realtime_event_source()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE
                    source_conversation uuid;
                    source_message uuid;
                    source_command text;
                BEGIN
                    SELECT r."ConversationId", r."MessageId", r."CommandType"
                    INTO source_conversation, source_message, source_command
                    FROM messaging."CommandRecords" r
                    WHERE r."TenantId" = NEW."TenantId" AND r."Id" = NEW."SourceCommandRecordId";
                    IF NOT FOUND THEN
                        RETURN NULL;
                    END IF;
                    IF source_conversation <> NEW."ConversationId" THEN
                        RAISE EXCEPTION 'A realtime event must belong to its source command conversation' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."MessageId" IS DISTINCT FROM source_message THEN
                        RAISE EXCEPTION 'A realtime event must name its source command message' USING ERRCODE = '23514';
                    END IF;
                    IF (NEW."Kind" = 'ConversationCreated') <> (source_command = 'CreateConversation') THEN
                        RAISE EXCEPTION 'A realtime event kind must match its source command type' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."MessageId" IS NOT NULL THEN
                        IF NOT EXISTS (
                            SELECT 1 FROM messaging."Messages" m
                            WHERE m."TenantId" = NEW."TenantId"
                              AND m."Id" = NEW."MessageId"
                              AND m."Sequence" = NEW."MessageSequence"
                              AND m."CurrentRevisionNumber" >= NEW."MessageRevisionNumber") THEN
                            RAISE EXCEPTION 'A realtime event must name a real message position and an existing revision' USING ERRCODE = '23514';
                        END IF;
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE OR REPLACE FUNCTION messaging.protect_realtime_attempt()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Realtime attempts are never deleted' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."RecipientId" <> NEW."RecipientId"
                       OR OLD."AttemptNumber" <> NEW."AttemptNumber"
                       OR OLD."ClaimToken" <> NEW."ClaimToken"
                       OR OLD."StartedAtUtc" <> NEW."StartedAtUtc" THEN
                        RAISE EXCEPTION 'A realtime attempt identity is immutable' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Outcome" <> 'Started' THEN
                        RAISE EXCEPTION 'A completed realtime attempt is immutable' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                DROP TRIGGER protect_realtime_attempt ON messaging."RealtimeAttempts";
                CREATE TRIGGER protect_realtime_attempt
                BEFORE UPDATE OR DELETE ON messaging."RealtimeAttempts"
                FOR EACH ROW EXECUTE FUNCTION messaging.protect_realtime_attempt();

                CREATE OR REPLACE FUNCTION messaging.protect_message()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Messages are never deleted; removal is recorded state' USING ERRCODE = '23514';
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

                DROP TRIGGER protect_message ON messaging."Messages";
                CREATE TRIGGER protect_message
                BEFORE UPDATE OR DELETE ON messaging."Messages"
                FOR EACH ROW EXECUTE FUNCTION messaging.protect_message();
                """);

        }
    }
}

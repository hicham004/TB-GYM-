using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase6B2BRealtimeMessagingDelivery : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "LastEventSequence",
                schema: "messaging",
                table: "Conversations",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_CommandRecords_TenantId_Id",
                schema: "messaging",
                table: "CommandRecords",
                columns: new[] { "TenantId", "Id" });

            migrationBuilder.CreateTable(
                name: "RealtimeEvents",
                schema: "messaging",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ConversationId = table.Column<Guid>(type: "uuid", nullable: false),
                    EventSequence = table.Column<long>(type: "bigint", nullable: false),
                    Kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    MessageId = table.Column<Guid>(type: "uuid", nullable: true),
                    MessageSequence = table.Column<long>(type: "bigint", nullable: true),
                    MessageRevisionNumber = table.Column<int>(type: "integer", nullable: true),
                    SourceCommandRecordId = table.Column<Guid>(type: "uuid", nullable: false),
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
                    table.PrimaryKey("PK_RealtimeEvents", x => x.Id);
                    table.UniqueConstraint("AK_RealtimeEvents_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.UniqueConstraint("AK_RealtimeEvents_TenantId_Id_ConversationId", x => new { x.TenantId, x.Id, x.ConversationId });
                    table.CheckConstraint("CK_RealtimeEvents_EventSequence", "\"EventSequence\" >= 1");
                    table.CheckConstraint("CK_RealtimeEvents_KindValue", "\"Kind\" IN ('ConversationCreated', 'MessageSent', 'MessageEdited', 'MessageSenderRemoved', 'MessageCoachModerated')");
                    table.CheckConstraint("CK_RealtimeEvents_Message", "(\"MessageId\" IS NULL) = (\"Kind\" = 'ConversationCreated') AND (\"MessageId\" IS NULL) = (\"MessageSequence\" IS NULL) AND (\"MessageId\" IS NULL) = (\"MessageRevisionNumber\" IS NULL)");
                    table.CheckConstraint("CK_RealtimeEvents_MessagePosition", "(\"MessageSequence\" IS NULL OR \"MessageSequence\" >= 1) AND (\"MessageRevisionNumber\" IS NULL OR \"MessageRevisionNumber\" >= 1)");
                    table.ForeignKey(
                        name: "FK_RealtimeEvents_CommandRecords_TenantId_SourceCommandRecordId",
                        columns: x => new { x.TenantId, x.SourceCommandRecordId },
                        principalSchema: "messaging",
                        principalTable: "CommandRecords",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RealtimeEvents_Conversations_TenantId_ConversationId",
                        columns: x => new { x.TenantId, x.ConversationId },
                        principalSchema: "messaging",
                        principalTable: "Conversations",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RealtimeEvents_Messages_TenantId_MessageId_ConversationId",
                        columns: x => new { x.TenantId, x.MessageId, x.ConversationId },
                        principalSchema: "messaging",
                        principalTable: "Messages",
                        principalColumns: new[] { "TenantId", "Id", "ConversationId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RealtimeRecipients",
                schema: "messaging",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ConversationId = table.Column<Guid>(type: "uuid", nullable: false),
                    RealtimeEventId = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipientUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    AttemptCount = table.Column<int>(type: "integer", nullable: false),
                    NextAttemptAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ClaimToken = table.Column<Guid>(type: "uuid", nullable: true),
                    ClaimExpiresAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    PublishedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CompletedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
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
                    table.PrimaryKey("PK_RealtimeRecipients", x => x.Id);
                    table.UniqueConstraint("AK_RealtimeRecipients_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.UniqueConstraint("AK_RealtimeRecipients_TenantId_RealtimeEventId_RecipientUserId", x => new { x.TenantId, x.RealtimeEventId, x.RecipientUserId });
                    table.CheckConstraint("CK_RealtimeRecipients_AttemptCount", "\"AttemptCount\" >= 0 AND \"AttemptCount\" <= 20");
                    table.CheckConstraint("CK_RealtimeRecipients_Claim", "(\"ClaimToken\" IS NOT NULL) = (\"Status\" = 'Processing') AND (\"ClaimToken\" IS NULL) = (\"ClaimExpiresAtUtc\" IS NULL)");
                    table.CheckConstraint("CK_RealtimeRecipients_Completed", "(\"CompletedAtUtc\" IS NOT NULL) = (\"Status\" IN ('Published', 'Suppressed', 'DeadLettered'))");
                    table.CheckConstraint("CK_RealtimeRecipients_FailureCode", "(\"Status\" = 'Published' AND \"FailureCode\" IS NULL) OR (\"Status\" IN ('Suppressed', 'DeadLettered') AND \"FailureCode\" IS NOT NULL) OR \"Status\" IN ('Pending', 'Processing')");
                    table.CheckConstraint("CK_RealtimeRecipients_Published", "(\"PublishedAtUtc\" IS NOT NULL) = (\"Status\" = 'Published')");
                    table.CheckConstraint("CK_RealtimeRecipients_PublishedAttempt", "\"PublishedAtUtc\" IS NULL OR \"AttemptCount\" >= 1");
                    table.CheckConstraint("CK_RealtimeRecipients_StatusValue", "\"Status\" IN ('Pending', 'Processing', 'Published', 'Suppressed', 'DeadLettered')");
                    table.ForeignKey(
                        name: "FK_RealtimeRecipients_ConversationParticipants_TenantId_Conver~",
                        columns: x => new { x.TenantId, x.ConversationId, x.RecipientUserId },
                        principalSchema: "messaging",
                        principalTable: "ConversationParticipants",
                        principalColumns: new[] { "TenantId", "ConversationId", "UserId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RealtimeRecipients_RealtimeEvents_TenantId_RealtimeEventId_~",
                        columns: x => new { x.TenantId, x.RealtimeEventId, x.ConversationId },
                        principalSchema: "messaging",
                        principalTable: "RealtimeEvents",
                        principalColumns: new[] { "TenantId", "Id", "ConversationId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RealtimeAcknowledgements",
                schema: "messaging",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ConversationId = table.Column<Guid>(type: "uuid", nullable: false),
                    RealtimeEventId = table.Column<Guid>(type: "uuid", nullable: false),
                    AcknowledgedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    AcknowledgedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RealtimeAcknowledgements", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RealtimeAcknowledgements_RealtimeEvents_TenantId_RealtimeEv~",
                        columns: x => new { x.TenantId, x.RealtimeEventId, x.ConversationId },
                        principalSchema: "messaging",
                        principalTable: "RealtimeEvents",
                        principalColumns: new[] { "TenantId", "Id", "ConversationId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RealtimeAcknowledgements_RealtimeRecipients_TenantId_Realti~",
                        columns: x => new { x.TenantId, x.RealtimeEventId, x.AcknowledgedByUserId },
                        principalSchema: "messaging",
                        principalTable: "RealtimeRecipients",
                        principalColumns: new[] { "TenantId", "RealtimeEventId", "RecipientUserId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RealtimeAcknowledgements_Users_AcknowledgedByUserId",
                        column: x => x.AcknowledgedByUserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RealtimeAttempts",
                schema: "messaging",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipientId = table.Column<Guid>(type: "uuid", nullable: false),
                    AttemptNumber = table.Column<int>(type: "integer", nullable: false),
                    ClaimToken = table.Column<Guid>(type: "uuid", nullable: false),
                    StartedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CompletedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Outcome = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
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
                    table.PrimaryKey("PK_RealtimeAttempts", x => x.Id);
                    table.CheckConstraint("CK_RealtimeAttempts_AttemptNumber", "\"AttemptNumber\" >= 1 AND \"AttemptNumber\" <= 20");
                    table.CheckConstraint("CK_RealtimeAttempts_Completion", "(\"CompletedAtUtc\" IS NOT NULL) = (\"Outcome\" <> 'Started') AND (\"CompletedAtUtc\" IS NULL OR \"CompletedAtUtc\" >= \"StartedAtUtc\")");
                    table.CheckConstraint("CK_RealtimeAttempts_FailureCode", "(\"Outcome\" IN ('Started', 'Published') AND \"FailureCode\" IS NULL) OR (\"Outcome\" NOT IN ('Started', 'Published') AND \"FailureCode\" IS NOT NULL)");
                    table.CheckConstraint("CK_RealtimeAttempts_OutcomeValue", "\"Outcome\" IN ('Started', 'Published', 'TransientFailure', 'PermanentFailure', 'Abandoned', 'Suppressed')");
                    table.ForeignKey(
                        name: "FK_RealtimeAttempts_RealtimeRecipients_TenantId_RecipientId",
                        columns: x => new { x.TenantId, x.RecipientId },
                        principalSchema: "messaging",
                        principalTable: "RealtimeRecipients",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Conversations_LastEventSequence",
                schema: "messaging",
                table: "Conversations",
                sql: "\"LastEventSequence\" >= 0");

            migrationBuilder.CreateIndex(
                name: "IX_RealtimeAcknowledgements_AcknowledgedByUserId",
                schema: "messaging",
                table: "RealtimeAcknowledgements",
                column: "AcknowledgedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_RealtimeAcks_TenantId_ConversationId_AcknowledgedAtUtc",
                schema: "messaging",
                table: "RealtimeAcknowledgements",
                columns: new[] { "TenantId", "ConversationId", "AcknowledgedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_RealtimeAcks_TenantId_RealtimeEventId_AcknowledgedByUserId",
                schema: "messaging",
                table: "RealtimeAcknowledgements",
                columns: new[] { "TenantId", "RealtimeEventId", "AcknowledgedByUserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RealtimeAcknowledgements_TenantId_RealtimeEventId_Conversat~",
                schema: "messaging",
                table: "RealtimeAcknowledgements",
                columns: new[] { "TenantId", "RealtimeEventId", "ConversationId" });

            migrationBuilder.CreateIndex(
                name: "IX_RealtimeAttempts_TenantId_RecipientId_AttemptNumber",
                schema: "messaging",
                table: "RealtimeAttempts",
                columns: new[] { "TenantId", "RecipientId", "AttemptNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RealtimeEvents_TenantId_ConversationId_EventSequence",
                schema: "messaging",
                table: "RealtimeEvents",
                columns: new[] { "TenantId", "ConversationId", "EventSequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RealtimeEvents_TenantId_MessageId_ConversationId",
                schema: "messaging",
                table: "RealtimeEvents",
                columns: new[] { "TenantId", "MessageId", "ConversationId" });

            migrationBuilder.CreateIndex(
                name: "IX_RealtimeEvents_TenantId_SourceCommandRecordId",
                schema: "messaging",
                table: "RealtimeEvents",
                columns: new[] { "TenantId", "SourceCommandRecordId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RealtimeRecipients_TenantId_ConversationId_RecipientUserId",
                schema: "messaging",
                table: "RealtimeRecipients",
                columns: new[] { "TenantId", "ConversationId", "RecipientUserId" });

            migrationBuilder.CreateIndex(
                name: "IX_RealtimeRecipients_TenantId_RealtimeEventId_ConversationId",
                schema: "messaging",
                table: "RealtimeRecipients",
                columns: new[] { "TenantId", "RealtimeEventId", "ConversationId" });

            migrationBuilder.CreateIndex(
                name: "IX_RealtimeRecipients_TenantId_Status_NextAttemptAtUtc",
                schema: "messaging",
                table: "RealtimeRecipients",
                columns: new[] { "TenantId", "Status", "NextAttemptAtUtc" });

            // ---------- the invariants ordinary keys and checks cannot express ----------

            // The event allocator is the durable tip of the event stream, exactly as LastSequence is
            // for messages, so it gets the same protections: it never rewinds, it never jumps, and it
            // has to agree with what is actually stored. Existing 6B-2A conversations start at zero
            // and hold no events, which the "empty" branch below states rather than assumes.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION messaging.protect_conversation_event_allocator()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'INSERT' THEN
                        -- Zero for a conversation upgraded from Phase 6B-2A, one for a conversation
                        -- created together with its own creation event in the same transaction.
                        -- Anything above one would be a conversation created with a history it never
                        -- had; the deferred tip assertion then requires that a one really has its
                        -- event, so this bound and that agreement together leave no room for an
                        -- allocator that was simply made up.
                        IF NEW."LastEventSequence" > 1 THEN
                            RAISE EXCEPTION 'A new conversation cannot be created with realtime event history' USING ERRCODE = '23514';
                        END IF;
                        RETURN NEW;
                    END IF;
                    IF NEW."LastEventSequence" < OLD."LastEventSequence" THEN
                        RAISE EXCEPTION 'A conversation realtime event allocator cannot move backwards' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."LastEventSequence" > OLD."LastEventSequence" + 1 THEN
                        RAISE EXCEPTION 'A conversation realtime event allocator advances one position at a time' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER protect_conversation_event_allocator
                BEFORE INSERT OR UPDATE ON messaging."Conversations"
                FOR EACH ROW EXECUTE FUNCTION messaging.protect_conversation_event_allocator();
                """);

            // The event tip, asserted from both sides at commit. An event inserted after position one
            // must have its predecessor, and LastEventSequence must identify the highest stored event
            // — so neither a gap nor an imaginary tip can commit, and a catch-up cursor that says
            // "I have everything up to here" is telling the truth.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION messaging.assert_conversation_event_tip()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE
                    conversation_id uuid;
                    expected_sequence bigint;
                    newest_sequence bigint;
                BEGIN
                    IF TG_TABLE_NAME = 'Conversations' THEN
                        conversation_id := NEW."Id";
                    ELSE
                        conversation_id := NEW."ConversationId";
                        IF NEW."EventSequence" > 1 AND NOT EXISTS (
                            SELECT 1
                            FROM messaging."RealtimeEvents" predecessor
                            WHERE predecessor."TenantId" = NEW."TenantId"
                              AND predecessor."ConversationId" = NEW."ConversationId"
                              AND predecessor."EventSequence" = NEW."EventSequence" - 1) THEN
                            RAISE EXCEPTION 'A realtime event sequence cannot have a gap' USING ERRCODE = '23514';
                        END IF;
                    END IF;

                    SELECT c."LastEventSequence" INTO expected_sequence
                    FROM messaging."Conversations" c
                    WHERE c."TenantId" = NEW."TenantId" AND c."Id" = conversation_id;
                    IF NOT FOUND THEN
                        -- The foreign key reports a missing conversation, and conversation deletion is
                        -- independently forbidden, so there is no valid disappearing-parent case here.
                        RETURN NULL;
                    END IF;

                    SELECT max(e."EventSequence") INTO newest_sequence
                    FROM messaging."RealtimeEvents" e
                    WHERE e."TenantId" = NEW."TenantId" AND e."ConversationId" = conversation_id;

                    IF expected_sequence = 0 THEN
                        IF newest_sequence IS NOT NULL THEN
                            RAISE EXCEPTION 'A conversation with no event tip cannot contain a realtime event' USING ERRCODE = '23514';
                        END IF;
                    ELSIF newest_sequence IS DISTINCT FROM expected_sequence THEN
                        RAISE EXCEPTION 'The conversation event tip must identify its newest realtime event' USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE CONSTRAINT TRIGGER assert_conversation_event_tip
                AFTER INSERT OR UPDATE ON messaging."Conversations"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION messaging.assert_conversation_event_tip();

                CREATE CONSTRAINT TRIGGER assert_conversation_event_tip
                AFTER INSERT ON messaging."RealtimeEvents"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION messaging.assert_conversation_event_tip();
                """);

            // The event a mutation produced has to be about that mutation. A send names its own
            // message, an edit or a removal names the message its command named, and every event
            // belongs to the conversation its source command belongs to. Without this a raw write
            // could point an event at somebody else's message and have it materialized, with current
            // authorization passing, into content the participant was never sent.
            migrationBuilder.Sql(
                """
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

                CREATE CONSTRAINT TRIGGER assert_realtime_event_source
                AFTER INSERT ON messaging."RealtimeEvents"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION messaging.assert_realtime_event_source();
                """);

            // Both explicit participants, and only them. A recipient row for one side but not the
            // other would silently drop a participant's delivery, and a row for somebody who is not
            // in the conversation is already refused by the participant foreign key — this is the
            // completeness half that key cannot state.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION messaging.assert_realtime_recipients_complete()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE
                    event_id uuid;
                    event_conversation uuid;
                    event_tenant uuid;
                    recipient_count integer;
                    participant_count integer;
                BEGIN
                    IF TG_TABLE_NAME = 'RealtimeEvents' THEN
                        event_id := NEW."Id";
                        event_conversation := NEW."ConversationId";
                    ELSE
                        event_id := NEW."RealtimeEventId";
                        event_conversation := NEW."ConversationId";
                    END IF;
                    event_tenant := NEW."TenantId";

                    SELECT count(*) INTO recipient_count
                    FROM messaging."RealtimeRecipients" r
                    WHERE r."TenantId" = event_tenant AND r."RealtimeEventId" = event_id;

                    SELECT count(*) INTO participant_count
                    FROM messaging."ConversationParticipants" p
                    WHERE p."TenantId" = event_tenant AND p."ConversationId" = event_conversation;

                    IF recipient_count <> participant_count THEN
                        RAISE EXCEPTION 'A realtime event needs publication state for every conversation participant' USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE CONSTRAINT TRIGGER assert_realtime_recipients_complete
                AFTER INSERT ON messaging."RealtimeEvents"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION messaging.assert_realtime_recipients_complete();

                CREATE CONSTRAINT TRIGGER assert_realtime_recipients_complete
                AFTER INSERT ON messaging."RealtimeRecipients"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION messaging.assert_realtime_recipients_complete();
                """);

            // Publication state is never deleted, never reattributed, and never leaves a terminal
            // status. A terminal row that could be reopened is how a dead letter becomes a success
            // nobody can contradict, and a claim that could be re-taken after Published is how one
            // frame becomes an unbounded number of them.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION messaging.protect_realtime_recipient()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Realtime publication state is never deleted' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'INSERT' THEN
                        IF NEW."Status" <> 'Pending' OR NEW."AttemptCount" <> 0 THEN
                            RAISE EXCEPTION 'Realtime publication state starts pending with no attempts' USING ERRCODE = '23514';
                        END IF;
                        RETURN NEW;
                    END IF;
                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."ConversationId" <> NEW."ConversationId"
                       OR OLD."RealtimeEventId" <> NEW."RealtimeEventId"
                       OR OLD."RecipientUserId" <> NEW."RecipientUserId" THEN
                        RAISE EXCEPTION 'Realtime publication state identity is immutable' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Status" IN ('Published', 'Suppressed', 'DeadLettered') THEN
                        RAISE EXCEPTION 'A terminal realtime publication cannot be dispatched or changed again' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."AttemptCount" < OLD."AttemptCount" THEN
                        RAISE EXCEPTION 'A realtime attempt count cannot move backwards' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."AttemptCount" > OLD."AttemptCount" + 1 THEN
                        RAISE EXCEPTION 'A realtime attempt count advances one attempt at a time' USING ERRCODE = '23514';
                    END IF;
                    -- Issuing a claim token is the only thing that starts an attempt, and it always
                    -- starts exactly one. Stated on the token rather than on the status because a
                    -- reclaim goes Processing to Processing: the lease expired, a different worker
                    -- takes over, and that is a new attempt even though the status did not change.
                    IF (NEW."ClaimToken" IS NOT NULL AND NEW."ClaimToken" IS DISTINCT FROM OLD."ClaimToken")
                       <> (NEW."AttemptCount" = OLD."AttemptCount" + 1) THEN
                        RAISE EXCEPTION 'A realtime claim consumes exactly one attempt' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER protect_realtime_recipient
                BEFORE INSERT OR UPDATE OR DELETE ON messaging."RealtimeRecipients"
                FOR EACH ROW EXECUTE FUNCTION messaging.protect_realtime_recipient();
                """);

            // Attempt history is append-only and its outcome is written once. A completed attempt
            // that could be rewritten is the only record of what happened being editable by whatever
            // happened next.
            migrationBuilder.Sql(
                """
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

                CREATE TRIGGER protect_realtime_attempt
                BEFORE UPDATE OR DELETE ON messaging."RealtimeAttempts"
                FOR EACH ROW EXECUTE FUNCTION messaging.protect_realtime_attempt();
                """);

            // The attempt rows for a publication are exactly the contiguous chain 1..AttemptCount,
            // and every attempt presents the claim its row was holding when it started. Together with
            // the one-at-a-time rule above and the hard ceiling in the check constraints, this is
            // what makes "every started attempt counts, and maximum + 1 is impossible" a database
            // fact rather than a property of the C# that happens to be running.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION messaging.assert_realtime_attempt_chain()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE
                    recipient_id uuid;
                    expected_count integer;
                    attempt_count integer;
                    lowest integer;
                    highest integer;
                BEGIN
                    IF TG_TABLE_NAME = 'RealtimeRecipients' THEN
                        recipient_id := NEW."Id";
                    ELSE
                        recipient_id := NEW."RecipientId";
                    END IF;

                    SELECT r."AttemptCount" INTO expected_count
                    FROM messaging."RealtimeRecipients" r
                    WHERE r."TenantId" = NEW."TenantId" AND r."Id" = recipient_id;
                    IF NOT FOUND THEN
                        RETURN NULL;
                    END IF;

                    SELECT count(*), min(a."AttemptNumber"), max(a."AttemptNumber")
                    INTO attempt_count, lowest, highest
                    FROM messaging."RealtimeAttempts" a
                    WHERE a."TenantId" = NEW."TenantId" AND a."RecipientId" = recipient_id;

                    IF expected_count = 0 THEN
                        IF attempt_count <> 0 THEN
                            RAISE EXCEPTION 'A realtime publication with no attempts cannot have attempt history' USING ERRCODE = '23514';
                        END IF;
                        RETURN NULL;
                    END IF;

                    IF attempt_count <> expected_count OR lowest <> 1 OR highest <> expected_count THEN
                        RAISE EXCEPTION 'Realtime attempts must be the contiguous chain 1..AttemptCount' USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE CONSTRAINT TRIGGER assert_realtime_attempt_chain
                AFTER INSERT OR UPDATE ON messaging."RealtimeRecipients"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION messaging.assert_realtime_attempt_chain();

                CREATE CONSTRAINT TRIGGER assert_realtime_attempt_chain
                AFTER INSERT ON messaging."RealtimeAttempts"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION messaging.assert_realtime_attempt_chain();
                """);

            // Acknowledgements are append-only, and the instant is the server's. Moving one would
            // rewrite when the other side actually had a message, which is the one thing this record
            // exists to be able to state.
            migrationBuilder.Sql(
                """
                CREATE TRIGGER protect_realtime_acknowledgement
                BEFORE UPDATE OR DELETE ON messaging."RealtimeAcknowledgements"
                FOR EACH ROW EXECUTE FUNCTION messaging.protect_append_only();

                CREATE TRIGGER protect_realtime_event
                BEFORE UPDATE OR DELETE ON messaging."RealtimeEvents"
                FOR EACH ROW EXECUTE FUNCTION messaging.protect_append_only();
                """);

            // The counterpart-delivery timestamp is written once and never moved, and the provider
            // column stays null because no provider channel exists to have accepted anything. This
            // extends the existing message protection rather than replacing it, so every 6B-2A rule
            // about immutable identity, one-way removal and the revision chain is untouched.
            migrationBuilder.Sql(
                """
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
                """);
        }

        /// <summary>
        /// Reverting this migration removes realtime delivery and keeps every persisted message.
        /// </summary>
        /// <remarks>
        /// Unlike the 6B-2A revert, this one destroys no conversation, message, revision, removal
        /// record or read position: those tables are not touched. What it drops is the record of what
        /// was published to whom, which attempts were made, and which events each application
        /// acknowledged — history that cannot be rebuilt, and whose loss means a client reconnecting
        /// across the rollback catches up from its full REST read instead of from an event cursor.
        /// <para>
        /// It restores the 6B-2A <c>protect_message</c> function exactly as that migration wrote it,
        /// so a revert leaves the message protections it found rather than a version that mentions
        /// columns whose meaning has gone.
        /// </para>
        /// <para>
        /// As with every migration here, this exists so the schema is reversible for a database that
        /// has just been built. Production rollback means restoring a tested backup or deploying a
        /// forward repair migration, exactly as ARCHITECTURE.md section 7 says.
        /// </para>
        /// </remarks>
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DROP TRIGGER IF EXISTS protect_realtime_event ON messaging."RealtimeEvents";
                DROP TRIGGER IF EXISTS protect_realtime_acknowledgement ON messaging."RealtimeAcknowledgements";
                DROP TRIGGER IF EXISTS assert_realtime_attempt_chain ON messaging."RealtimeAttempts";
                DROP TRIGGER IF EXISTS assert_realtime_attempt_chain ON messaging."RealtimeRecipients";
                DROP TRIGGER IF EXISTS protect_realtime_attempt ON messaging."RealtimeAttempts";
                DROP TRIGGER IF EXISTS protect_realtime_recipient ON messaging."RealtimeRecipients";
                DROP TRIGGER IF EXISTS assert_realtime_recipients_complete ON messaging."RealtimeRecipients";
                DROP TRIGGER IF EXISTS assert_realtime_recipients_complete ON messaging."RealtimeEvents";
                DROP TRIGGER IF EXISTS assert_realtime_event_source ON messaging."RealtimeEvents";
                DROP TRIGGER IF EXISTS assert_conversation_event_tip ON messaging."RealtimeEvents";
                DROP TRIGGER IF EXISTS assert_conversation_event_tip ON messaging."Conversations";
                DROP TRIGGER IF EXISTS protect_conversation_event_allocator ON messaging."Conversations";
                DROP FUNCTION IF EXISTS messaging.assert_realtime_attempt_chain();
                DROP FUNCTION IF EXISTS messaging.protect_realtime_attempt();
                DROP FUNCTION IF EXISTS messaging.protect_realtime_recipient();
                DROP FUNCTION IF EXISTS messaging.assert_realtime_recipients_complete();
                DROP FUNCTION IF EXISTS messaging.assert_realtime_event_source();
                DROP FUNCTION IF EXISTS messaging.assert_conversation_event_tip();
                DROP FUNCTION IF EXISTS messaging.protect_conversation_event_allocator();
                """);

            // The Phase 6B-2A message protection, restored verbatim.
            migrationBuilder.Sql(
                """
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

            migrationBuilder.DropTable(
                name: "RealtimeAcknowledgements",
                schema: "messaging");

            migrationBuilder.DropTable(
                name: "RealtimeAttempts",
                schema: "messaging");

            migrationBuilder.DropTable(
                name: "RealtimeRecipients",
                schema: "messaging");

            migrationBuilder.DropTable(
                name: "RealtimeEvents",
                schema: "messaging");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Conversations_LastEventSequence",
                schema: "messaging",
                table: "Conversations");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_CommandRecords_TenantId_Id",
                schema: "messaging",
                table: "CommandRecords");

            migrationBuilder.DropColumn(
                name: "LastEventSequence",
                schema: "messaging",
                table: "Conversations");
        }
    }
}

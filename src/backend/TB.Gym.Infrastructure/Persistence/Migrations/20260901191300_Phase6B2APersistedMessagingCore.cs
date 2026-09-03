using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase6B2APersistedMessagingCore : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "messaging");

            migrationBuilder.CreateTable(
                name: "Conversations",
                schema: "messaging",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    CoachUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    StartedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LastSequence = table.Column<long>(type: "bigint", nullable: false),
                    LastActivityAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LastMessageId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Conversations", x => x.Id);
                    table.UniqueConstraint("AK_Conversations_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_Conversations_Activity", "\"LastActivityAtUtc\" >= \"StartedAtUtc\"");
                    table.CheckConstraint("CK_Conversations_DistinctParticipants", "\"CoachUserId\" <> \"ClientUserId\"");
                    table.CheckConstraint("CK_Conversations_LastMessage", "(\"LastMessageId\" IS NULL) = (\"LastSequence\" = 0)");
                    table.CheckConstraint("CK_Conversations_LastSequence", "\"LastSequence\" >= 0");
                    table.ForeignKey(
                        name: "FK_Conversations_ClientProfiles_TenantId_ClientProfileId",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Conversations_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalSchema: "tenancy",
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Conversations_Users_ClientUserId",
                        column: x => x.ClientUserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Conversations_Users_CoachUserId",
                        column: x => x.CoachUserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ConversationParticipants",
                schema: "messaging",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ConversationId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Role = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    LastReadSequence = table.Column<long>(type: "bigint", nullable: false),
                    LastReadAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ConversationParticipants", x => x.Id);
                    table.UniqueConstraint("AK_ConversationParticipants_TenantId_ConversationId_UserId", x => new { x.TenantId, x.ConversationId, x.UserId });
                    table.CheckConstraint("CK_ConversationParticipants_ReadCursor", "\"LastReadSequence\" >= 0");
                    table.CheckConstraint("CK_ConversationParticipants_ReadInstant", "(\"LastReadAtUtc\" IS NULL) = (\"LastReadSequence\" = 0)");
                    table.CheckConstraint("CK_ConversationParticipants_Role", "\"Role\" IN ('Coach', 'Client')");
                    table.ForeignKey(
                        name: "FK_ConversationParticipants_Conversations_TenantId_Conversatio~",
                        columns: x => new { x.TenantId, x.ConversationId },
                        principalSchema: "messaging",
                        principalTable: "Conversations",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ConversationParticipants_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Messages",
                schema: "messaging",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ConversationId = table.Column<Guid>(type: "uuid", nullable: false),
                    SenderUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Sequence = table.Column<long>(type: "bigint", nullable: false),
                    SentAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    AvailableAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    RealtimeAcknowledgedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ProviderAcknowledgedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CurrentRevisionNumber = table.Column<int>(type: "integer", nullable: false),
                    EditedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DeletedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DeletionKind = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: true),
                    DeletedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    ModerationReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Messages", x => x.Id);
                    table.UniqueConstraint("AK_Messages_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.UniqueConstraint("AK_Messages_TenantId_Id_ConversationId", x => new { x.TenantId, x.Id, x.ConversationId });
                    table.UniqueConstraint("AK_Messages_TenantId_Id_SenderUserId", x => new { x.TenantId, x.Id, x.SenderUserId });
                    table.CheckConstraint("CK_Messages_Acknowledgements", "(\"RealtimeAcknowledgedAtUtc\" IS NULL OR \"RealtimeAcknowledgedAtUtc\" >= \"AvailableAtUtc\") AND (\"ProviderAcknowledgedAtUtc\" IS NULL OR \"ProviderAcknowledgedAtUtc\" >= \"AvailableAtUtc\")");
                    table.CheckConstraint("CK_Messages_Available", "\"AvailableAtUtc\" >= \"SentAtUtc\"");
                    table.CheckConstraint("CK_Messages_Deleted", "(\"DeletedAtUtc\" IS NULL) = (\"DeletionKind\" IS NULL) AND (\"DeletedAtUtc\" IS NULL) = (\"DeletedByUserId\" IS NULL)");
                    table.CheckConstraint("CK_Messages_DeletionKindValue", "\"DeletionKind\" IS NULL OR \"DeletionKind\" IN ('SenderRemoved', 'CoachModerated')");
                    table.CheckConstraint("CK_Messages_Edited", "(\"EditedAtUtc\" IS NULL) = (\"CurrentRevisionNumber\" = 1)");
                    table.CheckConstraint("CK_Messages_ModerationReason", "(\"ModerationReason\" IS NOT NULL) = (\"DeletionKind\" = 'CoachModerated')");
                    table.CheckConstraint("CK_Messages_RevisionNumber", "\"CurrentRevisionNumber\" >= 1");
                    table.CheckConstraint("CK_Messages_Sequence", "\"Sequence\" >= 1");
                    table.ForeignKey(
                        name: "FK_Messages_ConversationParticipants_TenantId_ConversationId_S~",
                        columns: x => new { x.TenantId, x.ConversationId, x.SenderUserId },
                        principalSchema: "messaging",
                        principalTable: "ConversationParticipants",
                        principalColumns: new[] { "TenantId", "ConversationId", "UserId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Messages_Conversations_TenantId_ConversationId",
                        columns: x => new { x.TenantId, x.ConversationId },
                        principalSchema: "messaging",
                        principalTable: "Conversations",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CommandRecords",
                schema: "messaging",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    IdempotencyKey = table.Column<Guid>(type: "uuid", nullable: false),
                    CommandType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    PayloadFingerprint = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    ActorUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ConversationId = table.Column<Guid>(type: "uuid", nullable: false),
                    MessageId = table.Column<Guid>(type: "uuid", nullable: true),
                    RecordedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CommandRecords", x => x.Id);
                    table.CheckConstraint("CK_MessagingCommandRecords_CommandTypeValue", "\"CommandType\" IN ('CreateConversation', 'SendMessage', 'EditMessage', 'DeleteMessage', 'ModerateMessage')");
                    table.CheckConstraint("CK_MessagingCommandRecords_Fingerprint", "\"PayloadFingerprint\" ~ '^[0-9a-f]{64}$'");
                    table.CheckConstraint("CK_MessagingCommandRecords_Message", "(\"MessageId\" IS NULL) = (\"CommandType\" = 'CreateConversation')");
                    table.ForeignKey(
                        name: "FK_CommandRecords_Conversations_TenantId_ConversationId",
                        columns: x => new { x.TenantId, x.ConversationId },
                        principalSchema: "messaging",
                        principalTable: "Conversations",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CommandRecords_Messages_TenantId_MessageId_ConversationId",
                        columns: x => new { x.TenantId, x.MessageId, x.ConversationId },
                        principalSchema: "messaging",
                        principalTable: "Messages",
                        principalColumns: new[] { "TenantId", "Id", "ConversationId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "MessageDeletionEvents",
                schema: "messaging",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ConversationId = table.Column<Guid>(type: "uuid", nullable: false),
                    MessageId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    ActorUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    RevisionNumberAtRemoval = table.Column<int>(type: "integer", nullable: false),
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
                    table.PrimaryKey("PK_MessageDeletionEvents", x => x.Id);
                    table.CheckConstraint("CK_MessageDeletionEvents_KindValue", "\"Kind\" IN ('SenderRemoved', 'CoachModerated')");
                    table.CheckConstraint("CK_MessageDeletionEvents_Reason", "(\"Reason\" IS NOT NULL) = (\"Kind\" = 'CoachModerated')");
                    table.CheckConstraint("CK_MessageDeletionEvents_Revision", "\"RevisionNumberAtRemoval\" >= 1");
                    table.ForeignKey(
                        name: "FK_MessageDeletionEvents_Messages_TenantId_MessageId_Conversat~",
                        columns: x => new { x.TenantId, x.MessageId, x.ConversationId },
                        principalSchema: "messaging",
                        principalTable: "Messages",
                        principalColumns: new[] { "TenantId", "Id", "ConversationId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "MessageRevisions",
                schema: "messaging",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MessageId = table.Column<Guid>(type: "uuid", nullable: false),
                    RevisionNumber = table.Column<int>(type: "integer", nullable: false),
                    Body = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    AuthoredByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    AuthoredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MessageRevisions", x => x.Id);
                    table.CheckConstraint("CK_MessageRevisions_RevisionNumber", "\"RevisionNumber\" >= 1");
                    table.ForeignKey(
                        name: "FK_MessageRevisions_Messages_TenantId_MessageId_AuthoredByUser~",
                        columns: x => new { x.TenantId, x.MessageId, x.AuthoredByUserId },
                        principalSchema: "messaging",
                        principalTable: "Messages",
                        principalColumns: new[] { "TenantId", "Id", "SenderUserId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CommandRecords_TenantId_ConversationId_RecordedAtUtc",
                schema: "messaging",
                table: "CommandRecords",
                columns: new[] { "TenantId", "ConversationId", "RecordedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_CommandRecords_TenantId_IdempotencyKey",
                schema: "messaging",
                table: "CommandRecords",
                columns: new[] { "TenantId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CommandRecords_TenantId_MessageId_ConversationId",
                schema: "messaging",
                table: "CommandRecords",
                columns: new[] { "TenantId", "MessageId", "ConversationId" });

            migrationBuilder.CreateIndex(
                name: "IX_ConversationParticipants_TenantId_ConversationId_Role",
                schema: "messaging",
                table: "ConversationParticipants",
                columns: new[] { "TenantId", "ConversationId", "Role" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ConversationParticipants_TenantId_UserId_ConversationId",
                schema: "messaging",
                table: "ConversationParticipants",
                columns: new[] { "TenantId", "UserId", "ConversationId" });

            migrationBuilder.CreateIndex(
                name: "IX_ConversationParticipants_UserId",
                schema: "messaging",
                table: "ConversationParticipants",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_Conversations_ClientUserId",
                schema: "messaging",
                table: "Conversations",
                column: "ClientUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Conversations_CoachUserId",
                schema: "messaging",
                table: "Conversations",
                column: "CoachUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Conversations_TenantId_ClientProfileId",
                schema: "messaging",
                table: "Conversations",
                columns: new[] { "TenantId", "ClientProfileId" });

            migrationBuilder.CreateIndex(
                name: "IX_Conversations_TenantId_ClientProfileId_CoachUserId",
                schema: "messaging",
                table: "Conversations",
                columns: new[] { "TenantId", "ClientProfileId", "CoachUserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Conversations_TenantId_LastActivityAtUtc_Id",
                schema: "messaging",
                table: "Conversations",
                columns: new[] { "TenantId", "LastActivityAtUtc", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_MessageDeletionEvents_TenantId_MessageId",
                schema: "messaging",
                table: "MessageDeletionEvents",
                columns: new[] { "TenantId", "MessageId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MessageDeletionEvents_TenantId_MessageId_ConversationId",
                schema: "messaging",
                table: "MessageDeletionEvents",
                columns: new[] { "TenantId", "MessageId", "ConversationId" });

            migrationBuilder.CreateIndex(
                name: "IX_MessageRevisions_TenantId_MessageId_AuthoredByUserId",
                schema: "messaging",
                table: "MessageRevisions",
                columns: new[] { "TenantId", "MessageId", "AuthoredByUserId" });

            migrationBuilder.CreateIndex(
                name: "IX_MessageRevisions_TenantId_MessageId_RevisionNumber",
                schema: "messaging",
                table: "MessageRevisions",
                columns: new[] { "TenantId", "MessageId", "RevisionNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Messages_TenantId_ConversationId_SenderUserId",
                schema: "messaging",
                table: "Messages",
                columns: new[] { "TenantId", "ConversationId", "SenderUserId" });

            migrationBuilder.CreateIndex(
                name: "IX_Messages_TenantId_ConversationId_Sequence",
                schema: "messaging",
                table: "Messages",
                columns: new[] { "TenantId", "ConversationId", "Sequence" },
                unique: true);

            // A direct conversation has exactly one Coach-side and one Client-side participant, and
            // they are the two people the conversation row names. The unique role index and the role
            // value check together refuse a third; this refuses a conversation created with one side
            // missing, or with a participant who is not the coach or client the row identifies. It is
            // a deferred constraint trigger because both rows are inserted in the same transaction,
            // so the assertion can only be true at commit.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION messaging.assert_direct_participants()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE
                    participant_count integer;
                BEGIN
                    SELECT count(*) INTO participant_count
                    FROM messaging."ConversationParticipants" p
                    WHERE p."TenantId" = NEW."TenantId" AND p."ConversationId" = NEW."Id";
                    IF participant_count <> 2 THEN
                        RAISE EXCEPTION 'A direct conversation has exactly two participants' USING ERRCODE = '23514';
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM messaging."ConversationParticipants" p
                        WHERE p."TenantId" = NEW."TenantId" AND p."ConversationId" = NEW."Id"
                          AND p."Role" = 'Coach' AND p."UserId" = NEW."CoachUserId") THEN
                        RAISE EXCEPTION 'The coach participant must be the conversation coach' USING ERRCODE = '23514';
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM messaging."ConversationParticipants" p
                        WHERE p."TenantId" = NEW."TenantId" AND p."ConversationId" = NEW."Id"
                          AND p."Role" = 'Client' AND p."UserId" = NEW."ClientUserId") THEN
                        RAISE EXCEPTION 'The client participant must be the conversation client' USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE CONSTRAINT TRIGGER assert_direct_participants
                AFTER INSERT ON messaging."Conversations"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION messaging.assert_direct_participants();
                """);

            // A conversation is never deleted and its identity never changes. The sequence allocator
            // and the activity instant only move forward, because a conversation that could rewind
            // either would let a committed message be overwritten or reordered under a reader.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION messaging.protect_conversation()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Conversations are never deleted' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'INSERT' THEN
                        IF NEW."LastSequence" <> 0 OR NEW."LastMessageId" IS NOT NULL THEN
                            RAISE EXCEPTION 'A new conversation must start with an empty message sequence' USING ERRCODE = '23514';
                        END IF;
                        RETURN NEW;
                    END IF;
                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."ClientProfileId" <> NEW."ClientProfileId"
                       OR OLD."CoachUserId" <> NEW."CoachUserId"
                       OR OLD."ClientUserId" <> NEW."ClientUserId"
                       OR OLD."StartedAtUtc" <> NEW."StartedAtUtc" THEN
                        RAISE EXCEPTION 'A conversation identity is immutable' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."LastSequence" < OLD."LastSequence" THEN
                        RAISE EXCEPTION 'A conversation sequence allocator cannot move backwards' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."LastSequence" > OLD."LastSequence" + 1 THEN
                        RAISE EXCEPTION 'A conversation sequence allocator advances one position at a time' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."LastActivityAtUtc" < OLD."LastActivityAtUtc" THEN
                        RAISE EXCEPTION 'Conversation activity cannot move backwards' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER protect_conversation
                BEFORE INSERT OR UPDATE OR DELETE ON messaging."Conversations"
                FOR EACH ROW EXECUTE FUNCTION messaging.protect_conversation();
                """);

            // LastSequence and LastMessageId are the durable tip of the message stream, not an
            // independent counter that repair SQL may advance. Assert the agreement from both
            // sides at commit, and require every inserted message after sequence one to have its
            // predecessor. Together with the empty-conversation and one-step allocator rules above,
            // this makes a gap or an imaginary tip impossible without scanning the entire stream.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION messaging.assert_conversation_message_tip()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE
                    conversation_id uuid;
                    expected_sequence bigint;
                    expected_message_id uuid;
                    newest_sequence bigint;
                    newest_message_id uuid;
                BEGIN
                    IF TG_TABLE_NAME = 'Conversations' THEN
                        conversation_id := NEW."Id";
                    ELSE
                        conversation_id := NEW."ConversationId";
                        IF NEW."Sequence" > 1 AND NOT EXISTS (
                            SELECT 1
                            FROM messaging."Messages" predecessor
                            WHERE predecessor."TenantId" = NEW."TenantId"
                              AND predecessor."ConversationId" = NEW."ConversationId"
                              AND predecessor."Sequence" = NEW."Sequence" - 1) THEN
                            RAISE EXCEPTION 'A message sequence cannot have a gap' USING ERRCODE = '23514';
                        END IF;
                    END IF;

                    SELECT c."LastSequence", c."LastMessageId"
                    INTO expected_sequence, expected_message_id
                    FROM messaging."Conversations" c
                    WHERE c."TenantId" = NEW."TenantId" AND c."Id" = conversation_id;
                    IF NOT FOUND THEN
                        -- The message foreign key reports a missing conversation. There is no valid
                        -- disappearing-parent case because conversation deletion is forbidden.
                        RETURN NULL;
                    END IF;

                    SELECT m."Sequence", m."Id"
                    INTO newest_sequence, newest_message_id
                    FROM messaging."Messages" m
                    WHERE m."TenantId" = NEW."TenantId" AND m."ConversationId" = conversation_id
                    ORDER BY m."Sequence" DESC
                    LIMIT 1;

                    IF expected_sequence = 0 THEN
                        IF newest_sequence IS NOT NULL OR expected_message_id IS NOT NULL THEN
                            RAISE EXCEPTION 'An empty conversation cannot contain a message' USING ERRCODE = '23514';
                        END IF;
                    ELSIF newest_sequence IS DISTINCT FROM expected_sequence
                       OR newest_message_id IS DISTINCT FROM expected_message_id THEN
                        RAISE EXCEPTION 'The conversation tip must identify its newest message' USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE CONSTRAINT TRIGGER assert_conversation_message_tip
                AFTER INSERT OR UPDATE ON messaging."Conversations"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION messaging.assert_conversation_message_tip();

                CREATE CONSTRAINT TRIGGER assert_conversation_message_tip
                AFTER INSERT ON messaging."Messages"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION messaging.assert_conversation_message_tip();
                """);

            // Membership is explicit and immutable in this slice: a participant row is never removed
            // and never changes who or what it is. Only the read cursor moves, and only forwards — a
            // cursor that could regress would silently re-notify somebody about what they had read.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION messaging.protect_conversation_participant()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Conversation participants are never deleted' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."ConversationId" <> NEW."ConversationId"
                       OR OLD."UserId" <> NEW."UserId"
                       OR OLD."Role" <> NEW."Role" THEN
                        RAISE EXCEPTION 'A conversation participant is immutable except for its read cursor' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."LastReadSequence" < OLD."LastReadSequence" THEN
                        RAISE EXCEPTION 'A conversation read cursor cannot move backwards' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER protect_conversation_participant
                BEFORE UPDATE OR DELETE ON messaging."ConversationParticipants"
                FOR EACH ROW EXECUTE FUNCTION messaging.protect_conversation_participant();
                """);

            // A cursor may never name a message that does not exist. The application clamps to the
            // newest committed sequence; a repair script does not, and a cursor past the tip would
            // silently hide the next message that arrives. Deferred, because a send commits the
            // message and the conversation's new LastSequence in the same transaction.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION messaging.assert_read_cursor_within_conversation()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE
                    newest bigint;
                BEGIN
                    SELECT c."LastSequence" INTO newest
                    FROM messaging."Conversations" c
                    WHERE c."TenantId" = NEW."TenantId" AND c."Id" = NEW."ConversationId";
                    IF newest IS NULL THEN
                        RETURN NULL;
                    END IF;
                    IF NEW."LastReadSequence" > newest THEN
                        RAISE EXCEPTION 'A read cursor cannot pass the newest committed sequence' USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE CONSTRAINT TRIGGER assert_read_cursor_within_conversation
                AFTER INSERT OR UPDATE ON messaging."ConversationParticipants"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION messaging.assert_read_cursor_within_conversation();
                """);

            // A message is never hard-deleted, never renumbered, never reattributed and never
            // restored once removed. Editing a removed message is refused here too, and so is
            // rewriting who removed it or why: the actor and the reason are as much a part of the
            // record as the fact that it happened.
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

                CREATE TRIGGER protect_message
                BEFORE UPDATE OR DELETE ON messaging."Messages"
                FOR EACH ROW EXECUTE FUNCTION messaging.protect_message();
                """);

            // A body lives only in a revision row, so a message with no revision says nothing and can
            // never be rendered, and a current revision number that names a missing row points at
            // nothing. The revisions must also be the contiguous chain 1..N that the audit trail
            // depends on: a gap would make "what did this message say before" unanswerable. Deferred,
            // because the message and its first revision are inserted together.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION messaging.assert_message_revisions()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE
                    message_id uuid;
                    current_revision integer;
                    revision_count integer;
                    lowest integer;
                    highest integer;
                BEGIN
                    IF TG_TABLE_NAME = 'Messages' THEN
                        message_id := NEW."Id";
                    ELSE
                        message_id := NEW."MessageId";
                    END IF;

                    SELECT m."CurrentRevisionNumber" INTO current_revision
                    FROM messaging."Messages" m
                    WHERE m."TenantId" = NEW."TenantId" AND m."Id" = message_id;
                    IF NOT FOUND THEN
                        -- The foreign key reports a missing parent for a revision insert. A message
                        -- delete is independently forbidden, so there is no valid disappearing-parent
                        -- case for this deferred assertion to diagnose.
                        RETURN NULL;
                    END IF;

                    SELECT count(*), min(r."RevisionNumber"), max(r."RevisionNumber")
                    INTO revision_count, lowest, highest
                    FROM messaging."MessageRevisions" r
                    WHERE r."TenantId" = NEW."TenantId" AND r."MessageId" = message_id;
                    IF revision_count = 0 THEN
                        RAISE EXCEPTION 'A message must have at least one revision' USING ERRCODE = '23514';
                    END IF;
                    IF lowest <> 1 OR highest <> current_revision
                       OR revision_count <> current_revision THEN
                        RAISE EXCEPTION 'Message revisions must be the contiguous chain 1..CurrentRevisionNumber' USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE CONSTRAINT TRIGGER assert_message_revisions
                AFTER INSERT OR UPDATE ON messaging."Messages"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION messaging.assert_message_revisions();

                CREATE CONSTRAINT TRIGGER assert_message_revisions
                AFTER INSERT ON messaging."MessageRevisions"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION messaging.assert_message_revisions();
                """);

            // The removal state on the message and the append-only event that explains it are two
            // records of one fact, and they must agree about every part of it. State without an event
            // loses who did it and why; an event without state hides a body nobody removed. Deferred
            // on both sides, because a removal writes both rows in one transaction.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION messaging.assert_removal_agreement()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE
                    message_id uuid;
                    m record;
                    e record;
                BEGIN
                    -- An IF rather than a CASE expression: plpgsql resolves the type of every
                    -- branch of a CASE, so the branch for the other table would be evaluated
                    -- against a record that has no such field.
                    IF TG_TABLE_NAME = 'Messages' THEN
                        message_id := NEW."Id";
                    ELSE
                        message_id := NEW."MessageId";
                    END IF;
                    SELECT * INTO m FROM messaging."Messages" WHERE "Id" = message_id;
                    IF NOT FOUND THEN
                        RETURN NULL;
                    END IF;

                    SELECT * INTO e FROM messaging."MessageDeletionEvents" WHERE "MessageId" = message_id;
                    IF m."DeletedAtUtc" IS NULL THEN
                        IF FOUND THEN
                            RAISE EXCEPTION 'A removal event describes a message that was not removed' USING ERRCODE = '23514';
                        END IF;
                        RETURN NULL;
                    END IF;

                    IF NOT FOUND THEN
                        RAISE EXCEPTION 'A removed message must record how it was removed' USING ERRCODE = '23514';
                    END IF;
                    IF e."TenantId" <> m."TenantId"
                       OR e."ConversationId" <> m."ConversationId"
                       OR e."Kind" <> m."DeletionKind"
                       OR e."ActorUserId" IS DISTINCT FROM m."DeletedByUserId"
                       OR e."OccurredAtUtc" <> m."DeletedAtUtc"
                       OR e."RevisionNumberAtRemoval" <> m."CurrentRevisionNumber"
                       OR e."Reason" IS DISTINCT FROM m."ModerationReason" THEN
                        RAISE EXCEPTION 'A message removal and its event must agree' USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE CONSTRAINT TRIGGER assert_removal_agreement
                AFTER UPDATE ON messaging."Messages"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION messaging.assert_removal_agreement();

                CREATE CONSTRAINT TRIGGER assert_removal_agreement
                AFTER INSERT ON messaging."MessageDeletionEvents"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION messaging.assert_removal_agreement();
                """);

            // What a message said at one point, the fact that it was removed, and a spent idempotency
            // key are all written once. The application guards each of them, but a repair script, a
            // later migration or a future job does not pass through the application.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION messaging.protect_append_only()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Messaging history is never deleted' USING ERRCODE = '23514';
                    END IF;
                    RAISE EXCEPTION 'Messaging history is immutable once written' USING ERRCODE = '23514';
                END;
                $function$;

                CREATE TRIGGER protect_message_revision
                BEFORE UPDATE OR DELETE ON messaging."MessageRevisions"
                FOR EACH ROW EXECUTE FUNCTION messaging.protect_append_only();

                CREATE TRIGGER protect_message_deletion_event
                BEFORE UPDATE OR DELETE ON messaging."MessageDeletionEvents"
                FOR EACH ROW EXECUTE FUNCTION messaging.protect_append_only();

                CREATE TRIGGER protect_messaging_command_record
                BEFORE UPDATE OR DELETE ON messaging."CommandRecords"
                FOR EACH ROW EXECUTE FUNCTION messaging.protect_append_only();
                """);
        }

        /// <summary>
        /// Reverting this migration is destructive and unrecoverable.
        /// </summary>
        /// <remarks>
        /// Dropping the <c>messaging</c> tables deletes every conversation, every message, every
        /// revision of every message, every record of who removed what and why, and every
        /// participant's read position. None of it can be rebuilt: a message body exists only in
        /// <c>messaging."MessageRevisions"</c>, and nothing else in the database holds a copy. Spent
        /// idempotency keys go with them, so a client retry in flight across a rollback would be
        /// written a second time on the way back up.
        /// <para>
        /// The schema itself is dropped last, with <c>RESTRICT</c>, so the revert leaves nothing of
        /// this slice behind and refuses rather than cascading if anything unexpected still lives
        /// there.
        /// </para>
        /// <para>
        /// This exists so the migration is reversible for a local database that has just been built.
        /// Schema rollback in production means restoring a tested backup or deploying a forward repair
        /// migration, exactly as ARCHITECTURE.md section 7 says; it does not mean running this.
        /// </para>
        /// </remarks>
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DROP TRIGGER IF EXISTS protect_messaging_command_record ON messaging."CommandRecords";
                DROP TRIGGER IF EXISTS protect_message_deletion_event ON messaging."MessageDeletionEvents";
                DROP TRIGGER IF EXISTS assert_removal_agreement ON messaging."MessageDeletionEvents";
                DROP TRIGGER IF EXISTS protect_message_revision ON messaging."MessageRevisions";
                DROP TRIGGER IF EXISTS assert_message_revisions ON messaging."MessageRevisions";
                DROP TRIGGER IF EXISTS assert_removal_agreement ON messaging."Messages";
                DROP TRIGGER IF EXISTS assert_message_revisions ON messaging."Messages";
                DROP TRIGGER IF EXISTS assert_conversation_message_tip ON messaging."Messages";
                DROP TRIGGER IF EXISTS protect_message ON messaging."Messages";
                DROP TRIGGER IF EXISTS assert_read_cursor_within_conversation ON messaging."ConversationParticipants";
                DROP TRIGGER IF EXISTS protect_conversation_participant ON messaging."ConversationParticipants";
                DROP TRIGGER IF EXISTS assert_conversation_message_tip ON messaging."Conversations";
                DROP TRIGGER IF EXISTS protect_conversation ON messaging."Conversations";
                DROP TRIGGER IF EXISTS assert_direct_participants ON messaging."Conversations";
                DROP FUNCTION IF EXISTS messaging.protect_append_only();
                DROP FUNCTION IF EXISTS messaging.assert_removal_agreement();
                DROP FUNCTION IF EXISTS messaging.assert_message_revisions();
                DROP FUNCTION IF EXISTS messaging.protect_message();
                DROP FUNCTION IF EXISTS messaging.assert_conversation_message_tip();
                DROP FUNCTION IF EXISTS messaging.assert_read_cursor_within_conversation();
                DROP FUNCTION IF EXISTS messaging.protect_conversation_participant();
                DROP FUNCTION IF EXISTS messaging.protect_conversation();
                DROP FUNCTION IF EXISTS messaging.assert_direct_participants();
                """);

            migrationBuilder.DropTable(
                name: "CommandRecords",
                schema: "messaging");

            migrationBuilder.DropTable(
                name: "MessageDeletionEvents",
                schema: "messaging");

            migrationBuilder.DropTable(
                name: "MessageRevisions",
                schema: "messaging");

            migrationBuilder.DropTable(
                name: "Messages",
                schema: "messaging");

            migrationBuilder.DropTable(
                name: "ConversationParticipants",
                schema: "messaging");

            migrationBuilder.DropTable(
                name: "Conversations",
                schema: "messaging");

            // Nothing of this slice is left behind, including the schema EnsureSchema created.
            migrationBuilder.Sql("""DROP SCHEMA IF EXISTS messaging RESTRICT;""");
        }
    }
}

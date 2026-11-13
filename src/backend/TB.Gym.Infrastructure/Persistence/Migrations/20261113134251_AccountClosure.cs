using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AccountClosure : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientProfiles_CompletedOnboarding",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "AnonymisedAtUtc",
                schema: "clients",
                table: "ClientProfiles",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "AnonymisedAtUtc",
                schema: "invitations",
                table: "ClientInvitations",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "AccountClosures",
                schema: "identity",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ClosedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestedOn = table.Column<DateOnly>(type: "date", nullable: true),
                    ClosedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    SpacesLeft = table.Column<int>(type: "integer", nullable: false),
                    RecordsAnonymised = table.Column<int>(type: "integer", nullable: false),
                    PhotosRemoved = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AccountClosures", x => x.Id);
                    table.CheckConstraint("CK_AccountClosures_Counts", "\"SpacesLeft\" >= 0 AND \"RecordsAnonymised\" >= 0 AND \"PhotosRemoved\" >= 0");
                    table.CheckConstraint("CK_AccountClosures_Source", "(\"Source\" = 'Self' AND \"ClosedByUserId\" = \"UserId\" AND \"RequestedOn\" IS NULL) OR (\"Source\" = 'OnRequest' AND \"ClosedByUserId\" <> \"UserId\" AND \"RequestedOn\" IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_AccountClosures_Users_ClosedByUserId",
                        column: x => x.ClosedByUserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_AccountClosures_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientProfiles_Anonymised",
                schema: "clients",
                table: "ClientProfiles",
                sql: "\"AnonymisedAtUtc\" IS NULL OR (\"ReleasedAtUtc\" IS NOT NULL AND \"FirstName\" = 'Closed' AND \"LastName\" = 'account' AND \"Email\" = 'closed-' || replace(\"Id\"::text, '-', '') || '@closed.tbgym.invalid' AND \"NormalizedEmail\" = upper(\"Email\") AND \"PhoneNumber\" IS NULL AND \"BirthDate\" IS NULL AND \"HeightCentimeters\" IS NULL AND \"HeightEnteredValue\" IS NULL AND \"HeightEnteredUnit\" IS NULL AND \"WorkType\" IS NULL AND \"AverageDailySteps\" IS NULL AND \"TrainingBackground\" IS NULL AND \"FoodPreferences\" IS NULL AND \"FoodAversions\" IS NULL AND \"Goals\" IS NULL AND \"Allergies\" IS NULL AND \"Medications\" IS NULL AND \"PreviousInjuries\" IS NULL AND \"CoachNotes\" IS NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientProfiles_CompletedOnboarding",
                schema: "clients",
                table: "ClientProfiles",
                sql: "\"OnboardingStatus\" <> 'Completed' OR \"AnonymisedAtUtc\" IS NOT NULL OR (\"BirthDate\" IS NOT NULL AND \"HeightCentimeters\" IS NOT NULL AND \"Goals\" IS NOT NULL AND \"OnboardingCompletedAtUtc\" IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientInvitations_Anonymised",
                schema: "invitations",
                table: "ClientInvitations",
                sql: "\"AnonymisedAtUtc\" IS NULL OR (\"Status\" = 'Accepted' AND \"FirstName\" = 'Closed' AND \"LastName\" = 'account' AND \"Email\" = 'closed-' || replace(\"Id\"::text, '-', '') || '@closed.tbgym.invalid' AND \"PhoneNumber\" IS NULL AND \"BirthDate\" IS NULL)");

            migrationBuilder.CreateIndex(
                name: "IX_AccountClosures_ClosedByUserId",
                schema: "identity",
                table: "AccountClosures",
                column: "ClosedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_AccountClosures_UserId",
                schema: "identity",
                table: "AccountClosures",
                column: "UserId",
                unique: true);

            migrationBuilder.Sql("""
                -- The record of each closing is kept as written (CLI-027).
                CREATE TRIGGER "TR_AccountClosures_AppendOnly"
                BEFORE UPDATE OR DELETE ON identity."AccountClosures"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                -- A closed account takes nothing new (CLI-027): no active membership, no client record and no upload.
                -- Checked at commit, so a join, an invitation's acceptance or an upload that read the account before
                -- the closing and waited on its row is refused once the closing has committed. TG_ARGV[0] names the
                -- row's account column.
                CREATE OR REPLACE FUNCTION identity.refuse_closed_account()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE
                    account uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
                BEGIN
                    IF TG_TABLE_NAME = 'Memberships' AND (to_jsonb(NEW) ->> 'Status') <> 'Active' THEN
                        RETURN NULL;
                    END IF;
                    IF account IS NOT NULL
                       AND EXISTS (SELECT 1 FROM identity."AccountClosures" AS closure WHERE closure."UserId" = account) THEN
                        RAISE EXCEPTION 'A closed account takes no new membership, client record or upload' USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE CONSTRAINT TRIGGER "TR_Memberships_NotClosedAccount"
                AFTER INSERT OR UPDATE OF "Status" ON tenancy."Memberships"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION identity.refuse_closed_account('UserId');

                CREATE CONSTRAINT TRIGGER "TR_ClientProfiles_NotClosedAccount"
                AFTER INSERT ON clients."ClientProfiles"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION identity.refuse_closed_account('UserId');

                CREATE CONSTRAINT TRIGGER "TR_Assets_NotClosedAccount"
                AFTER INSERT ON media."Assets"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION identity.refuse_closed_account('OwnerUserId');

                -- A released client's record is kept exactly as it was released, with one exception (CLI-027): the
                -- person's account closes and their details are erased, once. CK_ClientProfiles_Anonymised says what
                -- the erased record holds; this says that nothing else about it moves, and that it never moves again.
                CREATE OR REPLACE FUNCTION clients.freeze_released_client()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF OLD."ReleasedAtUtc" IS NOT NULL THEN
                        IF TG_OP = 'UPDATE'
                           AND OLD."AnonymisedAtUtc" IS NULL
                           AND NEW."AnonymisedAtUtc" IS NOT NULL
                           AND (NEW."Id", NEW."TenantId", NEW."UserId", NEW."AssignedCoachUserId", NEW."IsCoachBlocked",
                                NEW."IsSelfDirected", NEW."OnboardingStatus", NEW."OnboardingCompletedAtUtc",
                                NEW."ReleasedAtUtc", NEW."CreatedAtUtc", NEW."CreatedByUserId")
                               IS NOT DISTINCT FROM
                               (OLD."Id", OLD."TenantId", OLD."UserId", OLD."AssignedCoachUserId", OLD."IsCoachBlocked",
                                OLD."IsSelfDirected", OLD."OnboardingStatus", OLD."OnboardingCompletedAtUtc",
                                OLD."ReleasedAtUtc", OLD."CreatedAtUtc", OLD."CreatedByUserId") THEN
                            RETURN NEW;
                        END IF;
                        RAISE EXCEPTION 'A released client''s record is read-only' USING ERRCODE = '55000';
                    END IF;
                    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                END;
                $function$;

                -- An invitation's address never changes, except once, when the person who accepted it closes their
                -- account (CLI-027): CK_ClientInvitations_Anonymised says what it then holds, and it never changes back.
                CREATE OR REPLACE FUNCTION invitations.protect_client_invitation()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Invitations are never deleted; revocation and expiry are recorded state' USING ERRCODE = '23514';
                    END IF;

                    IF OLD."Id" <> NEW."Id" OR OLD."TenantId" <> NEW."TenantId" THEN
                        RAISE EXCEPTION 'An invitation identity is immutable' USING ERRCODE = '23514';
                    END IF;

                    IF OLD."AnonymisedAtUtc" IS NOT NULL AND NEW."AnonymisedAtUtc" IS DISTINCT FROM OLD."AnonymisedAtUtc" THEN
                        RAISE EXCEPTION 'An anonymised invitation stays anonymised' USING ERRCODE = '23514';
                    END IF;

                    -- The invited address is what every uniqueness rule, every token and every
                    -- authorization decision was evaluated against. Changing it would silently retarget
                    -- a credential that is already in somebody's mailbox. An accepted invitation's credential
                    -- is spent, so its address may be erased with its person.
                    IF (OLD."Email" <> NEW."Email" OR OLD."NormalizedEmail" <> NEW."NormalizedEmail")
                       AND NOT (OLD."Status" = 'Accepted' AND OLD."AnonymisedAtUtc" IS NULL AND NEW."AnonymisedAtUtc" IS NOT NULL) THEN
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
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // The functions as they were before closing an account existed (ReleaseClient, Phase6B3CTokenlessActionMail).
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION clients.freeze_released_client()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF OLD."ReleasedAtUtc" IS NOT NULL THEN
                        RAISE EXCEPTION 'A released client''s record is read-only' USING ERRCODE = '55000';
                    END IF;
                    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                END;
                $function$;

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

                DROP TRIGGER IF EXISTS "TR_Assets_NotClosedAccount" ON media."Assets";
                DROP TRIGGER IF EXISTS "TR_ClientProfiles_NotClosedAccount" ON clients."ClientProfiles";
                DROP TRIGGER IF EXISTS "TR_Memberships_NotClosedAccount" ON tenancy."Memberships";
                DROP FUNCTION IF EXISTS identity.refuse_closed_account();
                DROP TRIGGER IF EXISTS "TR_AccountClosures_AppendOnly" ON identity."AccountClosures";
                """);

            migrationBuilder.DropTable(
                name: "AccountClosures",
                schema: "identity");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientProfiles_Anonymised",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientProfiles_CompletedOnboarding",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientInvitations_Anonymised",
                schema: "invitations",
                table: "ClientInvitations");

            migrationBuilder.DropColumn(
                name: "AnonymisedAtUtc",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropColumn(
                name: "AnonymisedAtUtc",
                schema: "invitations",
                table: "ClientInvitations");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientProfiles_CompletedOnboarding",
                schema: "clients",
                table: "ClientProfiles",
                sql: "\"OnboardingStatus\" <> 'Completed' OR (\"BirthDate\" IS NOT NULL AND \"HeightCentimeters\" IS NOT NULL AND \"Goals\" IS NOT NULL AND \"OnboardingCompletedAtUtc\" IS NOT NULL)");
        }
    }
}

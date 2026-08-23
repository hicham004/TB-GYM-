using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase5B2ProgressPhotos : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Purpose",
                schema: "media",
                table: "Assets",
                type: "character varying(24)",
                maxLength: 24,
                nullable: false,
                defaultValue: "");

            // Every asset that predates the discriminator is exercise-library media. Backfill
            // before the coach library filter (which now selects on Purpose) can hide them, and
            // drop the placeholder default so future inserts must state the purpose explicitly.
            migrationBuilder.Sql(
                """
                UPDATE media."Assets"
                SET "Purpose" = 'ExerciseMedia'
                WHERE "Purpose" IS NULL OR "Purpose" = '';

                ALTER TABLE media."Assets" ALTER COLUMN "Purpose" DROP DEFAULT;
                """);

            migrationBuilder.CreateTable(
                name: "ProgressPhotos",
                schema: "progress",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    PhotoDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Pose = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    MediaAssetId = table.Column<Guid>(type: "uuid", nullable: false),
                    Source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProgressPhotos", x => x.Id);
                    table.UniqueConstraint("AK_ProgressPhotos_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_ProgressPhotos_Assets_TenantId_MediaAssetId",
                        columns: x => new { x.TenantId, x.MediaAssetId },
                        principalSchema: "media",
                        principalTable: "Assets",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ProgressPhotos_ClientProfiles_TenantId_ClientProfileId",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ProgressPhotoRemovals",
                schema: "progress",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProgressPhotoId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    PhotoDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Pose = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    MediaAssetId = table.Column<Guid>(type: "uuid", nullable: false),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    RemovedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    RemovedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProgressPhotoRemovals", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ProgressPhotoRemovals_ClientProfiles_TenantId_ClientProfile~",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ProgressPhotoRemovals_ProgressPhotos_TenantId_ProgressPhoto~",
                        columns: x => new { x.TenantId, x.ProgressPhotoId },
                        principalSchema: "progress",
                        principalTable: "ProgressPhotos",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProgressPhotoRemovals_TenantId_ClientProfileId",
                schema: "progress",
                table: "ProgressPhotoRemovals",
                columns: new[] { "TenantId", "ClientProfileId" });

            migrationBuilder.CreateIndex(
                name: "IX_ProgressPhotoRemovals_TenantId_ProgressPhotoId_RemovedAtUtc",
                schema: "progress",
                table: "ProgressPhotoRemovals",
                columns: new[] { "TenantId", "ProgressPhotoId", "RemovedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_ProgressPhotos_TenantId_ClientProfileId_PhotoDate_Pose",
                schema: "progress",
                table: "ProgressPhotos",
                columns: new[] { "TenantId", "ClientProfileId", "PhotoDate", "Pose" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProgressPhotos_TenantId_MediaAssetId",
                schema: "progress",
                table: "ProgressPhotos",
                columns: new[] { "TenantId", "MediaAssetId" },
                unique: true);

            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION progress.protect_progress_photo()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Progress photos cannot be deleted' USING ERRCODE = '23514';
                    END IF;

                    IF NEW."TenantId" <> OLD."TenantId"
                        OR NEW."ClientProfileId" <> OLD."ClientProfileId"
                        OR NEW."PhotoDate" <> OLD."PhotoDate"
                        OR NEW."Pose" <> OLD."Pose"
                        OR NEW."MediaAssetId" <> OLD."MediaAssetId"
                        OR NEW."CreatedAtUtc" <> OLD."CreatedAtUtc" THEN
                        RAISE EXCEPTION 'Progress photo identity and original audit fields are immutable' USING ERRCODE = '23514';
                    END IF;

                    IF NEW."Status" <> OLD."Status"
                        AND NOT (OLD."Status" = 'Active' AND NEW."Status" = 'Removed') THEN
                        RAISE EXCEPTION 'A progress photo may only move from Active to Removed' USING ERRCODE = '23514';
                    END IF;

                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_ProgressPhotos_ProtectIdentity"
                    BEFORE UPDATE OR DELETE ON progress."ProgressPhotos"
                    FOR EACH ROW EXECUTE FUNCTION progress.protect_progress_photo();
                CREATE TRIGGER "TR_ProgressPhotoRemovals_AppendOnly"
                    BEFORE UPDATE OR DELETE ON progress."ProgressPhotoRemovals"
                    FOR EACH ROW EXECUTE FUNCTION progress.reject_update_delete();
                """);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DROP TRIGGER "TR_ProgressPhotos_ProtectIdentity" ON progress."ProgressPhotos";
                DROP TRIGGER "TR_ProgressPhotoRemovals_AppendOnly" ON progress."ProgressPhotoRemovals";
                DROP FUNCTION progress.protect_progress_photo();
                """);

            migrationBuilder.DropTable(
                name: "ProgressPhotoRemovals",
                schema: "progress");

            migrationBuilder.DropTable(
                name: "ProgressPhotos",
                schema: "progress");

            migrationBuilder.DropColumn(
                name: "Purpose",
                schema: "media",
                table: "Assets");
        }
    }
}

using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RecordProgressPhotoExports : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddUniqueConstraint(
                name: "AK_ProgressPhotos_TenantId_ClientProfileId_Pose_Id",
                schema: "progress",
                table: "ProgressPhotos",
                columns: new[] { "TenantId", "ClientProfileId", "Pose", "Id" });

            migrationBuilder.CreateTable(
                name: "ProgressPhotoExports",
                schema: "progress",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    Pose = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    BeforePhotoId = table.Column<Guid>(type: "uuid", nullable: false),
                    AfterPhotoId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExportedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ExportedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProgressPhotoExports", x => x.Id);
                    table.CheckConstraint("CK_ProgressPhotoExports_TwoPhotos", "\"BeforePhotoId\" <> \"AfterPhotoId\"");
                    table.ForeignKey(
                        name: "FK_ProgressPhotoExports_ClientProfiles_TenantId_ClientProfileId",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ProgressPhotoExports_ProgressPhotos_TenantId_ClientProfileI~",
                        columns: x => new { x.TenantId, x.ClientProfileId, x.Pose, x.AfterPhotoId },
                        principalSchema: "progress",
                        principalTable: "ProgressPhotos",
                        principalColumns: new[] { "TenantId", "ClientProfileId", "Pose", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ProgressPhotoExports_ProgressPhotos_TenantId_ClientProfile~1",
                        columns: x => new { x.TenantId, x.ClientProfileId, x.Pose, x.BeforePhotoId },
                        principalSchema: "progress",
                        principalTable: "ProgressPhotos",
                        principalColumns: new[] { "TenantId", "ClientProfileId", "Pose", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProgressPhotoExports_TenantId_ClientProfileId_ExportedAtUtc",
                schema: "progress",
                table: "ProgressPhotoExports",
                columns: new[] { "TenantId", "ClientProfileId", "ExportedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_ProgressPhotoExports_TenantId_ClientProfileId_Pose_AfterPho~",
                schema: "progress",
                table: "ProgressPhotoExports",
                columns: new[] { "TenantId", "ClientProfileId", "Pose", "AfterPhotoId" });

            migrationBuilder.CreateIndex(
                name: "IX_ProgressPhotoExports_TenantId_ClientProfileId_Pose_BeforePh~",
                schema: "progress",
                table: "ProgressPhotoExports",
                columns: new[] { "TenantId", "ClientProfileId", "Pose", "BeforePhotoId" });

            // PRG-013: an export names two ACTIVE photos, the earlier one first. Both photos are locked
            // until the insert commits, so a removal racing it either waits for it or has committed first
            // and is seen here. The rows are append-only, like the removals.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION progress.protect_progress_photo_export()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE
                    before_date date;
                    after_date date;
                BEGIN
                    SELECT "PhotoDate" INTO before_date FROM progress."ProgressPhotos"
                    WHERE "TenantId" = NEW."TenantId" AND "Id" = NEW."BeforePhotoId" AND "Status" = 'Active'
                    FOR SHARE;
                    SELECT "PhotoDate" INTO after_date FROM progress."ProgressPhotos"
                    WHERE "TenantId" = NEW."TenantId" AND "Id" = NEW."AfterPhotoId" AND "Status" = 'Active'
                    FOR SHARE;
                    IF before_date IS NULL OR after_date IS NULL OR before_date >= after_date THEN
                        RAISE EXCEPTION 'A photo export names two active photos, the earlier one first'
                            USING ERRCODE = '23514', CONSTRAINT = 'CK_ProgressPhotoExports_ActivePhotos';
                    END IF;

                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_ProgressPhotoExports_ActivePhotos"
                    BEFORE INSERT ON progress."ProgressPhotoExports"
                    FOR EACH ROW EXECUTE FUNCTION progress.protect_progress_photo_export();
                CREATE TRIGGER "TR_ProgressPhotoExports_AppendOnly"
                    BEFORE UPDATE OR DELETE ON progress."ProgressPhotoExports"
                    FOR EACH ROW EXECUTE FUNCTION progress.reject_update_delete();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DROP TRIGGER "TR_ProgressPhotoExports_ActivePhotos" ON progress."ProgressPhotoExports";
                DROP TRIGGER "TR_ProgressPhotoExports_AppendOnly" ON progress."ProgressPhotoExports";
                DROP FUNCTION progress.protect_progress_photo_export();
                """);

            migrationBuilder.DropTable(
                name: "ProgressPhotoExports",
                schema: "progress");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_ProgressPhotos_TenantId_ClientProfileId_Pose_Id",
                schema: "progress",
                table: "ProgressPhotos");
        }
    }
}

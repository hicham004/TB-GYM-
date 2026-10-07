using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddProgramEdits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ProgramEdits",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MesocycleId = table.Column<Guid>(type: "uuid", nullable: false),
                    RuleKey = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    RuleVersion = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    PreviewHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    WeeksAdded = table.Column<int>(type: "integer", nullable: false),
                    WeeksMoved = table.Column<int>(type: "integer", nullable: false),
                    WeeksRemoved = table.Column<int>(type: "integer", nullable: false),
                    SessionsAdded = table.Column<int>(type: "integer", nullable: false),
                    SessionsEdited = table.Column<int>(type: "integer", nullable: false),
                    SessionsMoved = table.Column<int>(type: "integer", nullable: false),
                    SessionsRemoved = table.Column<int>(type: "integer", nullable: false),
                    ResultingWeekCount = table.Column<int>(type: "integer", nullable: false),
                    ResultingEndDateExclusive = table.Column<DateOnly>(type: "date", nullable: false),
                    ChangesJson = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProgramEdits", x => x.Id);
                    table.UniqueConstraint("AK_ProgramEdits_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_ProgramEdits_Counts", "\"WeeksAdded\" >= 0 AND \"WeeksMoved\" >= 0 AND \"WeeksRemoved\" >= 0 AND \"SessionsAdded\" >= 0 AND \"SessionsEdited\" >= 0 AND \"SessionsMoved\" >= 0 AND \"SessionsRemoved\" >= 0 AND \"ResultingWeekCount\" >= 1 AND \"ResultingWeekCount\" <= 52");
                    table.CheckConstraint("CK_ProgramEdits_Hash", "\"PreviewHash\" ~ '^[0-9a-f]{64}$'");
                    table.ForeignKey(
                        name: "FK_ProgramEdits_Mesocycles_TenantId_MesocycleId",
                        columns: x => new { x.TenantId, x.MesocycleId },
                        principalSchema: "training",
                        principalTable: "Mesocycles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProgramEdits_TenantId_MesocycleId_CreatedAtUtc",
                schema: "training",
                table: "ProgramEdits",
                columns: new[] { "TenantId", "MesocycleId", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_ProgramEdits_TenantId_MesocycleId_PreviewHash",
                schema: "training",
                table: "ProgramEdits",
                columns: new[] { "TenantId", "MesocycleId", "PreviewHash" },
                unique: true);

            // An edit is a fact about what a client was given: never rewritten, never deleted.
            migrationBuilder.Sql(
                """
                CREATE TRIGGER "TR_ProgramEdits_AppendOnly"
                BEFORE UPDATE OR DELETE ON training."ProgramEdits"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ProgramEdits",
                schema: "training");
        }
    }
}

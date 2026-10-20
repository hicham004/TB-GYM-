using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CoachMacrosMakeTargets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "MacroOverrideAuditId",
                schema: "nutrition",
                table: "CalculationSnapshots",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_CalculationSnapshots_TenantId_MacroOverrideAuditId",
                schema: "nutrition",
                table: "CalculationSnapshots",
                columns: new[] { "TenantId", "MacroOverrideAuditId" },
                unique: true,
                filter: "\"MacroOverrideAuditId\" IS NOT NULL");

            // Every row written from now on is checked. NOT VALID because snapshots are append-only: a
            // revert drops the link, and applying this again must not refuse the targets a coach made
            // before it, which keep their numbers and lose only their link (INV-2).
            migrationBuilder.Sql("""
                ALTER TABLE nutrition."CalculationSnapshots"
                    ADD CONSTRAINT "CK_CalculationSnapshots_CoachMacroOverride"
                    CHECK (("MacroMethodKey" = 'CoachMacroOverride') = ("MacroOverrideAuditId" IS NOT NULL)) NOT VALID;
                """);

            migrationBuilder.AddForeignKey(
                name: "FK_CalculationSnapshots_MacroOverrideAudits_TenantId_MacroOver~",
                schema: "nutrition",
                table: "CalculationSnapshots",
                columns: new[] { "TenantId", "MacroOverrideAuditId" },
                principalSchema: "nutrition",
                principalTable: "MacroOverrideAudits",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_CalculationSnapshots_MacroOverrideAudits_TenantId_MacroOver~",
                schema: "nutrition",
                table: "CalculationSnapshots");

            migrationBuilder.DropIndex(
                name: "IX_CalculationSnapshots_TenantId_MacroOverrideAuditId",
                schema: "nutrition",
                table: "CalculationSnapshots");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CalculationSnapshots_CoachMacroOverride",
                schema: "nutrition",
                table: "CalculationSnapshots");

            migrationBuilder.DropColumn(
                name: "MacroOverrideAuditId",
                schema: "nutrition",
                table: "CalculationSnapshots");
        }
    }
}

using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRpeChartLoadStrategy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_SetPrescriptions_LoadStrategy",
                schema: "training",
                table: "SetPrescriptions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ProgramTemplateSets_LoadStrategy",
                schema: "training",
                table: "ProgramTemplateSets");

            migrationBuilder.AddCheckConstraint(
                name: "CK_SetPrescriptions_LoadStrategy",
                schema: "training",
                table: "SetPrescriptions",
                sql: "(\"LoadStrategy\" = 'None') OR (\"LoadStrategy\" = 'Direct' AND \"DirectLoad\" > 0 AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" = 'PercentageWorkingMax' AND \"PercentageWorkingMax\" > 0 AND \"PercentageWorkingMax\" <= 150 AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" IN ('RpeBasedEpley', 'RpeChart') AND \"TargetRpe\" IS NOT NULL AND \"RepetitionsMaximum\" IS NOT NULL AND \"LoadUnit\" IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ProgramTemplateSets_LoadStrategy",
                schema: "training",
                table: "ProgramTemplateSets",
                sql: "(\"LoadStrategy\" = 'None') OR (\"LoadStrategy\" = 'Direct' AND \"DirectLoad\" > 0 AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" = 'PercentageWorkingMax' AND \"PercentageWorkingMax\" > 0 AND \"PercentageWorkingMax\" <= 150 AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" IN ('RpeBasedEpley', 'RpeChart') AND \"TargetRpe\" IS NOT NULL AND \"RepetitionsMaximum\" IS NOT NULL AND \"LoadUnit\" IS NOT NULL)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_SetPrescriptions_LoadStrategy",
                schema: "training",
                table: "SetPrescriptions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ProgramTemplateSets_LoadStrategy",
                schema: "training",
                table: "ProgramTemplateSets");

            migrationBuilder.AddCheckConstraint(
                name: "CK_SetPrescriptions_LoadStrategy",
                schema: "training",
                table: "SetPrescriptions",
                sql: "(\"LoadStrategy\" = 'None') OR (\"LoadStrategy\" = 'Direct' AND \"DirectLoad\" > 0 AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" = 'PercentageWorkingMax' AND \"PercentageWorkingMax\" > 0 AND \"PercentageWorkingMax\" <= 150 AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" = 'RpeBasedEpley' AND \"TargetRpe\" IS NOT NULL AND \"RepetitionsMaximum\" IS NOT NULL AND \"LoadUnit\" IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ProgramTemplateSets_LoadStrategy",
                schema: "training",
                table: "ProgramTemplateSets",
                sql: "(\"LoadStrategy\" = 'None') OR (\"LoadStrategy\" = 'Direct' AND \"DirectLoad\" > 0 AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" = 'PercentageWorkingMax' AND \"PercentageWorkingMax\" > 0 AND \"PercentageWorkingMax\" <= 150 AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" = 'RpeBasedEpley' AND \"TargetRpe\" IS NOT NULL AND \"RepetitionsMaximum\" IS NOT NULL AND \"LoadUnit\" IS NOT NULL)");
        }
    }
}

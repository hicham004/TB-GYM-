using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AtwaterCountsAlcohol : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // C7: Atwater 2.0 counts alcohol at 7 kcal/g, and every workspace on Atwater counts what it
            // saves from now on that way, so its setting names the version in force. Foods and
            // calculation snapshots are history and keep the version that counted them.
            migrationBuilder.Sql("""
                UPDATE nutrition."WorkspaceSettings"
                SET "EnergyPolicyVersion" = '2.0'
                WHERE "EnergyPolicyKey" = 'Atwater' AND "EnergyPolicyVersion" = '1.0';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE nutrition."WorkspaceSettings"
                SET "EnergyPolicyVersion" = '1.0'
                WHERE "EnergyPolicyKey" = 'Atwater' AND "EnergyPolicyVersion" = '2.0';
                """);
        }
    }
}

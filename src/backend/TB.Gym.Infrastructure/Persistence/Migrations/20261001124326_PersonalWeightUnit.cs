using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PersonalWeightUnit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PreferredWeightUnit",
                schema: "identity",
                table: "Users",
                type: "character varying(8)",
                maxLength: 8,
                nullable: false,
                defaultValue: "Kilogram");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Users_PreferredWeightUnit",
                schema: "identity",
                table: "Users",
                sql: "\"PreferredWeightUnit\" IN ('Kilogram', 'Pound')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Users_PreferredWeightUnit",
                schema: "identity",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "PreferredWeightUnit",
                schema: "identity",
                table: "Users");
        }
    }
}

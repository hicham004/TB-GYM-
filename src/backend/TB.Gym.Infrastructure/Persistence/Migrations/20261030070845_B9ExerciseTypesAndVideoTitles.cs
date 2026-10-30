using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Critique B9: seven exercise types, General renamed Other (the column holds the name, so the rename is a
    /// data migration), Other's own name, and a video link's own title from its provider (MED-015).
    /// </summary>
    public partial class B9ExerciseTypesAndVideoTitles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "UPDATE exercise_library.\"Exercises\" SET \"Classification\" = 'Other' WHERE \"Classification\" = 'General';");

            migrationBuilder.AddColumn<string>(
                name: "TypeName",
                schema: "exercise_library",
                table: "Exercises",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ExternalTitle",
                schema: "media",
                table: "Assets",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Exercises_Classification",
                schema: "exercise_library",
                table: "Exercises",
                sql: "\"Classification\" IN ('Strength', 'Power', 'Conditioning', 'Mobility', 'Balance', 'WarmUp', 'Other')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Exercises_TypeName",
                schema: "exercise_library",
                table: "Exercises",
                sql: "\"TypeName\" IS NULL OR (\"Classification\" = 'Other' AND \"TypeName\" = btrim(\"TypeName\") AND \"TypeName\" <> '')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaAssets_ExternalTitle",
                schema: "media",
                table: "Assets",
                sql: "\"ExternalTitle\" IS NULL OR (\"Source\" = 'ExternalEmbed' AND \"ExternalTitle\" <> '')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Exercises_Classification",
                schema: "exercise_library",
                table: "Exercises");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Exercises_TypeName",
                schema: "exercise_library",
                table: "Exercises");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaAssets_ExternalTitle",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropColumn(
                name: "TypeName",
                schema: "exercise_library",
                table: "Exercises");

            migrationBuilder.DropColumn(
                name: "ExternalTitle",
                schema: "media",
                table: "Assets");

            // Back to the four types: each added one becomes the nearest of those.
            migrationBuilder.Sql(
                "UPDATE exercise_library.\"Exercises\" SET \"Classification\" = CASE \"Classification\" " +
                "WHEN 'Power' THEN 'Strength' WHEN 'Other' THEN 'General' WHEN 'Balance' THEN 'General' " +
                "WHEN 'WarmUp' THEN 'General' ELSE \"Classification\" END;");
        }
    }
}

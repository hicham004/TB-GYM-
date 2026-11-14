using System.Globalization;
using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Nutrition;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The meal-plan builder's daily target (critique B5c2): "Fill in fat and carbs" works the fat and
/// carbohydrate out through the macro split (NUT-008), and "Start from a client's targets" lists the
/// caller's clients' latest targets to begin from.
/// </summary>
/// <remarks>
/// The split is worked out on the server, never in the browser, so the grams a plan keeps are the split's
/// own, unrounded, and the plan can name the share they came from (NUT-013). A client's targets are read
/// for the caller's current clients only (ADR 0026), and only while their plan includes Nutrition, as the
/// calculations read is (NUT-009).
/// </remarks>
internal sealed partial class NutritionApplicationService
{
    /// <summary>How many clients "Start from a client's targets" lists at most.</summary>
    private const int MaximumClientTargets = 500;

    public NutritionCommandResult PreviewMacroSplit(decimal? calorieTarget, decimal? proteinGrams, decimal? fatPercentage, decimal? bodyweightKilograms, bool isEnergyDeficit)
    {
        if (calorieTarget is not { } calories || calories is not (> 0m and <= 100_000m))
        {
            return Invalid("calorieTarget", "Type the daily calories first: more than 0 and at most 100,000.");
        }

        if (proteinGrams is not { } protein || protein is not (>= 0m and <= 1_000_000m))
        {
            return Invalid("proteinGrams", "Type the daily protein first: 0 or more grams.");
        }

        if (fatPercentage is not { } share || share is not (>= 0m and <= 100m))
        {
            return Invalid("fatPercentage", "Fat has to be between 0 and 100 percent of the calories.");
        }

        if (bodyweightKilograms is <= 0m or > 500m)
        {
            return Invalid("bodyweightKilograms", "A body weight has to be more than 0 and at most 500 kg.");
        }

        // NUT-008 refuses protein and fat beyond the calories; said here with the numbers, as the coach typed them.
        if (protein * 4m + calories * share / 100m > calories)
        {
            return Invalid(
                "fatPercentage",
                string.Create(
                    CultureInfo.InvariantCulture,
                    $"Protein and fat come to more than {calories:#,0.##} calories, so nothing is left for carbs. Lower the protein or the fat, or raise the calories."));
        }

        try
        {
            var split = MacroTargetCalculator.Calculate(new MacroTargetInput(calories, protein, share, bodyweightKilograms, isEnergyDeficit));
            return new NutritionCommandResult(
                NutritionCommandStatus.Success,
                MacroSplit: new MacroSplitView(
                    split.CalorieTarget,
                    split.ProteinGrams,
                    share,
                    split.FatGrams,
                    split.CarbohydrateGrams,
                    split.MethodKey,
                    split.MethodVersion,
                    split.Warnings));
        }
        catch (ArgumentException exception)
        {
            return Invalid("macroSplit", exception.PersonMessage());
        }
    }

    public async Task<ClientTargetsList> ListClientTargetsAsync(CancellationToken cancellationToken)
    {
        // The clients the caller coaches now (ADR 0026, C8): a client's targets are the private side, so the Owner
        // lists their own clients as a Coach does; never a former client, whose Nutrition is closed (ADR 0027).
        var staffUserId = await coachClientScope.StaffUserIdAsync(cancellationToken);
        var clients = dbContext.ClientProfiles.AsNoTracking()
            .Where(client => client.ReleasedAtUtc == null && client.AssignedCoachUserId == staffUserId);

        // Newest first within each client, in the order the calculations read lists them.
        var calculations = await (
            from snapshot in dbContext.NutritionCalculationSnapshots.AsNoTracking()
            join client in clients on snapshot.ClientProfileId equals client.Id
            join coach in dbContext.Users.AsNoTracking() on client.AssignedCoachUserId equals coach.Id
            orderby snapshot.ClientProfileId, snapshot.CreatedAtUtc descending, snapshot.Id descending
            select new
            {
                snapshot.Id,
                snapshot.ClientProfileId,
                client.FirstName,
                client.LastName,
                CoachUserId = coach.Id,
                CoachName = coach.DisplayName,
                snapshot.CreatedAtUtc,
                snapshot.CalorieTarget,
                snapshot.ProteinGrams,
                snapshot.CarbohydrateGrams,
                snapshot.FatGrams,
                snapshot.TdeeEstimate,
                snapshot.BmrEstimate,
                snapshot.MacroOverrideAuditId,
                snapshot.InputJson,
            })
            .ToListAsync(cancellationToken);
        var latest = calculations.GroupBy(row => row.ClientProfileId).Select(group => group.First()).ToList();
        if (latest.Count == 0)
        {
            return new ClientTargetsList([], 0, MaximumClientTargets);
        }

        // Targets are coaching the plan must cover now: a client whose plan leaves Nutrition out is not
        // listed, as their calculations are not read (NUT-009).
        var access = await featureAccessService.EvaluateManyAsync(
            tenantContext.TenantId,
            [.. latest.Select(row => row.ClientProfileId)],
            cancellationToken);
        var names = StringComparer.Create(CultureInfo.InvariantCulture, ignoreCase: true);
        var open = latest
            .Where(row => access[row.ClientProfileId].Single(decision => decision.Feature == CoachingFeature.Nutrition).IsAllowed)
            .OrderBy(row => row.FirstName, names)
            .ThenBy(row => row.LastName, names)
            .ThenBy(row => row.ClientProfileId)
            .ToList();
        return new ClientTargetsList(
            [.. open.Take(MaximumClientTargets).Select(row =>
            {
                var inputs = ReadCalculationInputs(row.InputJson);
                var isCoachMacros = row.MacroOverrideAuditId is not null;
                return new ClientTargetsItem(
                    row.ClientProfileId,
                    row.FirstName,
                    row.LastName,
                    row.CoachUserId,
                    row.CoachName,
                    row.Id,
                    row.CreatedAtUtc,
                    row.CalorieTarget,
                    row.ProteinGrams,
                    row.CarbohydrateGrams,
                    row.FatGrams,
                    isCoachMacros ? null : inputs?.FatPercentage,
                    inputs?.WeightKilograms,
                    inputs is not null && (isCoachMacros ? row.CalorieTarget < row.TdeeEstimate : inputs.IsEnergyDeficit),
                    CalculationWarnings(row.CalorieTarget, row.ProteinGrams, row.TdeeEstimate, row.BmrEstimate, isCoachMacros, inputs));
            })],
            open.Count,
            MaximumClientTargets);
    }
}

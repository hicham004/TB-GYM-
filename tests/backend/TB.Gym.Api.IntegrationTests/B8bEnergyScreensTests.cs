using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Critique B8b (NUT-015): energy model version 2's screens are built and tested with version 2 switched on in
/// development. Development's own settings turn it on, so the targets sheet, the demo and a developer's server work
/// energy out with it, while every other server keeps version 1 until B8c.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task B8bDevelopmentWorksEnergyOutWithVersionTwo()
    {
        // This test's server pins nothing, so it reads appsettings.Development.json as a developer's server does.
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b8b-development-coach@example.test", "Hicham Haddad", "B8b Development");

        var model = await ReadSliceAsync<EnergyModelView>(coach, B8aEnergyModelUrl);

        Assert.AreEqual((2, "2.0", (int?)7), (model.Version, model.ActivityModelVersion, model.MaximumWorkoutsPerWeek));
        Assert.IsNotNull(model.CoachChosen);
    }
}

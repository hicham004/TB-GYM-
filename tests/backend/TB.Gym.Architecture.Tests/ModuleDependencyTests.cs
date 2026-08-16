using System.Reflection;

namespace TB.Gym.Architecture.Tests;

[TestClass]
public sealed class ModuleDependencyTests
{
    private static readonly Assembly[] ModuleAssemblies =
    [
        typeof(TB.Gym.Modules.Clients.ClientsModule).Assembly,
        typeof(TB.Gym.Modules.ExerciseLibrary.ExerciseLibraryModule).Assembly,
        typeof(TB.Gym.Modules.Gamification.GamificationModule).Assembly,
        typeof(TB.Gym.Modules.Identity.IdentityModule).Assembly,
        typeof(TB.Gym.Modules.Integrations.IntegrationsModule).Assembly,
        typeof(TB.Gym.Modules.Invitations.InvitationsModule).Assembly,
        typeof(TB.Gym.Modules.Media.MediaModule).Assembly,
        typeof(TB.Gym.Modules.Messaging.MessagingModule).Assembly,
        typeof(TB.Gym.Modules.Notifications.NotificationsModule).Assembly,
        typeof(TB.Gym.Modules.Nutrition.NutritionModule).Assembly,
        typeof(TB.Gym.Modules.Progress.ProgressModule).Assembly,
        typeof(TB.Gym.Modules.Strength.StrengthModule).Assembly,
        typeof(TB.Gym.Modules.Subscriptions.SubscriptionsModule).Assembly,
        typeof(TB.Gym.Modules.Tenancy.TenancyModule).Assembly,
        typeof(TB.Gym.Modules.Training.TrainingModule).Assembly,
    ];

    [TestMethod]
    public void ModulesDoNotReferenceOtherModulesDirectly()
    {
        foreach (var assembly in ModuleAssemblies)
        {
            var forbiddenReferences = assembly.GetReferencedAssemblies()
                .Where(reference => reference.Name?.StartsWith("TB.Gym.Modules.", StringComparison.Ordinal) == true)
                .Select(reference => reference.Name)
                .ToArray();

            Assert.IsEmpty(
                forbiddenReferences,
                $"{assembly.GetName().Name} references another module: {string.Join(", ", forbiddenReferences)}");
        }
    }
}

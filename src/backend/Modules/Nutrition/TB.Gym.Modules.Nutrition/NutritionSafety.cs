namespace TB.Gym.Modules.Nutrition;

public enum AllergenCode
{
    GlutenCereals = 1,
    Crustaceans = 2,
    Eggs = 3,
    Fish = 4,
    Peanuts = 5,
    Soybeans = 6,
    Milk = 7,
    TreeNuts = 8,
    Celery = 9,
    Mustard = 10,
    Sesame = 11,
    SulphurDioxideAndSulphites = 12,
    Lupin = 13,
    Molluscs = 14,
}

// A per-workspace EU-14/US-9 labelling regime was considered and deliberately not shipped. The
// only behaviour it could have driven here is hiding declared allergens that a regime does not
// mandate, which removes safety information from the coach's view. Every declared allergen is
// therefore always displayed and always evaluated for conflicts. A real labelling feature
// (marking which declarations are regulator-mandated, per market) needs product and legal input
// and is deferred in ADR 0008.
public static class AllergenRegimes
{
    public static AllergenWarning EvaluateConflict(
        IEnumerable<AllergenCode> clientDeclaredAllergies,
        IEnumerable<AllergenCode> recipeDeclaredAllergens)
    {
        var conflicts = clientDeclaredAllergies
            .Intersect(recipeDeclaredAllergens)
            .Distinct()
            .Order()
            .ToArray();
        return new AllergenWarning(
            conflicts.Length > 0,
            conflicts,
            conflicts.Length > 0
                ? "Declared allergen conflict. Review before assignment. Ingredient declarations may be incomplete; TB Gym does not assert this recipe is safe."
                : "No declared conflict was found. Absence of a declaration is not evidence of allergen absence; TB Gym does not assert this recipe is safe.");
    }
}

public sealed record AllergenWarning(
    bool HasConflict,
    IReadOnlyList<AllergenCode> ConflictingCodes,
    string Message);

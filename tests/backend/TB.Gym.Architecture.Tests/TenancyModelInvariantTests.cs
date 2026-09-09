using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.SharedKernel;

namespace TB.Gym.Architecture.Tests;

/// <summary>
/// The tenancy invariants `AGENTS.md` states universally, asserted over the model EF actually built.
/// </summary>
/// <remarks>
/// <para>
/// These invariants hold today. Nothing here is remediation: it is the difference between holding by
/// convention — every author remembering <c>ConfigureTenantEntity</c> — and holding by a check that
/// fails when the next entity does not.
/// </para>
/// <para>
/// <strong>Why the model and never the source.</strong> Most tenant-owned entities do not contain the
/// string <c>HasQueryFilter</c> anywhere near their configuration; they call
/// <c>ConfigureTenantEntity(entity)</c>, which applies it for them. A search over configuration source
/// therefore reports the filter as absent for the large majority of the entities that have one, and
/// concludes that whole modules — Media, Check-Ins, Nutrition, Training, Strength, Exercise Library —
/// are unfiltered. That conclusion was reached here once, and it was wrong in the most alarming
/// possible direction: a reported cross-tenant read that does not exist. The model knows what the
/// source only implies, so the model is what is asked. Anyone tempted to re-check this with a grep
/// should read this paragraph first.
/// </para>
/// <para>
/// The context is built with stub dependencies and a connection string nothing dials. EF builds the
/// model without a database, so these are architecture tests rather than integration tests, and they
/// run in milliseconds beside the rest of the suite.
/// </para>
/// </remarks>
[TestClass]
public sealed class TenancyModelInvariantTests
{
    /// <summary>
    /// A floor, not the count. It exists so that a change which stopped these types from being
    /// discovered at all would fail rather than pass over an empty set — the way a negative test
    /// quietly stops testing anything.
    /// </summary>
    private const int ExpectedMinimumTenantOwnedTypes = 100;

    [TestMethod]
    public void EveryTenantOwnedEntityHasAGlobalQueryFilter()
    {
        var tenantOwned = TenantOwnedEntityTypes(out var owned);

        Assert.IsEmpty(
            owned,
            $"An owned type cannot carry a query filter of its own; it is filtered through its owner. "
            + $"These reach the model as owned types and need a different argument for their isolation: "
            + $"{Describe(owned)}");

        var unfiltered = tenantOwned
            .Where(entity => !HasQueryFilter(entity))
            .ToArray();
        Assert.IsEmpty(
            unfiltered,
            "A tenant-owned entity has no global query filter, so Set<T>() over it returns every "
            + $"workspace's rows: {Describe(unfiltered)}. Configure it through ConfigureTenantEntity.");
    }

    [TestMethod]
    public void EveryTenantOwnedEntityMapsTenantIdAsARequiredProperty()
    {
        var offenders = new List<string>();
        foreach (var entity in TenantOwnedEntityTypes(out _))
        {
            var tenantId = entity.FindProperty(nameof(ITenantOwnedEntity.TenantId));
            if (tenantId is null)
            {
                offenders.Add($"{entity.ClrType.Name} (TenantId is not mapped)");
                continue;
            }

            if (tenantId.IsNullable)
            {
                // A nullable discriminator is not one. A row that may have no workspace cannot be
                // filtered to one, and the query filter would silently exclude it rather than fail.
                offenders.Add($"{entity.ClrType.Name} (TenantId is nullable)");
            }
        }

        Assert.IsEmpty(
            offenders,
            $"TenantId must be mapped and required on every tenant-owned entity: {string.Join(", ", offenders)}.");
    }

    /// <summary>
    /// A relationship between two tenant-owned entities carries the workspace on both sides, so a
    /// child can never resolve to a parent in another one.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is what the <c>(TenantId, Id)</c> alternate keys exist to serve, and asserting the
    /// relationship rather than the key is deliberate. An earlier draft of this test required every
    /// tenant-owned entity to declare that alternate key, and failed on twenty-four of them — every
    /// one a leaf that nothing references as a principal, such as <c>PaymentRecord</c>, whose own
    /// foreign key is already the tenant-scoped <c>(TenantId, EnrollmentId)</c>. A key nothing points
    /// at buys nothing and costs a unique index, so that draft was asserting a rule the codebase never
    /// adopted and would have been "fixed" by twenty-four unnecessary schema changes. The invariant is
    /// about the edges, not about every node having a fitting on it.
    /// </para>
    /// <para>
    /// Foreign keys to something that is not tenant-owned — the workspace itself, an
    /// <c>ApplicationUser</c>, a global legal document — are outside this rule and excluded. Their
    /// isolation argument is a different one.
    /// </para>
    /// </remarks>
    [TestMethod]
    public void EveryRelationshipBetweenTenantOwnedEntitiesCarriesTheWorkspaceOnBothSides()
    {
        var tenantId = nameof(ITenantOwnedEntity.TenantId);
        var offenders = new List<string>();
        foreach (var entity in TenantOwnedEntityTypes(out _))
        {
            foreach (var foreignKey in entity.GetForeignKeys())
            {
                if (!typeof(ITenantOwnedEntity).IsAssignableFrom(foreignKey.PrincipalEntityType.ClrType))
                {
                    continue;
                }

                var dependentCarries = foreignKey.Properties.Any(property => property.Name == tenantId);
                var principalCarries = foreignKey.PrincipalKey.Properties.Any(property => property.Name == tenantId);
                if (!dependentCarries || !principalCarries)
                {
                    offenders.Add(
                        $"{entity.ClrType.Name} -> {foreignKey.PrincipalEntityType.ClrType.Name} "
                        + $"({string.Join(", ", foreignKey.Properties.Select(property => property.Name))})");
                }
            }
        }

        Assert.IsEmpty(
            offenders,
            "A foreign key between two tenant-owned entities does not carry TenantId on both sides, so "
            + "the database would let a row reference a parent in another workspace: "
            + $"{string.Join("; ", offenders)}.");
    }

    /// <summary>
    /// Guards the three tests above against the failure they cannot see themselves: passing because
    /// they found nothing to check.
    /// </summary>
    [TestMethod]
    public void TheTenantOwnedEntitySetIsDiscoveredAndSubstantial()
    {
        var tenantOwned = TenantOwnedEntityTypes(out _);
        Assert.IsGreaterThanOrEqualTo(
            ExpectedMinimumTenantOwnedTypes,
            tenantOwned.Length,
            $"Only {tenantOwned.Length} tenant-owned entity types were discovered in the model. Either "
            + "the model shrank substantially or these tests have stopped finding what they assert "
            + "over, and an assertion over an empty set passes without proving anything.");
    }

    /// <summary>
    /// Every mapped entity whose CLR type is tenant-owned, with the owned types separated out because
    /// EF cannot give those a filter of their own.
    /// </summary>
    private static IEntityType[] TenantOwnedEntityTypes(out IEntityType[] owned)
    {
        using var context = BuildContext();
        var all = context.Model.GetEntityTypes()
            .Where(entity => typeof(ITenantOwnedEntity).IsAssignableFrom(entity.ClrType))
            .ToArray();
        owned = all.Where(entity => entity.IsOwned()).ToArray();
        return all.Where(entity => !entity.IsOwned()).ToArray();
    }

    /// <summary>
    /// Whether a filter applies to this entity, asked at the root of its hierarchy.
    /// </summary>
    /// <remarks>
    /// <c>GetDeclaredQueryFilters</c> returns only what was declared on the type it is asked about,
    /// and EF permits a filter only on the root of an inheritance hierarchy — where it then applies to
    /// every derived type. Asking a derived type directly therefore answers "no filter declared here",
    /// which is true and is not the question. Reading that answer as "unfiltered" is the same
    /// false negative as searching the source for <c>HasQueryFilter</c> and missing the shared helper,
    /// arrived at through the model instead of through a grep.
    /// </remarks>
    private static bool HasQueryFilter(IEntityType entity) =>
        entity.GetRootType().GetDeclaredQueryFilters() is { Count: > 0 };

    /// <summary>
    /// The model, built offline. No connection is opened: EF needs a provider to build a model, not a
    /// database, and the connection string below is never dialled.
    /// </summary>
    private static GymDbContext BuildContext()
    {
        var options = new DbContextOptionsBuilder<GymDbContext>()
            .UseNpgsql("Host=model-only.invalid;Database=model;Username=model;Password=model")
            .Options;
        return new GymDbContext(options, new StubClock(), new StubCurrentUser(), new StubTenantContext());
    }

    private static string Describe(IEnumerable<IEntityType> entities) =>
        string.Join(", ", entities.Select(entity => entity.ClrType.Name).OrderBy(name => name, StringComparer.Ordinal));

    private sealed class StubClock : IClock
    {
        public DateTimeOffset UtcNow => DateTimeOffset.UnixEpoch;
    }

    private sealed class StubCurrentUser : ICurrentUser
    {
        public bool IsAuthenticated => false;

        public Guid? UserId => null;
    }

    /// <summary>
    /// Says it holds no tenant, which is what the filter closes over. The filter's expression is what
    /// is being asserted, never the value it would evaluate to.
    /// </summary>
    private sealed class StubTenantContext : ITenantContext
    {
        public bool HasTenant => false;

        public Guid TenantId => Guid.Empty;
    }
}

namespace TB.Gym.SharedKernel;

/// <summary>
/// Endpoint metadata: which side of a client a route that names one (<c>clientProfileId</c> or <c>clientId</c>)
/// reaches (C8, ADR 0026). <see cref="Business"/> is what runs the business: the client's name, coach, plan,
/// payments, renewals, sessions and the relationship itself, which whoever may manage the client reaches (the
/// Owner for every client, a Coach for their own). <see cref="Private"/> is the coaching: training and food logs,
/// check-in answers, weigh-ins, measurements, photos, the intake answers and the health fields, which only the
/// client's own coach reaches. The tenant authorization handler reads it, a route with neither counts as private,
/// and an integration test pins the business list, so every client route is sorted on purpose.
/// </summary>
public sealed class ClientSide
{
    public static readonly ClientSide Business = new("business");

    public static readonly ClientSide Private = new("private");

    private ClientSide(string name) => Name = name;

    public string Name { get; }

    public bool IsBusiness => ReferenceEquals(this, Business);

    public override string ToString() => Name;
}

namespace TB.Gym.Infrastructure.Persistence;

/// <summary>
/// The order a library lists names in, the same on every server: PostgreSQL's ICU root collation, so "bench"
/// sits beside "Bench Press" and "Élévations" under E. The alpine image's own collation (en_US.utf8 under musl)
/// sorts by byte, every capital before every small letter and accented letters last, which a page of 48 cut
/// off (audit A13c).
/// </summary>
internal static class NameOrder
{
    public const string Collation = "und-x-icu";
}

namespace TB.Gym.Modules.Clients;

/// <summary>
/// The This month page (critique B10d, SUB-018): what the month brought in, beside last month, in the workspace's
/// calendar. A Coach reads their own numbers; the Owner the workspace's, with each coach's. The shape lives here with
/// the coach's other overview reads; the composition is in Infrastructure, because only that layer may read the other
/// modules.
/// </summary>
public interface ICoachMonthService
{
    /// <summary>This month so far and the whole of last month, for the caller.</summary>
    Task<CoachMonthReportView> GetAsync(CancellationToken cancellationToken);
}

/// <summary>
/// This month and last, each for <c>[its first day, the next month's first day)</c> of the workspace's calendar, of
/// which <see cref="Today"/> is the last day so far.
/// </summary>
/// <param name="ThisMonth">The Owner's are the whole workspace's; a Coach's only what counts for them.</param>
/// <param name="LastMonth">The same, for the month before.</param>
/// <param name="Coaches">
/// The Owner's alone, null for a Coach (CLI-013): every active member of staff, the Owner first as You, then by name,
/// and after them anyone who left the team with a number in either month, so the rows add up to the totals.
/// </param>
public sealed record CoachMonthReportView(
    DateOnly Today,
    DateOnly ThisMonthFrom,
    DateOnly LastMonthFrom,
    CoachMonthNumbersView ThisMonth,
    CoachMonthNumbersView LastMonth,
    IReadOnlyList<CoachMonthRowView>? Coaches,
    string MonthRuleKey,
    int MonthRuleVersion,
    string MoneyRuleKey,
    int MoneyRuleVersion);

/// <summary>
/// One month's numbers (SUB-018). Money received keeps one total per currency, in currency order, empty with none:
/// never added, netted or converted across currencies, never profit or earnings (SUB-016). No client is named.
/// </summary>
public sealed record CoachMonthNumbersView(
    IReadOnlyList<CoachMoneyReceivedView> MoneyReceived,
    int SessionsHeld,
    int PlansSold,
    int PacksSold,
    int ClientsStarted,
    int ClientsEnded);

/// <summary>One member of staff's numbers, on the Owner's page.</summary>
/// <param name="HasLeftTheTeam">They are no longer active staff; their numbers stay theirs.</param>
public sealed record CoachMonthRowView(
    Guid CoachUserId,
    string Name,
    bool IsYou,
    bool HasLeftTheTeam,
    CoachMonthNumbersView ThisMonth,
    CoachMonthNumbersView LastMonth);

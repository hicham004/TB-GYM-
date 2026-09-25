using TB.Gym.Modules.PlatformBilling;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Platform billing settings that are not prices (ADR 0028). Prices live in the published plan, never here.
/// </summary>
public sealed class PlatformBillingOptions
{
    public const string SectionName = "PlatformBilling";

    /// <summary>The Whish number owners pay to, shown on the Billing page. Unset hides it.</summary>
    public string? WhishNumber { get; set; }

    /// <summary>The start of every invoice reference code, such as <c>TBG-202609-7KQ2XM</c>.</summary>
    public string ReferencePrefix { get; set; } = "TBG";

    /// <summary>How many days before the due date the "due soon" email goes out.</summary>
    public int DueSoonReminderDays { get; set; } = 2;

    /// <summary>Whether the Worker issues invoices and queues reminders on its own.</summary>
    public bool SweepEnabled { get; set; } = true;

    public int SweepIntervalSeconds { get; set; } = 900;

    public string? Validate()
    {
        if (!InvoiceReference.IsValidPrefix(ReferencePrefix))
        {
            return $"{SectionName}:ReferencePrefix must be 2-8 capital letters or digits, starting with a letter.";
        }

        if (DueSoonReminderDays is < 0 or > 30)
        {
            return $"{SectionName}:DueSoonReminderDays must be between 0 and 30.";
        }

        if (SweepIntervalSeconds is < 30 or > 86_400)
        {
            return $"{SectionName}:SweepIntervalSeconds must be between 30 and 86400.";
        }

        if (WhishNumber is { Length: > 40 })
        {
            return $"{SectionName}:WhishNumber cannot exceed 40 characters.";
        }

        return null;
    }
}

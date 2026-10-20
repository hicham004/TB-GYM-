namespace TB.Gym.SharedKernel;

/// <summary>
/// The sentence a person reads when a rule refuses what they sent.
/// </summary>
public static class PersonFacingMessages
{
    /// <summary>
    /// A refusal's own sentence, without what .NET appends for developers (audit CLIENT-5, NCM-10,
    /// AUTH-5): an <see cref="ArgumentException"/> ends in "(Parameter 'timeZoneId')", and an
    /// <see cref="ArgumentOutOfRangeException"/> adds "Actual value was …" after that.
    /// </summary>
    public static string PersonMessage(this Exception exception)
    {
        ArgumentNullException.ThrowIfNull(exception);
        var message = exception.Message;
        if (exception is ArgumentException { ParamName: { Length: > 0 } name })
        {
            var suffix = message.LastIndexOf($" (Parameter '{name}')", StringComparison.Ordinal);
            if (suffix >= 0)
            {
                message = message[..suffix];
            }
        }

        return message;
    }
}

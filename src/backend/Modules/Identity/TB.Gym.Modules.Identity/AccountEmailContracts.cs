namespace TB.Gym.Modules.Identity;

public interface IAccountEmailSender
{
    Task<AccountEmailDispatchResult> SendAsync(
        AccountEmailDispatchRequest request,
        CancellationToken cancellationToken);
}

public sealed record AccountEmailDispatchRequest(
    Guid UserId,
    string Recipient,
    AccountEmailPurpose Purpose,
    string Token);

public sealed record AccountEmailDispatchResult(
    EmailDeliveryStatus Status,
    string? DevelopmentActionUrl = null);


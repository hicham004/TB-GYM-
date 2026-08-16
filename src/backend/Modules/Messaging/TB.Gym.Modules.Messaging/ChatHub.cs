using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Messaging;

[Authorize]
public sealed class ChatHub : Hub
{
}

public sealed class MessagingModule : IModuleMarker
{
    public const string Name = "Messaging";
}

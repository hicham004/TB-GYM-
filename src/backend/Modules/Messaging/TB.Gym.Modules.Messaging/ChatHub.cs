using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Messaging;

/// <summary>
/// An authorized SignalR hosting shell, and deliberately nothing more.
/// </summary>
/// <remarks>
/// Phase 6B-2A persists conversations, participants, messages, revisions, read state and moderation
/// in PostgreSQL, and adds no realtime behaviour at all: this hub still has no hub method, no group
/// membership, no connection mapping, no acknowledgement and no catch-up. That is the point of the
/// ordering. A delivery channel built before the record it delivers can send but cannot say what was
/// sent, to whom, whether it arrived or whether anybody read it — and a message that exists only in a
/// socket frame is lost by the first disconnect.
/// <para>
/// Phase 6B-2B adds sending, group membership per conversation, reconnect and catch-up against the
/// sequences this slice already commits, and delivery acknowledgement recorded separately from read
/// state. An architecture test asserts this type stays empty until then.
/// </para>
/// </remarks>
[Authorize]
public sealed class ChatHub : Hub
{
}

public sealed class MessagingModule : IModuleMarker
{
    public const string Name = "Messaging";
}

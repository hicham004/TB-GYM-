using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Messaging;

/// <summary>
/// The realtime subscription surface, and deliberately nothing more.
/// </summary>
/// <remarks>
/// Every domain mutation stays on REST. There is no hub method that sends, edits, removes, moderates
/// or marks read, and there is no hub method that acknowledges: those carry cookie authentication,
/// antiforgery, idempotency keys, optimistic concurrency and the full authorization stack, and a hub
/// invocation carries none of them. What this hub can do is join and leave server-computed groups so
/// a committed change can be pushed to somebody who is already authorized to read it.
/// <para>
/// <b>The tenant arrives as query-string routing input, not as authorization.</b> A browser cannot
/// put a custom header on a WebSocket or an SSE stream, so the REST <c>X-Tenant-Id</c> convention has
/// no equivalent here. <c>?tenantId=</c> is therefore read exactly once, at connection, and is
/// immediately replaced by a <see cref="MessagingHubConnectionBinding"/> that only exists after
/// active membership has been read from PostgreSQL. A connection can never change workspace; changing
/// workspace means stopping this connection and opening another.
/// </para>
/// <para>
/// <b>Groups are routing, never authority.</b> They are transient, they are lost on an ordinary
/// reconnect, and removing somebody from one across replicas is best effort. So authorization is
/// re-established from the database on every hub method and again before every dispatched frame, and
/// nothing about correctness depends on a group having been left or on an in-memory connection
/// registry. Connection identifiers are never persisted, group counts are never treated as presence,
/// and there is no typing indicator, presence or online status here to be mistaken for one.
/// </para>
/// </remarks>
[Authorize]
public sealed class ChatHub(IMessagingRealtimeAuthorizer authorizer, ICurrentUser currentUser)
    : Hub<IMessagingRealtimeClient>
{
    /// <summary>The untrusted routing value, and the only query parameter the hub reads.</summary>
    public const string TenantQueryParameter = "tenantId";

    private const string BindingKey = "tb-gym.messaging.binding";

    public override async Task OnConnectedAsync()
    {
        var binding = await EstablishBindingAsync();
        if (binding is null)
        {
            // Fail closed and say nothing. An unauthenticated caller, a missing, malformed,
            // duplicated or unknown workspace value, and a workspace this account is not an active
            // member of are one answer, because telling them apart would confirm which workspaces
            // exist and who belongs to them.
            Context.Abort();
            return;
        }

        Context.Items[BindingKey] = binding;
        await Groups.AddToGroupAsync(
            Context.ConnectionId,
            MessagingRealtimeGroups.TenantUser(binding.TenantId, binding.UserId));
        await base.OnConnectedAsync();
    }

    /// <summary>
    /// Starts receiving full events for one conversation this caller may currently read.
    /// </summary>
    /// <remarks>
    /// The client passes a conversation identifier and never a group name, so there is no input
    /// through which another user's group, another workspace's group or an unrelated conversation
    /// could be addressed: the name is computed here, from the verified binding.
    /// <para>
    /// Authorization is re-read from PostgreSQL rather than inferred from the connection. A caller
    /// who was an active, entitled participant when the socket opened may since have been removed
    /// from the workspace, blocked, or had the Messaging entitlement lapse, and SignalR would still
    /// be presenting the principal they connected with.
    /// </para>
    /// <para>
    /// A refusal is silent and uniform. An unknown conversation, another workspace's conversation, a
    /// same-workspace non-participant and a participant whose entitlement is denied all simply do not
    /// join, exactly as the REST surface answers them all with one indistinguishable result.
    /// </para>
    /// </remarks>
    /// <returns><see langword="true"/> when the connection is now subscribed.</returns>
    public async Task<bool> SubscribeConversation(Guid conversationId)
    {
        if (Binding is not { } binding || conversationId == Guid.Empty)
        {
            return false;
        }

        if (!await authorizer.BindVerifiedTenantAsync(binding.TenantId, binding.UserId, Context.ConnectionAborted) ||
            !await authorizer.CanAccessConversationAsync(
                binding.TenantId,
                binding.UserId,
                conversationId,
                Context.ConnectionAborted))
        {
            return false;
        }

        await Groups.AddToGroupAsync(
            Context.ConnectionId,
            MessagingRealtimeGroups.ConversationUser(binding.TenantId, conversationId, binding.UserId));
        return true;
    }

    /// <summary>
    /// Stops receiving full events for one conversation.
    /// </summary>
    /// <remarks>
    /// Deliberately not an authorization decision. It computes this connection's own server-owned
    /// group name and leaves it; there is no name to supply and nothing to be granted, so a caller
    /// whose access has just been revoked can still tidy up after itself.
    /// </remarks>
    public async Task UnsubscribeConversation(Guid conversationId)
    {
        if (Binding is not { } binding || conversationId == Guid.Empty)
        {
            return;
        }

        await Groups.RemoveFromGroupAsync(
            Context.ConnectionId,
            MessagingRealtimeGroups.ConversationUser(binding.TenantId, conversationId, binding.UserId));
    }

    private MessagingHubConnectionBinding? Binding =>
        Context.Items.TryGetValue(BindingKey, out var stored)
            ? stored as MessagingHubConnectionBinding
            : null;

    private async Task<MessagingHubConnectionBinding?> EstablishBindingAsync()
    {
        if (currentUser.UserId is not { } userId ||
            Context.GetHttpContext() is not { } http ||
            !TryReadTenant(http.Request.Query[TenantQueryParameter], out var tenantId))
        {
            return null;
        }

        return await authorizer.BindVerifiedTenantAsync(tenantId, userId, Context.ConnectionAborted)
            ? new MessagingHubConnectionBinding(tenantId, userId)
            : null;
    }

    /// <summary>
    /// Exactly one non-empty workspace identifier, or nothing.
    /// </summary>
    /// <remarks>
    /// A repeated <c>?tenantId=a&amp;tenantId=b</c> is refused rather than resolved by taking the
    /// first or the last: two different answers to one question is a request nobody should have to
    /// guess the meaning of, and picking a side is how a proxy and an application end up disagreeing
    /// about which workspace a socket is for.
    /// </remarks>
    internal static bool TryReadTenant(Microsoft.Extensions.Primitives.StringValues values, out Guid tenantId)
    {
        tenantId = Guid.Empty;
        return values.Count == 1 &&
               Guid.TryParse(values[0], out tenantId) &&
               tenantId != Guid.Empty;
    }
}

public sealed class MessagingModule : IModuleMarker
{
    public const string Name = "Messaging";
}

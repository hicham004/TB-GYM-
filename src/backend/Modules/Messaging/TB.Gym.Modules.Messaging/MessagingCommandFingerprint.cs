using System.Security.Cryptography;
using System.Text;

namespace TB.Gym.Modules.Messaging;

/// <summary>
/// Binds an idempotency key to the normalized command it was spent on.
/// </summary>
/// <remarks>
/// Every fingerprint starts with the command name and the workspace, so a key spent in one workspace
/// or on one operation can never be honoured in another. Bodies and reasons are hashed in their
/// already-normalized form, so a retry differing only in line endings or trailing whitespace is
/// recognised as the same command rather than written a second time.
/// <para>
/// An expected concurrency version is deliberately <b>not</b> part of an edit, delete or moderate
/// fingerprint. A client that lost the response and re-read the message before retrying carries a
/// newer version, and binding to it would turn an honest retry into a conflict.
/// </para>
/// </remarks>
public static class MessagingCommandFingerprint
{
    public static string ForCreateConversation(Guid tenantId, Guid coachUserId, Guid clientProfileId) =>
        Hash($"create-conversation|{tenantId:N}|{coachUserId:N}|{clientProfileId:N}");

    public static string ForSend(
        Guid tenantId,
        Guid conversationId,
        Guid senderUserId,
        string normalizedBody) =>
        Hash($"send|{tenantId:N}|{conversationId:N}|{senderUserId:N}|{normalizedBody}");

    public static string ForEdit(
        Guid tenantId,
        Guid conversationId,
        Guid messageId,
        Guid editorUserId,
        string normalizedBody) =>
        Hash($"edit|{tenantId:N}|{conversationId:N}|{messageId:N}|{editorUserId:N}|{normalizedBody}");

    public static string ForDelete(
        Guid tenantId,
        Guid conversationId,
        Guid messageId,
        Guid actorUserId) =>
        Hash($"delete|{tenantId:N}|{conversationId:N}|{messageId:N}|{actorUserId:N}");

    public static string ForModerate(
        Guid tenantId,
        Guid conversationId,
        Guid messageId,
        Guid moderatorUserId,
        string normalizedReason) =>
        Hash($"moderate|{tenantId:N}|{conversationId:N}|{messageId:N}|{moderatorUserId:N}|{normalizedReason}");

    private static string Hash(string canonical) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
}

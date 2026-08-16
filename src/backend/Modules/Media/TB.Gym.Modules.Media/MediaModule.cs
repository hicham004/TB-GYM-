using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Media;

public interface IObjectStorage
{
    Task<StoredObject> PutAsync(ObjectUpload upload, CancellationToken cancellationToken);

    Task<Uri> CreateReadUrlAsync(string objectKey, TimeSpan lifetime, CancellationToken cancellationToken);

    Task DeleteAsync(string objectKey, CancellationToken cancellationToken);
}

public sealed record ObjectUpload(string FileName, string ContentType, Stream Content, Guid TenantId);

public sealed record StoredObject(string ObjectKey, long Length, string ContentType);

public sealed class MediaModule : IModuleMarker
{
    public const string Name = "Media";
}

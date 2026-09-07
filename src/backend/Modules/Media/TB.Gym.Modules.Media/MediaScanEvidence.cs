namespace TB.Gym.Modules.Media;

/// <summary>
/// Auditable evidence for the exact stored bytes a scanner inspected. The evidence keeps its own
/// locator even after operational purge clears the object's live key.
/// </summary>
public sealed record MediaScanEvidence
{
    private MediaScanEvidence(
        string storageLocation,
        string storageKey,
        string sha256,
        string scannerKey,
        string scannerVersion,
        DateTimeOffset scannedAtUtc,
        MediaScanOutcome outcome,
        string? failureCode)
    {
        StorageLocation = storageLocation;
        StorageKey = storageKey;
        Sha256 = sha256;
        ScannerKey = scannerKey;
        ScannerVersion = scannerVersion;
        ScannedAtUtc = scannedAtUtc;
        Outcome = outcome;
        FailureCode = failureCode;
    }

    public string StorageLocation { get; }

    public string StorageKey { get; }

    public string Sha256 { get; }

    public string ScannerKey { get; }

    public string ScannerVersion { get; }

    public DateTimeOffset ScannedAtUtc { get; }

    public MediaScanOutcome Outcome { get; }

    public string? FailureCode { get; }

    public bool IsAllowed => Outcome == MediaScanOutcome.Allowed;

    public static MediaScanEvidence Record(
        StorageObjectLocator locator,
        string sha256,
        MediaScanResult result,
        DateTimeOffset scannedAtUtc)
    {
        ArgumentNullException.ThrowIfNull(locator);
        ArgumentNullException.ThrowIfNull(result);
        if (scannedAtUtc.Offset != TimeSpan.Zero)
        {
            throw new ArgumentException("A media scan instant must be UTC.", nameof(scannedAtUtc));
        }

        return new MediaScanEvidence(
            locator.Location,
            locator.ObjectKey,
            MediaText.Sha256(sha256),
            MediaText.Required(result.ScannerKey, 80, nameof(result)),
            MediaText.Required(result.ScannerVersion, 40, nameof(result)),
            scannedAtUtc,
            result.IsAllowed ? MediaScanOutcome.Allowed : MediaScanOutcome.Refused,
            MediaText.Optional(result.FailureCode, 100, nameof(result)));
    }

    public bool Covers(StorageObjectLocator locator, string sha256) =>
        string.Equals(StorageLocation, locator.Location, StringComparison.Ordinal) &&
        string.Equals(StorageKey, locator.ObjectKey, StringComparison.Ordinal) &&
        string.Equals(Sha256, MediaText.Sha256(sha256), StringComparison.Ordinal);
}

public enum MediaScanEvidenceState
{
    None = 0,
    Complete = 1,

    /// <summary>
    /// A row predates exact locator/checksum/time evidence. No missing scanner fact is invented.
    /// </summary>
    LegacyUnavailable = 2,
}

public enum MediaScanOutcome
{
    Allowed = 1,
    Refused = 2,
}

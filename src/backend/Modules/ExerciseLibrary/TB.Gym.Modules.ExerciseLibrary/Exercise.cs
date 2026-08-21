using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.ExerciseLibrary;

public sealed class Exercise : TenantEntity
{
    private readonly List<ExerciseMuscle> muscles = [];
    private readonly List<ExerciseTag> tags = [];
    private readonly List<ExerciseAlternative> alternatives = [];
    private readonly List<ExerciseMediaLink> media = [];

    private Exercise()
    {
    }

    private Exercise(Guid tenantId, ExerciseDefinition definition)
        : base(tenantId)
    {
        ApplyDefinition(definition);
    }

    public string Name { get; private set; } = string.Empty;

    public string NormalizedName { get; private set; } = string.Empty;

    public string? Instructions { get; private set; }

    public ExerciseEquipment Equipment { get; private set; }

    public MovementPattern MovementPattern { get; private set; }

    public ExerciseClassification Classification { get; private set; }

    public bool IsArchived { get; private set; }

    public IReadOnlyCollection<ExerciseMuscle> Muscles => muscles;

    public IReadOnlyCollection<ExerciseTag> Tags => tags;

    public IReadOnlyCollection<ExerciseAlternative> Alternatives => alternatives;

    public IReadOnlyCollection<ExerciseMediaLink> Media => media;

    public static Exercise Create(Guid tenantId, ExerciseDefinition definition) =>
        new(tenantId, definition);

    public void Update(ExerciseDefinition definition)
    {
        if (IsArchived)
        {
            throw new InvalidOperationException("An archived exercise cannot be edited.");
        }

        ApplyDefinition(definition);
    }

    public void Archive() => IsArchived = true;

    public void Restore() => IsArchived = false;

    private void ApplyDefinition(ExerciseDefinition definition)
    {
        ArgumentNullException.ThrowIfNull(definition);
        var name = ExerciseText.Required(definition.Name, 160, nameof(definition.Name));
        var instructions = ExerciseText.Optional(definition.Instructions, 8_000, nameof(definition.Instructions));

        if (!Enum.IsDefined(definition.Equipment) ||
            !Enum.IsDefined(definition.MovementPattern) ||
            !Enum.IsDefined(definition.Classification))
        {
            throw new ArgumentException("Exercise metadata contains an unsupported value.", nameof(definition));
        }

        var requestedMuscles = definition.Muscles
            .DistinctBy(item => new { item.Muscle, item.Role })
            .OrderBy(item => item.Role)
            .ThenBy(item => item.Muscle)
            .ToArray();
        if (!requestedMuscles.Any(item => item.Role == MuscleRole.Primary))
        {
            throw new ArgumentException("At least one primary muscle is required.", nameof(definition));
        }

        var requestedTags = definition.Tags
            .Select(item => ExerciseText.Required(item, 60, nameof(definition.Tags)))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Order(StringComparer.OrdinalIgnoreCase)
            .Take(20)
            .ToArray();
        var requestedAlternatives = definition.Alternatives
            .DistinctBy(item => item.ExerciseId)
            .Take(20)
            .Select(item =>
            {
                if (item.ExerciseId == Guid.Empty || item.ExerciseId == Id)
                {
                    throw new ArgumentException("An alternative must reference another exercise.", nameof(definition));
                }

                return new ExerciseAlternativeDefinition(
                    item.ExerciseId,
                    ExerciseText.Optional(item.Note, 500, nameof(item.Note)));
            })
            .ToArray();
        var requestedMedia = definition.MediaAssetIds.Distinct().Take(10).ToArray();
        if (requestedMedia.Any(item => item == Guid.Empty))
        {
            throw new ArgumentException("Media ids cannot be empty.", nameof(definition));
        }

        Name = name;
        NormalizedName = name.ToUpperInvariant();
        Instructions = instructions;
        Equipment = definition.Equipment;
        MovementPattern = definition.MovementPattern;
        Classification = definition.Classification;

        muscles.RemoveAll(existing => !requestedMuscles.Any(requested =>
            requested.Muscle == existing.Muscle && requested.Role == existing.Role));
        foreach (var requested in requestedMuscles.Where(requested => !muscles.Any(existing =>
                     existing.Muscle == requested.Muscle && existing.Role == requested.Role)))
        {
            muscles.Add(ExerciseMuscle.Create(TenantId, Id, requested.Muscle, requested.Role));
        }

        tags.RemoveAll(existing => !requestedTags.Contains(existing.Value, StringComparer.Ordinal));
        foreach (var requested in requestedTags.Where(requested =>
                     !tags.Any(existing => string.Equals(existing.Value, requested, StringComparison.Ordinal))))
        {
            tags.Add(ExerciseTag.Create(TenantId, Id, requested));
        }

        alternatives.RemoveAll(existing => !requestedAlternatives.Any(requested =>
            requested.ExerciseId == existing.AlternativeExerciseId && requested.Note == existing.Note));
        foreach (var alternative in requestedAlternatives.Where(requested =>
                     !alternatives.Any(existing =>
                         existing.AlternativeExerciseId == requested.ExerciseId && existing.Note == requested.Note)))
        {
            alternatives.Add(ExerciseAlternative.Create(
                TenantId,
                Id,
                alternative.ExerciseId,
                alternative.Note));
        }

        media.RemoveAll(existing =>
            existing.DisplayOrder >= requestedMedia.Length ||
            requestedMedia[existing.DisplayOrder] != existing.MediaAssetId);
        for (var displayOrder = 0; displayOrder < requestedMedia.Length; displayOrder++)
        {
            var mediaAssetId = requestedMedia[displayOrder];
            if (!media.Any(existing =>
                    existing.MediaAssetId == mediaAssetId && existing.DisplayOrder == displayOrder))
            {
                media.Add(ExerciseMediaLink.Create(TenantId, Id, mediaAssetId, displayOrder));
            }
        }
    }
}

public sealed class ExerciseMuscle : TenantEntity
{
    private ExerciseMuscle()
    {
    }

    private ExerciseMuscle(Guid tenantId, Guid exerciseId, MuscleGroup muscle, MuscleRole role)
        : base(tenantId)
    {
        if (!Enum.IsDefined(muscle) || !Enum.IsDefined(role))
        {
            throw new ArgumentException("Muscle and role are required.");
        }

        ExerciseId = exerciseId;
        Muscle = muscle;
        Role = role;
    }

    public Guid ExerciseId { get; private set; }

    public MuscleGroup Muscle { get; private set; }

    public MuscleRole Role { get; private set; }

    internal static ExerciseMuscle Create(Guid tenantId, Guid exerciseId, MuscleGroup muscle, MuscleRole role) =>
        new(tenantId, exerciseId, muscle, role);
}

public sealed class ExerciseTag : TenantEntity
{
    private ExerciseTag()
    {
    }

    private ExerciseTag(Guid tenantId, Guid exerciseId, string value)
        : base(tenantId)
    {
        ExerciseId = exerciseId;
        Value = value;
        NormalizedValue = value.ToUpperInvariant();
    }

    public Guid ExerciseId { get; private set; }

    public string Value { get; private set; } = string.Empty;

    public string NormalizedValue { get; private set; } = string.Empty;

    internal static ExerciseTag Create(Guid tenantId, Guid exerciseId, string value) =>
        new(tenantId, exerciseId, value);
}

public sealed class ExerciseAlternative : TenantEntity
{
    private ExerciseAlternative()
    {
    }

    private ExerciseAlternative(
        Guid tenantId,
        Guid exerciseId,
        Guid alternativeExerciseId,
        string? note)
        : base(tenantId)
    {
        ExerciseId = exerciseId;
        AlternativeExerciseId = alternativeExerciseId;
        Note = ExerciseText.Optional(note, 500, nameof(note));
    }

    public Guid ExerciseId { get; private set; }

    public Guid AlternativeExerciseId { get; private set; }

    public string? Note { get; private set; }

    internal static ExerciseAlternative Create(
        Guid tenantId,
        Guid exerciseId,
        Guid alternativeExerciseId,
        string? note) =>
        new(tenantId, exerciseId, alternativeExerciseId, note);
}

public sealed class ExerciseMediaLink : TenantEntity
{
    private ExerciseMediaLink()
    {
    }

    private ExerciseMediaLink(Guid tenantId, Guid exerciseId, Guid mediaAssetId, int displayOrder)
        : base(tenantId)
    {
        ExerciseId = exerciseId;
        MediaAssetId = mediaAssetId;
        DisplayOrder = displayOrder;
    }

    public Guid ExerciseId { get; private set; }

    public Guid MediaAssetId { get; private set; }

    public int DisplayOrder { get; private set; }

    internal static ExerciseMediaLink Create(
        Guid tenantId,
        Guid exerciseId,
        Guid mediaAssetId,
        int displayOrder) =>
        new(tenantId, exerciseId, mediaAssetId, displayOrder);
}

public sealed record ExerciseDefinition(
    string Name,
    string? Instructions,
    ExerciseEquipment Equipment,
    MovementPattern MovementPattern,
    ExerciseClassification Classification,
    IReadOnlyList<ExerciseMuscleDefinition> Muscles,
    IReadOnlyList<string> Tags,
    IReadOnlyList<ExerciseAlternativeDefinition> Alternatives,
    IReadOnlyList<Guid> MediaAssetIds);

public sealed record ExerciseMuscleDefinition(MuscleGroup Muscle, MuscleRole Role);

public sealed record ExerciseAlternativeDefinition(Guid ExerciseId, string? Note);

public enum ExerciseClassification
{
    Strength = 1,
    General = 2,
    Mobility = 3,
    Conditioning = 4,
}

public enum ExerciseEquipment
{
    None = 1,
    Barbell = 2,
    Dumbbell = 3,
    Kettlebell = 4,
    Machine = 5,
    Cable = 6,
    Band = 7,
    Bodyweight = 8,
    SpecialtyBar = 9,
    Other = 10,
}

public enum MovementPattern
{
    Squat = 1,
    Hinge = 2,
    HorizontalPush = 3,
    VerticalPush = 4,
    HorizontalPull = 5,
    VerticalPull = 6,
    Carry = 7,
    Rotation = 8,
    Locomotion = 9,
    Isolation = 10,
    Mobility = 11,
    Other = 12,
}

public enum MuscleGroup
{
    Chest = 1,
    Back = 2,
    Shoulders = 3,
    Biceps = 4,
    Triceps = 5,
    Forearms = 6,
    Quadriceps = 7,
    Hamstrings = 8,
    Glutes = 9,
    Calves = 10,
    Abdominals = 11,
    Adductors = 12,
    Abductors = 13,
    FullBody = 14,
    Other = 15,
}

public enum MuscleRole
{
    Primary = 1,
    Secondary = 2,
}

internal static class ExerciseText
{
    public static string Required(string value, int maxLength, string parameterName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);
        var normalized = value.Trim();
        return normalized.Length <= maxLength
            ? normalized
            : throw new ArgumentException($"The value cannot exceed {maxLength} characters.", parameterName);
    }

    public static string? Optional(string? value, int maxLength, string parameterName) =>
        string.IsNullOrWhiteSpace(value) ? null : Required(value, maxLength, parameterName);
}

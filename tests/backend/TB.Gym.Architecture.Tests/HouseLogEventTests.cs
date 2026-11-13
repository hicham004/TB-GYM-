using System.Text.RegularExpressions;

namespace TB.Gym.Architecture.Tests;

/// <summary>
/// The house's log events (notes plans N9a1 and N9b1) keep ids 6400 to 6499 to themselves, one id an event, so an
/// alert or a count by id never mixes a trainee joining without Free with a platform admin changing a setting (the
/// clash N9b1's first build had). A source scan, so it reads every event declared, not only those a test run logs.
/// </summary>
[TestClass]
public sealed partial class HouseLogEventTests
{
    [TestMethod]
    public void EveryHouseLogEventIdNamesOneEvent()
    {
        var backend = Path.Combine(RepositoryRoot(), "src", "backend");
        var declared = new List<(int Id, string Name, string File)>();
        foreach (var file in Directory.EnumerateFiles(backend, "*.cs", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(backend, file).Replace('\\', '/');
            if (relative.Contains("/obj/", StringComparison.Ordinal) || relative.Contains("/bin/", StringComparison.Ordinal))
            {
                continue;
            }

            foreach (Match match in EventIdDeclaration().Matches(File.ReadAllText(file)))
            {
                var id = int.Parse(match.Groups["id"].Value, System.Globalization.CultureInfo.InvariantCulture);
                if (id is >= 6400 and < 6500)
                {
                    declared.Add((id, match.Groups["name"].Value, relative));
                }
            }
        }

        Assert.IsGreaterThanOrEqualTo(12, declared.Count, "The scan found the house's events: sign-up, its sweep, the settings and Free.");
        var shared = declared
            .GroupBy(item => item.Id)
            .Where(group => group.Select(item => item.Name).Distinct(StringComparer.Ordinal).Count() > 1)
            .Select(group => $"{group.Key}: {string.Join(", ", group.Select(item => $"{item.Name} ({item.File})"))}")
            .ToArray();
        Assert.IsEmpty(shared, "One id names two of the house's events: " + string.Join("; ", shared));
        var renamed = declared
            .GroupBy(item => item.Name, StringComparer.Ordinal)
            .Where(group => group.Select(item => item.Id).Distinct().Count() > 1)
            .Select(group => group.Key)
            .ToArray();
        Assert.IsEmpty(renamed, "One event of the house's carries two ids: " + string.Join(", ", renamed));
    }

    [GeneratedRegex(@"new EventId\(\s*(?<id>\d+)\s*,\s*""(?<name>[A-Za-z0-9]+)""\s*\)")]
    private static partial Regex EventIdDeclaration();

    private static string RepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "TB.Gym.slnx")))
        {
            directory = directory.Parent;
        }

        Assert.IsNotNull(directory, "The repository root could not be located from the test output directory.");
        return directory.FullName;
    }
}

using System.Net.Mail;
using System.Text.RegularExpressions;
using TB.Gym.Infrastructure.Initialization;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// UI plan R6.2d: the public homepage's pictures show a first-name cast in a workspace whose name was
/// checked against real businesses, chosen with a switch on the demo command, so the owner's own
/// demo keeps its full names. The same stories, people and keys; only the names change.
/// </summary>
[TestClass]
public sealed class DemoWorkspaceCastTests
{
    [TestMethod]
    public void TheSampleCastKeepsEveryStoryAndDropsTheSurnames()
    {
        var atlas = DemoWorkspaceCast.Atlas;
        var sample = DemoWorkspaceCast.Sample;

        Assert.AreEqual("Atlas Performance", atlas.WorkspaceName);
        Assert.AreEqual("Oakline Strength", sample.WorkspaceName);
        Assert.HasCount(atlas.Clients.Count, sample.Clients);
        Assert.HasCount(atlas.Coaches.Count, sample.Coaches);
        Assert.HasCount(atlas.PendingInvites.Count, sample.PendingInvites);

        var everyone = new[] { sample.Owner }.Concat(sample.Coaches)
            .Select(staff => (staff.FirstName, staff.LastName, staff.Email))
            .Concat(sample.Clients.Select(client => (client.FirstName, client.LastName, client.Email)))
            .Concat(sample.PendingInvites.Select(invite => (invite.FirstName, invite.LastName, invite.Email)))
            .ToList();
        foreach (var (firstName, lastName, email) in everyone)
        {
            Assert.IsTrue(Regex.IsMatch(lastName, @"^[A-Z]\.$"), $"{firstName} keeps an initial only, not {lastName}.");
            Assert.IsTrue(MailAddress.TryCreate(email, out _), $"{email} is a valid address.");
            Assert.IsFalse(email.Contains("atlas", StringComparison.Ordinal), email);
        }

        Assert.AreEqual(everyone.Count, everyone.Select(person => person.Email).Distinct().Count(), "Every address is distinct.");
        Assert.AreEqual("karim@oakline.example", sample.Owner.Email);
        Assert.AreEqual("Karim H.", sample.Owner.DisplayName);

        foreach (var (before, after) in atlas.Clients.Zip(sample.Clients))
        {
            Assert.AreEqual(before.Key, after.Key);
            Assert.AreEqual(before.FirstName, after.FirstName);
            Assert.AreEqual(before.CoachKey, after.CoachKey);
            Assert.AreEqual(before.IsHero, after.IsHero);
            Assert.AreEqual(before.Plans, after.Plans);
            Assert.AreEqual(before.Blocks, after.Blocks);
            Assert.HasCount(before.Messages.Count, after.Messages);
            Assert.IsFalse(after.Welcome.Contains("Atlas", StringComparison.Ordinal), after.Welcome);
            Assert.IsFalse(after.Messages.Any(message => message.Text.Contains("Atlas", StringComparison.Ordinal)), after.FirstName);
            Assert.AreEqual(before.Messages[^1].Ago, after.Messages[^1].Ago, "A with-expression keeps the recent message's timing.");
        }

        var hero = sample.Clients.Single(client => client.IsHero);
        Assert.AreEqual("Maya F.", hero.DisplayName);
        Assert.AreEqual("maya.f@mail.example", hero.Email);
        Assert.StartsWith("Welcome to Oakline, Maya!", hero.Welcome);
        Assert.AreEqual("Lynn B.", sample.Clients.Single(client => client.Key == "lynn").DisplayName);

        // The owner's own demo is untouched by the sample cast.
        Assert.AreEqual("Maya Fakhoury", atlas.Clients.Single(client => client.IsHero).DisplayName);
        Assert.AreEqual("lynn.boukhalil@mail.example", atlas.Clients.Single(client => client.Key == "lynn").Email);
        Assert.StartsWith("Welcome to Atlas, Maya!", atlas.Clients.Single(client => client.IsHero).Welcome);
    }

    [TestMethod]
    public void TheCommandChoosesTheCastFromItsArguments()
    {
        Assert.IsTrue(DemoWorkspaceOptions.TryParse([DemoWorkspaceCommand.Name], out var plain));
        Assert.AreSame(DemoWorkspaceCast.Atlas, plain.People);
        Assert.AreEqual(DemoWorkspaceCommand.DefaultPassword, plain.Password);

        Assert.IsTrue(DemoWorkspaceOptions.TryParse([DemoWorkspaceCommand.Name, "--cast", "sample"], out var sample));
        Assert.AreSame(DemoWorkspaceCast.Sample, sample.People);

        Assert.IsTrue(DemoWorkspaceOptions.TryParse(
            [DemoWorkspaceCommand.Name, "--cast", "atlas", "--password", "Another-Pass-1"], out var both));
        Assert.AreSame(DemoWorkspaceCast.Atlas, both.People);
        Assert.AreEqual("Another-Pass-1", both.Password);

        Assert.IsFalse(DemoWorkspaceOptions.TryParse([DemoWorkspaceCommand.Name, "--cast", "nope"], out _));
        Assert.IsFalse(DemoWorkspaceOptions.TryParse([DemoWorkspaceCommand.Name, "--cast"], out _));
        Assert.IsFalse(DemoWorkspaceOptions.TryParse([DemoWorkspaceCommand.Name, "--password", " "], out _));
        Assert.IsFalse(DemoWorkspaceOptions.TryParse([DemoWorkspaceCommand.Name, "--mystery", "x"], out _));
        Assert.IsFalse(DemoWorkspaceOptions.TryParse(["platform-admin"], out _));
    }
}

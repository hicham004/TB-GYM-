using System.Net;
using System.Net.Http.Json;
using Npgsql;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// P1: the builder's "Duplicate with progression" (TRN-025) and the RTS RPE chart load formula
/// (STR-010). The preview computes copies of a week with per-copy steps and saves nothing; a set the
/// chart cannot cover is refused with the reason; a program that uses the chart gets explained loads
/// when it is assigned.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string P1PreviewUrl = "/api/training/week-progression/preview";

    private static object P1Set(
        int position,
        string strategy,
        decimal? rpe = 7m,
        int reps = 5,
        decimal? percentage = null,
        decimal? direct = null,
        decimal? manual = null,
        string setType = "Normal") => new
        {
            position,
            setType,
            repetitionsMinimum = reps,
            repetitionsMaximum = reps,
            loadStrategy = strategy,
            directLoad = direct,
            loadUnit = strategy == "None" ? null : "Kilogram",
            percentageWorkingMax = percentage,
            targetRpe = rpe,
            targetRir = (decimal?)null,
            exertionDisplayPreference = "Rpe",
            restSeconds = (int?)null,
            tempo = (string?)null,
            coachNotes = (string?)null,
            manualLoadOverride = manual,
        };

    private static object P1Week(Guid exerciseId, params object[] sets) => new
    {
        label = "Week 1",
        isPublished = true,
        sessions = new[]
        {
            new
            {
                name = "Squat day",
                dayOffset = 0,
                coachNotes = (string?)null,
                exercises = new[]
                {
                    new
                    {
                        exerciseId,
                        position = 1,
                        isMainLift = false,
                        modificationPolicy = "CoachApprovedSwap",
                        coachNotes = (string?)null,
                        approvedAlternativeExerciseIds = Array.Empty<Guid>(),
                        sets,
                    },
                },
            },
        },
    };

    private static object P1Request(
        object sourceWeek,
        int copies,
        decimal rpeStep = 0m,
        int repsStep = 0,
        decimal percentageStep = 0m,
        decimal loadStep = 0m,
        int weeksInProgram = 1) => new
        {
            sourceWeek,
            copies,
            steps = new { rpeStep, repetitionsStep = repsStep, percentageStep, loadStep },
            weeksInProgram,
        };

    private static async Task<HttpResponseMessage> P1PreviewAsync(HttpClient client, object request)
    {
        await RefreshCsrfAsync(client);
        return await client.PostAsJsonAsync(P1PreviewUrl, request);
    }

    private static async Task<string> P1RefusalAsync(HttpResponseMessage response)
    {
        await AssertStatusAsync(response, HttpStatusCode.BadRequest);
        return await response.Content.ReadAsStringAsync();
    }

    [TestMethod]
    public async Task P1PreviewCopiesAWeekWithEachStepAndSavesNothing()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "p1-preview@example.test", "P1 Coach", "P1 Preview");
        var squat = await CreateExerciseAsync(coach, "Back squat", [], []);
        var source = P1Week(
            squat.Id,
            P1Set(1, "PercentageWorkingMax", rpe: 6m, percentage: 70m),
            P1Set(2, "RpeChart", rpe: 7m),
            P1Set(3, "Direct", rpe: 7m, direct: 100m),
            P1Set(4, "PercentageWorkingMax", rpe: 8m, percentage: 80m, manual: 102.5m),
            P1Set(5, "Direct", rpe: null, reps: 5, direct: 60m, setType: "WarmUp"));

        var response = await P1PreviewAsync(
            coach, P1Request(source, 3, rpeStep: 0.5m, repsStep: 1, percentageStep: 2.5m, loadStep: 2.5m));

        await AssertStatusAsync(response, HttpStatusCode.OK);
        var preview = await response.Content.ReadFromJsonAsync<WeekProgressionPreviewView>(SliceReadJson)
            ?? throw new AssertFailedException("The preview was empty.");
        Assert.AreEqual(("WeekStep", "1.0"), (preview.TransformKey, preview.TransformVersion));
        Assert.HasCount(3, preview.Weeks);
        for (var copy = 1; copy <= 3; copy++)
        {
            var sets = preview.Weeks[copy - 1].Sessions.Single().Exercises.Single().Sets;
            Assert.AreEqual(70m + 2.5m * copy, sets[0].PercentageWorkingMax);
            Assert.AreEqual(6m + 0.5m * copy, sets[0].TargetRpe);
            Assert.AreEqual(5 + copy, sets[0].RepetitionsMinimum);
            Assert.AreEqual(TrainingLoadStrategy.RpeChart, sets[1].LoadStrategy);
            Assert.AreEqual(7m + 0.5m * copy, sets[1].TargetRpe);
            Assert.AreEqual(100m + 2.5m * copy, sets[2].DirectLoad);
            Assert.AreEqual(102.5m + 2.5m * copy, sets[3].ManualLoadOverride);
            Assert.AreEqual(60m, sets[4].DirectLoad, "a warm-up stays as it was");
            Assert.AreEqual(5, sets[4].RepetitionsMinimum, "a warm-up stays as it was");
        }

        // A preview is a calculation: no program or draft exists afterwards.
        Assert.AreEqual(0, (await ReadSliceAsync<ProgramTemplatePage>(coach, "/api/training/templates")).Total);
        Assert.IsEmpty(await ReadSliceAsync<ProgramDraftSummary[]>(coach, R42aDraftsUrl));
    }

    [TestMethod]
    public async Task P1APreviewThatBreaksALimitIsRefusedWithTheReasonAndTheWeekItIsIn()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "p1-limits@example.test", "P1 Coach", "P1 Limits");
        var squat = await CreateExerciseAsync(coach, "Back squat", [], []);

        // RPE 9 + 0.5 x 3 = 10.5 on the third copy.
        var rpe = await P1RefusalAsync(await P1PreviewAsync(
            coach, P1Request(P1Week(squat.Id, P1Set(1, "RpeChart", rpe: 9m)), 3, rpeStep: 0.5m)));
        StringAssert.Contains(rpe, "Copy 3");
        StringAssert.Contains(rpe, "Back squat");
        StringAssert.Contains(rpe, "RPE would be 10.5");

        // The chart stops at 12 repetitions: 8 + 5 x 1 = 13 on the fifth copy.
        var reps = await P1RefusalAsync(await P1PreviewAsync(
            coach, P1Request(P1Week(squat.Id, P1Set(1, "RpeChart", rpe: 8m, reps: 8)), 5, repsStep: 1)));
        StringAssert.Contains(reps, "13 reps at RPE 8");
        StringAssert.Contains(reps, "RPE 6.5 to 10");

        // A program holds 52 weeks at most, and 12 copies is the most a preview makes.
        var weeks = await P1RefusalAsync(await P1PreviewAsync(
            coach, P1Request(P1Week(squat.Id, P1Set(1, "RpeChart")), 3, weeksInProgram: 50)));
        StringAssert.Contains(weeks, "52 weeks");
        var copies = await P1RefusalAsync(await P1PreviewAsync(
            coach, P1Request(P1Week(squat.Id, P1Set(1, "RpeChart")), 13)));
        StringAssert.Contains(copies, "1 to 12 copies");
        var step = await P1RefusalAsync(await P1PreviewAsync(
            coach, P1Request(P1Week(squat.Id, P1Set(1, "RpeChart")), 2, rpeStep: 0.3m)));
        StringAssert.Contains(step, "half steps");
    }

    [TestMethod]
    public async Task P1ASourceWeekThatCouldNotBePublishedIsRefusedBeforeItIsCopied()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "p1-source@example.test", "P1 Coach", "P1 Source");
        var squat = await CreateExerciseAsync(coach, "Back squat", [], []);

        // RPE 6 is not on the RTS chart, so this set cannot be saved as a chart set at all.
        var outside = await P1RefusalAsync(await P1PreviewAsync(
            coach, P1Request(P1Week(squat.Id, P1Set(1, "RpeChart", rpe: 6m)), 2, rpeStep: 0.5m)));
        StringAssert.Contains(outside, "Fix this week before copying it.");
        StringAssert.Contains(outside, "5 reps at RPE 6 is outside the chart");

        // A chart set needs an RPE and the highest reps.
        var missing = await P1RefusalAsync(await P1PreviewAsync(
            coach, P1Request(P1Week(squat.Id, P1Set(1, "RpeChart", rpe: null)), 2)));
        StringAssert.Contains(missing, "Fix this week before copying it.");
    }

    [TestMethod]
    public async Task P1APreviewIsForSignedInCoachesOfThatWorkspaceWithAnAntiforgeryToken()
    {
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "p1-auth-owner@example.test", "P1 Owner", "P1 Auth A");
        var squat = await CreateExerciseAsync(owner, "Back squat", [], []);
        var request = P1Request(P1Week(squat.Id, P1Set(1, "RpeChart")), 1);

        using var anonymous = CreateClient();
        await RefreshCsrfAsync(anonymous);
        await AssertStatusAsync(await anonymous.PostAsJsonAsync(P1PreviewUrl, request), HttpStatusCode.Unauthorized);

        // Signed in without the token the write cannot be made, even though it saves nothing.
        using var noToken = CreateClient();
        await RegisterCoachAsync(noToken, "p1-auth-token@example.test", "P1 Token", "P1 Token");
        noToken.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        Assert.AreEqual(HttpStatusCode.BadRequest, (await noToken.PostAsJsonAsync(P1PreviewUrl, request)).StatusCode);

        // A coach of another workspace names this one and is refused: membership decides, not the header.
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "p1-auth-stranger@example.test", "P1 Stranger", "P1 Auth B");
        SetTenant(stranger, workspaceId);
        Assert.AreEqual(HttpStatusCode.Forbidden, (await P1PreviewAsync(stranger, request)).StatusCode);

        // A client of the workspace is not staff.
        using var client = CreateClient();
        await InviteAndAcceptAsync(owner, client, "p1-auth-client@example.test", newAccount: true);
        SetTenant(client, workspaceId);
        Assert.AreEqual(HttpStatusCode.Forbidden, (await P1PreviewAsync(client, request)).StatusCode);

        // The owner, on the other hand, is served.
        await AssertStatusAsync(await P1PreviewAsync(owner, request), HttpStatusCode.OK);
    }

    [TestMethod]
    public async Task P1AssigningAChartProgramCalculatesFromTheChartAndExplainsEveryWeight()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p1-assign@example.test", "P1 Coach", "P1 Assign");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p1-assign-client@example.test", newAccount: true);
        SetTenant(client, workspaceId);
        var enrollment = await CreateFreeTrainingEnrollmentAsync(coach, clientId, TenantToday());
        var squat = await CreateExerciseAsync(coach, "Competition squat", [], []);
        var max = await RecordWorkingMaxAsync(coach, clientId, squat.Id, 140m);

        // Week 1: 5 reps at RPE 7 from the chart; a second set at 3 reps and RPE 8 beside a fixed weight.
        var created = await PublishProgramContentAsync(coach, new
        {
            name = "Chart base",
            description = (string?)null,
            weeks = new[]
            {
                P1Week(squat.Id,
                    P1Set(1, "RpeChart", rpe: 7m, reps: 5),
                    P1Set(2, "RpeChart", rpe: 8m, reps: 3),
                    P1Set(3, "Direct", rpe: 7m, reps: 5, direct: 100m)),
            },
        });
        await AssertStatusAsync(created, HttpStatusCode.OK);
        var template = await RequiredJsonAsync<TemplateVersion>(created);

        await RefreshCsrfAsync(coach);
        var assigned = await coach.PostAsJsonAsync(
            $"/api/training/clients/{clientId}/mesocycles",
            AssignmentRequest(enrollment.Id, template.Id, squat.Id, max.Id, 140m, Guid.NewGuid()));
        await AssertStatusAsync(assigned, HttpStatusCode.OK);
        var mesocycle = await assigned.Content.ReadFromJsonAsync<TrainingMesocycleView>(SliceReadJson)
            ?? throw new AssertFailedException("The program was empty.");

        var sets = mesocycle.Weeks.Single().Sessions.Single().Exercises.Single().Sets;
        Assert.AreEqual(TrainingLoadStrategy.RpeChart, sets[0].LoadStrategy);
        Assert.AreEqual(110.04m, sets[0].UnroundedRecommendedLoad);
        Assert.AreEqual(110m, sets[0].PrescribedLoad);
        Assert.AreEqual("RpeChart", sets[0].CalculationStrategyKey);
        Assert.AreEqual("1.0", sets[0].CalculationStrategyVersion);
        Assert.AreEqual(
            "RTS RPE chart v1: 5 reps at RPE 7 is 78.6% of 140 kg = 110.04 kg. Rounded to the nearest 2.5 kg: 110 kg.",
            sets[0].CalculationExplanation);
        // 3 reps at RPE 8 is 86.3%: 140 kg x 86.3% = 120.82 kg, which nearest 2.5 kg rounds to 120.
        Assert.AreEqual(120.82m, sets[1].UnroundedRecommendedLoad);
        Assert.AreEqual(120m, sets[1].PrescribedLoad);
        Assert.AreEqual(100m, sets[2].PrescribedLoad);
        Assert.AreEqual("CoachDirect", sets[2].CalculationStrategyKey);
        Assert.AreEqual(max.Id, mesocycle.WorkingMaxes.Single().SourceMaxRecordId);
    }

    [TestMethod]
    public async Task P1ATemplateThatUsesTheChartOutsideItsRangeCannotBePublishedAndTheDatabaseKnowsTheFormula()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "p1-publish@example.test", "P1 Coach", "P1 Publish");
        var squat = await CreateExerciseAsync(coach, "Back squat", [], []);

        // A draft keeps any value mid-edit (TRN-024); Publish is where the chart's range is checked.
        foreach (var (rpe, reps) in new[] { (6m, 5), (10m, 13), (6.5m, 0) })
        {
            var response = await PublishProgramContentAsync(coach, new
            {
                name = "Outside the chart",
                description = (string?)null,
                weeks = new[] { P1Week(squat.Id, P1Set(1, "RpeChart", rpe: rpe, reps: reps)) },
            });
            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode, $"RPE {rpe} x {reps} reps");
        }

        Assert.AreEqual(0, (await ReadSliceAsync<ProgramTemplatePage>(coach, "/api/training/templates")).Total);

        // The migration widened both check constraints, so the strategy is stored, not only accepted.
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        foreach (var constraint in new[] { "CK_ProgramTemplateSets_LoadStrategy", "CK_SetPrescriptions_LoadStrategy" })
        {
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = @name";
            command.Parameters.AddWithValue("name", constraint);
            var definition = (string?)await command.ExecuteScalarAsync();
            StringAssert.Contains(definition, "RpeChart", constraint);
        }
    }
}

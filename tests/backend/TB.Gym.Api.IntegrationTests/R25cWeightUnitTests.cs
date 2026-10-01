using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Npgsql;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// R2.5c: a person's saved weight unit lives on the global account, like their light/dark mode. It
/// is validated, remembered across sessions, private to the account, and moves no stored value.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task R25cWeightUnitIsValidatedRememberedAndPrivateToTheAccount()
    {
        using var account = CreateClient();
        await RegisterCoachAsync(account, "r25c-unit@example.test", "Unit", "Owner");
        var start = await ReadSliceAsync<PersonalSettings>(account, "/api/auth/me");
        Assert.AreEqual(("Kilogram", "system"), (start.PreferredWeightUnit, start.PreferredThemeMode));

        // Only the two canonical names are accepted, spelled exactly; nothing changes on a refusal.
        foreach (var refused in new[] { "Stone", "kg", "kilogram", "POUND", "" })
        {
            await RefreshCsrfAsync(account);
            await AssertStatusAsync(
                await account.PutAsJsonAsync("/api/auth/me/weight-unit", new { unit = refused }),
                HttpStatusCode.BadRequest);
        }

        await RefreshCsrfAsync(account);
        await AssertStatusAsync(
            await account.PutAsJsonAsync("/api/auth/me/weight-unit", new { unit = (string?)null }),
            HttpStatusCode.BadRequest);
        Assert.AreEqual("Kilogram",
            (await ReadSliceAsync<PersonalSettings>(account, "/api/auth/me")).PreferredWeightUnit);

        await RefreshCsrfAsync(account);
        var saved = await account.PutAsJsonAsync("/api/auth/me/weight-unit", new { unit = "Pound" });
        await AssertStatusAsync(saved, HttpStatusCode.OK);
        var response = await RequiredJsonAsync<PersonalSettings>(saved);
        Assert.AreEqual(("Pound", "system"), (response.PreferredWeightUnit, response.PreferredThemeMode));

        // It is the account's, so a new device signing in finds it, and the light/dark mode is a
        // separate setting that neither overwrites nor is overwritten by it.
        using var phone = CreateClient();
        await RefreshCsrfAsync(phone);
        var login = await phone.PostAsJsonAsync(
            "/api/auth/login",
            new { email = "r25c-unit@example.test", password = Password, rememberMe = false });
        await AssertStatusAsync(login, HttpStatusCode.OK);
        Assert.AreEqual("Pound", (await RequiredJsonAsync<PersonalSettings>(login)).PreferredWeightUnit);
        await RefreshCsrfAsync(phone);
        await AssertStatusAsync(
            await phone.PutAsJsonAsync("/api/auth/me/theme", new { mode = "dark" }), HttpStatusCode.OK);
        var both = await ReadSliceAsync<PersonalSettings>(account, "/api/auth/me");
        Assert.AreEqual(("Pound", "dark"), (both.PreferredWeightUnit, both.PreferredThemeMode));

        // Saving the same unit again is not an error, and it can be changed back.
        await RefreshCsrfAsync(account);
        await AssertStatusAsync(
            await account.PutAsJsonAsync("/api/auth/me/weight-unit", new { unit = "Pound" }), HttpStatusCode.OK);
        await RefreshCsrfAsync(account);
        await AssertStatusAsync(
            await account.PutAsJsonAsync("/api/auth/me/weight-unit", new { unit = "Kilogram" }), HttpStatusCode.OK);
        Assert.AreEqual("Kilogram",
            (await ReadSliceAsync<PersonalSettings>(phone, "/api/auth/me")).PreferredWeightUnit);

        // Another person's choice never moves this one.
        using var other = CreateClient();
        await RegisterCoachAsync(other, "r25c-unit-b@example.test", "Other", "Gym");
        await RefreshCsrfAsync(other);
        await AssertStatusAsync(
            await other.PutAsJsonAsync("/api/auth/me/weight-unit", new { unit = "Pound" }), HttpStatusCode.OK);
        Assert.AreEqual("Kilogram",
            (await ReadSliceAsync<PersonalSettings>(account, "/api/auth/me")).PreferredWeightUnit);
        Assert.AreEqual("Pound",
            (await ReadSliceAsync<PersonalSettings>(other, "/api/auth/me")).PreferredWeightUnit);
    }

    [TestMethod]
    public async Task R25cWeightUnitWritesNeedASessionAndAValidAntiforgeryToken()
    {
        using var stranger = CreateClient();
        await AssertStatusAsync(
            await stranger.PutAsJsonAsync("/api/auth/me/weight-unit", new { unit = "Pound" }),
            HttpStatusCode.Unauthorized);

        using var account = CreateClient();
        await RegisterCoachAsync(account, "r25c-csrf@example.test", "Csrf", "Owner");
        foreach (var token in new[] { null, "forged-token" })
        {
            account.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
            if (token is not null) account.DefaultRequestHeaders.Add("X-XSRF-TOKEN", token);
            var refused = await account.PutAsJsonAsync("/api/auth/me/weight-unit", new { unit = "Pound" });
            await AssertStatusAsync(refused, HttpStatusCode.BadRequest);
            using var body = JsonDocument.Parse(await refused.Content.ReadAsStringAsync());
            Assert.AreEqual("antiforgery_token_invalid", body.RootElement.GetProperty("code").GetString());
        }

        Assert.AreEqual("Kilogram",
            (await ReadSliceAsync<PersonalSettings>(account, "/api/auth/me")).PreferredWeightUnit);
    }

    [TestMethod]
    public async Task R25cTheDatabaseRefusesAnyOtherWeightUnit()
    {
        using var account = CreateClient();
        await RegisterCoachAsync(account, "r25c-check@example.test", "Check", "Owner");

        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "UPDATE identity.\"Users\" SET \"PreferredWeightUnit\" = 'Stone' WHERE \"Email\" = @email";
        command.Parameters.AddWithValue("email", "r25c-check@example.test");
        var exception = await Assert.ThrowsExactlyAsync<PostgresException>(
            async () => await command.ExecuteNonQueryAsync());
        Assert.AreEqual("23514", exception.SqlState);
        Assert.AreEqual("CK_Users_PreferredWeightUnit", exception.ConstraintName);
    }

    private sealed record PersonalSettings(string PreferredWeightUnit, string PreferredThemeMode);
}

using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Subscriptions;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Shared ground for notes plan N9c5's tests (Max): the house as N9c1 opens it, a Max plan covering the four things a
/// coach's client gets, Max's places filled by the platform admin, and a trainee put on Max the one way the house
/// books it, asked for and booked with its whole price.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string N9c5MaxPlacesSetting = "MaxPlaces";

    private const string N9c5MaxPlanName = "Max Coaching";

    /// <summary>A price no owner's offer uses (N7's trap): the test's own figure.</summary>
    private const decimal N9c5MaxPrice = 141.17m;

    private static readonly string[] N9c5MaxFeatures = ["Training", "Nutrition", "CheckIns", "Messaging"];

    /// <summary>
    /// The house with its Whish number, N9c1's Pro+ plan, a Max plan of one four-week option covering Training,
    /// Nutrition, Check-ins and Messaging, and Max's places set to <paramref name="places"/> (left empty when null).
    /// A Coach joins the house unless <paramref name="withCoach"/> is false, so a trainee has someone to coach them.
    /// </summary>
    private async Task<N9c5MaxSpace> N9c5MaxSpaceAsync(string tag, bool withCoach = true, string? places = "3")
    {
        var space = await N9c1OpenAsync($"n9c5-{tag}", withCoach);
        await RefreshCsrfAsync(space.House.Owner);
        var response = await space.House.Owner.PostAsJsonAsync(
            A7ProductsUrl,
            new
            {
                name = N9c5MaxPlanName,
                description = (string?)null,
                initialOffer = B4aOfferRequest(4, N9c5MaxPrice, "USD", N9c5MaxFeatures),
                houseTier = "Max",
            });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var max = await ReadSlicePayloadAsync<CoachingProductView>(response);
        if (places is not null)
        {
            await N9a1SettingAsync(space.House.Admin, N9c5MaxPlacesSetting, places);
        }

        return new N9c5MaxSpace(space, max);
    }

    /// <summary>The platform admin sets Max's places (null or blank empties them, which closes Max).</summary>
    private static async Task N9c5SetMaxPlacesAsync(N9c5MaxSpace space, string? places) =>
        await N9a1SettingAsync(space.House.Admin, N9c5MaxPlacesSetting, places ?? string.Empty);

    /// <summary>The trainee asks for Max's four-week option; 201 with the stored ask.</summary>
    private static Task<HousePlanAskView> N9c5AskForMaxAsync(N9c5MaxSpace space, N9a1Trainee trainee) =>
        N9c1AskedAsync(trainee.Client, space.MaxOfferId);

    /// <summary>The house's Owner books a trainee's Max ask with its whole price, under a new key.</summary>
    private static Task<HttpResponseMessage> N9c5BookMaxAsync(N9c5MaxSpace space, N9a1Trainee trainee, Guid askId) =>
        N9c1BookAsync(space.House.Owner, trainee.ProfileId, askId, Guid.NewGuid(), N9c5MaxPrice, "USD");

    /// <summary>
    /// Puts a trainee on Max the one way the house books it: they ask, the Owner books the ask with its whole price.
    /// Max then grants from the house's day (or from the end of a running Pro+), for four weeks.
    /// </summary>
    private static async Task<HousePlanAskView> N9c5OnMaxAsync(N9c5MaxSpace space, N9a1Trainee trainee)
    {
        var ask = await N9c5AskForMaxAsync(space, trainee);
        var response = await N9c5BookMaxAsync(space, trainee, ask.Id);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<HousePlanAskView>(response);
    }

    private sealed record N9c5MaxSpace(N9c1Space Space, CoachingProductView Max) : IDisposable
    {
        public N9a1House House => Space.House;

        public Guid MaxOfferId => Max.Offers[0].Id;

        public void Dispose() => Space.Dispose();
    }
}

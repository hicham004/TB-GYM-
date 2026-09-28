# Reference board

Screens to learn from, one line each on what to take. Screenshots of other companies' products are
**not committed** (they're third-party material). Open the links, or keep local copies outside git.
Every screen spec in [UI-REDESIGN-PLAN.md](../UI-REDESIGN-PLAN.md) names the references it follows.

## Starting point: our own prototype and concepts (R1)

`prototype/tb-gym-prototype.html` is the clickable, GSAP-animated prototype the owner approved on
2026-09-28 (live copy: https://claude.ai/artifact/RHKaDiQAVU8FBJBBTQMyn4). It covers the client
Today, the workout player, the summary and share card, Coach Today with a live feed, four coach
brands plus a custom colour, and light/dark. Open it in a browser; it loads GSAP and Google Fonts
from their CDNs.

`concepts/r1-coach-today.png`, `concepts/r1-client-today.png` and `concepts/r1-workout-player.png`,
built from `concepts/concept.html` on 2026-09-28. They show the brand v2 direction on realistic
content. They're a target for R1, not pixel specs; the approved version gets built in the lab on
demo data.

## Coach side

| Product | Look at | Take |
| --- | --- | --- |
| Hevy Coach | [hevycoach.com](https://hevycoach.com/) hero dashboard | The same layout as ours made alive by faces, feed sentences ("Kaiya finished Push Day, 7,800 kg, 3 PRs") and a weekly active-clients chart |
| TrueCoach | [Dashboard feature page](https://truecoach.co/features/dashboard/) | Activity feed, completion rates (7/30/90 days), "Due soon" and "Needs attention" lists on one screen |
| Everfit | [Coach app](https://apps.apple.com/us/app/everfit-for-coach/id1485827117), [Autoflow](https://help.everfit.io/en/articles/3661707-autoflow-overview-how-to-automate-your-training-business) | Automation and completion tracking; fast program builder |

## Client side

| Product | Look at | Take |
| --- | --- | --- |
| Hevy | [App Store](https://apps.apple.com/us/app/hevy-workout-tracker-gym-log/id1458862350) | Set rows with previous values, one-tap ✓, the rest timer, the exercise history chart |
| Everfit client | [App Store](https://apps.apple.com/us/app/everfit-train-smart/id1438926364) | "Your day in a snapshot" Today, the macro ring, voice notes, video in the logger |
| Future | [App Store](https://apps.apple.com/us/app/future-pro-personal-training/id1288178982) | Coach presence, a dark editorial style, photographic workout cards, a greeting |
| Ladder | [App Store](https://apps.apple.com/us/app/ladder-strength-training-plans/id1502936453) | Bold numbers, a week strip with completion rings, photography, a lime-on-dark accent |
| Whoop | [App Store](https://apps.apple.com/us/app/whoop/id933944389) | One hero number plus one plain sentence explaining it |
| MacroFactor | [App Store](https://apps.apple.com/us/app/macrofactor-macro-tracker/id1553503471) | Fast food logging and a clear daily macro view |

## What to avoid

Scroll-hijacking, animation on every tap, stock photos of people inside the app, AI-generated
"real" people, charts without a sentence of meaning, and internal system words on screen.

# Placeholders for the private pre-launch build

Stand-in photographs for showing the homepage privately before the shoot (UI plan R6.2h).
AI-generated people are allowed in this folder and nowhere else in TB Gym.

- Every file here except this README is git-ignored, so the pictures never enter the repository
  (nor do screenshots of them: `docs/design/` keeps the grey version of the private page).
- The production build never copies this folder; only the private build does, through the
  `placeholders` configuration in `angular.json`.
- `npm run build` refuses a production output that holds the folder, names it, draws a stand-in or
  asks not to be indexed (`scripts/check-prerender.mjs`, proven with planted files in its tests).

Files the private build looks for (JPEG, landscape; any that exist are used, grey stand-ins for the rest):

| File        | What it shows                                                   | Where on the page                     |
| ----------- | --------------------------------------------------------------- | ------------------------------------- |
| `hero.jpg`  | A coach beside a loaded barbell, reading a phone                | Behind the hero, the phone in front   |
| `train.jpg` | A client between sets, phone in hand                            | Monday evening, "They lift it."       |
| `talk.jpg`  | The coach and the client looking at a phone together at the bar | Sunday, "You both see it."            |
| `team.jpg`  | Two coaches on a gym floor, each with a client                  | The gyms story, above the Team screen |

## Showing it

From the repository root:

```powershell
.\scripts\private-preview.ps1                     # build, then open http://127.0.0.1:4400/
.\scripts\private-preview.ps1 -Network            # also on the local Wi-Fi, behind a password it prints
.\scripts\private-preview.ps1 -Api http://localhost:5134   # with a running API, so Talk to us can send
```

The script writes `home-placeholders.ts` into this folder (git-ignored, like the pictures) from
the files it finds, builds with `ng build --configuration production,placeholders` into
`src/web/.private`, and serves it with `X-Robots-Tag: noindex, nofollow` on every response. Every
stand-in on the page carries a visible "Placeholder" mark, and the pages ask not to be indexed.
`npm run e2e:private` runs the Playwright checks of this build (`playwright.private.config.ts`).

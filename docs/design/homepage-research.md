# Homepage research: what the best do, and what only TB Gym can show

Written for UI plan R6.2b on 2026-10-12, before the homepage was rebuilt. Twenty-nine homepages
were read that day: the competitors a coach compares us with, the fitness and health products
people love, the product sites engineers copy, and the sites the web-design juries picked. Each
was read as text and structure (headline, calls to action, sections, motion, media), not as a
screenshot; third-party screenshots are not committed (REFERENCES.md). Where a site could not be
read (Whoop's site refuses robots; Opal now redirects to an essay), the note says so.

Three facts drove the decision at the end:

1. Every coaching product shows **one side**: the coach's dashboard. Every consumer fitness app
   shows **the other side**: the client's phone. Nobody shows the same week from both sides.
2. The best product sites win by **showing the real product doing real work with realistic data**
   (Linear, Family, Mercury), not by describing it.
3. The award winners win by making **the scroll itself the story**, in chapters, with one object
   that carries it. They pay for it with WebGL, sound and lock-and-scroll, which the reference
   board rules out and which would fail our Lighthouse bar on a phone.

## 1. The competitors: coaching software

| Site | What it does best | What we take, and what we leave |
| --- | --- | --- |
| [Hevy Coach](https://hevycoach.com/) | A single conversion path: "Start 30 Day Free Trial" with "No credit card required" in the hero and again at pricing; a three-step "Getting started is easy". | Take the three plain steps. Leave the static dashboard screenshot and the eleven tool cards. |
| [TrueCoach](https://www.truecoach.co/) | Low-friction trial entry: one email field and "Try it free", with "Cancel any time". Names the enemy: "spreadsheets and texting" are outdated. | Take the named enemy (we already do). Leave the nine-card feature grid and the counters (16K+ coaches in one place, 20,000+ in another). |
| [Everfit](https://everfit.io/) | A repeatable module: a short label ("PLAN & COACH", "ENGAGE"), one tagline, a list of one-liners with visuals. A rotating audience word in the headline. | Take the module rhythm for the "what's inside" section. Leave the marquees, the "#1" badge and "Trusted by over 380,000 coaches". |
| [ABC Trainerize](https://www.trainerize.com/) | Social proof straight under the hero: 400k+ coaches, 45k+ companies, Gold's Gym and YMCA logos, before any feature. | Nothing to take yet: we have no numbers to show honestly. Leave the email-capture hero. |
| [PT Distinction](https://www.ptdistinction.com/) | Trust first: award badges and three 4.9-star ratings before features; "Access For All" (every feature in every package). | Take "every feature in every package" as a stance when pricing is public (not this step: money terms stay as they are). |
| [TrainHeroic](https://www.trainheroic.com/) | The hero names the audience and the jobs in one breath: "The Premier Platform For Strength Coaches", then "Sending workouts isn't the same as coaching." An angled laptop mockup. | Take the sentence "sending workouts isn't coaching" as the attitude. Leave the generic mockup. |
| [Kahunas](https://kahunas.io/) | Pain-first headline ("who has time for clunky platforms and dull spreadsheets?"), a founder's guarantee, a GIF of the progress-photo overlay. | Take the one moving demo of a real feature. Leave the urgency banner and the branded-app upsell. |
| [Caliber](https://caliberstrong.com/) | A coach and a client's exchange shown as content (James and Kirsten, "+11 Strength Balance") beside a photo; three steps from intake to coached execution. | The closest anyone gets to a two-sided story, as one static quote. We make it the whole page. |

What they all share: a "#1" claim, a trial button with an email field, a logo wall or star badges, a
long grid of features, and screenshots of the coach's dashboard that were drawn for marketing. The
client's phone is a small mockup or absent. Nothing moves except carousels.

## 2. Consumer fitness and health

| Site | What it does best | What we take |
| --- | --- | --- |
| [Hevy](https://www.hevyapp.com/) | A three-beat headline ("Log Workouts / Get Stronger / Stay Motivated") that maps onto the first three sections; phone and watch mockups; "17+ million athletes". | The three-beat headline that the page then keeps. |
| [Strava](https://www.strava.com/) | Frictionless entry: three sign-up buttons in the hero; layered screenshots. | One primary action, repeated. |
| [Future](https://www.future.co/) | Coach presence: a phone mockup with the coach's check-in clip and a chat line ("a lift and quick recovery"); price and refund beside the button. | The coach as a person in the client's phone. (Price beside the button is not ours to decide in this step.) |
| [Ladder](https://www.joinladder.com/) | Defines itself by contrast: "not algorithm-generated, not 1-on-1 remote personal training, and not class-led". | Define by contrast: not a chat thread, not a spreadsheet, not a PDF. |
| [Whoop](https://www.whoop.com/) (site refuses robots; read from the [App Store listing](https://apps.apple.com/us/app/whoop/id933944389)) | One hero number with one sentence of meaning: "a daily Recovery score on a scale of 1 to 99%... When you're in the green, you're ready for strain." | One number, one sentence. Our number is the client's lift. |
| [Oura](https://ouraring.com/) | Outcome-led slides ("Put your stress to the test"); a claim with a footnote ("86% of Oura Members see their health improve", sample and window stated). | Claims carry their footnote. |
| [Eight Sleep](https://www.eightsleep.com/) | Scenario-led storytelling: "Quit fighting over the thermostat" over an app-style readout on a photo; a looping hero film with a poster. | A scenario per chapter with the real readout. The poster-first hero is exactly how R6.2c's video will arrive. |
| [Tonal](https://www.tonal.com/) | A feature row of image + heading + one benefit sentence ("Weight that adapts to you", "Gains without the guesswork"). | One claim, one sentence, one picture. |
| [Peloton](https://www.onepeloton.com/) | (Not read: the fetch landed on an unrelated Peloton.) Known for a full-bleed hero video and coach faces; noted for completeness, not relied on. | Nothing. |

## 3. The best product sites

| Site | What it does best | What we take |
| --- | --- | --- |
| [Linear](https://linear.app/) | "Shows the product doing the work": every capability section pairs a one-line claim with a realistic UI mockup carrying domain-specific sample data (tickets, a roadmap, an agent's chat), so claims read as demonstrated. | Real UI with real-looking data, one claim per section. Our data is realer: the Atlas demo built through the real services. |
| [Stripe](https://stripe.com/) | Audience routing with proof (enterprises, startups, platforms each get a headline and a link); an animated wave hero with a static fallback. | Three audiences at the end (independent coaches, gyms, clients). A fallback for every effect. |
| [Family](https://family.co/) | Phone screens everywhere; copy and testimonials praise the micro-animations ("numbers that animate beautifully"); "Watch the demo" per section. | Motion as proof of craft, on the product's own numbers. |
| [Mercury](https://mercury.com/) | One animation per claim (cards stacking); a hero that is a start frame and an end frame. | One moment per chapter, not constant motion. |
| [Raycast](https://www.raycast.com/) | One memorable object explains the product: a keyboard with four callouts. | One object the page keeps returning to. |
| [Notion](https://www.notion.com/) | Three named steps (Capture, Find, Automate), each with a promise line and screenshots. | Name the steps. |
| [Arc](https://arc.net/) | A scan rhythm: short headline, one benefit sentence, screenshot, repeated. | The rhythm. |
| [Vercel](https://vercel.com/) | Proof beside the claim: a named customer and a figure for every use case. | When we have founding coaches: a name beside each claim. |
| [Rive](https://rive.app/) | Stacked proof: a trusted-by line, logos, stats, eighteen quotes; the runtime pitch "120fps with perfect quality". | Nothing yet (no proof to stack); the standard for smoothness. |
| [Apple, iPhone](https://www.apple.com/iphone/) | Modular feature storytelling: a short lead-in, a large device image, a compact subhead, repeated down a very long page. | The device as the hero image, photographed with care. |

## 4. The award winners (Awwwards Sites of the Year, [list](https://www.awwwards.com/websites/sites_of_the_year/))

| Site | What it does | What we take, and what we leave |
| --- | --- | --- |
| [Lando Norris](https://www.landonorris.com/) by OFF+BRAND, 2025 | A cursor-reactive hero built from the subject's own helmet (blobs, neon); the site split into "On Track" and "Off Track"; a helmet archive with hover swaps; Rive animations with placeholders; "tap to lock / back to scroll". | Take: a motif drawn from the subject (ours: the week strip and the lime set ticks from the app), and a two-sided split. Leave: lock-and-scroll and "rotate your device". |
| [Igloo Inc](https://igloo.inc/) by abeto, 2024 ([case study](https://awwwards.com/igloo-inc-case-study.html)) | Three sections; the UI in WebGL; a real-time intro; each project its own ice block because identical blocks "looked too similar to each other when scrolling past"; particles synced to audio. The brief was "a scrolling experience that kept users engaged". | Take: the scroll as the story's spine, and a distinct object per chapter. Leave: WebGL, sound, the loader. |
| [Lusion v3](https://lusion.co/), 2023 | "Scroll to explore" and "continue to scroll" cues; a reel; 3D work cards with discipline tags. | Take: the quiet scroll cue under the hero. Leave: the showreel feel. |
| [Opal Tadpole](https://opalcamera.com/) by Claudio Guglieri, 2024 (the product page now redirects to [an essay](https://op.al/)) | Product photography and one metaphor carried from heading to sign-off ("the table"). | One metaphor carried to the end. |
| Messenger by abeto, 2025 | Listed with the 2025 badge; no public address was found, so it was not read. | Nothing. |

## 5. Where the current page stands

The page built on 2026-09-24 and pre-rendered in R6.2a already does several of these things: a
pain-led headline, an auto-playing coach-and-client example, a before/after panel, a product tour.
Measured with Lighthouse 13 on a phone against the production build served with nginx's rules
(2026-10-12, before this step): performance 64 (first paint 5.0 s, largest paint 6.4 s, blocking
110 ms, no layout shift), accessibility 97 (one contrast pair), best practices 96 (the signed-out
session check logs a 401 in the console), SEO 92 (no robots.txt, so the shell answers for it).
The example and the tour are drawings of the product, not the product, and they play on a timer
rather than with the reader.

## 6. What TB Gym can own that none of them has

1. **One week, two screens.** TB Gym's rules are built on the separation the competitors hide: a
   prescription is never overwritten by what was lifted (TRN), training maxes carry their provenance
   (STR), a check-in is answered one question at a time and read by the coach in one timeline, and
   the coach's brand paints the client's phone (R3.5a). The same week can be shown from the coach's
   screen and the client's phone, with the numbers travelling between them. No competitor shows the
   client's side at all; no consumer app has a coach's side.
2. **Real screens, real data.** The Atlas demo is built through the real services on a time-travel
   clock, so every screen is the shipped product with data that obeys every rule. Competitors use
   marketing renders; the award winners use 3D worlds. Ours can be photographs of the product, which
   also keeps the copy true to shipped features (the rule since the first homepage).
3. **A number that travels.** Whoop's "one number, one sentence" becomes a story when the number
   moves: Maya's back squat, prescribed on Monday, lifted that evening with 2.5 kg more, celebrated
   in the chat, suggested as her new training max for the coach to keep. Every step is a real screen.

## 7. Three concepts

**A. One week, two screens (the scroll story).** The hero is the two screens: Lea's Coach Today and
Maya's phone on the Atlas demo, with the headline "You plan it. They lift it. You both see it." As
the reader scrolls, the screens stay (pinned on a wide screen) and the week passes beside them in
chapters: Monday, plan; Monday evening, train; Tuesday, eat; Thursday, check in; Friday, talk;
Sunday, progress. Each chapter swaps both screens to that moment's real screen and moves the
travelling number. On a phone the chapters stack, each with its own screens; with reduced motion
the same stack is still. GSAP ScrollTrigger on the homepage only; everything else is CSS.
*Risk:* the pinned stage must be fast and must degrade to a plain page. *Why it is one of one:*
nobody else can show both sides, and nobody in the category shows the real product moving.

**B. The number that travels (typographic).** A page built around one lift: a display numeral in
Instrument Serif morphs as you scroll (52.5 → 55 → a kept max), with small crops of real screens.
Minimal imagery, very fast. *Risk:* abstract for a coach deciding in thirty seconds; the product
still has to be shown, so it becomes concept A with smaller pictures.

**C. The coach's Tuesday (the live feed).** Time of day as the scroll axis: Coach Today's real
activity feed grows as you scroll (06:40 Maya finished Lower A, 07:15 a check-in from Rita, ...),
Hevy Coach's feed sentences made alive. *Risk:* one-sided again (the coach only, like every
competitor); the client's phone becomes a footnote; hard to tell from Hevy Coach's hero.

## 8. The decision

**Concept A, with B's travelling number as the motif inside it and C's feed sentences as the coach's
side of the Monday-evening chapter.** Decided by Claude for the owner on 2026-10-12 after the reading
above: it is the one thing the competitors cannot show (§1, §6.1), it uses the real product on real
data as the best product sites do (§3), and it borrows only the spine of the award winners (the scroll
as the story, one object per chapter) and none of their cost (§4).

What stays exactly as it was: money terms (the page names no price, trial or offer, and this step
adds none) and legal statements (there are none on the page). The hero works without the video;
R6.2c drops its loop into the hero's picture frame later, poster first, as Eight Sleep does.

The bar for the build is the row's: Lighthouse on a phone at performance 90 or more, accessibility
100, best practices and SEO 95 or more; reduced-motion and keyboard paths; the pre-render kept;
Vitest for the motion set-up and clean-up; Playwright at 390 and 1440 px; and at least two polish
rounds with the page's screenshots set beside the references above.

## 9. What was built, and the polish rounds

Built on 2026-10-12 as `features/home/` (`home-week`, `home-inside`, `home-closing`), on the real
screens of the Atlas demo: Lea Khoury's coaching screens and Maya Fakhoury's phone, photographed
after Maya logged Lower A with 2.5 kg more on her last squat set, as Lea's message asked. Every
picture is listed in `src/web/scripts/home-screens.mjs`. Screenshots of the page are in
`docs/design/r62b-*.png` (1440 px: the hero, the Train, Talk and Share chapters, the still page with
reduced motion, What's inside; 390 px: the hero, the Train, Check in and Share chapters, Who it's for).

**Round one** (the page beside Linear, Family and Eight Sleep: real UI, one claim per section, a
readout per scenario): the headline went from two lines to its three beats, one per line, as Hevy's
three promises are; on a phone the phone and the coach's screen stopped overlapping (the coach's
screen was unreadable at a third of its size) and stack with the moment's number between them;
the phone pictures were drawn stretched by the HTML `height` attribute and are now sized by the
stylesheet; the Sunday coach picture changed from the Training tab, whose suggestion the phone
covered, to Maya's overview, where "Logged sets suggest a new Deadlift max" reads at the top;
the stage's pictures became lazy, so a phone never downloads the eight coach screens it does not
draw.

**Round two** (the page beside Apple's product pages and Lando Norris's site: rhythm, one object
that carries the story, nothing locked): on a phone the hero's copy owns the first screen, with
"See a week of coaching" as the way down, so the first paint is the headline and the pictures
follow; the phone pictures come in two sizes; the stage's top bar wraps its caption instead of
clipping it on a narrow stage; the global stylesheet is put inside the built page so the first paint
needs the HTML alone; the two Latin IBM Plex files were subset from about 65 kB to about 25 kB each;
the link-preview picture is the hero itself.

**Not done, on purpose:** no cursor-reactive hero, no lock-and-scroll, no sound, no 3D (the
reference board's rules); no claim the product does not keep; no price, trial or offer.

**Measured** (Lighthouse 13 on a phone, the production build served with nginx's rules and gzip,
2026-10-12): performance 91, 90, 91, 90 over four quiet runs (87 once while the test suites ran),
accessibility 100, best practices 96, SEO 100; first paint 2.3 to 2.4 s, largest paint 3.0 to 3.2 s (the
headline), blocking 60 to 90 ms, no layout shift. On desktop: 98 / 100 / 96 / 100. Before this step the
same page scored 64 / 97 / 96 / 92 (85 on performance once gzip was accounted for). The one failing
audit left is the signed-out session check's 401 in the console, a backend answer (follow-ups in the
plan).

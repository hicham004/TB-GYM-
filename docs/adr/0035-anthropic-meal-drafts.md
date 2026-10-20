# ADR 0035: Optional Anthropic meal suggestions

- Status: Accepted for the requested launch fix
- Date: 2026-10-05

The existing AI review flow always used an unavailable provider, and its feedback appeared away
from the generation button. Enabling a billed provider also exposed missing failed-response costs
and races in the monthly allowance.

Use the official `Anthropic` .NET SDK, pinned centrally, behind `IAiMealDraftProvider` in
Infrastructure. The optional default is `claude-sonnet-5-5`, currently documented at USD 2 input /
10 output per million tokens: the current balanced model avoids choosing an older model near its
earliest retirement date. SDK types stay inside the adapter. See the official
[SDK](https://github.com/anthropics/anthropic-sdk-csharp),
[models](https://platform.claude.com/docs/en/about-claude/models/overview), and
[pricing](https://platform.claude.com/docs/en/about-claude/pricing).

Requests contain only the coach's general meal description and language, with an explicit warning
to omit personal/health information. No client profile is fetched. Structured output matches
`meal-draft-v1`; all output still passes owned bounds/schema validation and requires coach mapping
to canonical foods and approval. The default caps output at 2,048 tokens and times out after 45
seconds. Five-minute caching marks the static prompt without padding it; short prompts may be
uncached. See [structured output](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
and [prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

A per-tenant PostgreSQL advisory lock serializes allowance reservations before any billed call.
Pending operations reserve a conservative token/cost bound using UTF-8 bytes, framing allowance
and the highest cache-write rate. Known USD charges replace that reservation, including refusal,
invalid output and other failures. Ambiguous transport failures/timeouts retain the reservation;
there are no automatic SDK retries. Four-decimal cost recording rounds upward. Model/routing
options are restricted to the documented rates; changing either requires updating reference tests.

Availability is an authenticated coach read exposing only a configured boolean; since the audit's batch
A6 (2026-10-20, LOST-4) it is true only while TB Gym's ceiling (below) is also above zero, and Settings ›
Nutrition reads it as the recipe editor does, so the two never disagree. Disabled AI
explains setup beside the button; failures there are announced and focused. Configuration contains
the server key only. The adapter is verified with HTTP fakes; a real-key generation remains an
operational check before enabling it for coaches. The full nutrition redesign remains R4.4.

## Amended in R4.4b (2026-10-07)

Suggestions moved into New recipe. The coach matches each suggested ingredient to a food, as in any
recipe importer (MyFitnessPal's matches each line and lets the user change or drop it), and may drop
suggested ingredients or add others; approval needs at least one line rather than exactly one per
suggestion. Every saved line is still a food version the coach chose, approval may publish in the
same save, and the operation keeps the suggestion beside the recipe it became (NUT-004).

## Amended in R4.4c (2026-10-07)

TB Gym pays Anthropic, yet any coach could set a workspace's allowance up to USD 1,000,000 a month.
TB Gym now sets a ceiling for every workspace in server configuration (`Nutrition:AiAllowance`,
`MaximumMonthlyRequests` and `MaximumMonthlyCostUsd`; zero, so AI stays off, until set). Only the owner
changes the workspace's allowance, from Settings, Nutrition, and never above the ceiling; an allowance
saved before a lower ceiling counts only up to it. Everfit and Trainerize likewise sell AI inside their
plans rather than letting coaches set the platform's spend. A ceiling per plan or per workspace set by
the platform admin is a later choice; the suggested launch ceiling is 100 suggestions and USD 3.

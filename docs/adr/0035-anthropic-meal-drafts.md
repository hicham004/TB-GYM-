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

Availability is an authenticated coach read exposing only a configured boolean. Disabled AI
explains setup beside the button; failures there are announced and focused. Configuration contains
the server key only. The adapter is verified with HTTP fakes; a real-key generation remains an
operational check before enabling it for coaches. The full nutrition redesign remains R4.4.

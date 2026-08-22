# ADR 0008: Nutrition engine v1

- Status: Accepted for Phase 4 implementation
- Date: 2026-08-22

## Context

Nutrition needs reproducible estimates, legally snapshotable food facts, explicit preparation
bases, allergen warnings, and historical prescriptions that survive later library edits. It
must preserve the modular-monolith boundary and use server-side commercial entitlement checks.

## Decision

### Lifecycle and ownership

`TB.Gym.Modules.Nutrition` owns nutrition rules and state transitions. Infrastructure supplies
EF persistence and provider adapters. The lifecycle is:

`FoodItemVersion -> RecipeVersion -> MealPlanTemplateVersion -> ClientNutritionPlan -> DailyNutritionLog`.

Food edits append versions. Published recipe and meal-plan versions are immutable. Assignment
deep-copies every day, slot, choice, prescribed quantity, recipe name, and macro total into a
client snapshot tied to exactly one nutrition enrollment and one calculation snapshot. Daily
logs record concrete choices and actual servings separately; an alternative average is never
an actual. PostgreSQL triggers backstop publication, append-only, and completed-log boundaries.

### Food data and licensing

USDA FoodData Central is the only Phase 4 external source because its CC0 1.0 data can be
retained in immutable history. Canonical imports are cached locally and attributed with FDC id,
data type, retrieval/source version, and provider calories. A missing nutrient is rejected and
is not fabricated as zero. The API key is server configuration only.

Coach-authored and label-transcribed foods are first-class provenance types. Labels require a
media reference. No invented Lebanese-food seed values are included. Edamam, Nutritionix, and
Spoonacular are excluded because their persistence terms conflict with immutable snapshots.
Open Food Facts is excluded because ODbL share-alike needs a separate legal decision. Generic
web/Google scraping is prohibited.

### Calculation policies (DOMAIN-RULES decisions 2 and 3)

The default is `MifflinStJeor v1`. `KatchMcArdle v1` is available only with body-fat input;
`HarrisBenedictRevised v1` is an explicit non-default alternative. Each strategy records its
key, version, inputs, units, bounds, and result and rejects out-of-range input.

`OccupationStepsPal v1` combines occupation type with average daily steps, maps the result to
the FAO/WHO/UNU sedentary, moderate, or vigorous range, and never uses training intensity alone.
`TdeeMultiplication v1` multiplies BMR by PAL. `BmrEstimate`, `ActivityModel`, `TdeeEstimate`,
`CoachGoalAdjustment`, and `CalorieTarget` remain distinct snapshot fields.

NUT-008 macro splitting retains unrounded results and validates residual calories. Display/
prescription rounding is separate, and a positive result that rounds to zero is rejected.
ISSN protein ranges produce warnings only; a coach remains responsible for the decision.

Workspaces select `Atwater v1` (default) or `Eu1169 v1`. Stored carbohydrate is always TOTAL
carbohydrate including fibre and polyols, matching USDA "Carbohydrate, by difference" and the
figure printed on a nutrition label, so a coach transcribes a label without converting. Each
policy derives what it needs from that single convention: Atwater charges total carbohydrate at
4 kcal/g, while EU 1169 charges only available carbohydrate at 4 kcal/g and applies the Annex XIV
factors to fibre, polyols, alcohol, salatrims, organic acids, and erythritol separately. Charging
total carbohydrate under EU 1169 would bill fibre at 4 + 2 kcal/g, so components exceeding the
declared carbohydrate are rejected rather than silently absorbed. Every percentage input, macro
or body composition, uses one 0-100 scale. Provider and policy-computed calorie values are both retained;
a configurable tolerance flags discrepancies without silently preferring either value.

These choices resolve open decisions 2 and 3 for implementation. They do not constitute
clinical approval. A qualified reviewer must approve validity ranges, sex/formula usage,
activity mapping, display language, and discrepancy tolerances before production launch.

### Preparation basis

Every food quantity carries `Raw`, `Cooked`, `AsSold`, or `Prepared`. A cross-basis recipe line
requires compatible, append-only, versioned, sourced factor records. Conversion follows the
EuroFIR order: apply yield first for weight change, then retention for nutrient change. Phase 4
does not silently convert units or bases and seeds no factor values. A yield factor may reach
5.0 because water-absorbing staples central to the launch market gain mass when cooked (rice and
burghul near 3x, pasta near 2.4x); a retention factor is a surviving fraction and cannot exceed
1.0.

### Assigned plan lifecycle

An assigned plan is a snapshot, not an immovable rock: a misassignment must be correctable. A
plan therefore carries `Active` or `Cancelled` plus a `BlocksOverlap` reservation flag, and
cancellation is an audited coach operation requiring a reason and the current concurrency token.
Cancelling is one-way; it retains days, slots, choices, and completed logs as history, withdraws
the plan from the client's day view, and clears the reservation so a corrected plan can occupy
the same dates. The PostgreSQL exclusion constraint is partial on `BlocksOverlap`, and a database
trigger permits only that one transition while keeping every snapshot column immutable. Each
transition appends a `PlanLifecycleEvent` row carrying actor, reason, and both statuses.

### Allergens and health-adjacent data

Allergens use structured EU 14 codes. A per-workspace EU-14/US-9 display regime was considered
and deliberately not shipped: the only behaviour it could drive here is hiding declared allergens
that a regime does not mandate, which removes safety information from the coach's view. Every
declared allergen is therefore always displayed and always evaluated for conflicts. A real
labelling feature, marking which declarations are regulator-mandated per market, needs product
and legal input and is deferred. Conflicts require explicit coach acknowledgement and
create an append-only audit record. User-facing language says declarations may be incomplete
and never claims a recipe is safe. Allergies and medications are excluded from application
logs, analytics, exceptions, and notifications.

### AI review gate

The owned provider port returns untrusted output. `meal-draft-v1` schema validation and domain
validation occur before review; uncertainty metadata is retained. Failed provider/schema
operations remain visible and traceable. Only coach approval plus mappings to canonical food
versions may create a recipe draft. Model, model version, prompt version, schema version, cost,
currency, reviewer, and review time are retained. Per-workspace monthly request and cost limits
are enforced. No provider SDK type crosses the adapter boundary.

### Access, tenancy, and query shape

Every endpoint is authenticated and tenant-scoped. Client endpoints resolve their profile from
the principal. Client-specific coach mutations evaluate `ICoachingFeatureAccessService` and
assignment additionally uses `NutritionCoveragePolicy` so the whole half-open plan period fits
one enrollment. Tenant-composite foreign keys, query filters, write guards, and negative tests
enforce isolation. List endpoints are paginated. The client-day query filters by client and date
in SQL before loading its bounded slot/log graph.

## Consequences and deferred work

The nutrition history is explainable and compatible with live-database additive migration.
Provider records that omit required nutrients are visibly rejected rather than imported with
false precision. Estimates are not clinical facts.

Deferred: qualified clinical/legal approval; Lebanese/FAO/INFOODS seed licensing and curation;
additional external food providers; AI provider selection and SDK adapter; diet-completion
effects on gamification; progress/bodyweight; production media/object storage; notifications;
credits, refunds, FX, recurring billing; and Phase 5 behavior. Any new provider or material
science-policy change requires an ADR.

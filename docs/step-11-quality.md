# Step 11: itinerary quality and reliability

## File inventory

Created:
- `packages/shared/src/quality.ts`
- `apps/api/src/services/itineraryValidationService.ts`
- `apps/api/src/services/tripQualityService.ts`
- `apps/api/src/services/itineraryRepairService.ts`
- `apps/api/src/services/providerReliability.ts`
- `apps/api/src/services/providerReliability.test.ts`
- `apps/api/src/services/quality.test.ts`
- `apps/api/src/services/fixtures/qualityScenarios.ts`
- `docs/step-11-quality.md`

Modified:
- `packages/shared/src/index.ts`, `trip.ts`, `regeneration.ts`
- `apps/api/src/models/Trip.ts`
- `apps/api/src/routes/trips.ts`
- `apps/api/src/routing/providers/osrm.ts`
- `apps/api/src/services/attractions.ts`, `tripGeneration.ts`, `tripDraft.ts`, `tripRegeneration.ts`, `tripItineraryEditor.ts`, `assistantContext.ts`, `assistantIntent.ts`, `tripAssistantService.test.ts`
- `apps/web/src/pages/TripPage.tsx`, `TripPage.test.tsx`

## Architecture and reused modules

`itineraryValidationService` is pure and deterministic. It accepts a plain `TripRecord`, supports trip/day/activity scopes and optional window overrides, and never calls a provider or modifies its input. `valid` means no blocking issues were found in available data. Unknown hours, prices and routing are uncertainty, not evidence of feasibility.

It reuses `openingHoursService.evaluateOpeningHours` for whole visit intervals, `timeZone` and `@date-fns/tz` for destination local timestamps, `schedulingConfig` for pace windows, `geo.distanceMeters` for preference-relative outliers, and `budgetSummary.summarizeBudget` for admission, manual planned spending, actual spending, allocations and currencies. Validation does not estimate missing travel times or convert currencies.

The existing `tripPlanner`, geographic clustering, scoring, `routeOptimizer`, `openingHoursPlanning`, `buildDailySchedules`, budget selection, editor, regeneration and assistant services remain the planning engine. Day route metadata now preserves mode, provenance and start/return sequence offsets. Old records retain optional-field compatibility.

## Issue codes

| Severity | Codes |
| --- | --- |
| Error | `DAY_ORDER_INVALID`, `DATE_OUTSIDE_TRIP`, `ACTIVITY_DURATION_INVALID`, `ACTIVITY_OVERLAP`, `ACTIVITY_DATE_INVALID`, `DAILY_WINDOW_EXCEEDED`, `ATTRACTION_DUPLICATE`, `COORDINATES_INVALID`, `OPENING_HOURS_CONFLICT`, `TRAVEL_WINDOW_IMPOSSIBLE`, `ROUTE_VALUES_INVALID`, `ROUTE_SEGMENT_INVALID`, `ROUTE_MODE_INVALID` |
| Warning | `TIMEZONE_UNKNOWN`, `OPENING_HOURS_UNKNOWN`, `OPENING_HOURS_INVALID`, `ROUTE_ESTIMATED`, `ROUTE_UNKNOWN`, `ROUTE_MISSING`, `DAILY_LOAD_EXCESSIVE`, `GEOGRAPHIC_OUTLIER`, `WALKING_PREFERENCE_EXCEEDED`, `TRAVEL_LOAD_HIGH`, `BUDGET_PLANNED_EXCEEDED`, `BUDGET_ACTUAL_EXCEEDED`, `ADMISSION_PRICE_UNKNOWN`, `BUDGET_CURRENCY_MISMATCH`, `BUDGET_COMPARISON_UNKNOWN`, `BUDGET_ALLOCATION_EXCEEDED`, `BUDGET_CATEGORY_ALLOCATION_EXCEEDED` |
| Info | `WEATHER_UNAVAILABLE` |
| Conditional | `DAY_DATE_UNKNOWN`: invalid supplied date is error, absent date warning. `ACTIVITY_TIME_INVALID`: malformed supplied times on a dated day are errors; absent dates/times are warnings. |

Travel interval comparison permits 30 seconds of rounding because the existing scheduler rounds provider seconds to minutes. Zero-minute travel is permitted for colocated points; visits and breaks require positive duration. Missing inter-attraction legs are warnings. Outliers and walking limits apply only with explicit walking-mode evidence and a user distance preference; they never block remote attractions.

## Quality scoring

Dimensions: schedule, routing, opening hours, budget, relevance, workload, and data completeness. Evidence-based dimensions start at 100; each error deducts 30 and each warning 10, floored at zero. Relevance averages saved attraction scores; those are a selection proxy, not independently verified satisfaction. Workload also measures relative daily load variation: `100 - 40 * coefficientOfVariation`, floored at zero. This avoids a universal visit-count ceiling.

A dimension is null when its necessary evidence is unavailable. Estimated/missing routes make routing unavailable; unknown opening hours make opening compatibility unavailable; incomplete pricing makes budget alignment unavailable. The combined score is an equal-weight mean of the six non-completeness dimensions and is null unless all six have evidence. Completeness separately reports the percentage of evaluable dimensions. These are internal diagnostic heuristics, not guarantees or external data verification. No AI request produces scores.

## Repair behavior

The repair service accepts at most three attempts (default two) and revalidates every proposed change. It shifts timestamps forward to avoid overlaps or into an evaluator-confirmed opening interval. It preserves all attractions, sequence, routes, preferences, actual expenses and unrelated days. It skips days with estimated routes, missing route information, invalid times/durations or unresolved timezone. Unknown opening hours cannot justify a shift. It never deletes/replaces a place, reorders a manual selection, fabricates travel, or performs new routing requests.

Candidates are accepted only when blocking issue count decreases and no new issue identity appears. Unresolved issues and attempted repair count are returned. Repairs are optional and conservative: a conflict may be left unresolved even when a more invasive repair could exist. Existing edit recalculation continues to perform routing and scheduling with `preserveOrder: true` before this check.

## Workflow integrations

- Generation checks/repairs the existing planner output before its atomic ready-state save. Confirmed unresolved conflicts use the existing failed-generation path. No corrupt partial itinerary is persisted. Structured stage logs include durations, availability, route source, issue count, repair attempts and dimension scores, without raw prompts or secrets.
- Day previews check/repair only the selected day, preserve confirmation and version guards, and return structured quality plus existing warning strings. Apply rechecks stored candidates with current attraction and budget metadata before the version-guarded save. Preview storage does not replace the saved itinerary.
- Manual edit recalculation validates affected days while retaining explicit order. Cross-day duplicates are checked after all affected days have been recalculated, avoiding false duplicate detection during moves. Blocking edit responses include structured issues. Assistant previews and confirmation reuse this same recalculation/edit path.
- Trip details calculate quality at read time so edits, current expenses and legacy records do not depend on stale persisted scores. Diagnostics are not separately denormalized in MongoDB.
- Ask Triply receives deterministic quality context and a `quality` intent, whose response is generated from diagnostics on the server. Existing busiest, budget, walking and opening-hours tools remain. Changes still require explicit preview confirmation.
- TripPage uses the existing MUI Alert next to timeline warnings, prioritizes conflicts, deduplicates messages and limits visible diagnostic text to four messages. Existing map, budget and chat layouts are retained; no new quality dashboard or displayed numerical guarantee is introduced.

## External providers

Existing AI timeouts and normalized errors, five-second weather/geocoding timeouts, Overpass bounded multi-endpoint retries/cache and OSRM bounded requests/public endpoint rate limits were retained. Weather failure continues as unavailable data. AI responses are never fabricated.

OSRM and Overpass now respect Retry-After seconds or HTTP dates. A provider is not retried earlier to fit a budget. Overpass can use another endpoint during cooldown. Cancellation is not retried. HTTP authentication and other permanent client errors retain their existing non-retry behavior. Structured failure categories cover timeout, cancellation, rate limit, configuration, temporary provider failures, invalid response/input and internal errors. No blanket AI retries were added because duplicate costly inference and provider limits require separate policy. Existing backoff schedules are retained; jitter and shared cross-request cooldowns for arbitrary endpoints are not added.

## Tests and limitations

Executed validation:
- `bun run --cwd apps/api test`: 30 files, 410 tests passed.
- `bun run --cwd apps/web test`: 11 files, 77 tests passed. Required execution outside the sandbox after Vite encountered directory access restrictions.
- `bun run typecheck`: all workspace checks passed.
- `bun run build`: all three packages passed; frontend build emitted dependency annotation and bundle-size warnings. The final run reused unchanged shared/web build outputs from the preceding successful build.
- `git diff --check` with a command-scoped safe-directory override: passed. Git reported line-ending conversion warnings. No lint command exists, so linting was not claimed or configured.
- No live external city/provider calls were used for the fixture suite. Nothing was committed or pushed.

Synthetic destination fixtures represent a large European city, compact city, spread-out destination, limited POIs and sparse hours. They are not live-city verification. Planner scenarios cover 1/4/7 days, relaxed/packed pace, provider routing/fallbacks, low budget, missing prices and a DST transition. Unit tests cover stable issue severities, dates, durations, overlap, full opening intervals, unknown hours/timezone, missing/impossible routes, outliers, currencies, scoped validation, safe shifting, bounded attempts, idempotence, order/expense/day preservation and deterministic scoring. Provider tests cover Retry-After, cooldown fallback, cancellation and error categories; existing provider suites cover network, timeout, invalid/empty responses and retry exhaustion. Existing API suites exercise MongoDB persistence, concurrency, generation, regeneration, editing and budget history. Assistant and frontend regression tests exercise quality explanation and warnings.

Limits: legacy routes lack exact mode/provenance and start/return metadata, so inferred sequence context can be uncertain. No independent speed-based implausibility threshold is imposed on provider routes. Unresolved timezone and undated trips remain uncertain. There is no new must-visit contract or hard-budget policy. Existing provider failures and sparse POI coverage cannot be repaired into factual data. Diagnostics are English, matching the existing UI; no localization framework exists in these modules. No lint script is configured in the workspaces.

# Step 20A: assistant reliability and context awareness

The assistant now has a conversational, read-only path using the existing Gemini/OpenRouter adapters. No commits or pushes were made. No real-model paid evaluations were run.

## Work checklist

- [x] Audit the UI, request contract, persisted conversations, ownership, providers, generation/regeneration, localization and tests.
- [x] Reproduce the persisted-history serialization defect with a failing regression test before fixing it.
- [x] Implement bounded context/history, conversational output, recoverable failures, cancellation and request serialization.
- [x] Enforce read-only behavior at the service and action endpoint, including old previews.
- [x] Add deterministic unit, HTTP integration, evaluation construction, frontend and browser regressions.
- [x] Finish and record validation, including intermittent broad browser failures and their passing isolated reruns.

## Confirmed causes and audit findings

1. The old history projection spread Mongoose subdocuments. The first prompt had no history; subsequent prompts contained `__parentArray`, `$__parent`, `$__`, `_doc` and copies of the conversation. The expected top-level `role` was absent. The reproduction failed specifically on leaked internals; JSON serialization itself succeeded for the tested fixture. This inflated the prompt and obscured roles. It is a confirmed defect, not proof that every historical provider failure had this cause.
2. The assistant called an intent classifier with a strict enum/schema, rather than requesting conversational answers. Unrecognized questions became generic clarification, and nonconforming model output was discarded. It could not naturally answer recommendations, packing questions or nuanced follow-ups.
3. The old context sent itinerary counts for most days, details primarily for the selected day, and no saved weather/packing data. A question about a different day could lack relevant facts at the model boundary.
4. The old catch block discarded error categories and diagnostic details behind one generic reliability error. Failed answers were saved as ordinary assistant history, and retry was not modeled separately.
5. The UI contained both editable local message history and a query-cache history. It appended an optimistic user message on every retry and did not distinguish a provider error returned inside HTTP 200 from a successful answer. Mutations lacked an assistant-specific deadline/cancellation path.
6. The old conversation revision check happened after the provider call, allowing competing requests to incur provider cost before one lost the save race. Initial conversation upserts could also race against the unique index.
7. Guest access is deliberately disabled for the assistant in the existing middleware and TripPage. This was preserved, including all guest quotas. The ObjectId assumption in the authenticated conversation service is not a demonstrated reachable Guest Mode failure.

## Files and responsibilities

| Area | Files |
| --- | --- |
| Contract and storage | `packages/shared/src/assistant.ts`, `apps/api/src/models/TripAssistantConversation.ts` |
| Conversation service and HTTP lifecycle | `apps/api/src/services/tripAssistantService.ts`, `apps/api/src/routes/trips.ts` |
| Context, history and error/retry modules | `apps/api/src/services/assistantTripContext.ts`, `assistantHistory.ts`, `assistantProvider.ts` |
| Prompt | `apps/api/src/ai/prompts/assistant.ts` |
| Existing provider adapters | `apps/api/src/ai/types.ts`, `errors.ts`, `providers/gemini.ts`, `providers/openrouter.ts` |
| Chat and mutation | `apps/web/src/components/trip/TripAssistant.tsx`, `apps/web/src/hooks/useTripAssistant.ts` |
| Localization | `apps/web/src/i18n/locales/{en,pl}/assistant.json` |
| API tests/fixtures | `tripAssistantService.test.ts`, `assistantSerialization.test.ts`, `assistantTripContext.test.ts`, `assistantProvider.test.ts`, `assistantFixtures.ts`, `routes/trips.editing.routes.test.ts`, `ai/providers/assistantText.test.ts`, `ai/providers/openrouter.test.ts` |
| Frontend tests | `components/trip/TripAssistant.test.tsx`, `hooks/useTripAssistant.test.tsx` |
| Evaluation scenarios | `apps/api/src/services/assistantEvaluations.ts`, `assistantEvaluations.test.ts`, `apps/api/scripts/evaluateAssistant.ts` |
| Browser coverage | `apps/api/e2e/assistantReliability.spec.ts`, `apps/api/e2e/providers.ts` |

The existing intent/budget interpretation helpers remain available for future work; the conversational path no longer calls them or the regeneration/editor/expense mutation services. Existing manual editing and generation pipelines keep their APIs and provider JSON behavior.

## Architecture

`User message → existing authentication/rate limiter → shared strict validation → authorized current trip load → owner/trip conversation lookup → request replay check → atomic conversation lease → bounded history and relevant trip projection → versioned prompt → existing provider text mode → response normalization → conversation CAS save → query cache → existing chat bubbles`

The existing conversation collection and owner/trip unique index remain. Optional lease, latest request ID/hash/response and message-failure fields are additive, with defaults for legacy documents; no data migration is required. The latest completed request can be replayed without a second provider call. Reusing its ID for a different input is rejected.

## Trip context

- Real trip dates, destination, content language, traveler count, pace, interests and walking preferences.
- Trip-wide ordered day/date/count overview, plus details prioritized by explicit day/ordinal/date, destination today/tomorrow, named attraction, conversation referent and selected day.
- Saved scheduled titles, stable place IDs, complete local start/end timestamps, durations and their sources, unresolved scheduling state, travel estimates/distances and warnings.
- Bounded attraction descriptions, known admission metadata, saved opening hours and deterministic opening-hours checks. Requested 24-hour or AM/PM visit times are checked separately. Missing/unresolved arrival times are not interpreted as midnight.
- Saved day weather with its retrieval timestamp. No weather refresh or other external lookup is triggered by chat context construction.
- Existing authoritative budget summaries for cost/budget questions, including recorded/planned remaining money, category totals/allocations, relevant-day totals, incomplete pricing warnings and currency precision. Private expense titles/notes are excluded.
- Existing packing items/counts/packed state for packing questions; no generation is triggered.

Context has a 28,000-character cap; history has a separate 16,000-character cap; the full prompt plus system instructions is capped at 50,000 characters. These are conservative character budgets, not a provider-tokenizer guarantee. Excess external descriptions are shortened. Whole day/activity omissions are explicit in coverage metadata. Current user instructions are never sliced. Large context that cannot be reduced safely returns `CONTEXT_TOO_LARGE`.

Dates remain date-only strings. Today/tomorrow use an explicitly validated destination IANA timezone, never server local time. User timezone is sent separately. Missing destination timezone is marked unknown and the prompt requires clarification. Tests cover local midnight and DST boundaries.

## History, language and prompt

History is explicitly projected from persisted messages into plain `{role, content}` entries with `ai → assistant` mapping. Only successful complete user/assistant pairs are included, at most ten recent pairs within the character budget. Storage stays bounded at forty messages. Day and attraction referents are stored separately so they survive history window movement.

Failed turns stay visible and are marked; retry replaces the last failed pair and keeps its user ID. Network retries reuse their request ID, enabling safe replay when a response was lost. Conversation history survives normal navigation in the existing database and query cache. Unsaved drafts are local to the mounted panel.

Prompt `20a-v1` separates stable role/capability/grounding/language instructions from dynamic context. It labels context/history as untrusted, requires estimates and unknowns to be distinguished from facts, forbids claiming browsing or edits, preserves venue identifiers, and asks for concise clarification when needed. New responses use the UI locale; existing explicit-language detection takes precedence. Changing UI language does not translate history or regenerate content.

## Provider and recovery behavior

Generation/regeneration callers retain their existing JSON contract. Assistant requests opt into bounded conversational text. Gemini thinking parts are excluded; OpenRouter accepts both strings and text content parts. The Gemini assistant budget is 8,192 tokens, allowing room for thinking as well as the visible answer; OpenRouter uses 2,048 tokens. This is an implementation safeguard based on [Google's combined token-budget guidance](https://ai.google.dev/gemini-api/docs/generate-content/thinking?hl=en), not a confirmed cause of the historical failures. Empty/malformed provider envelopes map to safe errors. Raw upstream response messages are no longer logged.

The assistant has a total deadline capped at forty seconds (or the configured shorter AI deadline), a forty-five-second frontend transport deadline and a sixty-second database lease. At most one retry is allowed for connection/server failures, within the same deadline. Invalid input, context overflow, credentials, rate limits and malformed responses are not automatically retried. Returning rate limits immediately avoids violating Retry-After. There is no configured fallback in the existing provider factory, so no fallback model or credentials were invented.

Normalized response categories include `RATE_LIMITED`, `PROVIDER_TIMEOUT`, `PROVIDER_UNAVAILABLE`, `PROVIDER_BAD_RESPONSE`, `CONTEXT_TOO_LARGE` and `INTERNAL_ERROR`. Request validation uses `VALIDATION_ERROR`; existing authentication/ownership HTTP conventions are preserved. UI failures are localized, drafts remain available on failure, retry is explicit, and offline mutations execute immediately rather than staying paused indefinitely. A local synchronous send lock and a server lease serialize messages. Requests abort on trip change/unmount, and late responses cannot populate another trip's cache.

Diagnostics contain request/trip correlation, selected provider/model, prompt version, context characters, history count, latency, retries, fallback usage, normalized/provider codes and cancellation. They omit full prompts, conversations, keys and raw upstream response text.

## Ownership and read-only boundary

The existing owner-filtered load runs before any conversation access or model request. Explicit conversation IDs are also scoped to both user and trip. Invalid IDs, deleted trips, anonymous access and other users' trips are rejected. Shared public links do not grant assistant access to private budget/context data. Guests remain excluded by the pre-existing account-only policy, with quotas unchanged.

Assistant sends never call trip mutation services. Direct edit commands receive localized deterministic read-only guidance without an AI call. Existing assistant apply endpoints reject even old prepared previews with HTTP 403. The UI no longer exposes assistant action application. Manual itinerary editing, expenses, packing and Regenerate Day remain separate features.

## Evaluation harness

Automated tests use deterministic providers. Scenarios A–H cover itinerary, follow-up cost, missing hours, budget, indoor recommendations, read-only guidance, Polish tomorrow and ten-turn history construction. Construction tests verify orchestration, not real-model answer quality.

Dry run (lists scenarios, no provider request):

```powershell
bun run --cwd apps/api scripts/evaluateAssistant.ts
```

Optional paid evaluation using the explicitly configured provider/model:

```powershell
bun run --cwd apps/api scripts/evaluateAssistant.ts --live A-itinerary
```

Omit the scenario ID to evaluate all scenarios. Real answers require human review against the printed criteria. This harness is deliberately absent from test/build/CI scripts and was not run with `--live` during implementation.

## Validation results

| Check | Actual result |
| --- | --- |
| Original serialization reproduction | Failed before the fix on leaked Mongoose internals; passed after projection was fixed. |
| `bun run test --concurrency=1 -- --maxWorkers=2` | Passed all package tasks: the full API unit/integration suite and all 498 frontend tests in 53 files. This serialized run followed two frontend timing failures during an earlier simultaneous API/web/browser run. |
| Final focused API context/service/HTTP checks | 71 tests passed in 3 files, including ten turns, current trip context, failed-turn referents, context overflow, request replay, concurrency and ownership. |
| Final focused frontend assistant/hook checks | 15 tests passed in 3 files, including offline recovery, cancellation, late results and stable locale/request IDs on network retry. |
| Final provider adapter/reliability checks | 49 tests passed in 5 files after the Gemini budget safeguard. |
| `bun run typecheck` | Passed shared, API and web checks, including existing web scripts. |
| `bun run typecheck:e2e` | Passed, including the new two-trip browser test. |
| `bun run build` | Passed all three package builds. API build passed again after the final provider budget adjustment. Existing Rollup annotation and large-chunk warnings remain. |
| Translation validation (run by tests/build) | Zero errors, zero warnings; 174 existing repeated-value groups flagged for contextual review. |
| Lint | No lint script or configuration is present; no lint pass is claimed. |
| Initial focused browser run | 13 passed, one new selector failed because it matched unrelated itinerary alerts. Scoped the selector to the assistant panel. |
| Complete `bun run test:e2e` | 135 passed, 2 failed in 25.2 minutes. Failures: Guest entry remained on `/login` in `destinationPlanning.spec.ts:45`; the Polish mobile visual test found no heading during route navigation in `mobileVisual.spec.ts:27`. Both failed before assistant interaction. |
| Final browser rerun: `bun run test:e2e --grep "[Aa]ssistant\|anonymous Saved planning entry\|mobile visual review pl"` | All 7 passed: both previously failing cases, assistant UI locale, ten-turn/duplicate/retry/navigation checks, mobile chat, the new two-owned-trip isolation test and mobile keyboard/focus/draft recovery. This is a passing focused rerun, not a claim that the earlier complete run was clean. |
| `git diff --check` | Passed. Git reports existing Windows LF/CRLF normalization notices. |
| Optional evaluation harness dry run | Passed; listed scenarios only. `--live` was never used. |

Mocked browser regression coverage also passed generation, Regenerate Day, editing, scheduling/routing, weather recovery, discovery/Saved, packing, expenses, guest quotas/migration, authentication, sharing/revocation, PDF/calendar exports and localization. No unrelated production feature or test was changed to hide the two broad-run failures.

## Limitations and Step 20B

No live-provider behavior or answer quality has been claimed from deterministic mocks. Model output can still contain factual mistakes; the bounded facts and grounding instructions reduce that risk but are not a semantic verifier. Very long conversations keep recent pairs and explicit trip referents, not an AI-generated summary. Ambiguous or missing facts require clarification. Context omission metadata makes those limits visible to the model.

Guest assistant support and provider fallback require an explicit product/configuration decision; this step preserves the existing policy. Latest-request replay is bounded and does not provide a permanent idempotency ledger for arbitrarily old requests. User drafts that never reached the server do not persist after panel unmount. No streaming or live browsing was added.

The read-only boundary is ready to be the foundation for Step 20B, but tools/actions are intentionally disabled. Step 20B must add separate typed tool contracts, ownership checks, preview/confirmation, version checks and idempotent execution; it must not simply re-enable the former apply path. The broad browser run was not clean even though both failures passed independently; their intermittency remains a qualification on repository-wide stability.

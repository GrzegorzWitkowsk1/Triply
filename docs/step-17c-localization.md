# Step 17C language boundaries

Audited before implementation: shared trip/assistant/packing/sharing contracts; Trip model;
trip analysis route, draft and generation services; deterministic planner/scheduler;
regeneration preview/apply; assistant intent, context and budget services; packing signed
previews and database leases; Overpass/Geoapify; Open-Meteo weather/geocoding;
Gemini/OpenRouter adapters; guest reservation/migration; i18n hooks and test harness.

## Content classification

| Kind | Fields | Rule |
| --- | --- | --- |
| Natural language | extracted generated notes; packing name/reason/warnings; assistant response text; planner break/travel labels and explanations | Use the feature's selected language |
| Structured identifiers | JSON keys, pace/budget/category/source/status enums, interests slugs, IDs, WMO codes, dates, coordinates, currencies, quantities | Never translate |
| Proper nouns | destination and venue names, official POI names | Preserve official provider names; no invented translations |
| User content | prompt, custom instructions, manual packing items, messages, expense titles | Preserve verbatim |
| Provider content | POI description/address, hours and admission metadata | Prefer supplied multilingual descriptions; preserve addresses and IDs; deterministic fallback |

Trip-analysis destination/country fields are also geocoding lookup inputs: the prompt
keeps their established English lookup names because the existing resolver matches English
provider names. User quotations, manual edits, venue names, addresses and IDs are preserved.
This avoids changing geocoding or its language-independent cache for localized prose.

## Actual architecture

There is no LLM itinerary prose stage: analysis extracts requirements, then POI filtering,
clustering, routing, scheduling, repair and quality checks build the itinerary. Regeneration
also uses the deterministic planner; only optional custom-instruction parsing calls AI.
The assistant interprets structured intent with AI and computes factual answers on the server.
Packing generates structured suggestions with AI. No extra translation calls are necessary.

The existing Trip Assistant component was commented out in TripPage. Step 17C mounts
it for authenticated trips using its existing guest guard; conversation queries and
AI requests remain inactive until the user opens/sends in the assistant.

New analysis requests capture UI locale and persist it as contentLocale. Legacy records use
English at serialization/use without a database default or read migration. Regeneration
reads the stored locale. Assistant and packing use the locale of each new request, leaving
history and saved items unchanged. Language changes have no generation effect or query-key
invalidation. Guest migration changes ownership fields only; contentLocale travels intact.

Gemini and OpenRouter receive the same centralized language instruction. The provider factory
selects one configured provider; it does not implement runtime cross-model fallback or repair.
Existing bounded packing retries reuse one context. POI fallback is Overpass to Geoapify;
locale belongs in description caches, never in geometry or geocoding caches.

Model language is a prompt constraint, not a property guaranteed by JSON schema validation.
There is no reliable language detector for short venue names or multilingual packing text.
Schema validation remains mandatory; no automatic translation or unbounded language retries
are introduced. Incorrect-language provider output remains a limitation to review in 17D.

## Step 17C file inventory

Only the following feature files and their regression tests were edited for this step.
Existing work from 17A/17B/17B.1 in the working tree was retained.

| Area | Files (relative to repository root) |
| --- | --- |
| Shared contracts | `packages/shared/src/{locale,index,trip,assistant,packing,sharing}.ts` |
| AI layer | `apps/api/src/ai/types.ts`, `apps/api/src/ai/prompts/{language,parseTrip,parseRegeneration,packing}.ts` |
| Persistence | `apps/api/src/models/{Trip,TripAssistantConversation}.ts` |
| HTTP boundaries | `apps/api/src/routes/{trips,packing,sharing}.ts` |
| Generation and editing | `apps/api/src/services/{tripDraft,tripGeneration,tripRegeneration,tripItineraryEditor}.ts` |
| Assistant and content | `apps/api/src/services/{assistantBudget,assistantContext,assistantIntent,tripAssistantService,contentLanguage}.ts` |
| Packing and POIs | `apps/api/src/services/{packing,attractions,geoapify}.ts` |
| Frontend requests | `apps/web/src/hooks/{useTripAnalysis,useTripAssistant}.ts`, `apps/web/src/api/packing.ts`, `apps/web/src/i18n/config.ts` |
| Assistant mounting/history | `apps/web/src/pages/TripPage.tsx`, `apps/web/src/components/trip/TripAssistant.tsx` |
| API tests | `apps/api/src/ai/prompts/parseTrip.test.ts`, `apps/api/src/routes/{guestMigration,guestTrips,profile,sharing,trips.editing}.routes.test.ts`, `apps/api/src/services/{contentLanguage,geoapify,packing,tripAssistantService}.test.ts` |
| Frontend tests | `apps/web/src/hooks/useAiLocale.test.tsx`, `apps/web/src/components/trip/TripAssistant.test.tsx` |
| Browser fixtures/tests | `apps/api/e2e/{providers.ts,aiLocalization.spec.ts}` |
| Audit/report | `docs/step-17c-localization.md` |

## Reliability and security

- Locale is an enum at HTTP boundaries and resolves to a fixed language instruction;
  arbitrary instruction strings are rejected before generation/quota reservation.
- Prompts preserve structured keys/enums and identify external/user content as untrusted.
- Generation uses persisted contentLocale. Regeneration ignores conflicting client locale,
  preserves version checks and signed/server-side preview semantics, and replaces one day.
- Assistant messages capture each request locale. Explicit English/Polish reply requests
  are recognized without an extra AI call. Persisted history and confirmation text stay fixed.
- Packing signs locale with the preview, records it with generation metadata, and uses it
  in context fingerprints and stale checks. Retries reuse the same context and abort signal.
- Existing guest idempotency hashes already include request bodies, so locale variants
  conflict under a reused key instead of replaying a different language's response.
- POI request/cache fingerprints include locale. Missing translations fall back to original
  provider descriptions; blank localized values do not hide usable original descriptions.
- Existing ownership, leases, CAS writes, provider metering, deadlines and quotas remain intact.
- Localization of newly generated itinerary labels happens after deterministic validation
  and conflict recovery; it is not an input to scheduling or geometric algorithms.
- Weather retains WMO codes/numeric values and the existing frontend i18n dictionary/units.

## Validation

- API: 925 tests across 56 files passed, including real MongoDB/Fastify integration suites.
- Frontend: 460 tests across 46 files passed with two workers. The initial default-worker
  run hit four timing failures under load; reducing workers passed without changing tests.
- Affected frontend recheck: 38 tests across four files passed after mounting the assistant.
- Assistant history recheck: seven tests passed after freezing confirmation message text.
- TypeScript: root workspace checks and E2E TypeScript checks passed.
- Production: shared/API/web builds passed. Existing Rollup annotation and bundle-size
  warnings remain; no new bundling policy was introduced.
- Translation validation: zero errors and zero warnings (repeated-value audit notices remain).
- Lint: `bun run lint` reports no configured script; no lint configuration was added.
- Whitespace: `git diff --check` passed (command-local safe.directory was needed under
  the sandbox identity; global Git configuration was not changed).
- Browser: all 78 Playwright tests passed in 14 minutes, including all five new localization
  scenarios, scheduling/editing, weather/POI fallback, guest quotas/isolation/migration,
  Saved/Explore, packing, sharing, PDF export and ICS/calendar export.

Vite checks required execution outside the Windows sandbox because its config loader was
blocked from reading ancestor directories. Tests use deterministic provider fixtures,
isolated MongoDB instances and no live paid AI calls.

## Limits and 17D readiness

No reliable language detector was added: a provider can still disobey language instructions,
especially in short text or proper nouns. Provider descriptions and unfamiliar provider/parser
diagnostics may fall back to their original language. Packing cross-language matching uses a
small reviewed synonym dictionary and explicit confirmation for possible matches; it is not
general semantic equivalence. English monetary command syntax remains the assistant's existing
deterministic expense parser; localized answer templates do not expand its command grammar.

17D should harden language-quality evaluation with offline multilingual fixtures, expand
reviewed packing synonyms/diagnostic coverage, and review linguistic quality against real
model outputs without adding translation calls to successful requests. No database migration,
automatic translation, generation on UI switching, quota increase, commit or push was performed.

## Completed checklist

- [x] Audit workflows and document natural language/identifier/proper noun/user/provider boundaries.
- [x] Add validated locale propagation and backward-compatible trip language persistence.
- [x] Localize prompts, deterministic answers, new itinerary labels and supported provider descriptions.
- [x] Preserve regeneration, packing, guest, quota, cache and ownership semantics.
- [x] Verify language switching and deterministic unit, integration and browser regressions.
- [x] Complete TypeScript checks, production builds and whitespace validation; record unavailable lint.
- [x] Record limitations and readiness for Step 17D without committing or pushing.

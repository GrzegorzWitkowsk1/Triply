# Step 20B resume audit

Latest status: **targeted intent/replacement/budget fixes verified; ready for manual QA**. Trip Assistant packing actions are retired by product decision; see the latest appended section. Earlier completion reports below describe the previous scope and do not establish manual QA success. Existing uncommitted changes remain preserved. No commit or push.

## TODO

- [x] Recover working tree, inspect implementation and run baseline tests.
- [x] Verify safety and all ten registered action adapters.
- [x] Reproduce and fix incomplete expense previews and lost-response cache recovery.
- [x] Finish fresh browser and final web checks.
- [x] Finish provider truncation hardening and record final API result.

## Status matrix

| Area | Status | Evidence |
| --- | --- | --- |
| Registry, strict schemas, entity/intent resolution, ten adapters | COMPLETE | `packages/shared/src/assistantActions.ts`, `assistantToolRegistry.ts`, `assistantTools.test.ts`, HTTP action tests |
| Provider native calls / strict JSON fallback | COMPLETE | `assistantToolSelection.ts`, Gemini/OpenRouter adapters, `assistantText.test.ts`, selector tests; primary API contracts inspected |
| Proposal generation and validation | COMPLETE | `assistantActions.ts`: private drafts reuse editor/expense/packing services; failed batches never commit |
| Ownership, confirmation, cancellation, expiry, replay, stale/CAS | COMPLETE | Owner-scoped routes/services, server-owned args, guarded single-document write + receipt; HTTP tests including simultaneous confirmation and lost acknowledgement |
| Multi-action atomicity | COMPLETE | Itinerary/expenses/packing share the Trip document; three-domain HTTP test verifies one commit and no partial writes |
| Preview / feedback / query refresh | COMPLETE | Components and hook connected; fixed omitted expense category/day/date and stale domain caches; browser recovery test confirms visible expenses update before reload |
| Conversation, trip isolation, normal chat, EN/PL | COMPLETE | Service/provider/context tests, UI tests and three passing browser reliability workflows |
| Mobile and keyboard accessibility | COMPLETE | Passing action E2E covers mobile PL, axe, keyboard and viewport containment |
| Unit/integration, types/build/translations | COMPLETE | Results below |
| Lint | MISSING | Repository provides no lint script/configuration |

## Changes during resume

- `apps/web/src/hooks/useTripAssistant.ts`: shared cache refresh for confirmed and uncertain writes; expense changes also refresh trip lists.
- `apps/web/src/components/trip/AssistantProposalCard.tsx`: recovered completed/rejected receipts suppress obsolete transport errors.
- `apps/api/src/services/assistantActions.ts`: EN/PL expense previews include category, day assignment and date.
- `apps/api/src/ai/providers/gemini.ts`, `openrouter.ts`: reject incomplete/filtered responses before accepting parseable partial actions or JSON. Preserve finish-reason diagnostics. Four new regressions reproduced truncated native/fallback acceptance before the fix.
- Tests: hook cache regression, recovered receipt UI, expense preview integration, independent expense/packing stale facts, visible expense refresh before reload in `apps/api/e2e/assistantActions.spec.ts`.

## Tests executed in this resume

- Baseline API: 1,009 passed; baseline workspace typecheck passed.
- New regressions reproduced both preview omission and stale domain caches before fixes.
- Final API: **1,016 passed / 63 files**, including four provider truncation regressions. The first provider rerun caught lost finish-reason diagnostics; implementation was corrected without rewriting those existing assertions, and the final full suite passed.
- Final web full run: **509 passed / 54 files**; focused hook/card checks: **14 passed**.
- `bun run typecheck`, `bun run typecheck:e2e`, `bun run build`: passed. Build retains upstream Zod annotation and bundle-size advisories.
- Translation validator: 0 errors / 0 warnings (duplicate-value groups informational).
- `git diff --check`: passed (line-ending notices only).
- Browser action + reliability suite: **7/7 passed** with fresh isolated servers. Initial sandbox startup failed; its verified leftover server was stopped. First browser run exposed a new assertion's incorrect assumption of zero seeded Lunch expenses and an existing 360.00003px transform-rounding failure. Corrected baseline-relative count and integer layout/overflow assertions; rerun passed.
- After final provider changes, action browser suite repeated: **4/4 passed**. Full unrelated browser suite was not rerun in this resume; previous-session results remain separately recorded in the original report.
- All automated AI tests use mocks; no paid provider calls.

## Remaining work

No required implementation work remains. E2E typecheck passed after browser assertion changes; API build/typecheck passed after provider changes; final whitespace check passed. No lint task exists. Optional live-model quality evaluation and a fresh full unrelated browser regression remain outside the validation performed here.

Provider contract references checked during resume: [Gemini FunctionDeclaration](https://ai.google.dev/api/caching#FunctionDeclaration), [OpenRouter tool calling](https://openrouter.ai/docs/guides/features/tool-calling). Existing native request/response shapes match those contracts; no paid live-model evaluation was performed.

Existing limitations: account-only assistant; replacement discovery uses known trip attractions; expiry cleanup is lazy; receipts retain 20 terminal entries; dependent actions may need separate proposals. See `docs/step-20b-assistant-actions.md` for implementation details and previous-session validation (not rerun evidence).

## Manual QA remediation

TODO: [x] audit/reproduce false staleness; [x] fix snapshot CAS; [x] isolate read-only requests; [x] harden action replies and response correlation; [x] add targeted regressions; [x] collect final API/browser/build results. Manual QA remains for the user.

Confirmed causes and fixes:

- `assistantActions.ts:createAssistantProposal/executeAssistantProposal`: raw snapshot filters passed through Mongoose query casting acquired nested defaults, so unchanged legacy documents failed equality. Reproduced for all three domains by unsetting `analysis.notes` and an activity's `durationSource`; all failed before the fix and passed afterward. Guarded writes now use the raw collection API. Confirmation validates prepared fields with Mongoose before the atomic write. Raw snapshot, owner, pending status, ID and expiry checks remain; timestamps are maintained explicitly.
- `assistantToolSelection.ts:isActionRequest`: pending proposals/drafts enabled tool selection for every message. Ordinary question starts in EN/PL now bypass the pending amendment path. Explicit action verbs and terse clarification answers remain supported.
- `tripAssistantService.ts`: native text without any tool call was displayed verbatim as a clarification. Deterministic JavaScript/Warsaw responses reproduce the acceptance gap. Mutation requests now receive a server-authored clarification when no validated actions are returned; read-only conversational answers are preserved.
- `openrouter.ts:supportsTools`: the configured `openrouter/free` is a feature-routing model, so a missing concrete catalog entry must not disable native tools. Explicitly recognize its documented tool routing without changing configuration or incurring paid calls. This fixes a capability gap; historical QA provider payloads/logs were unavailable, so no claim is made that it conclusively explains T01/T02.
- Shared `AssistantMessageResult`, service and `useTripAssistant.ts`: echo and validate trip/request/conversation identity before caching responses; preserve cancellation and send locks. New tests reject mismatched envelopes.
- Prompt now explicitly treats descriptions, expense names/notes and other trip fields as quoted data. A hostile-description fixture cannot authorize a tool call on a read-only turn; server validation and explicit confirmation remain mandatory. Suspicious user data is preserved.
- Provider diagnostics record HTTP status, finish reason and routed OpenRouter model without prompts/response text. Request summaries log stage, normalized cause and server/client request IDs. Invalid provider output receives a specific EN/PL failure message while retaining the user turn.

New coverage: nested-default legacy preview/commit in itinerary/expense/packing; independent domain revisions; genuine concurrent write during preparation with safe diagnostics; pending-proposal read-only budget questions; Polish move and indoor replacement; unrelated native output; unsolicited tool output from hostile trip data; preserved provider failures; free-router capability; response identity rejection. Existing ownership, expiry, duplicate confirmation, stale confirmation, atomic batching and cache recovery tests retained. Browser combined action scenario now asks a read-only budget question while its proposal remains pending.

Final results in this remediation: **1,031 API tests passed across 63 files**, **27 assistant frontend tests passed across 3 files**, **7/7 Playwright assistant action/reliability scenarios passed**. Focused HTTP/conversation run: 95 passed. Workspace typechecks, E2E typecheck after fixture edits, all production builds, translation validation (0 errors/0 warnings), and `git diff --check` passed. No lint script/configuration exists, so lint was unavailable. Existing Zod annotation/bundle-size build advisories remain. No broad unrelated browser suite or live-model calls were run.

Next: repeat manual QA T01–T15, then dependent T16–T32. For any T01/T02 recurrence, correlate server/client request IDs with `provider_response` and request-summary events (HTTP status, actual routed model, finish reason, stage, providerErrorCode). Historical T01/T02 root cause remains unconfirmed without its logs; malformed output, rejected requests and timeouts are reproduced safely in deterministic tests. No manual PASS is claimed and no live paid AI calls were made.

## Latest scope: intent routing, replacement and budget accuracy

TODO: [x] audit incorrect move routing; [x] constrain tool selection; [x] metadata-based replacements; [x] authoritative budget replies; [x] retire Trip Assistant packing; [x] regression tests and validation. Ready for manual QA; no manual PASS claimed.

Confirmed gaps and changes:

- All tools were advertised for every action and any schema-valid tool could reach a domain validator. `assistantToolSelection.ts` now determines the allowed operation set from EN/PL commands or pending amendment tools, advertises only those tools and rejects unrelated calls before argument/entity resolution. One bounded corrective retry can repair a wrong-domain selection under the existing deadline. Attraction and expense clarifications are separate. Shared move schema descriptions distinguish source and destination days.
- Replacement resolution recognized only narrow outdoor wording, and provider failures could mask missing metadata. Generic outdoor-to-indoor requests now use saved metadata through the existing registry/proposal/CAS path. Unique known targets/candidates yield a preview; multiple sources or candidates yield explicit names/IDs; absent environment metadata or alternatives yields a specific explanation. All scheduling/availability validation and explicit confirmation remain. No attraction discovery, IDs or hours are fabricated.
- The context already contained both planned and actual balances from `summarizeBudget`, but model prose could emphasize only the actual balance. Remaining-budget questions now reuse `assistantContext.ts:factualAnswer` and `summarizeBudget` directly. EN/PL replies label total, known planned spending, actual spending, remaining after known plans and actual unspent budget separately, retain unknown-price warnings, and keep currency totals separate. Existing accounting semantics are unchanged; no financial calculation is duplicated in prompts.
- Packing tools are excluded from model declarations and blocked by registry/preparation/confirmation. Packing preparation adapters were removed. Pending legacy packing proposals project as failed and cannot execute; completed receipts remain readable. Shared legacy receipt types and translation labels remain solely for compatibility. Packing state is excluded from assistant context, and explicit packing requests redirect to the separate Packing Assistant without an AI call. Standalone packing services/UI remain intact.

Files changed for this targeted work: `packages/shared/src/assistantActions.ts`; API `assistantToolSelection.ts`, `assistantToolRegistry.ts`, `assistantActions.ts`, `tripAssistantService.ts`, `assistantTripContext.ts`, `assistantContext.ts`, `contentLanguage.ts`, `equipment.ts`, `ai/prompts/assistant.ts`; web `hooks/useTripAssistant.ts`; focused service/HTTP tests; E2E `assistantActions.spec.ts` and `providers.ts`. Prior uncommitted work was preserved.

Coverage added/adapted: PL/EN move variations; wrong expense selection and bounded correction; expense routing; read-only questions with pending proposals; one/multiple outdoor targets and indoor candidates; missing metadata; planned/actual/mixed budgets; unknown costs and currency separation; Polish destination amendment superseding its previous proposal; disabled packing tools and old packing receipts; standalone packing CRUD. Existing malformed-provider retry, authorization, stale, expiration, idempotency and cache-recovery tests remain. Old positive Trip Assistant packing tests were replaced with retirement checks and supported expense/itinerary batches, retaining atomicity/security coverage.

Executed results:

- Full API suite: **1,052 passed / 63 files**.
- Final focused intent/budget run after routing refinements: **64 passed**.
- Assistant frontend: **27 passed / 3 files**.
- Playwright action/reliability plus standalone packing: **9/9 passed**.
- Workspace TypeScript and E2E TypeScript checks: passed.
- Production builds: all three tasks passed; existing Zod annotation/bundle advisories remain.
- Translation validation: 0 errors/0 warnings. `git diff --check`: passed.
- Lint: unavailable; no repository lint task/configuration exists.

Limitations/next action: repeat the reported move, generic indoor replacement, planned/actual/mixed budget and pending-amendment manual scenarios, then confirmation/stale/idempotency and trip-isolation checks. Replacements use known unscheduled candidates; missing metadata requires clarification or finding a candidate in Explore. Live model adherence was not evaluated with paid calls. No remaining automated failures are known; manual QA remains pending.

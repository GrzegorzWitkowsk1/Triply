# Step 20B — Assistant tools and confirmed actions

The assistant prepares changes from natural language and displays an explicit preview. Only the separate confirmation endpoint can persist domain changes. No commits, pushes, paid evaluations, new services or dependencies were introduced. Existing Step 20A changes in the workspace are preserved; its report describes the earlier reliability investigation.

## Work checklist

- [x] Audit actual storage, ownership, providers, editing, scheduling, expenses, packing and query keys.
- [x] Implement strict tool inputs, entity resolution and provider normalization.
- [x] Implement server-owned proposals, preview, cancellation, expiration, revalidation and atomic commit.
- [x] Integrate localized, accessible proposal cards and domain-specific query refresh.
- [x] Add deterministic unit, HTTP integration and browser tests, including persistence/network failure recovery.
- [x] Record final validation results below, including corrected failures and successful reruns.

## 1. Architecture audit

All three affected domains live inside the same MongoDB `Trip` document: itinerary/version, expenses/budgetRevision and equipment. A multi-document transaction or second editor is unnecessary. The existing manual editor already owns attraction membership, duplicate detection, opening-hours checks, route recalculation, constraint validation, localization and itinerary version increments. It lacked an explicit local-time reschedule operation; this is now an additive operation of that same editor/scheduler.

Expense CRUD already uses integer minor units, ISO currencies, associations, budget range validation and revision checks. Packing CRUD already has shared item schemas, list limits, stable ObjectIds and version increments. Their preparation logic is reused rather than sending model output into database commands.

The conversation remains in the existing owner/trip-scoped collection. Its clean history, request lease, bounded context, latest request replay, provider deadline and UI-language behavior from Step 20A remain. The existing guest allowlist and TripPage deliberately make the assistant account-only. This policy and guest quotas are unchanged. Public shared views do not expose assistant metadata or mutation access.

## 2. Tools implemented

| Registered tool | Resolved operation | Existing validation/preparation |
| --- | --- | --- |
| `reschedule_attraction` | Exact destination-local HH:mm, with reordered stops | Manual editor and scheduler |
| `move_attraction` | One authorized attraction between two trip days | Manual editor |
| `remove_attraction` | Remove one scheduled stable ID | Manual editor |
| `add_existing_attraction` | Add one known unscheduled attraction | Manual editor |
| `suggest_replacement` | Replace with one known unscheduled candidate | Manual editor; optional indoor/outdoor constraint |
| `add_expense` | New expense, server UUID | Expense service |
| `update_expense` | Existing expense, preserve unspecified fields | Expense service |
| `add_packing_item` | New item, server ObjectId | Packing schema/list limit/duplicate check |
| `remove_packing_item` | Remove precisely one resolved item | Packing service |
| `update_packing_item_status` | Explicit packed/unpacked boolean | Packing service |

Registry entries provide stable names, descriptions, strict Zod input schemas, owner permission, entity resolution and a domain preparation adapter. Preparation adapters only change a private draft. A shared preview builder computes before/after values and affected days. A single persistence adapter owns atomic confirmed commits for every tool.

## 3. Files changed for Step 20B

- Contracts: `packages/shared/src/assistantActions.ts`, `assistant.ts`, `index.ts`, `itineraryEditing.ts`, `scheduling.ts`.
- Server orchestration: `apps/api/src/services/assistantActions.ts`, `assistantToolRegistry.ts`, `assistantToolSelection.ts`, `tripAssistantService.ts`; `apps/api/src/routes/trips.ts`.
- Reused domains: `tripItineraryEditor.ts`, `scheduling.ts`, `expenses.ts`, `equipment.ts`, `contentLanguage.ts` in `apps/api/src/services`.
- Storage: `apps/api/src/models/Trip.ts`, `TripAssistantConversation.ts`; the existing `assistantHistory.ts` projection preserves proposal references.
- Providers/prompt: `apps/api/src/ai/types.ts`, `providers/gemini.ts`, `providers/openrouter.ts`, `prompts/assistant.ts`.
- UI/cache: `apps/web/src/components/trip/AssistantProposalCard.tsx`, `TripAssistant.tsx`; `apps/web/src/hooks/useTripAssistant.ts`; EN/PL `assistant.json`; assistant button contrast in `styles.css`.
- Tests: `apps/api/src/services/assistantTools.test.ts`, `tripAssistantService.test.ts`; `apps/api/src/routes/trips.editing.routes.test.ts`; `apps/api/src/ai/providers/assistantText.test.ts`; `apps/web/src/components/trip/AssistantProposalCard.test.tsx`; `apps/api/e2e/assistantActions.spec.ts`, `providers.ts`.

The broader Git diff also includes pre-existing Step 20A work and user edits/formatting, including TripPage. These were not reverted or reformatted as part of Step 20B.

## 4. Proposal contract and lifecycle

`AssistantActionProposal` contains proposal/trip IDs, validated domain actions, before/after changes, warnings, blocking conflicts, affected day previews, base itinerary/budget revisions, timestamps and status. The server additionally retains source requests and evidence, a fingerprint of authoritative facts and a fingerprint of the prepared domain payload. Private evidence and fingerprints are excluded from API projections. Evidence is cleared on successful execution.

One active proposal per trip is stored in `Trip.assistantAction`. Creating a replacement archives the previous pending proposal as rejected. `assistantActionHistory` retains at most 20 terminal public receipts and omits historical full day previews. Active proposals have a 15-minute expiry; expiration is enforced on read, before/after preparation and in the commit predicate. Cleanup is lazy and bounded, without a new scheduler or TTL collection. Pruned IDs fail closed, so their replay cannot create another expense/item.

Statuses: pending, completed, rejected, expired, stale, failed. A completed receipt can be returned again without executing. Rejected, expired, stale and failed proposals cannot execute. Legacy Step 20A previews cannot execute through the new path.

## 5. Validation and entity resolution

Model output is untrusted. Tool names, argument shape, extra properties, request size, maximum five actions and executable tool/operation correspondence are checked with strict shared schemas. Resolution uses only the currently owned trip. Exact IDs/names win; partial names, categories and ordinals must resolve uniquely. Ambiguity produces localized choices, never an arbitrary ID. Follow-ups use saved referents, the current proposal and a bounded clarification draft.

Date-only values are preserved. Relative days require a validated destination IANA timezone; missing/ambiguous dates ask for clarification. Polish ordinals and stable attraction names are supported. Mongoose documents are explicitly converted to plain data before day resolution and expense field copying; regression tests cover both previously incorrect operations.

Money uses the existing currency precision and decimal-to-minor-unit parser. Explicit user amounts/currencies are checked against conversation evidence; mixed currencies require unambiguous amount/currency pairs. Exchange rates are never invented. Packing duplicates are blocked with a useful failed preview. Missing known opening hours remain warnings rather than fabricated availability.

## 6. Confirmation and execution

1. Authenticate and load the owned ready trip.
2. Select validated tools through one provider generation call, resolve entities and prepare a private draft.
3. Save only proposal metadata; itinerary, expenses and packing remain unchanged.
4. Render the preview. Confirmation applies to every action in the displayed batch.
5. POST only the proposal ID plus optional locale; client-provided actions/arguments are rejected.
6. Reload ownership, expiry, relevant facts/versions and target entities. Re-run the existing domain services. Require the prepared payload to match the reviewed fingerprint.
7. In one MongoDB compare-and-swap, save every affected domain and its completed receipt together. Itinerary and budget revisions increment once per batch when affected; packing updates increment `__v`.
8. Return server-confirmed completion and refresh relevant query caches.

The CAS compares raw BSON fields, including `$exists:false` for legacy missing defaults. It also checks the active proposal ID/status. This avoids comparing hydrated Mongoose defaults to absent storage values and prevents overwriting concurrent edits. Metadata replacement itself uses a CAS to avoid racing a confirmation or cancellation.

## 7–10. Domain and multi-action behavior

Itinerary rescheduling keeps the exact requested local time, retains opening-hours/travel/window checks and uses idle gaps for ordinary scheduler breaks. Newly introduced blocking conflicts reject the batch. Existing unresolved diagnostics follow the manual editor's recovery rules. The preview exposes changes to other activities on the affected day; unrelated days are preserved.

Expense updates preserve IDs, associations, notes and unspecified fields. New expenses use stable server-generated UUIDs throughout preview/commit retries. Packing items use stable server-generated ObjectIds and existing item validation. Replacement candidates come from the authorized known attraction pool; no location or opening-hour discovery is fabricated.

Up to five actions, including cross-domain changes, commit atomically because they share a document. A validation failure in any action prevents all domain writes. A database failure before the write leaves the proposal retryable and the trip unchanged. A lost database or HTTP acknowledgement after the write is recovered by the completed receipt. No partial-success claim is emitted. Dependent actions targeting an entity created/moved earlier in the same batch can require clarification or separate proposals; entity references resolve against the original authoritative snapshot.

## 11. Authorization and idempotency

Every preview, confirmation and cancellation checks owner scope server-side. Changing trip/entity IDs or supplying another user's proposal never grants access. Guest and shared-link callers retain their previous restrictions. No tool accepts arbitrary queries, executable code, unrestricted URLs or permissions. Descriptions and user/model text cannot bypass domain validators or the separate confirmation endpoint.

The domain payload and completed receipt are one atomic write. Simultaneous confirmations either win that write or return the saved receipt. They cannot create duplicate expenses/packing items. A stale proposal never overwrites newer edits. Query callbacks remain guarded by the existing identity mutation wrapper; trip changes cannot contaminate another trip's conversation cache.

## 12. UI, localization and diagnostics

Proposal cards show localized action names, before/after values, affected dates/times, warnings/conflicts and status. Confirm/Cancel have keyboard semantics, visible focus and 44px minimum targets. Pending, completed, failed, expired and stale states are distinct. Recoverable failures leave the card visible, clear loading and allow safe retry. The chat clears the composer immediately on send, retains failed messages and restores the failed draft only when no newer text exists.

Confirmations update proposal status and refresh the exact trip, relevant budget/packing context and itinerary candidates/list queries. Read-only chat, opening/closing, switching language or selecting days never triggers execution. The UI language controls new assistant replies and controls; trip contentLocale is preserved.

Diagnostics include request/trip/proposal IDs, tool names, validation/confirmation result, failure category and latency. Existing provider/model/prompt-version/context-size/history/retry diagnostics remain. Full prompts, conversations, credentials and raw driver errors are not logged by default.

Provider formats were checked against primary documentation: [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling), [Google's FunctionDeclaration JSON Schema examples](https://github.com/googleapis/js-genai), and [OpenRouter tool capabilities](https://openrouter.ai/blog/tutorials/tool-calling/). Gemini native function calls and OpenRouter native tool calls normalize at the adapter boundary. OpenRouter checks configured-model capability metadata with a bounded timeout and cache; unsupported models use a strictly validated JSON envelope. No fallback credentials/models are invented. Generation and Regenerate Day retain their existing JSON paths.

## 13–14. Validation results

| Check executed | Actual result |
| --- | --- |
| `bun run test --concurrency=1 -- --maxWorkers=2` | Passed all project test tasks: API unit/integration suite and 507 web tests across 54 files. |
| Final focused API checks after refinements | 26 tool/resolution/selector tests, 78 conversation/editor/HTTP workflow tests, and 8 provider normalization tests passed. |
| `bun run test:e2e` | 140/142 passed in 23.7 minutes. Both failures were the same existing white-on-orange assistant-button contrast defect, in desktop EN and PL. |
| Fresh-server browser rerun after the contrast fix | **9/9 passed in 2.4 minutes**: both previously failing desktop axe tests, all four action workflows and all three conversational reliability workflows. |
| `bun run typecheck` | All four Turbo tasks passed, including shared build and shared/API/web type checks. |
| `bun run typecheck:e2e` | Passed, including the new provider fixtures and browser tests. |
| `bun run build` | All three production build tasks passed. The final API build was repeated successfully after backend refinements. |
| Translation validation | 0 errors, 0 warnings; existing duplicate-value audit groups are informational. |
| `git diff --check` | Passed. Git printed only line-ending conversion notices. |
| Lint | No lint script/configuration is provided; no lint pass is claimed. |

The first broad unit run found one obsolete Step 20A assertion that actions must never reach the provider. It was updated to assert proposal-only generation without domain writes. Its replacement and the full project-script rerun passed. An unfiltered direct Vitest invocation was stopped because it also collected Playwright files; the project scripts correctly separate these runners.

Browser coverage includes preview/confirm/cancel, a failed scheduling proposal, multi-domain commit, stale rejection after a separate manual edit, provider rate limiting, mobile Polish controls, language changes without AI/execution, keyboard confirmation, lost committed HTTP response, refreshed completed receipts and the existing ten-turn conversational suite. Axe also checks the new pending action card.

The full browser regression exercised generation, manual editing, Regenerate Day preview/commit/discard, routing, weather, Explore/Saved, packing, expenses, guest quotas/migration/isolation, authentication, sharing, PDF/calendar exports and localization. Apart from the two corrected contrast failures, these scenarios passed. Tests use deterministic provider mocks, isolated MongoDB and browser fixtures; they do not consume paid AI credits.

Production builds retain the existing large-bundle advisory and upstream Zod annotation warnings. These are warnings, not build failures. No unrelated bundle/dependency refactor was introduced.

## 15. Known limitations

- Assistant access remains account-only, matching the existing application policy. Guest planning/editing/packing/expense quotas and features are preserved.
- Replacement proposals use known unscheduled attractions. Multiple suitable candidates require a user choice; new external discovery is outside this first tool set.
- Character budgets are conservative bounds, not a provider-tokenizer guarantee. Large requests fail safely instead of dropping actions/instructions.
- Expiry cleanup is lazy. Recent receipt retention is bounded to 20; older replay IDs fail closed.
- Routing changes between preview and confirmation invalidate the preview rather than silently approving different times.
- Real-model quality was not evaluated with paid APIs. Mocked tests establish contracts, ownership, construction, lifecycle and persistence correctness.

## 16. Step 20C readiness

Voice transcription can reuse the existing message contract and the same preview/confirmation flow. Recognized speech must remain untrusted input and must never stand in for the explicit action confirmation. Voice and attachments were not implemented in this step.

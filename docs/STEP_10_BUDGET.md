# Step 10 implementation report

The existing `TripBudgetCard`, its chart, card layout and CSS remain in use. Repository inspection found no expense form or expense list in `apps/web/src`; one shared add/edit dialog and one persisted expense list were added inside the card. The existing MUI components, TanStack Query data flow, trip page and assistant confirmation dialog are reused. No dependencies were added. The actual backend is Express, and its existing authentication, ownership and error conventions were retained.

## Completed TODO

- [x] Inspect existing UI, budget fields, admission metadata, planning and assistant flows.
- [x] Define shared money, category, expense, allocation and summary contracts.
- [x] Persist embedded expenses and allocations with ownership and revision checks.
- [x] Implement CRUD and centralized reconciliation and summaries.
- [x] Extend generation, regeneration, manual editing responses and assistant actions.
- [x] Connect the existing card, chart, expense controls and per-day breakdown.
- [x] Add persistence, backend and frontend tests; run checks and production builds.

## Data and APIs

Expenses are embedded on the existing Trip document, without a new collection. Each has a stable UUID, title, category, integer `amountMinor`, ISO currency, planned/actual status, optional day/attraction/date/note, explicit `replacesAdmission` flag, and creation/update timestamps. Day IDs follow the existing itinerary's numeric day index. Existing trips default to no expenses, no allocations and revision zero.

The existing `analysis.budget` remains the only stored total budget. Per-person budgets require a known traveler count. Category allocations have a recorded currency and are reservations, not expenses. A currency change preserves the original allocations and warns instead of converting them.

Authenticated, owner-scoped routes:

| Method | Route | Result |
| --- | --- | --- |
| GET | `/api/trips/:id/expenses` | Expenses, revision and computed summary |
| POST | `/api/trips/:id/expenses` | Create from `{ expense, requestId, expectedRevision }` |
| PATCH | `/api/trips/:id/expenses/:expenseId` | Update from `{ expense, expectedRevision }` |
| DELETE | `/api/trips/:id/expenses/:expenseId` | Delete with `{ expectedRevision }` |
| GET | `/api/trips/:id/budget` | Same authoritative budget data |
| PATCH | `/api/trips/:id/budget` | Save `{ allocations, expectedRevision }` |

Expense updates submit the complete validated expense input. Creation retries reuse a client UUID; conflicting reuse is rejected. Budget revision checks reject stale writes. Association writes also check itinerary revision. Expense writes do not increment itineraryVersion or invalidate regeneration previews. Forms retain their opening revision even when data refreshes in the background.

## Calculation and integration

`budgetSummary.ts` calculates amounts by currency, category and day, including an unassigned bucket. Planned and actual amounts remain separate. Decimal inputs use BigInt parsing with ISO currency-specific precision, while persisted money is safe integer minor units. Money formatting preserves cents even at the safe-integer boundary. Mixed-currency totals are never summed or converted; trip-budget comparisons become unavailable. Missing prices, unknown units, conditional pricing and missing per-person traveler counts remain uncertain.

Automatic estimates are separate from manual records. A manual expense explicitly linked as an admission replacement suppresses that scheduled admission's estimate. Unlinked records, including souvenirs, remain independent. A unique admission retains reconciliation after moving to another day, while the expense's recorded day and date remain unchanged. Changing planned to actual moves a single record between totals. Actual spending is never inferred from a visit.

`budgetSelection.ts` applies bounded cost penalties and chooses affordable alternatives of similar relevance. It retains unknown-price choices and explicitly named attractions in notes. When no attraction allocation exists, the remaining total is a ceiling rather than an invented allocation percentage. Selection reserves actual spending and planned commitments. The existing clustering, route optimization and opening-hours scheduling stages remain in use.

Regeneration ranks candidates against the remaining budget after accounting for other days, includes admission estimate differences and budget warnings in its existing preview, and preserves manual expenses on apply. Manual itinerary editing receives fresh budget data through the existing trip serializer; it never changes recorded expense history or silently substitutes budget alternatives.

Ask Triply receives the same deterministic budget context. Literal requests such as `Add EUR 25 for lunch on day 2`, `Record EUR 18 for drinks`, `Move my drinks expense to day 3`, and `Delete the drinks expense` produce stored, expiring confirmation previews. Add means planned; record means actual. The existing apply/cancel dialog and endpoints confirm each mutation once through the shared expense service. Ambiguous requests ask for more specific input. Cheaper-day requests use the existing regeneration preview/apply flow.

## Files

Created:

- `packages/shared/src/budget.ts`
- `apps/api/src/routes/expenses.ts`
- `apps/api/src/services/expenses.ts`
- `apps/api/src/services/budgetSummary.ts`
- `apps/api/src/services/budgetSelection.ts`
- `apps/api/src/services/assistantBudget.ts`
- `apps/api/src/services/budgetSummary.test.ts`
- `apps/web/src/hooks/useTripBudget.ts`
- `apps/web/src/components/trip/TripBudgetCard.test.tsx`
- `docs/STEP_10_BUDGET.md`

Modified:

- `packages/shared/src/index.ts`, `trip.ts`, `assistant.ts`
- `apps/api/src/models/Trip.ts`, `TripAssistantConversation.ts`
- `apps/api/src/routes/trips.ts`, `trips.editing.routes.test.ts`
- `apps/api/src/services/tripDraft.ts`, `tripGeneration.ts`, `tripRegeneration.ts`
- `apps/api/src/services/assistantContext.ts`, `tripAssistantService.ts`, `tripAssistantService.test.ts`
- `apps/web/src/components/trip/TripBudgetCard.tsx`, `TripAssistant.tsx`
- `apps/web/src/pages/TripPage.tsx`, `TripPage.editing.test.tsx`
- `apps/web/src/styles.css` (wrapping for new expense rows only)

## Validation and limits

- Full `bun run test`: 373 backend tests and 74 frontend tests passed.
- Final `bun run test --filter=@triply/web`, after form concurrency protection: 75 frontend tests passed.
- Shared, API and web TypeScript checks passed.
- `bun run build` passed for shared, API and web; the final frontend revision was rebuilt.
- `git diff --check` passed. There is no configured lint script or lint configuration to execute.
- Tests use MongoDB memory-server and mocked AI, places and routing services. No live AI or discovery service was required.

No exchange-rate conversion is implemented. Unknown prices prevent a guaranteed budget fit. Selection is a deterministic heuristic, not a global financial optimizer. Assistant expense commands deliberately use a limited literal grammar; general amount/category/status edits remain available in the Budget dialog. Embedded expenses are limited to 2,000 per trip. Production build warnings remain for Zod comment annotations and the large frontend bundle. No browser visual comparison was performed. No changes were committed or pushed.

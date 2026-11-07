# Journey #21D: business rules and final QA

## Actual architecture and data flow

The Trip MongoDB document embeds the itinerary, UUID occurrence identities, sparse visits, actual/planned expenses, and independent itinerary/visit/Budget revisions. Attraction admission metadata already stores minor-unit amounts, currency precision, adult/general price type, per-person/per-group/unknown units, OSM/official source, raw fee evidence, and conditional/conflict notes. `analysis.travelers` is the existing participant count and `analysis.budget.currency` is the trip expense currency.

Plan and Journey share `useTripVisits`, `VisitControls`, the confirmed Trip Query cache, one Leaflet map, and existing Budget components/queries. Account-level `promptForExpenseAfterVisit` controls manual prompts. Guest ownership uses the existing trip identity policy. No new expense collection, visit ledger, transaction system, planner, provider, or AI feature was introduced.

Inspection found that the existing completed-item UI fix correctly disabled More and sortable activation. It was preserved. The backend had no visited-item protection, including indirect rescheduling and regeneration, and no automatic actual posting. Budget already supported update operations, but automatic expenses needed a small amount-correction UI.

## Protection audit

| Path | Enforcement |
| --- | --- |
| Drag, tap reorder, cross-day move, replace/swap, remove, insertion, route/schedule recalculation | Shared editor compares every active visited UUID's day, calendar date/timezone, attraction position, identity, scheduled start/end, duration/status, and coordinates before persistence. Indirect shifts reject the entire write with 409. |
| Concurrent visit during edit | Visit revision participates in the itinerary compare-and-set. A newer visit causes conflict instead of committing a stale unlocked edit. |
| Day regeneration preview | A day containing visited occurrences rejects with 409 before generation; its itinerary/progress/expenses remain intact. A visit revision guard protects preview persistence. |
| Stored preview commit | Final visited snapshots are checked, including visits made after preview creation. Commit also uses a visit revision guard. An unchanged retained visited occurrence is allowed; removal, movement, replacement, or rescheduling is rejected. |
| Full regeneration/preferences reset | Existing active visited occurrences block itinerary invalidation. Requirement writes have visit revision guards. Full generation also checks for active visited occurrences. |
| Other callers | Shared editor enforcement also covers callers such as assistant confirmation, without modifying assistant behavior or prompts. There is no independent scheduled-time mutation endpoint. |
| Reset and skipped | Reset unlocks editing; planned/skipped remain editable when the resulting schedule leaves any other visited occurrence unchanged. Actual expenses survive reset/skip. |

No planner changes were needed. Rejecting day preview for a day with visited items is deliberate: the current regeneration engine has no immutable-visit constraints. Users can reset those visits first. Existing legacy history referring to retired occurrences does not lock unrelated current items.

## Automatic actual-expense eligibility

Automatic posting requires paid admission with a strictly valid finite safe nonnegative minor-unit price, supported currency/precision, known per-person or group unit, and no conditional pricing/conflict notes. Zero/free prices create no expense.

Reliable evidence is either an explicitly confirmed `price.reliability` value, or saved OSM admission evidence that exactly reproduces the existing strict charge parser's amount/currency/unit. `reliability` is a backward-compatible optional `confirmed | estimated` field; estimated prices never qualify. Legacy official values without confirmation and ambiguous raw charges use manual entry. Confirmation is trusted server/provider metadata; expense/visit clients cannot supply it.

General per-person prices multiply by the positive safe-integer `analysis.travelers` count within the existing trip limits; adult-only prices require manual entry because no adult-count breakdown exists. Group prices are used once and do not require a traveler count. Unknown participants do not default to one. The result must fit safe minor-unit arithmetic. Currency must match the trip currency; there is no invented conversion or exchange rate.

Existing actual admissions or ambiguous attractions/other expenses associated with the visit, or potentially matching unlinked day expenses, suppress posting rather than guessing. Explicit food, shopping, accommodation, and transport purchases do not suppress admission posting. Existing manual records are never merged or deleted. The normal optional manual prompt is used for ineligible/ambiguous cases, respecting the account preference. Eligible automatic posting is independent of that preference and suppresses the redundant prompt.

## Persistence, retries and lifecycle

The successful first visited transition atomically stores a server-generated pending admission snapshot in `Trip.automaticAdmissions`. A subsequent single-document CAS appends the existing Budget `TripExpense`, increments Budget revision, and marks the receipt posted together. CAS checks visit, itinerary, and Budget revisions; concurrent manual expense writes also guard visit revision so they cannot overwrite a newly created pending receipt.

The receipt UUID is the itinerary occurrence ID. Its generated expense ID and original amount/currency/price unit/participant count remain fixed for retries. A lost write acknowledgment is resolved by reading the persisted receipt before reporting success. Posting failures leave the visit saved and pending snapshot durable; they are displayed separately from visit-save failures. Both Budget caches receive canonical results and revision guards reject stale results.

`POST /api/trips/:id/visits/:itemId/expense/retry` retries only an authorized existing receipt, never changes visit status, and supports a retired occurrence. This prevents recovery from accidentally marking a reset visit visited again. An explicit linked actual admission entered manually resolves a pending receipt. Concurrent/ambiguous manual spending is rechecked before posting. Failures can be retried after refresh; a retired occurrence's recovered expense is detached from the active itinerary.

Posted/resolved receipts remain as tombstones when expenses are edited/deleted. Undo/revisit, price changes, participant changes, refresh, or mode switching never recreate or overwrite the transaction. `TripExpense.automaticSource` stores immutable original provenance; existing expense CRUD preserves it while allowing actual amount corrections. The Budget card exposes a small accessible correction dialog with original amount, currency, validation, save/error states, and preserved values on failure. Manual creation remains unchanged.

The existing admission-replacement calculation recognizes an active automatic actual expense by occurrence UUID, so the same admission is not also included as automatic planned spending in the combined Budget display. Other planned/manual entries and actual totals keep their existing arithmetic. This works for repeated attractions and moved visits without changing actual spending dates.

Removal after unlocking retains actual expenses using the existing safe unlink policy. Source metadata retains the original occurrence ID as provenance, separate from the optional active itinerary link. Actual expense day/date do not follow later itinerary moves.

## Visuals and accessibility

Plan and Journey use the same status chip with a check, skip, or planned icon and translated label. At narrow mobile widths, status text stays visible and actions use 44px icon buttons with full accessible labels/titles, keeping the row usable in Polish. Visited cards have a subtle success surface/border; skipped cards have a muted surface and dashed border. Plan's disabled edit/drag buttons reference a visible lock explanation through `aria-describedby`. Both modes supply visit statuses to the existing marker classes and accessible marker labels; check/minus cues supplement color. There were no separate Leaflet popups to duplicate. Existing overview progress keeps skipped separate from visited and has a neutral zero state. No new animations were added.

Broader browser regression also verified the existing marker provider-ID attributes separately from UUID occurrence identity, prevented a failed move's background refetch from resetting its destination, and fixed minimum grid widths/Polish preference wrapping at 320px.

## #21D files

- Shared contracts: `packages/shared/src/admission.ts`, `budget.ts`, `trip.ts`, `visits.ts`.
- Backend: `models/Trip.ts`, `middleware/tripIdentity.ts` (only the owned guest recovery-route allowlist), `routes/trips.ts`, `services/visitedProtection.ts`, `automaticVisitExpenses.ts`, `tripVisits.ts`, `expenses.ts`, `budgetSummary.ts`, `tripDraft.ts`, `tripGeneration.ts`, `tripItineraryEditor.ts`, `tripRegeneration.ts`.
- Backend regressions: `routes/trips.editing.routes.test.ts`, `trips.regeneration.routes.test.ts`, `guestTrips.routes.test.ts`.
- Frontend: `api/trips.ts`, `hooks/useTripVisits.ts`, `pages/TripPage.tsx`, `components/trip/VisitControls.tsx`, `TripTimeline.tsx`, `TripMap.tsx`, `MoveAttractionDialog.tsx`, `TripBudgetCard.tsx`, `styles.css`, EN/PL `itinerary/visits.json` and `itinerary/expenses.json`.
- Frontend regressions/cache guard: `pages/TripPage.editing.test.tsx`, `hooks/useTripVisits.test.tsx`, `query/confirmedTrip.ts`, `query/confirmedTrip.test.ts` (existing timeline/map/Journey tests also exercised). The cache helper reports an identity change during cancellation so a late visit response cannot restore its Budget under another session.
- Browser fixtures/regressions: `apps/api/e2e/data.ts`, `server.ts`, `journey.spec.ts`.
- This report. Earlier uncommitted #21A/#21B/#21C work remains preserved.

## Verification

No tests use live AI, Places, or external pricing APIs. Browser tests use a saved deterministic Journey fixture, the real local API/MongoDB, and Chromium. An initial parallel full-frontend run exposed an unchanged Explore timing failure; it passed on subsequent full runs without changing or skipping that test. Final executed counts are also reported in the delivery response.

| Command | Actual result |
| --- | --- |
| `bun run --cwd apps/api test` | 58 files, 1,009 tests passed. |
| `bun run --cwd apps/web test` | 59 files, 551 tests passed. Includes translation validation. |
| `bun run test:e2e apps/api/e2e/journey.spec.ts` | 2 Chromium tests passed, including amount correction, EN/PL, keyboard, and 320px layout. |
| `bun run test:e2e apps/api/e2e/journey.spec.ts apps/api/e2e/tripExperience.spec.ts` | 6 passed, 1 failed. The remaining failure expects Ask Triply; TripAssistant is already commented out in repository HEAD. The failing test was left intact and no Assistant functionality was enabled or changed. Its preceding map/list/deletion assertions pass. |
| `bun run typecheck` | Passed for shared, API, and web. |
| `bun run typecheck:e2e` | Passed. |
| `bun run build` | Shared/API/web builds passed. Shared was also directly rebuilt by browser-test commands. |
| Translation validation | 0 errors, 0 warnings; 185 contextual repeated-value audit groups. |
| `git diff --check` | Passed; existing LF-to-CRLF notice for `useTrips.ts`. |

There is no repository lint script. Builds report existing bundle-size and Zod annotation warnings. No commits or pushes were made.

## Remaining limits

- Unclassified official/ambiguous/estimated/conditional prices and currency mismatch require manual entry. No currency conversion, age/discount pricing, payment verification, or price refresh is introduced.
- All travelers in the existing authoritative count are used for eligible general per-person pricing; the application has no separate paying-participant breakdown.
- Failed posting is reconciled explicitly, not by a new background worker. Reload/refetch displays pending recovery without creating expenses.
- Pending snapshot/tombstone storage grows with automatically posted occurrences and intentionally survives user deletion.
- Cross-tab convergence uses existing focus/refetch behavior, not realtime push or offline synchronization.
- This is a focused Journey/Trip Page browser regression, not an assertion that the entire repository Playwright suite ran.

## Exact manual QA (existing saved trip; no Places needed)

1. Open an existing ready trip in Plan, choose a day, and switch to Journey. Confirm that mode/day switching does not change itinerary version, statuses, or expenses.
2. On a saved admission with exact per-person price and known traveler count, mark visited. Verify unit amount × travelers in the confirmation, linked actual expense, Budget totals, and daily actual totals. With a group price, verify the amount is used once.
3. Check visited label/check/success surface in Journey, switch to Plan, and check the same state plus lock explanation. More and drag must be disabled; the map marker must announce Visited in both modes.
4. Attempt reorder, move, replace, remove, insertion before a visited item, and direct itinerary API mutation. Any direct or indirect change to its position/schedule must fail with 409 and no partial itinerary write. Regenerate its day and confirm rejection with progress/expenses unchanged.
5. Reset the visit to planned. Verify editing unlocks and the actual expense remains. Edit/move the unlocked item, preserving its occurrence and transaction. Revisit it: there must be no second automatic admission expense.
6. Use Correct expense in Budget to change the actual amount. Check the original posted amount in the dialog, save a correction, and confirm totals/linked display update. Delete it explicitly, undo/revisit, and confirm it stays deleted.
7. Mark a saved unknown/ambiguous/mismatched-currency item visited. Confirm no automatic actual expense and the existing optional manual prompt when enabled. Dismiss it, then disable prompting in Settings; manual creation must remain available, with no prompt after the next unknown visit.
8. Mark another item skipped. Verify skip icon/muted dashed treatment on list/map, separate skipped count, and no increase in visited percentage. Reset and verify neutral styling returns.
9. For deterministic expense-failure QA, use the backend test's transient posting fault or a local test stub: visit remains saved, pending error survives refresh, Retry records exactly one original snapshot, and manual linked admission entry resolves the failure. Retry after reset must preserve planned status.
10. Create a regeneration preview while an item is planned, mark that item visited, then apply a preview that would change it. Confirm rejection and preserved itinerary/visits/spending. Discarding or failing a preview must preserve all actual spending.
11. Refresh, reopen the saved trip, and refocus a second tab after a mutation. Verify server persistence and eventual cache convergence without new expense creation or prompts.
12. At mobile widths, test status controls, day/mode switching, external Navigate link, and the correction dialog using touch/keyboard. Repeat in Polish and English and with reduced motion. Confirm no horizontal overflow and readable status/lock labels.
13. Inspect Network while switching modes, visiting, correcting expenses, and selecting markers. Journey must add no Places or AI requests. Normal existing map tiles and explicit Plan routing behavior remain unchanged.

For a seeded browser flow with reliable person/group prices and three participants, run `bun run test:e2e apps/api/e2e/journey.spec.ts`.

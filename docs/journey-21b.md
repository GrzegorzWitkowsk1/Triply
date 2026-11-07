# Journey #21B: optional expenses and account preferences

## Architecture and integration

#21A is present: attraction activities have persisted occurrence UUIDs, sparse
visit records and independent visit/itinerary revisions. Budget already stores
expenses inside `Trip.expenses`, validates integer minor units/currencies, computes
all totals on the server, and guards mutations with `budgetRevision`. Its create
request UUID is also the expense ID, making unchanged retries idempotent.

This implementation extends those paths. It introduces no expense collection,
Budget calculator, planner algorithm, AI call, provider, Journey screen or mode
toggle. All pre-existing #21A work and uncommitted changes remain in place.

## Expense contract and persistence

`ExpenseInput`/`TripExpense` gain optional `itineraryItemId: string | null`.
Existing records and callers may omit it. Existing expense CRUD endpoints and
response shapes remain compatible. A non-null link must be a UUID belonging to a
current attraction occurrence in the same owned trip. If a provider attraction ID
is supplied too, it must match that occurrence. Unknown, cross-trip and mismatched
references are rejected using the existing association-validation error format.

Updates that omit the optional link preserve it; explicit `null` unlinks it.
Distinct request UUIDs allow multiple expenses for one visit. Existing revision
guards, immediate submit locks and stable retry UUIDs prevent duplicate creation.
No estimated admission amount is copied into actual spending.

The existing Budget form receives an optional visit draft: title, attractions
category, day/date and occurrence link. The amount starts blank; currency and
money validation still come from Budget. The form also allows manual optional
visit selection, unlinking a draft, and editing its spending date. Successful
creation shows confirmation and updates the existing Budget query/list/daily
summary. Failure retains the form and UUID without changing the completed visit.
A queued visit draft waits for an in-flight expense operation to finish.

## Prompt behavior

The visit PATCH retains its canonical `TripDetail` response and may add an
ephemeral `expensePromptItemId`. Only a newly persisted transition to `visited`
can carry it. The account preference is checked on the server. The client removes
the signal before caching and checks current visit revision, status, trip route
and prior status before showing the prompt. Identity-aware mutation callbacks
prevent callbacks from updating another account's UI.

`Trip.expensePromptedItemIds` records consumed occurrence IDs atomically with
visit changes. Revisiting after undo/skip does not prompt repeatedly, including
across refreshes or tabs. Disabled preferences also consume that visit's automatic
opportunity. Leaving a legacy visited state consumes its opportunity too. Manual
expense creation remains available for every visit regardless of this marker.

The prompt is a dismissible, nonmodal Snackbar region using existing MUI
components. It names the place and offers Add expense, Not now, Dismiss and the
Don't ask again checkbox. It neither traps focus nor blocks navigation. Explicit
Add/Not now with the checkbox checked saves the account preference. Toggling the
checkbox, Escape, click-away or Dismiss alone makes no preference request.
Preference saving and expense entry are independent; failure remains visible and
the user can retry in Settings. Add opens/focuses the existing form on mobile too.

Skipped/failed/idempotent visit updates, stale responses, GET/refetch/refresh,
day changes, disabled preferences and guests never open an automatic prompt.
The server signal is consumed once even if navigation or a lost response means
the prompt is not displayed. It is an optional offer, not a delivery queue.

## Account preference and guest policy

The shared `JourneyPreferences` schema contains `promptForExpenseAfterVisit`.
`User.journeyPreferences` defaults to true, including legacy accounts without the
field. It is separate from AI travel-planning defaults, so changing travel
preferences cannot accidentally overwrite it. `journeyPreferencesRevision` guards
concurrent saves.

- `GET /api/profile/preferences/journey` returns `{ preferences, revision }`.
- `PATCH /api/profile/preferences/journey` accepts
  `{ promptForExpenseAfterVisit: boolean, expectedRevision: number }` and returns
  the persisted result. Invalid/extra fields return 400; conflicting saves return
  409. The existing authenticated profile scope and origin checks apply.
- Settings adds a Journey preference switch inside the existing Preferences card,
  with a labeled switch and loading/saving/error states. It uses server-confirmed
  values and has English/Polish translations.
- The TanStack preference cache is keyed by account ID, shares updates between
  Settings and Trip Page, rejects older revision responses, and refetches on focus
  and every 60 seconds while active. Authentication's existing cache isolation
  applies. Concurrent conflicts refetch canonical state rather than overwriting it.
- Guests retain authorized manual expense creation, including occurrence links,
  but have no automatic prompt or account preference. Guest requests to these
  profile endpoints are rejected. No global or anonymous local-storage preference
  was introduced.

## Itinerary changes and concurrency

The shared `expenseLinksForItinerary` helper participates in itinerary persistence
for manual edits, day apply, requirements regeneration and full generation.
Its budget-revision condition is checked even if the initial snapshot has no
linked expenses: a concurrent new expense can otherwise introduce a dangling link.

- Reorder/move/time recalculation retain the occurrence link. Spending dates,
  expense day assignments, descriptions and amounts do not follow scheduling
  changes automatically.
- Undoing visited or marking skipped never changes expenses.
- Removed/replaced occurrences are explicitly unlinked (`null`) in the same
  atomic write as the itinerary change. Their expense records and transaction
  data remain. This advances `budgetRevision`; retained links do not change.
- Preview/discard/failure never write expenses. Commit retains exact occurrence
  matches and unlinks removed ones. Names never transfer a link.
- A manual edit or day commit racing expense creation returns a retryable 409
  rather than overwriting money or leaving a broken link. Full generation retries
  only its database save against fresh spending data, without rerunning providers
  or the planner. Sustained contention can still produce a recoverable error.

The Budget calculation implementation is unchanged. Expense queries now also
reject delayed GET responses with older budget revisions.

## Files changed for #21B

Paths below are relative to their stated directory; they distinguish this phase
from the pre-existing uncommitted #21A implementation.

- `packages/shared/src/`: `budget.ts`, `profile.ts`, `visits.ts`.
- `apps/api/src/models/`: `Trip.ts`, `User.ts`.
- `apps/api/src/routes/`: `profile.ts`, `trips.ts`,
  `profile.routes.test.ts`, `guestTrips.routes.test.ts`,
  `trips.routes.test.ts`, `trips.editing.routes.test.ts`,
  `trips.regeneration.routes.test.ts`.
- `apps/api/src/services/`: new `expenseLinks.ts`; updated `expenses.ts`,
  `tripVisits.ts`, `tripDraft.ts`, `tripGeneration.ts`, `tripItineraryEditor.ts`,
  `tripRegeneration.ts`.
- `apps/web/src/api/`: `trips.ts`.
- `apps/web/src/hooks/`: new `useJourneyPreferences.ts`, `useTripVisits.test.tsx`;
  updated `useTripVisits.ts`, `useTripBudget.ts`.
- `apps/web/src/components/profile/`: new `JourneyPreferencesCard.tsx` and test.
- `apps/web/src/components/trip/`: new `JourneyExpensePrompt.tsx` and test;
  updated `TripBudgetCard.tsx`.
- `apps/web/src/pages/`: `ProfilePage.tsx`, `ProfilePage.test.tsx`, `TripPage.tsx`,
  `TripPage.editing.test.tsx`.
- `apps/web/src/i18n/`: `namespaces.ts`, new
  `locales/en/itinerary/expenses.json` and `locales/pl/itinerary/expenses.json`.
- `docs/journey-21b.md`.

## Actual verification

| Executed check | Result |
| --- | --- |
| `bun run --cwd apps/api test` | 58 files, 968 tests passed |
| `bun run --cwd apps/web test` | 57 files, 524 tests passed |
| `bun run --cwd apps/web vitest run src/pages/TripPage.editing.test.tsx` | 33 tests passed, including the final explicit estimated-price fixture |
| `bun run typecheck` | All workspace typechecks passed, 4 task executions |
| `bun run build` | Shared, API and web builds all executed and passed, 3 task executions |
| Translation validator invoked by web tests/build | 0 errors, 0 warnings |
| `git -c safe.directory=C:/Users/grzes/Desktop/Files/Triply diff --check` | Passed |

The shared build was also executed directly during implementation. The repository
has no lint script. Tests use existing Vitest, Testing Library, in-memory MongoDB
and mocked AI/provider infrastructure. No live external AI/Places calls were used
for the new tests. Vite emitted Zod annotation and bundle-size warnings; sandboxed
Turbo typecheck emitted a Git dirty-hash warning but all tasks succeeded.

## Manual QA using a saved trip

Use an authenticated account and an existing ready trip with a currency and at
least two planned occurrences. Use different previously unvisited occurrences for
repeated prompt scenarios: undo/revisit intentionally does not offer again. A new
occurrence can be added from the trip's saved attraction pool without Places.

1. In Settings → Preferences, enable Ask to add expenses after visiting a place.
   Reload Settings and re-login: the switch must retain its value.
2. Mark a planned place visited. Inspect Network: the visit PATCH must succeed
   before the prompt appears. Skip another place: expect no prompt. Refresh,
   switch days and return: expect no automatic replay.
3. Choose Not now. Verify the visit remains visited and no expense was created.
   Undo and revisit the same occurrence: it must not prompt again.
4. Visit another occurrence and choose Add expense. Confirm the existing Budget
   form shows its name, attractions category, relevant day/date, current currency
   and a blank amount even when estimated admission is known. Enter the actual
   amount and submit once. Verify confirmation, list, whole-trip/daily totals,
   persisted occurrence link and unchanged visited status after refresh.
5. Before saving another expense, block its POST request in DevTools. Verify the
   visit remains visited and entered values remain. Restore the request and retry
   without editing: the request UUID must be the same and only one expense exists.
6. On a fresh prompt, check Don't ask again, then dismiss or press Escape. Reload
   Settings: the preference must remain enabled. On another prompt, check it and
   explicitly choose Not now (repeat with Add using another occurrence): it must
   become disabled. Manual Budget entry must still work.
7. Re-enable the setting. Block PATCH `/api/profile/preferences/journey` and choose
   Add or Not now with the checkbox checked. Expect a visible preference error,
   independently completed visit, and usable expense form. Restore the request
   and retry the setting in Settings; failed saves must not appear successful.
8. Add a second manual expense linked to an existing visit using the optional
   Linked visit selector. Verify both records contribute to totals. Use No linked
   visit for another manual expense and verify normal creation/deletion still work.
9. Move/reorder a linked visit and verify its link survives while its transaction
   amount/date/day remain unchanged. Undo visited and mark skipped: keep expenses.
   Remove the occurrence: keep the actual expense with a null link and its original
   description/date/amount. Adding the provider attraction again must not inherit it.
10. Preview a relaxed day regeneration using saved candidates. Inspect expenses
    before apply and after discard/retry: no changes. Commit: retained occurrence
    links survive, removed occurrence links become null, actual totals persist.
    If regeneration fails, expenses must remain intact. Existing regeneration may
    attempt optional provider discovery when the saved pool is small; basic
    prompt/Budget/Settings checks do not require Places.
11. Open two tabs for the account. Save a setting in one and focus/refresh the other
    (or wait for the active-query refresh). Both converge. Simultaneous saves may
    produce a visible revision conflict; refresh/retry must show server truth.
    A visit changed in another tab must never open an expense prompt from refetch.
12. Repeat a linked expense request using an item UUID from a different owned trip:
    expect 400 with no new spending. Without authentication, profile preference
    requests return 401. A guest keeps manual linked expenses but gets no automatic
    prompt or authenticated Settings access. Never use another person's credentials.
13. At a narrow mobile viewport, mark visited, use Add expense, and enter the amount.
    The existing form must be visible/focused and navigation must remain usable.
    Tab through prompt buttons/checkbox and Settings toggle; use Enter/Space and
    Escape. Repeat with English and Polish labels.

Browser QA is a handoff checklist and was not manually executed in this workspace.

## Remaining limits

- Automatic offers are at most once per logical occurrence. Lost responses,
  navigation, or unavailable account-preference data can mean an offer is missed;
  manual entry remains available. This phase has no offline delivery queue.
- Guests intentionally have manual entry only. Account preferences are not stored
  globally or per guest browser.
- The existing inline form still uses the trip's currency; without one it retains
  Budget's existing instruction to set a currency before adding an expense.
  Backend currency support/calculations are unchanged.
- Expense updates and explicit link removal are available through existing CRUD;
  no new expense-editing manager was added. The existing list/create/delete UI is
  extended with visit context.
- Cross-tab preference convergence relies on focus/refetch/active polling, not push.
  Persisted consumed-visit IDs grow with the trip's visited occurrence history.
- No commit or push was performed.

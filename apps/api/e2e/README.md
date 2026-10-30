# Triply browser smoke tests

TODO / implementation checklist:
- [x] Audit Fastify, sessions, trip pipelines, provider boundaries, tests and CI.
- [x] Add Chromium configuration and isolated MongoDB/server lifecycle.
- [x] Add deterministic provider fixtures and browser journeys.
- [x] Add a separate GitHub Actions job.
- [x] Complete two consecutive passing browser runs and record validation results.

Run from the repository root with Bun 1.3.14 and Node 24:

```sh
bun install --frozen-lockfile
bunx playwright install chromium
bun run test:e2e
bun run test:e2e:headed
bun run test:e2e:report
bun run typecheck:e2e
```

CI runs all scenarios in four independent shards (`--shard=1/4` through
`--shard=4/4`), with one worker and separate servers per runner. Individual
tests can be sharded because fixtures reset state for each test. The October 30
audit, current counts and consolidation recommendations are in
[`docs/testing-audit.md`](../../../docs/testing-audit.md); the validation counts
at the end of this document describe the original October 14 smoke suite.

On Linux CI, use `bunx playwright install --with-deps chromium`. The first
MongoMemoryReplSet invocation may download its MongoDB binary. No manually
configured MongoDB, application secrets, or paid provider keys are needed.

`playwright.config.ts` builds shared contracts through the root script and
starts two servers: the compiled API test executable under Node at port 4001
and Vite at port 5174. Node is also the production API runtime; Bun's current
V8 implementation cannot load the BSON dependency used by MongoMemoryServer.
Both readiness URLs are probed by Playwright. Existing servers are never reused.

Chromium runs headlessly with one worker, Europe/Madrid timezone, en-GB locale,
60-second tests and 10-second assertions/actions. Failures are not retried locally
or in CI; failed tests retain their trace and screenshot.
HTML reports are written to `playwright-report` and failure assets to
`test-results`. The workflow uploads both on failure, with seven-day retention.

The backend remains the real `startServer`/`createApp`, protected Fastify routes,
Argon2 authentication, signed cookies, MongoDB sessions, destination recovery,
generation/planning, weather policy, scheduling validator and itinerary editor.
Tests log in through the UI using a freshly hashed fixture user's credentials.
The auth scenario also checks failed login, browser CORS preflight, credentialed
validation errors, reload, logout and rejection of a replayed session cookie.

The executable requires test mode, an explicit E2E flag and a random per-run
control token before importing application code. It overwrites inherited keys
and MongoDB settings, then creates its own loopback MongoDB process with a
random `triply_e2e_*` database. Cleanup checks the exact owned database name and
host before deleting records. Each test resets collections (including native
sessions), providers and the Fastify instance/limiters. More than one worker is
rejected. Retries receive fresh state and tests do not depend on execution order.

MongoDB runs as a single-node replica set so guest imports use real transactions.
Migration scenarios cover registration, six-trip existing-account import,
defer/resume, ownership preservation, old guest credential rejection and public
sharing. A guarded harness control injects an interruption after real transaction
writes to verify rollback and retry without mocking application HTTP routes.

A separate loopback control server on port 4002 requires the token. It seeds
users/trips, reads MongoDB directly for assertions, selects fixtures, advances
the fixture clock and holds/releases provider responses to verify loading states
without sleeps. These controls are never registered in the application API and
the executable is excluded from production builds. Global teardown requests
graceful Fastify/Mongoose/MongoDB shutdown before Playwright stops its servers.

Only this executable replaces backend `fetch`: Gemini, Open-Meteo geocoding and
weather, Overpass, Geoapify and OSRM return deterministic wire-format responses.
The actual provider adapters parse them. Every unknown URL or invalid fixture
request is recorded and fails fixture teardown, even if business logic catches
the provider exception. There is no live-network fallback. Browser `/api`
traffic is never intercepted, fulfilled or rewritten by tests. Chromium's host
resolver permits loopback and rejects external DNS (with system proxies disabled),
keeping optional remote images/map tiles offline without changing CORS behavior.

Dates start at 1 June 2030 (future cookies remain valid in Chromium's OS-based
cookie jar). The browser and backend clocks advance together past
the real weather cooldown, without changing policy or waiting ten minutes.
The API runs in UTC while the browser and Barcelona fixtures use Europe/Madrid,
so local runs also exercise the server/destination time-zone difference in CI.
The backend clock preserves native Date prototype methods as own properties:
`@date-fns/tz` discovers these methods when building its zone-aware accessors.
MongoDB's TTL monitor is disabled because its OS clock is independent; the real
session store still checks expiry on every request. Setup advances past the
process-local attraction cache lifetime. Provider/weather timers and
the scheduling pipeline remain active.

Scenarios cover:

- Authentication/session/CORS behavior after the Fastify migration.
- Barcelona's actual prompt, requirements dialog and confirmation flow (the
  existing UI has text destination fields, not an autocomplete or step wizard),
  followed by the real itinerary generation pipeline and reload.
- Prague with missing coordinates, including Overpass-to-Geoapify fallback.
- Weather outage through all provider retries, cooldown, explicit UI refresh,
  and preservation of itinerary, ordering, budget, expenses and generation.
- Rome beyond the forecast horizon, with no fabricated weather/provider call.
- Barcelona removal and keyboard reorder, warnings, reload and preservation of
  unresolved diagnostics on another day.
- Barcelona rerouting despite opening-hours conflicts, two 13:30 openings,
  unknown-hours SITAKE YA, retained attractions and persisted geometry/diagnostics.

Each mutation is checked against MongoDB independently of React Query's cache.
Unit/integration tests stay in Vitest; the API test script targets `src` so it
does not discover Playwright specs. Existing Supertest/RTL fixtures mock larger
parts of the app, so this suite reuses their fixture shapes and memory-server
dependency rather than their mocked generation/authentication behavior.

## Local validation (14 October 2026)

- Final unchanged smoke suite: **7/7 passed**, twice consecutively (51.3s, 52.3s).
- API Vitest: **594 tests passed** across 36 files.
- Frontend Vitest/RTL: **93 tests passed** across 13 files.
- `bun run typecheck`, `bun run typecheck:e2e`, `bun run build`: passed.
- `bun install --frozen-lockfile` and pinned Chromium installation verification:
  passed (402 installs checked, no dependency changes).
- GitHub Actions YAML parsed with Bun's YAML parser; permissions/job structure
  checked. `git diff --check`: passed.
- Production-mode E2E startup rejection and unlisted-provider rejection were
  also executed successfully.

The repeat run initially exposed keyboard sensor activation timing. Reordering
now waits for the handle's stable `aria-pressed=true` state before Arrow Down,
then waits for the position announcement before dropping. No sleeps or retries
were added locally.

Chromium and MongoDB ran locally from their caches. The newest Playwright browser
download initially failed DNS resolution, so the dependency is pinned to 1.63.0,
matching the cached browser. Fresh machines need network access for initial
browser/MongoDB binary installation. Windows sandbox restrictions required
escalation for browser/Vite execution. The existing Vite warning about importing
city-photo JSON from `public`, and existing build annotation/chunk-size warnings,
remain; they did not fail validation. The hosted GitHub Actions job has not been
executed locally.

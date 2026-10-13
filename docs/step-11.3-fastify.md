# Step 11.3: Express to Fastify migration

## Checklist

- [x] Audit the entire backend and framework dependencies.
- [x] Record Express test/typecheck/build baseline.
- [x] Add and run HTTP contract tests against Express before replacement.
- [x] Register the complete route inventory in Fastify.
- [x] Preserve signed cookies, existing MongoDB sessions, and lifecycle behavior.
- [x] Preserve parsing, security, authorization, limits, errors, and cancellation.
- [x] Adapt HTTP test transport while retaining behavioral assertions.
- [x] Verify complete tests, types, builds, startup, shutdown, and dependencies.

## Original architecture and audit

`src/index.ts` loads configuration, connects Mongoose, constructs `createApp()`
from `src/app.ts`, and starts Express. `src/start.ts` forces production mode and
imports that entry point. No signal handling or graceful shutdown was defined.
Configuration is validated by Zod; dev uses Bun watch, production uses Node.

Original middleware order: Helmet → credentialed CORS → trusted-origin check
for unsafe methods → strict JSON parser (100 KiB) → Mongo-backed session →
public health/auth routers → authentication for all remaining `/api` requests →
trip/location routers → centralized error handler → Express's HTML 404.
CORS preflight ends before parsing, session loading, or authentication. JSON
parsing precedes authentication. Unknown `/api` routes require authentication,
including unknown auth routes after the public auth router falls through.

No URL-encoded parser, cookie-parser, file uploads, webhooks, raw-body routes,
SSE, streaming responses, or recurring background jobs were found. Generation
and provider calls run inside async HTTP requests. Weather refresh cancels its
provider request when the response connection closes before completion.
Logging is existing console-based startup/domain/error logging, with no HTTP
request logger. Services, models, provider adapters, and shared contracts are
independent of Express. Zod validation remains inside handlers.

Express-specific runtime dependencies: express, express-session, connect-mongo
(which extends express-session.Store), express-rate-limit, cors, helmet.
Five HTTP test files after adding the contract suite use Supertest, with four
existing route suites. Three existing suites mock the Express limiter.

Session format: cookie `triply.sid`, URL-encoded `s:<id>.<HMAC-SHA256 base64>`
without base64 padding; session IDs are random. Cookie path `/`, HttpOnly,
SameSite=Lax, Secure in production, rolling seven-day expiry, no domain.
MongoDB `sessions` records use string `_id`, JSON-string `session`, Date `expires`,
and Date `lastModified`. Native TTL index on `expires`; unchanged sessions touch
storage at most once per 24 hours. Sessions are not created for anonymous visits.
Registration/login rotate IDs; logout deletes storage and expires the cookie.

GitHub Actions installs the frozen Bun lockfile, checks types, runs API/frontend
tests directly, builds production artifacts, and checks repository integrity.
No lint script or browser E2E infrastructure exists. Docker Compose supplies
MongoDB only. Vite proxies `/api` and `/health`; production needs external hosting
and reverse-proxy routing. No frontend changes are required by this migration.

## Express baseline (2026-10-13)

- API: **556 passed**, 34 files.
- Frontend: **93 passed**, 13 files. Total: **649 passed**.
- New HTTP compatibility suite: **17 passed** against Express.
- Root typecheck passed for all three packages.
- Root production build passed from Turbo cache; direct API build passed;
  direct frontend production build passed outside the sandbox.
- Frontend's sandboxed direct build could not read ancestor directories in
  esbuild; rerunning outside the sandbox succeeded. This is an environment
  restriction, not a migration regression.
- Existing frontend build warnings: Zod pure annotations and bundle size.

## Endpoint inventory

All paths below are full paths. `owned` means session plus trip ownership;
inaccessible trips retain existing not-found behavior. Schemas named below are
the existing shared Zod contracts, unless marked local. Normal responses retain
existing serializers, including nulls, optional fields, and ISO dates.

| Method | Path | Access / validation | Success | Expected handler errors / special handling |
| --- | --- | --- | --- | --- |
| GET (+ HEAD) | `/health` | Public | 200 status/db/uptime/timestamp/version | No anonymous session |
| POST | `/api/auth/register` | Public, local credentials schema | 201 `{ user }` | 400 invalid credentials, 409 duplicate; auth limit, rotate/save session |
| POST | `/api/auth/login` | Public, local credentials schema | 200 `{ user }` | 400 invalid input, 401 bad credentials; auth limit, rotate/save session |
| POST | `/api/auth/logout` | Public | 204 empty | Delete session and expire cookie |
| GET (+ HEAD) | `/api/auth/session` | Session, live user | 200 `{ user }` | 401; Cache-Control no-store |
| GET (+ HEAD) | `/api/location/search` | Session; first `q` query value | 200 coordinates/city/country/displayName | 404 location unavailable |
| GET (+ HEAD) | `/api/trips` | Session; tripListQuerySchema | 200 summary array | 400 filter; owned list sorted newest first |
| POST | `/api/trips/analyze` | Session; analyzeTripRequestSchema | 200 analysis/draft/missing requirements | 400; planning limit, AI and draft persistence |
| PATCH | `/api/trips/:id/requirements` | Owned; updateTripRequirementsSchema | 200 analysis result | 400, 404, 409 state conflict |
| GET (+ HEAD) | `/api/trips/:id` | Owned; ObjectId | 200 trip detail including quality | 404; weather/attraction backfill |
| POST | `/api/trips/:id/weather/refresh` | Owned; ObjectId | 200 weather refresh result | 404; cancel on premature response close |
| GET (+ HEAD) | `/api/trips/:id/equipment` | Owned; ObjectId | 200 `{ equipment }` | 404; exposed service errors |
| POST | `/api/trips/:id/equipment` | Owned; createTripEquipmentItemSchema | 201 item | 400, 404 |
| PATCH | `/api/trips/:id/equipment/:itemId` | Owned; ObjectIds, updateTripEquipmentItemSchema | 200 item | 400, 404 |
| DELETE | `/api/trips/:id/equipment/:itemId` | Owned; ObjectIds | 204 empty | 404 |
| POST | `/api/trips/:id/confirm` | Owned; ObjectId, complete requirements | 200 trip detail | 400 with missingFields, 404 |
| POST | `/api/trips/:id/generate` | Owned; generation requirements | 200 trip detail | 400/404/409/502; generation lock, idempotent ready state |
| POST | `/api/trips/:id/days/:dayId/regenerate` | Owned; positive day, regenerateDayRequestSchema | 200 preview | 400/404/409/422 with warnings; planning limit |
| POST | `/api/trips/:id/days/:dayId/apply` | Owned; applyRegenerationRequestSchema | 200 trip detail | 400/404/409/410; preview/version guard |
| POST | `/api/trips/:id/itinerary/edit` | Owned; itineraryEditRequestSchema | 200 edit result and trip | 400/404/409 etc.; error retains warnings/conflicts/issues |
| POST | `/api/trips/:id/itinerary/candidates` | Owned; itineraryCandidatesRequestSchema | 200 candidates result | 400/404 etc.; planning limit |
| GET (+ HEAD) | `/api/trips/:id/assistant/conversations` | Owned | 200 conversation result | ItineraryEditError status and message |
| GET (+ HEAD) | `/api/trips/:id/assistant/conversations/:conversationId` | Owned | 200 conversation result | ItineraryEditError status and message |
| POST | `/api/trips/:id/assistant/messages` | Owned; assistantMessageRequestSchema | 200 assistant result | 400 and service statuses; planning limit |
| POST | `/api/trips/:id/assistant/actions/:previewId/apply` | Owned; UUID-shaped preview ID | 200 edit result and trip | 400/404/409/410 etc. |
| DELETE | `/api/trips/:id/assistant/actions/:previewId` | Owned; UUID-shaped preview ID | 204 empty | 400 and service statuses |
| GET | `/api/trips/:id/expenses` | Owned | 200 budgetData | ItineraryEditError status and message |
| POST | `/api/trips/:id/expenses` | Owned; expenseCreateSchema | 201 budgetData | 400/404/409 etc.; expectedRevision, requestId |
| PATCH | `/api/trips/:id/expenses/:expenseId` | Owned; UUID-shaped ID, expenseUpdateSchema | 200 budgetData | 400/404/409 etc.; invalid ID falls through to HTML 404 |
| DELETE | `/api/trips/:id/expenses/:expenseId` | Owned; revision-only body | 200 budgetData | 400/404/409 etc.; invalid ID falls through to HTML 404 |
| GET | `/api/trips/:id/budget` | Owned | 200 budgetData | ItineraryEditError status and message |
| PATCH | `/api/trips/:id/budget` | Owned; budgetUpdateSchema | 200 budgetData | 400/404/409 etc.; expectedRevision |

Expense routes originally use method-dispatch middleware: unlike ordinary GET
routers they do not provide implicit HEAD, and their exact suffix matching does
not accept a trailing slash. Other routers are case-insensitive and accept
trailing slashes. Preserve these edge cases as well as normal frontend calls.

Common errors: untrusted unsafe origin 403 `{ error }`; malformed strict JSON
400 with parser message; oversized JSON 413 `request entity too large`;
missing/deleted-user session 401 `Authentication required`; unexpected async or
database errors 500 `Internal server error`. Existing exposed application errors
retain status/message. Unknown public paths or authenticated unknown API paths
return Express-compatible HTML 404; unauthenticated unknown API paths return 401.
Auth has one shared 10/15-minute per-IP limit; selected planning endpoints share
20/10-minute per-user limit. Both use draft-8 headers and JSON 429 messages.
Quality is part of trip details and assistant behavior, not a separate route.

## Migration implementation

Fastify 5 replaces Express throughout the HTTP layer. The async `createApp()`
factory registers plugins and every route, waits for readiness, and opens no
network port. `startServer()` separately connects MongoDB and starts one listener.
Closing it drains HTTP requests, removes signal handlers, and disconnects MongoDB;
repeated closes share the same promise. Failed startup also releases MongoDB.

Services, AI/provider adapters, Mongoose models, shared contracts, frontend calls,
and domain tests are unchanged. All **32 explicit method/path combinations** in
the inventory are registered and checked through the real Fastify application.
Existing implicit HEAD behavior is retained, including expense-route exceptions.

| Express behavior | Fastify implementation |
| --- | --- |
| Helmet, CORS, preflight, unsafe-origin guard | Official Helmet/CORS plugins and ordered `onRequest` hooks |
| Strict JSON, compressed bodies, Unicode charsets, 100 KiB limit | `preParsing` decompression and custom JSON parser using the original iconv-lite decoder |
| Ignored non-JSON bodies | Fallback parser drains the body without interpreting it |
| Mongo session load after JSON parsing | Native session `preValidation` hook and existing-format Mongo store |
| Authentication and shared route limits | Protected plugin/route `preHandler` hooks; official rate-limit counter with compatible fixed windows and draft-8 headers |
| Rolling session persistence and cookie | `onSend` hook; official cookie plugin with the original signing and URL encoding |
| Zod validation and existing JSON payloads | Existing handler validation and serializers; no response schema that strips fields |
| Async errors and router fallthrough | Central error handler and compatible HTML not-found handler |
| Weak ETags and conditional requests | Response compatibility hook retaining 304 behavior |
| Weather cancellation | Existing response-close listener on the underlying Node response |

Malformed parameter URLs are kept inside the security/body/session/auth lifecycle
rather than receiving Fastify's early default error. Authenticated malformed
parameters retain the old 400 payload; anonymous requests retain 401. Raw expense
suffix matching, query arrays, case handling, and trailing slashes retain their
original behavior. Unexpected exceptions return a safe 500 payload; expected
service errors, conflicts, and provider failures retain their existing responses.

## Authentication and session compatibility

Native session hooks preserve the existing storage protocol rather than changing
authentication architecture. The official session plugin's lifecycle/storage
behavior would differ from the current setup. Existing signed cookies and MongoDB
session records are accepted directly, including lazy-touch records whose stored
cookie expiry is older than their active database expiry. No session migration or
forced logout is required. Session IDs, signature, attributes, renewal, rotation,
logout, TTL index, and 24-hour touch interval retain their previous semantics.

`@fastify/cookie` is pinned to **11.0.2**: a newer serializer changed raw cookie
encoding during verification. Preserve this pin unless the compatibility tests
are updated against a verified equivalent implementation. Secure production
cookies retain the original trusted-proxy/first-forwarded-protocol behavior.
Origin protection and credentialed, restricted CORS remain in place.

## Files changed

- Application/startup: `apps/api/src/app.ts`, `index.ts`; new `server.ts`.
- Sessions: `config/session.ts`; new `config/mongoSession.ts`.
- HTTP/security: `middleware/auth.ts`, `error.ts`; new `notFound.ts`,
  `rateLimit.ts`, `rateLimitStore.ts`, and `http/{types,body,response,url}.ts`.
- Routes: `routes/{auth,health,location,trips,expenses}.ts`.
- Tests: four existing trip HTTP suites; new `http.contract.test.ts` and
  `server.test.ts`.
- Dependencies: `apps/api/package.json`, `bun.lock`.
- Documentation: `README.md`, the backend stack entry in `AGENTS.md`, and this report.

Existing Supertest assertions now target `app.server` after factory readiness.
Apps close before test MongoDB connections. Domain-suite limiter mocks remain
isolated; new HTTP tests exercise actual counters and shared scopes. Database
isolation and external provider mocks remain unchanged. The first 17 HTTP
compatibility tests passed against Express before implementation replacement.

## Final verification (2026-10-13)

| Check | Executed result |
| --- | --- |
| Root `bun run test` | **594 API tests** in 36 files and **93 frontend tests** in 13 files passed: **687 total**, up from 649 |
| Focused HTTP/session/server suites | **38 passed**; 36 HTTP contract tests and two server lifecycle tests |
| Root `bun run typecheck` | All three packages passed |
| Root `bun run build` | API compiled; shared/frontend existing artifacts validated from Turbo cache; direct frontend build also passed during baseline |
| Frozen Bun install | `bun install --frozen-lockfile --offline` succeeded without modifying the lockfile |
| Diff integrity | `git diff --check` passed |
| Original-vs-migrated HTTP comparison | **54/54 matched** for status, response body, and security/CORS headers; timestamp/uptime and transport/cache/cookie headers excluded from this comparison and covered separately where applicable |
| Route inventory | Every explicit method/path registered; all 27 trip/location routes reject unauthenticated requests |
| Development | Independent `bun run dev:api` and root `bun run dev --env-mode=loose` smoke tests passed |
| Vite integration | Health and full cookie-auth flow passed through the frontend proxy |
| Production | API `bun run start` passed health, registration, cookie, authenticated request, and logout/rejection |
| Shutdown | SIGINT and SIGTERM production smoke tests exited with code 0 and released the HTTP listener; lifecycle tests verify Mongo disconnect, failed startup cleanup, and idempotent close |
| Source/dependency audit | No active Express imports, type packages, or lockfile dependencies remain |

Startup smoke tests used an isolated temporary MongoDB database and test-only
credentials, with Bun **1.3.14** and Node **24.11.1**. Loose Turbo environment mode
was used only to pass the smoke harness's isolated database configuration through
the existing strict filter; production/dev scripts and Turbo configuration were
not changed. Original signed-session fixtures work across separate application
instances. Tests cover login/session/logout, rotation, expired/tampered/deleted-user
sessions, cookie renewal, shared rate limits, conflicts, parser failures, CORS,
protected/unknown routes, and safe asynchronous database failures.

GitHub Actions was reviewed: its frozen install, direct API/frontend test commands,
typecheck, build, and integrity checks remain applicable. The remote workflow was
not executed. No existing baseline test/typecheck failure was found.

## Deployment and remaining limits

Deploy rebuilt API artifacts and install the updated frozen Bun lockfile. Fastify
5 requires Node.js 20 or newer; use a currently supported runtime. Preserve the
existing production session secret, MongoDB database, frontend origin, HTTPS, and
trusted-proxy setup. No database migration or frontend deployment change is
required. All Express runtime dependencies and Express type packages are removed.

Rate-limit counters remain process-local, as before. Provider behavior was checked
with existing mocks rather than live paid services. Windows signal smoke tests
delivered SIGINT/SIGTERM to the production process through IPC and verified a clean
exit and released listener; an actual deployment's service manager was not tested.
The repository has no lint command or browser E2E suite. Existing frontend bundle
size/Zod annotation warnings and Turbo's sandbox Git ownership warning remain.

# Triply #22A — Technical quality audit

Audit date: 2026-11-07. Scope: repository-visible implementation and existing local diagnostic artifacts. Audit only; no remediation implemented.

## Executive summary

Triply has substantial domain logic and meaningful integration tests. Its strongest work is in deterministic scheduling, explicit degraded-provider behavior, shared request schemas, ownership checks, and Journey expense integrity. The application is not yet ready for an unqualified production-readiness sign-off. Remaining risks concern crash recovery, inconsistent mutation boundaries, resource admission, UI availability, and operations.

The register contains **23 findings: 0 Critical, 3 High, 14 Medium, 6 Low**. Severity describes the repository-visible risk, not evidence of a production incident. Confidence is separate from severity. Static traces establish reachable failure conditions; they do not establish frequency in production.

Main strengths:

- Itinerary edits use expected versions and atomic writes; visit and budget revisions protect independently changing data.
- Automatic admission expenses have durable pending receipts and permanent tombstones, conservative price eligibility, and recovery for uncertain acknowledgments. Resetting a visit does not erase actual spending.
- Guest import uses transactions and durable identity fences; standalone MongoDB refusal is covered.
- Provider tests cover real failure semantics: valid empty Overpass results, credit reservations, Retry-After, timeouts, weather exclusions and fallback estimates without fabricated geometry.
- CI defines frozen Bun installs, typechecks, tests, production builds, isolated Chromium shards, and seven-day failure artifacts.

Top five priorities:

1. Make guest activity fencing recover safely from process death (#22A-01).
2. Apply admission/concurrency controls to expensive authenticated generation and geocoding (#22A-02).
3. Replace unguarded read-triggered attraction persistence with a guarded update (#22A-03).
4. Restore a truthful Assistant availability contract across the product, documentation, and browser suite (#22A-04).
5. Make ready-trip and Budget data converge between tabs (#22A-05).

Limitations: no production database, live AI/Places/weather/routing calls, dependency installation, build, browser session, or test-suite execution. Direct no-emit TypeScript checks passed for all three workspaces. Existing test outcomes and bundle sizes are historical evidence, explicitly labeled below. No complete automated dependency-cycle, dead-code, vulnerability, bundle, contrast, or runtime performance analysis was performed. Secret-bearing environment files were not read. Production infrastructure outside this repository is unknown.

## Repository inventory

| Area | Actual structure and responsibilities |
| --- | --- |
| Frontend | `apps/web`: React 19, Vite, strict TypeScript, React Router, MUI/Emotion, TanStack Query, React Hook Form, Leaflet, dnd-kit, EN/PL i18next resources. `App.tsx` composes routes; pages coordinate hooks, API clients and domain adapters. |
| Backend | `apps/api`: Fastify factory in `src/app.ts`; lifecycle in `server.ts`; Mongoose models, route registration, identity/session middleware, services, plain-fetch AI and routing adapters. Production entry `start.ts` selects production before importing startup. |
| Shared package | `packages/shared`: Zod request schemas, DTOs, discriminated visit/expense contracts, money/date helpers, catalog and curated collections, scheduling and quality types. Compiles to `dist`; development export selects source. No separate test script. |
| Persistence | Models: Trip, User, Destination, SavedDestination, SavedAttraction, TripAssistantConversation, ApiUsage; GuestHandoff uses a raw collection. Session storage, guest usage and packing leases also use MongoDB collections. Trip embeds itinerary, weather, candidate pool, visits, receipts, expenses and packing. |
| API | Authentication/profile; public destinations/collections; owned trips/analyze/requirements/confirm/generate; weather refresh; itinerary candidates/edit; day preview/apply; visits/retry; expenses/allocations; packing/context/bulk/generate/apply; saved destinations/attractions; assistant; sharing; PDF/ICS; location search; health. Registration and protection boundaries are visible in `apps/api/src/app.ts:82–106`. |
| Tooling | Bun 1.3.14, one `bun.lock`, Turbo task graph, workspace TypeScript, Vitest/jsdom/Testing Library, Supertest/inject, mongodb-memory-server and Playwright. No lint script or ESLint configuration found. |
| CI | `.github/workflows/ci.yml`: validation job plus four Chromium shards; browser servers own disposable MongoDB and do not reuse development servers. No deployment workflow found. |
| Deployment | MongoDB-only `docker-compose.yml`, replica set for transactions, persistent volume. No application Dockerfile, infrastructure deployment manifest, backup/restore runbook or rollback procedure found in reviewed files. Static frontend needs hosting and API forwarding. |
| Documentation | Root README and AGENTS; `.github/CI.md`; API PDF/calendar guides; provider and seed guides; Journey 21A–21D reports; localization/UX reports; `docs/testing-audit.md`; web i18n README/AUDIT. Root README contains material stale statements. |
| Diagnostics | 53 root dot-log files totaling 1,776,016 bytes; generated `.turbo` logs; ignore rules for runtime/test artifacts. No tracked `.log`, screenshot or generated report found by the audit's Git inventory. |

### Business-flow map

| Domain | Implementation path | Important boundary |
| --- | --- | --- |
| Trip generation | HomePage → useTripAnalysis/useTripGeneration → routes/trips → tripDraft/tripGeneration → tripPlanner | AI extracts requirements; deterministic services produce itinerary; claim and completion guard against superseded runs. |
| Attraction discovery | attractions → Overpass; geoapify/geoapifyUsage fallback; poiFiltering/Scoring/Clustering | Valid empty data differs from failure; per-trip cache plus bounded process cache; fallback spending reserved in MongoDB. |
| Geocoding | routes/location → location; tripDestination recovery; catalogDestination | Open-Meteo city search, country/ambiguity checks and validated coordinates. |
| Weather | weather/weatherPolicy → tripWeather → useTripWeather | Horizon and stale snapshots are modeled explicitly; refresh uses narrow CAS and shared cancellation. |
| Scheduling/routing | tripPlanner → routePlanning/routeOptimizer → OSRM; scheduling/openingHoursPlanning | Time-zone-aware scheduling, bounded optimization passes, approximation fallback. |
| Editing | TripTimeline → useItineraryEditing → tripItineraryEditor | Shared operations, server-owned candidates, recalculation, version/visit/budget checks. |
| Day regeneration | RegenerateDayDialog → tripRegeneration preview/apply | Stored preview, 30-minute TTL, base itinerary version and visited-item protection. |
| Journey/visit tracking | TripPage/JourneyDay/VisitControls → useTripVisits → tripVisits | Stable UUID occurrences; visit CAS; retired records excluded from progress. |
| Automatic expenses | tripVisits → automaticVisitExpenses → budgetSummary | Visit and pending receipt persisted together; expense/receipt completion is one document CAS. |
| Budget | TripBudgetCard/useTripBudget → routes/expenses → expenses/budgetSummary | Integer minor units, currency-separated totals, request UUID and budget revision. |
| Saved trips | MyTripsPage/useTrips → GET/DELETE trips | Owner-scoped persistence; presently unbounded listing. |
| Guest Mode | session/tripIdentity/guestActivity/guestLimits/guestMigration | Tagged owners, explicit route allowlist, quota ledger, unique storage slots, transaction-backed import. |
| Explore | ExplorePage/CollectionPage → destinations/destinationDiscovery → Destination | Catalog validation, indexed normalized fields, pagination and query deadlines. |
| Saved ideas | SavedPage → saved/savedAttractions | Unique owner/identity indexes; source attraction must belong to an owned trip. |
| Packing | TripEquipmentPage/PackingSuggestions → equipment/packing | Atomic manual writes; signed owner/trip-bound previews; cross-process lease; review before apply. |
| Trip Assistant | TripAssistant/useTripAssistant → tripAssistantService/assistantIntent/Context/Budget | Backend exists, UI mount is commented out; proposed writes use validated operations. |
| Attachments | HomePage file input/local File[] | Selected filenames only; no file content submitted, no PDF/TXT ingestion contract found. PDF routes export documents. |

## Findings register

Locations below use repository-relative paths and source line numbers from this audit snapshot.

| ID | Severity | Category | Location | Finding | Confidence | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| #22A-01 | High | Crash recovery/data integrity | `apps/api/src/middleware/guestActivity.ts:7`; `apps/api/src/services/guestMigration.ts:127` | Guest request markers have no recoverable lease | High | M |
| #22A-02 | High | Security/resource limits | `apps/api/src/routes/trips.ts:498`; `apps/api/src/routes/location.ts:7` | Expensive authenticated generation/search lacks appropriate admission controls | High | M |
| #22A-03 | High | Concurrency | `apps/api/src/services/tripDraft.ts:383` | Read-triggered attraction backfill saves a stale document without CAS | High | M |
| #22A-04 | Medium | Product/test contract | `apps/web/src/pages/TripPage.tsx:664` | Assistant is unavailable despite documented/tested behavior | High | S |
| #22A-05 | Medium | Frontend consistency | `apps/web/src/query/queryClient.ts:8`; `apps/web/src/hooks/useTrips.ts:40` | Ready-trip/Budget caches do not converge on tab focus | High | S |
| #22A-06 | Medium | Generation reliability | `apps/api/src/services/tripGeneration.ts:29`; `apps/api/src/services/routePlanning.ts:61` | Fixed stale lease is disconnected from total planning duration | High | M |
| #22A-07 | Medium | Observability | `apps/api/src/app.ts:44`; `apps/api/src/middleware/error.ts:29` | Failed requests cannot be reliably correlated or reconstructed | High | M |
| #22A-08 | Medium | Logging/privacy | `apps/api/src/ai/providers/gemini.ts:86`; `apps/api/src/ai/providers/openrouter.ts:115` | Raw provider error text enters logs | High | S |
| #22A-09 | Medium | Error contracts/i18n | `apps/api/src/middleware/error.ts:20`; `apps/web/src/i18n/errors.ts:21` | Typed AI error codes are lost at HTTP boundary | High | S |
| #22A-10 | Medium | Runtime contracts | `apps/web/src/api/client.ts:36`; `apps/api/src/ai/providers/gemini.ts:84` | Type assertions substitute for boundary validation | High | M |
| #22A-11 | Medium | Database performance | `apps/api/src/routes/trips.ts:285`; `apps/api/src/routes/savedAttractions.ts:11` | Unbounded owned lists hydrate large records | High | M |
| #22A-12 | Medium | Frontend recovery | `apps/web/src/main.tsx:13`; `apps/web/src/App.tsx:18` | No application render-error recovery boundary found | High | S |
| #22A-13 | Medium | Mutation recovery | `apps/api/src/services/tripAssistantService.ts:150` | Assistant consumes preview before applying mutation | High | M |
| #22A-14 | Medium | Operations | `apps/api/src/routes/health.ts:7` | Health always returns HTTP success even when DB disconnected | High | S |
| #22A-15 | Medium | Local database security | `docker-compose.yml:5` | Unauthenticated MongoDB published on all host interfaces | High | XS |
| #22A-16 | Medium | Frontend delivery | `apps/web/src/App.tsx:5`; `.ui-monorepo-build-final.log:262` | Eager routes and historically large initial bundle | High | M |
| #22A-17 | Low | Test quality | `apps/api/e2e/hardeningVisual.spec.ts:18` | Screenshot capture provides no visual comparison gate | High | S |
| #22A-18 | Low | Tooling | `package.json:11`; `.github/workflows/ci.yml:55` | No static lint gate | High | S |
| #22A-19 | Low | Developer documentation | `README.md:273` | README contradicts implemented E2E and persistent features | High | S |
| #22A-20 | Low | Diagnostics hygiene | `.gitignore:9`; `docs/journey-21d.md:65` | Local diagnostics lack provenance/retention index | High | S |
| #22A-21 | Medium | Product integrity | `apps/web/src/pages/HomePage.tsx:270` | Attachments appear accepted but have no planning effect | High | S |
| #22A-22 | Low | Architecture/naming | `apps/api/src/services/tripItineraryEditor.ts:4`; `apps/api/src/services/tripVisits.ts:6` | Cyclic services and misleading side-effect boundaries | High | M |
| #22A-23 | Low | Localization consistency | `apps/api/src/services/tripDraft.ts:507`; `apps/api/src/services/tripItineraryEditor.ts:76` | Some discovery/requirements calls drop trip locale | High | S |

### Detailed evidence and remediation

Every entry includes impact, remediation, effort, regression risk and verification status. High confidence means the stated implementation was inspected; conditional impacts remain conditional.

#### #22A-01 — Guest activity cannot recover from process death

- **Category / severity / confidence:** Crash recovery/data integrity / High / High.
- **Evidence:** `apps/api/src/middleware/guestActivity.ts:7–20` pushes random request IDs into `activeRequests` and only removes them in completion hooks (`:24–35`). `apps/api/src/models/GuestHandoff.ts:6,22–25` stores bare strings and a 30-day whole-record cleanup time, without request expiration/heartbeat. `apps/api/src/services/guestMigration.ts:102,127–130` treats any marker as busy and blocks import. Import context lasts 15 minutes (`:15`). A crash after acquisition prevents completion hooks from clearing the marker.
- **Impact:** A guest with preserved trips can receive repeated retry instructions without a path to complete import during the handoff window. This is a recovery failure, not evidence that data is deleted.
- **Remediation:** Use bounded, fenced activity leases with safe expiration/renewal and documented restart recovery. Expiration must not allow a still-running old writer to bypass the import fence.
- **Effort / regression risk:** M / High: identity and import serialization must remain intact.
- **Verification:** Static crash trace confirmed. Existing busy-request test at `apps/api/src/routes/guestMigration.routes.test.ts:244–251` manually removes the marker; it does not simulate restart recovery. No process-kill experiment executed.

#### #22A-02 — Resource admission differs by identity and process

- **Category / severity / confidence:** Security/resource limits / High / High.
- **Evidence:** `apps/api/src/routes/trips.ts:498` invokes the planning limiter for guests only on full generation. `apps/api/src/app.ts:79` disables global rate limiting. `apps/api/src/routes/location.ts:7–13` forwards search without route rate limiting or a bounded query schema. `apps/api/src/services/location.ts:20–29` deduplicates identical simultaneous searches but does not limit distinct queries. `apps/api/src/middleware/rateLimitStore.ts:5–22` keeps counters in a process-local Map. Existing planning limits are 20/10 minutes (`rateLimit.ts:33`).
- **Impact:** Authenticated callers can start expensive planning for multiple drafts without that limiter; distinct geocoding requests can amplify external traffic. Existing per-trip generation claims prevent duplicate ownership of one run, not account-wide concurrency. Multi-process limits multiply unless infrastructure supplies a shared gate.
- **Remediation:** Define explicit identity/IP limits and bounded concurrency for generation/search; validate search length; choose a shared store or document/enforce single-instance assumptions. Preserve guest quota accounting independently.
- **Effort / regression risk:** M / Medium: avoid blocking normal retries or charging rejected guest work.
- **Verification:** Static route/middleware trace confirmed; no abuse or live-load test. External ingress controls unknown.

#### #22A-03 — Attraction backfill bypasses the guarded write pattern

- **Category / severity / confidence:** Concurrency / High / High.
- **Evidence:** `apps/api/src/routes/trips.ts:310–312` makes GET detail perform weather and attraction backfill. `apps/api/src/services/tripDraft.ts:383–415` awaits provider work, then assigns the candidate array and clustering and calls `trip.save()` without status, owner, input-snapshot or itinerary-version predicates. The ready-trip shortcut at `:388` excludes only ready trips with a nonempty candidate pool. Explicit candidate discovery appends via `tripItineraryEditor.ts:87–91` without advancing Mongoose `__v`; generation commits via `tripGeneration.ts:270–289` advance domain revisions, not `__v`.
- **Impact:** A draft backfill started before a requirements/generation write can subsequently save old-location candidates/clustering. For an eligible legacy ready trip, a concurrent explicit candidate discovery can be replaced by the older backfill result. Ordinary Mongoose array versioning is not the same protection as the application's CAS predicates.
- **Remediation:** Persist a narrow update guarded by owner, status and relevant input/version snapshot; discard stale backfill results. Separate read serialization from optional enrichment where practical.
- **Effort / regression risk:** M / High: preserve legacy recovery, candidate discovery and lazy weather behavior.
- **Verification:** Static interleaving confirmed; no MongoDB race reproduction executed. Do not infer that all GET requests overwrite edits.

#### #22A-04 — Assistant is disconnected from TripPage

- **Category / severity / confidence:** Product/test contract / Medium / High.
- **Evidence:** `apps/web/src/pages/TripPage.tsx:51` imports TripAssistant but its mount at `:664` is inside a JSX comment. `apps/api/e2e/tripExperience.spec.ts:60–64` expects its trigger/panel. Also expected by accessibility (`accessibility.spec.ts:41`), localization (`aiLocalization.spec.ts:96`), mobile (`mobileExperience.spec.ts:168`) and UX tests (`uxHardening.spec.ts:126`). `README.md:85–87` describes assistant editing. `docs/journey-21d.md:74` records the same browser failure.
- **Impact:** Users cannot reach the implemented Assistant through the Trip page; multiple full-suite tests have an unsatisfied product assumption. Standalone component tests can remain green.
- **Remediation:** Decide the supported availability contract, then restore the mount or explicitly retire/gate the feature and update all affected requirements. Do not merely delete the failing assertion. No retirement decision was found in reviewed documentation.
- **Effort / regression risk:** S for availability alignment, potentially M for resulting defects / Medium: reactivation exposes existing integration/recovery paths.
- **Verification:** Current source contradiction confirmed; historical browser failure corroborates it. This is a genuine current feature-availability regression relative to repository documentation/tests, not proven stale test wording. The intent behind disabling it is unknown. Browser suite not rerun.

#### #22A-05 — Ready-trip cross-tab refresh is missing

- **Category / severity / confidence:** Frontend consistency / Medium / High.
- **Evidence:** `apps/web/src/query/queryClient.ts:6–8` sets a one-minute stale time but disables focus refetch. `apps/web/src/hooks/useTrips.ts:40–43` polls only generating trips; `useTripBudget.ts:10–14` supplies no focus/poll override. No trip/Budget broadcast subscription was found. AuthProvider explicitly refreshes identity, which does not itself refresh unchanged-identity trip data. `docs/journey-21d.md:89,104` assumes focus/refetch convergence.
- **Impact:** Two mounted ready-trip tabs can show different visit locks, progress and spending indefinitely until navigation/manual refetch/another invalidation. Stale time alone schedules no fetch. Backend CAS protects writes, but user-visible state remains misleading.
- **Remediation:** Add an explicit ready-trip/Budget focus or cross-tab invalidation policy, preserving independent revision merging and identity isolation.
- **Effort / regression risk:** S / Medium: GET can trigger enrichment, so bound refetch frequency and avoid provider amplification.
- **Verification:** Static query policy confirmed; no two-tab browser run. Add a real two-context convergence test with unchanged identity.

#### #22A-06 — Generation lease and runtime budget are unrelated

- **Category / severity / confidence:** Generation reliability / Medium / High.
- **Evidence:** `apps/api/src/services/tripGeneration.ts:29,62–73` allows takeover after two minutes. `runTripGeneration(:202–250)` has no overall deadline or cancellation signal. `routePlanning.ts:61–71` awaits routing for each day serially; `tripPlanner.ts:57–64` can perform additional opening-hours routing. Per-provider timeouts bound individual calls, not the whole trip. The generation HTTP path `routes/trips.ts:553–565` has no disconnect cancellation, unlike packing/weather paths.
- **Impact:** A sufficiently slow or long valid plan can still be running when declared abandoned. CAS prevents the superseded result overwriting the winner, but duplicate provider/CPU work and retry conflicts remain possible. Client disconnects can leave planning running.
- **Remediation:** Introduce an end-to-end deadline, cancellation propagation and compatible lease heartbeat/fencing or a job lifecycle. Measure long-trip budgets before choosing values.
- **Effort / regression risk:** M / Medium–High: preserve useful partial provider fallbacks and supersession protection.
- **Verification:** Control-flow mismatch confirmed; frequency and worst-case duration unmeasured. No claim that all requests exceed two minutes.

#### #22A-07 — Diagnostics lack request correlation

- **Category / severity / confidence:** Observability / Medium / High.
- **Evidence:** `apps/api/src/app.ts:44` disables Fastify logging. `middleware/error.ts:11,29` discards request context and logs only the exception name. Generation stage objects at `services/tripGeneration.ts:214,224,251,263,298` have timings/status but no request ID or run identifier. `automaticVisitExpenses.ts:76–80` reconciles exceptions but records no diagnostic cause. Overpass emits both structured-ish console objects and text (`attractions.ts:304–306`).
- **Impact:** Concurrent failed trip generations cannot reliably be reconstructed from log stages. Automatic-expense recovery is robust in storage, but operators cannot distinguish validation, capacity or driver failure from those logs. Failure counts based on console error level are noisy because fallback success can also use it (`attractions.ts:286`).
- **Remediation:** Emit a consistent redacted event envelope with request/run correlation, stage, duration, provider, stable error category and outcome; include a support-safe correlation ID in errors. Define retention and destination.
- **Effort / regression risk:** M / Medium: protect prompts, identities, URLs and secrets while improving context.
- **Verification:** Static logging inventory confirmed; production log collector/monitoring unknown.

#### #22A-08 — Provider errors bypass redaction policy

- **Category / severity / confidence:** Logging/privacy / Medium / High.
- **Evidence:** `apps/api/src/ai/providers/gemini.ts:86–90` and `openrouter.ts:115–119` print `payload.error.message` verbatim. `services/tripGeneration.ts:302–305` prints arbitrary error messages. This differs from the sanitization intent documented in `middleware/error.ts:28–29`.
- **Impact:** Provider/driver error content can contain request fragments or identifiers and enter retained logs. No secret value or actual credential leak was established; the risk is an uncontrolled logging boundary.
- **Remediation:** Log validated provider/status/error categories; omit or sanitize bounded diagnostic text centrally. Add malicious/sensitive-looking provider-error fixtures.
- **Effort / regression risk:** S / Low–Medium: retain actionable categories without raw payloads.
- **Verification:** Raw logging confirmed statically; historical log samples did not establish a leak. Environment values were not inspected or copied.

#### #22A-09 — Error taxonomy is not preserved end to end

- **Category / severity / confidence:** Error contracts/i18n / Medium / High.
- **Evidence:** `apps/api/src/ai/errors.ts:17–28` defines provider/code/status. The exposed-error branch in `middleware/error.ts:20–22` sends only `error`, dropping code. `apps/web/src/i18n/errors.ts:14–24` uses code/status rather than backend text; 504 and generic 502/503 AI failures fall through to unexpected error. Visit handlers also return message-only conflicts (`routes/trips.ts:79–92`). Guest errors and destination routes use a different coded convention.
- **Impact:** Timeouts, missing configuration and provider overload lose semantic recovery guidance and consistent localization. Same numeric conflict status represents both stale edits and visited locks.
- **Remediation:** Adopt shared safe error envelopes/codes; preserve existing code contracts during migration; map timeout/unavailability/locked/stale distinctly in EN/PL. Do not expose raw provider details.
- **Effort / regression risk:** S / Medium: synchronize API, clients, localization and contract tests.
- **Verification:** Static response-to-UI trace confirmed. No production response observed.

#### #22A-10 — Runtime boundary validation is incomplete

- **Category / severity / confidence:** Runtime contracts / Medium / High.
- **Evidence:** `apps/web/src/api/client.ts:19–36` converts invalid JSON to null and returns successful bodies via `as T`; `api/trips.ts:47–48` trusts TripDetail. Budget only checks three top-level properties (`hooks/useTripBudget.ts:11–12`). AI adapters cast unknown envelopes (`gemini.ts:84`, `openrouter.ts:113`) and then invoke `parts.map`/`content.trim` outside their JSON parsing catches (`:29,98` and `:58,127`).
- **Impact:** A 200 HTML/null response can reach render code; malformed provider envelopes can raise TypeError rather than the established invalid-response taxonomy. Shared TypeScript DTOs do not validate network bytes. Normalized AI analysis and Geoapify/location schemas do provide stronger validation downstream.
- **Remediation:** Validate critical trip/budget/visit responses and AI envelope fields at boundaries using existing Zod patterns. Preserve valid 204 behavior and forward-compatible fields deliberately.
- **Effort / regression risk:** M / Medium: avoid overstrict legacy rejection and duplicate schema definitions.
- **Verification:** Static malformed-response traces confirmed; no injected runtime response or provider request executed.

#### #22A-11 — Owned lists have no pagination or projection

- **Category / severity / confidence:** Database performance / Medium / High.
- **Evidence:** `apps/api/src/routes/trips.ts:285–287` loads all matching full Trip documents, sorts and maps summaries. Trip embeds weather, routes, expenses and receipts (`models/Trip.ts:434–518`). Indexes at `:534–540` do not include list creation-time sorting. `routes/saved.ts:9–10` and `savedAttractions.ts:11` also load all owned saved items. Explore instead uses limit/maxTimeMS (`routes/destinations.ts:42–44`).
- **Impact:** Larger authenticated histories increase database transfer, hydration, sorting and response work. Guest trip counts are capped, but that does not bound account histories. This is not a measured production latency incident.
- **Remediation:** Add cursor pagination and summary projections; select indexes using explain plans and representative histories. Bound saved-item responses too.
- **Effort / regression risk:** M / Medium: synchronize list contracts and retain ordering/filter semantics.
- **Verification:** Query shape confirmed; no explain plan or load test executed.

#### #22A-12 — Render failures lack application recovery

- **Category / severity / confidence:** Frontend recovery / Medium / High.
- **Evidence:** Provider tree in `apps/web/src/main.tsx:13–23` and route composition in `App.tsx:18–67` contain no error boundary/errorElement. Search of web source found no componentDidCatch/ErrorBoundary implementation. Query error panels handle request failures, not exceptions during rendering.
- **Impact:** Malformed cached/network data or a component exception can remove the application UI without a localized retry/navigation path. This compounds #22A-10.
- **Remediation:** Add a route/application recovery boundary with useful reset/navigation and redacted diagnostics; test a thrown render exception.
- **Effort / regression risk:** S / Low–Medium: ensure reset clears only relevant failing state.
- **Verification:** Source absence confirmed within searched application tree; no deliberate browser crash executed.

#### #22A-13 — Assistant confirmation has an unrecoverable intermediate state

- **Category / severity / confidence:** Mutation recovery / Medium / High.
- **Evidence:** `apps/api/src/services/tripAssistantService.ts:149–155` clears `prepared` in one write before applying the itinerary/expense operation. A failure requires a new preview by design. A successful apply followed by a lost HTTP response causes retry to return 410; there is no durable applied-result receipt keyed by preview ID. Confirmation-history failure is swallowed with a warning (`:156`).
- **Impact:** A transient failure can destroy a valid reviewed proposal; a lost acknowledgment leaves the client unable to distinguish success from expiration using the same request. State CAS still prevents unsafe stale application. Currently hidden UI reduces direct exposure, but endpoints remain implemented.
- **Remediation:** Persist claim/result state and provide idempotent confirmation reconciliation; revalidate stale business state rather than blindly reapplying. Preserve single-application semantics.
- **Effort / regression risk:** M / High: two persistence boundaries and cancellation must remain coherent.
- **Verification:** Static partial-write/acknowledgment trace confirmed. Existing tests check stale/duplicate confirmation but not restart-after-claim reconciliation.

#### #22A-14 — Health is unsuitable as a readiness gate

- **Category / severity / confidence:** Operations / Medium / High.
- **Evidence:** `apps/api/src/routes/health.ts:7–14` always sends status ok and HTTP 200 while separately reporting DB disconnected. Startup connects DB first and shutdown drains requests (`server.ts:17–26`), which are useful protections but do not cover post-start connection loss.
- **Impact:** HTTP-only readiness probes can route traffic to an instance unable to serve persisted features.
- **Remediation:** Separate liveness and readiness, or use 503 for dependency-unready health; document probe expectations and test DB loss/recovery.
- **Effort / regression risk:** S / Low–Medium: update consumers of the existing endpoint deliberately.
- **Verification:** HTTP behavior confirmed statically. Actual deployment probe configuration unknown.

#### #22A-15 — Development MongoDB exposure is broader than needed

- **Category / severity / confidence:** Local database security / Medium / High.
- **Evidence:** `docker-compose.yml:5–7` uses `--bind_ip_all` and publishes `27018:27018` without a host-loopback binding or configured MongoDB authentication.
- **Impact:** With ordinary Docker networking the port is published on all host interfaces; LAN access depends on firewall/network policy. Local trip/account data may be reachable outside the developer machine. No reachability probe performed.
- **Remediation:** Bind published development port to loopback and clearly label this Compose setup as development-only; document separate authenticated production DB requirements.
- **Effort / regression risk:** XS / Low: preserve replica-set address and local setup.
- **Verification:** Configuration confirmed; external network exposure remains environment-dependent.

#### #22A-16 — Initial frontend delivery is unnecessarily broad

- **Category / severity / confidence:** Frontend delivery / Medium / High.
- **Evidence:** `apps/web/src/App.tsx:5–16` eagerly imports every page, including TripPage/map consumers; no lazy/Suspense route boundary found. Historical `.ui-monorepo-build-final.log:254–262` records 1,608.35 kB JS (463.50 kB gzip), 109.33 kB CSS and an 800.23 kB favicon. That log's build date/revision is not independently established.
- **Impact:** Eager routing structurally includes broad features in initial delivery. The historical size suggests meaningful slow-network cost, but current compressed size and user performance require a fresh build/profile.
- **Remediation:** Measure current assets, split meaningful route/map boundaries, optimize oversized static assets and set a reviewed delivery budget. Do not raise warning thresholds as the fix.
- **Effort / regression risk:** M / Medium: loading states, map mounting, styles and translations need regression checks.
- **Verification:** Eager imports confirmed; sizes historical, not measured by this audit. CPU/rerender impact unprofiled.

#### #22A-17 — Visual tests capture artifacts rather than compare them

- **Category / severity / confidence:** Test quality / Low / High.
- **Evidence:** `apps/api/e2e/hardeningVisual.spec.ts:18` and `mobileVisual.spec.ts:22` call screenshot and attach output. No `toHaveScreenshot` use found in E2E. `docs/testing-audit.md:109–112` already identifies the distinction.
- **Impact:** Visual changes can pass unless they break explicit DOM/layout assertions or receive manual artifact review. This does not invalidate their existing behavior/overflow checks.
- **Remediation:** Label capture-only checks accurately; establish a small stable baseline set or an explicit review process. Keep meaningful keyboard, touch and overflow assertions.
- **Effort / regression risk:** S / Low–Medium: avoid a large flaky snapshot matrix.
- **Verification:** Static test inspection confirmed; screenshots not regenerated or visually assessed.

#### #22A-18 — Typechecks have no complementary lint gate

- **Category / severity / confidence:** Tooling / Low / High.
- **Evidence:** Root and workspace manifests expose test/build/typecheck but no lint script. No ESLint configuration found. Strict TS configs omit noUnusedLocals; `TripPage.tsx:51` imports the disabled Assistant and still passes typecheck. CI validation (`.github/workflows/ci.yml:55–87`) runs no lint.
- **Impact:** Some unused code, effect dependency mistakes and consistency errors rely solely on review. Passing strict TypeScript is not evidence that these checks exist.
- **Remediation:** Introduce a small reviewed static-analysis policy in #22D, without blanket fixes or cosmetic rename churn; gate only actionable rules.
- **Effort / regression risk:** S / Low: baseline existing violations separately.
- **Verification:** Manifest/config search and successful no-emit checks confirmed. No lint command or formatter run.

#### #22A-19 — New-developer documentation has conflicting scope claims

- **Category / severity / confidence:** Developer documentation / Low / High.
- **Evidence:** `README.md:273` says no full browser E2E script; `package.json:17` defines it and CI runs it. README Current project scope at `:292` describes inspiration/saved ideas as demo data, although Destination/Saved routes and models persist them. README at `:296` links `docs/step-11.3-fastify.md`, absent from the Git file inventory. Assistant availability conflict is separately tracked in #22A-04.
- **Impact:** New developers can miss the browser gate, misclassify persistent domains and follow a broken architectural reference.
- **Remediation:** Reconcile setup/test/product scope with current code and link the Journey/CI/provider guides; document Node runtime separately from Bun package-manager requirements.
- **Effort / regression risk:** S / Low.
- **Verification:** Documentation/contracts cross-check confirmed; fresh-clone onboarding not executed.

#### #22A-20 — Historical artifacts lack provenance and lifecycle

- **Category / severity / confidence:** Diagnostics hygiene / Low / High.
- **Evidence:** Inventory found 53 root dot-logs across a11y/hardening/mobile/trip/ui runs, including repeated final/complete/verified variants. `.gitignore:9–11` ignores logs and browser output. `docs/journey-21d.md:65–90` contains useful summarized checks, but there is no central diagnostic index associating local logs with commit, command, time or supersession. No reviewed manifest/CI command consumes the root log filenames.
- **Impact:** Old success/failure output can be mistaken for current verification; useful incident evidence becomes difficult to find or retain safely.
- **Remediation:** Index curated, sanitized evidence with provenance; keep generated/raw logs ignored and rotate them outside Git. Proposed structure below. Preserve existing files until archival decisions are reviewed.
- **Effort / regression risk:** S / Low; no movement/deletion authorized by this audit.
- **Verification:** File and reference inventory confirmed. Not every log line was reviewed; no declaration that all logs are obsolete or secret-free.

#### #22A-21 — Attachments are silently ineffective

- **Category / severity / confidence:** Product integrity / Medium / High.
- **Evidence:** `apps/web/src/pages/HomePage.tsx:270–273` appends File objects and `:405–407` displays them. `:299–300` submits prompt, destination, badges/preferences only; file contents/metadata are absent. `:445–453` accepts multiple files without type/count/size constraints. No PDF/TXT ingestion or multipart route was found. Existing PDFJS dependencies are used by tests/inspection; PDF routes export.
- **Impact:** Users can reasonably assume attached travel documents affect planning when they do not. No backend extraction safeguards can be credited because that ingestion path is absent. No server upload vulnerability was demonstrated.
- **Remediation:** Clearly disable/label the placeholder, or scope a separately designed bounded TXT/PDF extraction contract with reviewable extracted text. Do not imply support before implementation and tests.
- **Effort / regression risk:** S to make current behavior truthful; L for full ingestion / Low for labeling, High for ingestion.
- **Verification:** UI-to-request trace confirmed statically; no file uploaded or parsed.

#### #22A-22 — Domain utilities sit inside cyclic, broad services

- **Category / severity / confidence:** Architecture/naming / Low / High.
- **Evidence:** `apps/api/src/services/tripItineraryEditor.ts:4` imports identity backfill from tripVisits; `tripVisits.ts:6` imports error/loader from editor, a direct module cycle. `expenses.ts:4` also imports editor errors; `tripVisits.ts:9` imports expenses. `tripDraft.ts` combines enrichment, writes and serialization across 714 lines. `tripPlanner.ts:45` claims it is not wired into live draft endpoints, while generation calls it at `tripGeneration.ts:237`. `backfillTripAttractions` and `ensureTripItemIdentities` write data during GET; `loadEditableTrip` can trigger identity persistence (`tripItineraryEditor.ts:44`).
- **Impact:** Initialization is currently safe enough for typechecks, but changes to these modules are tightly coupled; mocks and error semantics leak across domains. Misleading comments/names obscure network/storage side effects during maintenance.
- **Remediation:** Extract only proven shared error/loading/identity persistence boundaries; document read/write effects. Retain scheduling and expense invariants. No generic repository framework or full rewrite is justified.
- **Effort / regression risk:** M / Medium–High: protect module initialization and mocks with integration tests.
- **Verification:** Specific import cycle and comments confirmed manually; no exhaustive graph/dead-code proof.

#### #22A-23 — Locale propagation is inconsistent

- **Category / severity / confidence:** Localization consistency / Low / High.
- **Evidence:** `apps/api/src/services/tripDraft.ts:507–513` calls ensureAttractions without locale, whose default is English at `:348`. `tripItineraryEditor.ts:74–76` passes weather but no locale on discovery. By comparison, generation passes the trip content locale (`tripGeneration.ts:222`) and backfill does so at `tripDraft.ts:395`. Locale is part of attraction cache identity (`attractions.ts:339`).
- **Impact:** Polish trips can receive English provider descriptions/categories during these operations and use an inconsistent locale cache entry. This is a content-consistency defect; safety/business IDs remain unchanged.
- **Remediation:** Pass authoritative trip content locale through all candidate/requirements paths; add PL request/response tests that inspect transport language and stored content.
- **Effort / regression risk:** S / Low–Medium: preserve content-language versus current UI-language policy.
- **Verification:** Call-site/default mismatch confirmed; no live provider-language response inspected.

## Naming and architecture assessment

Component files generally use PascalCase; hooks consistently use `use*`; services use lower camelCase; constants mostly use uppercase; schemas use `*Schema`, with shared inferred types. These are coherent enough that broad naming work would be cosmetic.

Meaningful naming problems are concentrated at semantic boundaries:

- `userId` often means a tagged guest-or-account owner (`services/expenses.ts:9`, `tripItineraryEditor.ts:35`, `tripGeneration.ts:59`); prefer `owner` when touching these signatures. Do not rename database `user` ownership fields casually.
- Equipment is the persisted/API name while Packing is the product term (`services/equipment.ts:37`, `routes/packing.ts`, `pages/TripEquipmentPage.tsx`). Document this mapping; a route/schema migration solely for spelling is not justified.
- `TripAttraction.placeId` identifies a provider place; `itineraryItemId` identifies an occurrence. Some edit operations still call provider IDs `attractionId`, and expenses separately retain both concepts (`services/expenses.ts:15–27`). Require explicit distinctions in new contracts; preserve existing compatibility.
- Query namespaces are mostly sensible but partly literal: `tripQueryKey` exists (`hooks/useTrips.ts:23`), while Budget/candidates/Assistant keys are repeated strings (`useTripVisits.ts:21`, `useTripBudget.ts:9`, `useTripAssistant.ts:11`, `useItineraryEditing.ts:16`). Centralize when changing cache behavior, not as a standalone mass rename.
- Error names/codes mix uppercase guest identifiers, lowercase underscore AI codes, hyphenated external codes and uncoded message-only errors. #22A-09 addresses the behavior consequence.
- Backend tests use camelCase `*.routes.test.ts`, frontend tests use component/hook names and `*.test.tsx`; no material directory/file naming defect found. The combined tripExperience test title at `:47` understates its additional Assistant requirement; split that responsibility when restoring the gate.

TripPage (667 lines) coordinates generation, preferences, Journey, selections, dialogs, timeline/map and Budget; tripRegeneration is 745 lines, scheduling 628 lines. Size alone is not a defect. Extract cohesive orchestration/state boundaries only after targeted correctness work. Scheduler math is appropriately kept out of UI. No proof of broad dead-code prevalence or an exhaustive list of unused dependencies was established. The disabled Assistant mount/import is concrete unreachable UI, not proof its backend is unused by all clients.

## Error handling and data integrity

### Confirmed safeguards

| Scenario | Backend evidence and assessment |
| --- | --- |
| Two itinerary editors | `tripItineraryEditor.ts:266–267,323–327`: expected version, owner, ready status, budget link guard and visit guard; loser receives 409. |
| Concurrent visit changes | `tripVisits.ts:47–79`: bounded retry, current occurrence membership, itinerary/visit/budget guards; prevents unrelated record loss. |
| Visit becomes locked while editing | `visitedProtection.ts:22–38` compares final occurrence schedule/position; editor guards visit revision at commit. |
| Stale regeneration | `tripRegeneration.ts:684–699,727–741`: preview/day/expiry/version checks, final visited comparison and revision guard. |
| Automatic expense failure | `tripVisits.ts:62–75` persists visit plus pending receipt; `automaticVisitExpenses.ts:58–84` retries atomically and reads durable state after uncertain write. |
| Undo/revisit/deletion | Tombstones retained (`models/Trip.ts:436–441`); first-visit/prompt markers and receipt identity prevent automatic recreation. Actual spending intentionally survives visit undo. |
| Retired occurrence | `expenseLinks.ts:5–17` unlinks removed occurrences without deleting expense; retry route supports pending retired receipts (`tripVisits.ts:11–16`). |
| Manual expense retries | `expenses.ts:34–43` stable request UUID replay; revisions reject stale writers; ownership and references validated (`:9–27`). |
| Money totals | `budgetSummary.ts:22–29` checks safe integer sums; currencies separated; `expenses.ts:63,75–77` validates supported totals/allocations. |
| Guest import | `guestMigration.ts:120–138`: resource transfer and receipt/fence in one transaction; idempotent completed receipt. |
| Late mutation response after logout | `useIdentityMutation.ts:19–31` suppresses old-identity callbacks; cacheConfirmedTrip checks identity around cancellation. |

Outstanding integrity/recovery concerns are #22A-01/03/05/13. Automatic-expense receipts use `Schema.Types.Mixed` for their snapshots (`models/Trip.ts:440`); creation paths are typed and conservative, but legacy/administrative corruption of snapshots has no equivalent full runtime validation at that model field. Treat migration validation as a follow-up, not a demonstrated externally writable exploit.

Partial success is explicitly supported for a saved visit whose expense posting fails; the UI gets feedback/pending IDs rather than rolling back the visit. Optional candidate discovery falls back to saved candidates (`tripItineraryEditor.ts:77–78`). These catches have product recovery value; do not flag all swallowed exceptions as defects. Diagnostics of their cause are weaker (#22A-07).

Expense day/date represent historical recorded spending and intentionally survive later itinerary moves (`budgetSummary.ts:57`). Tests should preserve that policy; do not automatically “repair” historical expenses to the attraction's new day.

## Test quality assessment

No tests were executed in this audit. Coverage below means inspected test presence/assertions, not code coverage percentages or current pass status.

| Major flow | Inspected coverage | Remaining high-value gap |
| --- | --- | --- |
| Description/draft/generation | `routes/trips.routes.test.ts:150–375`: auth, requirements, concurrent claim, failure persistence, spending during generation, superseded owner; planner/provider units | Long-run takeover/deadline and backfill-versus-generation interleavings; route tests mock planner and enrichers. |
| Attractions/fallback | attractions, geoapify and geoapifyUsage integration tests; providerReliability tests | Cross-request admission pressure; guarded backfill after concurrent requirements change. |
| Geocoding | `services/location.test.ts:15–34`, routes/trips recovery scenarios | Distinguish outage from no match at location/search; bounded/limited distinct searches. |
| Weather | `weather.test.ts:17–223`; `trips.weather.routes.test.ts` | Multi-instance passive-refresh load/cancellation under frequent trip changes; no reason to duplicate existing horizon/retry tests. |
| Scheduler/routes/opening hours | scheduling, routeOptimizer, openingHours integration, quality and repair scenario tests | Representative maximum-trip duration/resource budget; adversarial composition beyond isolated stage mocks. |
| Manual edits | `trips.editing.routes.test.ts:911–1125`, TripTimeline/TripPage editing tests | Backfill interleavings; browser two-context convergence. |
| Day preview/apply | `trips.regeneration.routes.test.ts:203–384`: immutable preview, visit-after-preview, failed regeneration, apply, stale/expired preview | Full browser stale-preview plus independent visit/budget changes across two contexts. |
| Journey visits/locks | `trips.editing.routes.test.ts:442–554`: ownership, legacy IDs, simultaneous visits/reads, edit/visit race; `e2e/journey.spec.ts:5,69` | Actual cross-tab refocus and restart recovery. Do not claim concurrency tests are missing wholesale. |
| Automatic expenses | same API file `:161–267`: simultaneous visits, pending recovery, manual resolution, lost acknowledgment, correction/deletion/revisit/retired retry | Process restart between pending receipt and posting, fault during response serialization/session save. |
| Budget | budgetSummary units; API CRUD/auth/revision/allocation tests `:676–774`; TripBudgetCard tests | Schema-invalid successful HTTP response; independent ready-tab cache convergence. |
| Saved trips/ideas | saved, savedAttractions, savedMigration/collections API and browser tests | Large histories/pagination contract; frontend summary-only fetch budget. |
| Guest Mode/import | guest routes, guestMigration transactional/standalone API tests and E2E | Crash-orphaned active request: existing test manually removes in-flight marker. |
| Explore | destination discovery/planning/hardening API and frontend/browser tests | Explain/load evidence; reduce repeated layout matrix only after retaining unique assertions. |
| Packing | service/API/component plus packing/AI/smart E2E; signed previews, leases, duplicate handling | Process-death and multi-instance lease expiry with cancellation; preserve existing atomic batch and provenance tests. |
| Assistant | intent/context/service units, API conversation/write tests `:746–829`, standalone component tests | Mounted product availability; crash/lost acknowledgment after confirmation claim. |
| Attachments | No ingestion contract or extraction path found | Product truthfulness first; ingestion tests only after a defined extraction feature exists. |
| Sharing/PDF/calendar | owner/public export API and browser tests, rendering/calendar parser assertions | Keep authorization/revocation, time zone/DST, resource-limit tests; no upload coverage should be inferred from export tests. |

### Assertion quality and test boundaries

- Integration tests do inspect persisted data, authorization and losing writers, not just status 200. Examples: `trips.editing.routes.test.ts:170–214,379–398,516–554,1015–1026` and regeneration visited-state tests. These are valuable and should not be replaced by shallow mocks.
- Generation route tests mock `tripPlanner` (`trips.routes.test.ts:21`) and weather/attractions (`:70–78`); they prove orchestration/persistence boundaries, not real planner composition. Separate planner units help, but a representative full pipeline with provider-only stubs should protect #22A-03/06.
- `apps/web/src/pages/TripPage.test.tsx:17–26` replaces hooks, dialogs and Assistant with mocks. That explains why this suite cannot detect a missing Assistant mount. At least one availability test must render the real page integration.
- `services/tripAssistantService.test.ts:155–160` checks forwarding of expected version with mocks. It does not prove MongoDB consumes/reconciles the preview correctly after failure; the mocked stored object can retain `prepared` even after a mocked update.
- Screenshot tests are capture-only (#22A-17). Similar width/locale/overflow coverage occurs across designConsistency, mobileVisual and i18nCoverage; consolidate shared matrix setup only after mapping unique focus, touch and language assertions. `docs/testing-audit.md:103–117` already gives a useful consolidation starting point.
- Fixed 2030 dates are legitimate deterministic DST/export fixtures, not automatically outdated tests. Weather tests commonly inject time. The reviewed evidence does not establish a new date-sensitive failure. `docs/journey-21d.md:67` reports a historical parallel Explore timing failure that later passed; this is a flakiness lead, not a current reproduced failure.
- Chromium is the only configured browser project (`playwright.config.ts:31`); mobile viewport emulation is not physical-device or Safari coverage. Manual assistive-technology and cross-engine verification remain unproven.

Ask Triply conclusion: preserve the failing test until product availability is resolved. `docs/journey-21d.md:74` reports six passes/one failure for a focused historical browser command, not a clean full-suite run. Current source predicts failures in multiple Assistant-dependent specs. Current CI run status and branch protection were not inspected remotely.

## Logs and diagnostics inventory

| Artifact group | Evidence/value | Proposed treatment |
| --- | --- | --- |
| Root `.trip-*.log` | Generation/editing/Journey tests, builds and browser evidence; final/complete/verified variants | Historical candidates; retain only redacted evidence relevant to incidents/releases, with commit/command/time. Keep raw files outside Git. |
| Root `.ui-*.log` | UI/type/build/visual outputs, historical bundle warning evidence | Same; build warnings are useful but do not describe the current bundle conclusively. |
| Root `.mobile-*.log`, `.hardening-*.log`, `.a11y-*.log` | Responsive, keyboard, accessibility and recovery work; some earlier failing runs | Preserve useful failure-to-fix narratives; mark superseded results rather than treating all failures as current. |
| `*/.turbo/turbo-build.log` | Generated task-cache diagnostics | Active tooling artifact, ignored through `.turbo/`; regenerate as needed, do not archive wholesale. |
| `test-results/`, `playwright-report/`, `apps/api/e2e-dist/` | Configured output locations for reports, screenshots, traces, transpiled test server | Active outputs referenced by config/CI; ignored. Not found as current screenshot/report files in this inventory. CI retains uploaded artifacts seven days. |
| `docs/journey-21*.md`, localization/UX reports, `docs/testing-audit.md` | Tracked historical rationale, QA instructions and results | Keep discoverable; distinguish historic counts from current verification; add links/provenance. |
| `apps/api/scripts/inspectPdf.ts`, `inspectCalendar.ts` | Purposeful developer inspection tools | Keep with documented invocation; they are not disposable output logs. |
| `.env`, `apps/api/.env` | Local configuration files exist and are ignored | Remain outside Git. Contents deliberately not read. `.env.example` is tracked configuration documentation, not a secret store. |

The root log count is 53, approximately 1.69 MiB. Git lists no tracked `.log` files. Reference inspection of manifests, CI and documentation found no required consumption of specific root dot-log filenames; runtime code logs to console rather than appending these files. Therefore they are historical candidates, not proven safe to delete. No log was moved, rewritten or deleted.

Suggested follow-up structure (proposal only):

```text
docs/
  diagnostics/
    README.md
    archive/
      historical-logs/   # sanitized excerpts + provenance, not raw dumps
      qa-reports/
      incident-notes/
```

Each curated record should identify revision, UTC time, command, environment, expected/actual result, artifact location, redaction and superseding record. Raw provider responses, cookies, URLs with keys, guest IDs, emails, user prompts and browser traces may be sensitive. Existing visual tests mask an email selector, but that does not sanitize all screenshots/traces or logs. No actual secret leak was confirmed. CI artifact expiry is documented; runtime console log destination/retention is not.

A developer can infer broad generation stage outcomes from existing logs, but cannot reliably associate interleaved stages with one failed request (#22A-07). AI diagnostics also print raw upstream messages (#22A-08). Add correlation before increasing log verbosity.

## Performance and security

### Backend and integrations

Overpass has bounded retry rounds, endpoint fallback, overall Overpass budget and a 200-key short process cache (`attractions.ts:243–317,325–361`). Valid empty results intentionally do not use Geoapify. Geoapify validates payload shape and reserves credits durably before HTTP; uncertain settlements retain the reservation (`geoapifyUsage.ts:18–65`). This is safer than refunding on ambiguous network errors. Its configured per-attempt timeout/retry work can occur after the Overpass budget; that budget should not be presented as the whole generation deadline.

Weather explicitly models unsupported dates, partial usable data, retry cooldown, cancellation and stale snapshots. Geocoding uses five-second timeout, exact normalized city/country matching, rejects ambiguity and validates coordinates (`location.ts:32–74`), but optional compatibility search flattens lookup failure into null/404 (`:79–84`, `routes/location.ts:15–16`). Treat this as an error-contract refinement under #22A-09.

Routing bounds matrix size and two-opt passes (`routeOptimizer.ts:14–15`), paces public requests and falls back to approximate timing with absent geometry. Serial per-day work plus extra opening-hours passes needs end-to-end budgeting (#22A-06). Do not replace serial processing with unbounded Promise.all: that would undermine public provider pacing.

MongoDB list issues are confirmed query shapes (#22A-11). Candidate discovery additionally performs one atomic update per addition (`tripItineraryEditor.ts:84–91`), an N-write pattern bounded by provider results; measure before changing deduplication semantics. Budget summaries repeatedly search days/stops/expenses per attraction (`budgetSummary.ts:47–69`); maximum-size CPU cost requires profiling. Receipts and retired visit records intentionally persist; monitor document growth and MongoDB document-size headroom rather than deleting tombstones and breaking idempotency.

PDF is export-only and already bounds concurrency, days, activities, characters, pages and bytes (`tripPdf.ts:14,20,75,85,140`); it does not fetch remote images/URLs. No PDF/TXT extraction safeguards were found because ingestion is not implemented (#22A-21).

### Frontend, accessibility and i18n

Query helpers preserve independently newer itinerary/visit/budget revisions (`packages/shared/src/visits.ts:35–42`). Identity mutation wrappers prevent many stale callbacks. Budget/visit updates generally publish confirmed data rather than broad unsafe optimistic guesses; packing has explicit optimistic rollback tests. Broad `TRIPS_KEY` invalidations can refresh unrelated active trip descendants; profile real request volume before changing them.

TripMap creates/updates Leaflet elements and has cleanup and localized marker labels (`components/trip/TripMap.ts:114,169–194`); timeline uses keyboard/mouse/touch sensors (`TripTimeline.ts:5,99`). Render frequency, marker churn and timeline virtualization need profiling, not blanket memoization. No quantitative frame-time or memory measurement was made. Route splitting has direct evidence (#22A-16).

Accessibility strengths include keyboard sorting, explicit visit controls/lock descriptions, day tab/panel relationships (`TripPage.tsx:469–470`), MUI dialogs and focus/keyboard E2E scenarios. Journey markers communicate status in labels as well as color. This audit does not certify contrast, screen-reader announcements, every dialog focus trap or mobile target size. The absent Assistant blocks its dialog accessibility flow too; old screenshot capture cannot establish accessibility compliance.

EN/PL resources have validation and contextual duplicate auditing; repeated translated values across namespaces are not inherently bugs. Shared currency/date helpers and destination time zones reduce formatting drift. Locale propagation defect #22A-23 and error-code loss #22A-09 have concrete user impact. No exhaustive hardcoded-string/missing-key audit was rerun.

### Security boundaries reviewed

- Argon2id password hashes; signed HttpOnly, SameSite=Lax cookies, secure in production; session regeneration at authentication; MongoDB-backed session state.
- Exact allowed Origin required on unsafe methods (`app.ts:64–67`), fixed credentialed CORS, Helmet. No production-origin bypass demonstrated.
- Owner filters distinguish account and guest ownership; guest allowlist keeps Assistant/account endpoints user-only. Expense occurrence and attraction membership checks are enforced server-side.
- Public sharing uses hashed token storage and owner-independent public DTO/export paths; private trip HTTP payloads receive no-store. Sharing/PDF routes have local rate limits.
- User-derived strings go through Zod/scalar construction in inspected routes; destination discovery uses normalized filter building. No confirmed NoSQL injection or IDOR was found in reviewed paths. This is not a penetration-test guarantee.
- Provider URL hosts are fixed except server-configured routing URL; user text is encoded through URLSearchParams/model encoding. No arbitrary user-URL fetch path was identified. Configuration trust/SSRF from an operator-controlled URL is a separate deployment boundary.
- AI action intents are allowlisted and revalidated before writes, with preview confirmation; packing context is bounded and excludes private notes/expenses. Prompt instructions alone are not a security boundary, but these server validation boundaries are meaningful. No live prompt-injection test executed.
- Avatar validation statically restricts file signatures/SVG vocabulary (`services/avatar.ts:3–42`); regex-based SVG handling and all image edge cases were not fully reviewed. General travel-document upload does not exist.

Dependencies: one Bun lockfile and aligned declared Zod/TypeScript families were found. No installation, vulnerability feed, registry lookup or dependency upgrade occurred; dependency CVE/deprecation status is **unknown**, not “clean.” No unused-package claim is made without import/build analysis. Historical Rollup annotation warnings point to comments in installed Zod (`.ui-monorepo-build-final.log:239–250`), not application compilation failures; bundle analysis should assess actual retention before changing versions.

## Production readiness

| Capability | Verified repository evidence | Remaining unknown/gap |
| --- | --- | --- |
| Environment validation | Zod config; production session-secret requirement (`config/env.ts:24–103`) | Real deployment env, provider availability, TLS and proxy topology unverified. Defaults for DB/origin still exist; validate deployment explicitly. |
| Startup/shutdown | Connect DB before listening; drain app then disconnect; startup seed/index preparation | No demonstrated startup resource limits or rollout procedure. Seed work runs at startup, not a versioned migration system. |
| Health/readiness | DB status appears in health | Always-200 response (#22A-14); deployed probe unknown. |
| Durable storage | Mongoose schemas/indexes; import transactions; development replica set | Backup schedule, tested restore, point-in-time recovery and storage monitoring unknown. |
| Migration/evolution | Lazy legacy identity/location compatibility; explicit seed/index preparation | No general versioned migration/rollback runbook found. Existing lazy writes must be audited as mutations. |
| Rate/resource controls | Auth/planning limits, guest quotas, provider credit reservations, packing lease, PDF bounds | #22A-02/06; in-memory rate limits across replicas; real ingress controls unknown. |
| Error monitoring/tracing | Console stage events and sanitized global 500 | No repository-visible monitoring integration, request correlation or runtime retention policy. |
| CI gates | Typecheck/tests/build/translation/browser definitions; disposable test DB; artifact uploads | Current CI result/required branch protection unknown; full browser contract currently contradicts Assistant mount. No lint/bundle-size failure gate. |
| Hosting/rollback | README describes static host + API proxy; MongoDB Compose persists data | No app deployment manifests, tested rollback, secret rotation, incident ownership or restore exercise found. |

Readiness should be conditional on closing correctness/recovery issues and obtaining operational evidence. Absence of deployment files is not proof the deployed service lacks backups or monitoring; those capabilities are simply unverified here.

## Prioritized remediation roadmap

These are proposed future jobs, not authorization exercised during this audit.

### #22B — Critical correctness, reliability, and security fixes

| Task | Goal and scope | Dependencies | Risk | Acceptance criteria |
| --- | --- | --- | --- | --- |
| B1: Recover guest activity fencing | Close #22A-01 with expiring fenced activity leases and safe restart recovery | Define maximum request lifetime with B3 | High | Kill/restart API after acquisition; import completes safely after recovery, no old writer can mutate transferred resources, no trip/receipt loss. |
| B2: Guard enrichment writes | Close #22A-03; narrow owned CAS for attraction backfill and audit confirmation write (`tripDraft.ts:559–572`) | Existing revision/identity contracts | High | Delay backfill, change requirements/generate/discover in another request; old data never overwrites current candidates, weather, itinerary or expenses. Legacy reads still recover. |
| B3: Bound expensive operations | Close #22A-02/06; consistent account/guest/search admission, deadlines and cancellation, lease lifecycle | Provider pacing/guest accounting policy; coordinate B1 | Medium–High | Authenticated bursts receive bounded rejection; multi-instance policy explicit; slow many-day plan cannot be silently taken over while legitimately leased; disconnect/deadline stops cancellable work; no accidental guest refunds after provider boundary. |
| B4: Recover UI mutation results | Close #22A-05/13 and critical part of #22A-10/12 | Preserve independent revisions and owner transitions | High | Two contexts converge on focus; lost Assistant apply response is reconciled idempotently; invalid successful payload produces recoverable UI, no cache resurrection after logout. |
| B5: Readiness and safe local DB | Close #22A-14/15 | Agree probe contract | Low–Medium | DB disconnect returns unready while liveness remains usable; Compose publishes loopback only; transaction-capable local setup still works. |

### #22C — Architecture, naming, and maintainability

| Task | Goal and scope | Dependencies | Risk | Acceptance criteria |
| --- | --- | --- | --- | --- |
| C1: Align feature availability | Resolve #22A-04/21; explicit supported Assistant/attachment UI contract | Product decision, then B4 if Assistant enabled | Medium | Docs, actual page and full browser assertions agree; attachment affordance makes its capability clear; no assertion deleted merely to hide regression. |
| C2: Clarify mutation boundaries | Reduce #22A-22 cycles; move shared error/identity persistence primitives; document owner/place/occurrence terminology | B1/B2 invariants protected by tests | Medium–High | Direct editor/visits cycle removed; loading/backfill side effects explicit; existing auth, concurrency and tombstone behavior preserved. |
| C3: Shared contracts and language | Close #22A-09/10/23; safe coded errors, critical response validation, locale propagation; consolidate touched query keys | C1 availability choice | Medium | EN/PL timeout/lock/conflict recovery is distinct; malformed AI envelopes map to invalid-response; every candidate fetch carries intended content locale. |
| C4: Delivery and list scaling | Close #22A-11/16; paginated summary endpoints, measured indexes, route/map splitting | API pagination DTOs and UI loading design | Medium | Representative history explain/load evidence; bounded response sizes; measured initial JS reduction; lazy route/map recovery tested. |

### #22D — Test quality and CI improvements

| Task | Goal and scope | Dependencies | Risk | Acceptance criteria |
| --- | --- | --- | --- | --- |
| D1: Reestablish trustworthy browser gate | Resolve Assistant expectations; retain unique focus/touch/map tests | C1; B4 where enabled | Medium | Full configured Chromium suite passes against actual supported product; no skip/mocking of absent feature to mask the issue; CI result retained. |
| D2: Add failure-boundary scenarios | Cover B1–B4 with restart, stale backfill, lost acknowledgment, long lease and two-context tests | Fix contracts settled with each B task | Medium | Tests fail against old behavior and assert persisted records, single effects and recovery, not only status/call counts. |
| D3: Focus quality gates | Add useful lint and small measured bundle budget; clarify capture-only visual checks; consolidate redundant width scenarios | C4 measurement; preserve existing negative scenarios | Low–Medium | Actionable static rules, no blanket formatting; stable visual review/baselines; unique auth/concurrency/keyboard/language assertions remain; local and CI commands documented. |

### #22E — Logs, diagnostics, and documentation

| Task | Goal and scope | Dependencies | Risk | Acceptance criteria |
| --- | --- | --- | --- | --- |
| E1: Correlated safe diagnostics | Close #22A-07/08; shared structured event context, safe categories, expense recovery events | Error taxonomy C3; operational log sink agreement | Medium | A failed mocked generation can be reconstructed by one correlation/run ID; secret-like provider text never appears; runtime retention documented. |
| E2: Curate historical evidence | Close #22A-20 using proposed diagnostic index/archive | Review sensitivity and retention with owner | Low | Every retained historical artifact has revision/command/time/status; raw logs/traces stay ignored; no destructive move/delete without separate authorization. |
| E3: Onboarding and operations | Close #22A-19; current feature/test commands, provider behavior, Journey expense policy, readiness/deploy/backup/restore/rollback guide | C1 product scope, B5 probes, operations owner input | Low | Fresh developer can follow setup and isolated tests; backup restoration and rollback evidence recorded or explicitly marked unverified; broken references removed/replaced. |

## Audit verification

### Commands and checks executed

Read-only inspection used PowerShell `Get-Content` with explicit line numbering/ranges; `rg --files`, `rg -n` and scoped searches across source/tests/docs/configuration; `Get-ChildItem`, `Measure-Object`, `Test-Path`, `Get-Command`; and Git file/status queries. No provider/server/seed command was run.

Principal command groups:

```text
git status --short
git status --porcelain=v1
git -c safe.directory=C:/Users/grzes/Desktop/Files/Triply status --porcelain=v1
git -c safe.directory=C:/Users/grzes/Desktop/Files/Triply ls-files '*.log' '*report*' '*screenshot*' '*.png' '*.env*'
rg --files [source/docs/config/test scopes]
rg --files -uu [artifact scopes; node_modules/.git/dist excluded]
rg -n [domain/error/concurrency/provider/test/diagnostic patterns] [scoped files]
Get-Content [manifests, configuration, source, tests and selected historical logs]
Get-ChildItem -Force -File -Filter '*.log' | Measure-Object -Property Length -Sum
bun apps/api/node_modules/typescript/bin/tsc -p packages/shared/tsconfig.json --noEmit
bun apps/api/node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit
bun apps/web/node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit
```

All three final direct no-emit typechecks exited 0. Configurations have no incremental/composite output enabled; Git status remained clean afterward. These checks use existing installed dependencies/shared artifacts; they do not establish fresh shared-dist reproducibility or E2E/script typechecking.

Inspection errors/limitations were retained as audit facts: initial plain Git status failed due to sandbox ownership; a **per-command** safe.directory override allowed reads without editing Git configuration. Initial root `node_modules/typescript/bin/tsc` invocations failed because TypeScript is installed through workspace paths; a Bun resolve probe also failed due to PowerShell/native quoting. Correct direct workspace paths above succeeded. Several wildcard filename searches produced Windows path-glob errors and were replaced/supplemented with directory searches and explicit file reads. No package installation or configuration change was used to recover.

### Commands deliberately skipped

- `bun run build`, Turbo typecheck/test commands: shared builds and task cache can write dist/.turbo, outside the one-file authorization. Turbo was not invoked, and no Turbo configuration/commands were changed; bundled Turbo command documentation was therefore not needed for a configuration change.
- Vitest: runner caches and MongoDB binary global setup can create artifacts/downloads; normal API test setup owns disposable MongoDB, but this audit did not need mutation-capable execution to establish the static findings.
- Playwright: writes reports/screenshots/traces, builds shared/e2e-dist and starts servers. Existing records are not counted as current passing runs.
- Lint/format fixes, dependency install/update/audit feeds, seeds, application startup, Docker commands, production DB access and live external requests: prohibited or unnecessary.
- No commit, push, branch creation, cleanup, log archival or application edit performed.

### Review depth and exclusions

Critical reviewed paths: generation orchestration, provider timeout/fallback/quota behavior, identity/session/origin boundaries, draft backfill/requirements, editor CAS, regeneration commit, visit revisions/locks, automatic expense receipts, budget persistence/totals, frontend query/mutation state, Assistant mount/confirmation, guest import fencing, CI/test configurations and representative tests. Other domains were mapped through models/routes/contracts and representative tests.

Not fully reviewed line by line: all 628 scheduling lines and every quality/repair rule; full catalog/seed data; every opening-hours parser edge; PDF/calendar layout internals and fonts; every profile/avatar/SVG path; every Explore filter/collection combination; all CSS and translation values; every component/effect and test; every diagnostic log; dependency internals or transitive vulnerability status; actual deployments, accessibility devices, browser engines beyond configured Chromium and operational backups. No exhaustive dead-code, import graph or coverage measurement is claimed.

### Git integrity

- **Initial Git status:** clean; `git -c safe.directory=C:/Users/grzes/Desktop/Files/Triply status --porcelain=v1` returned no entries. The first plain attempts failed ownership validation and did not change state.
- **After inspection and typechecks:** clean; no entries.
- **Final verification command:** `git -c safe.directory=C:/Users/grzes/Desktop/Files/Triply status --porcelain=v1 --untracked-files=all`.
- **Final permitted status:** `?? docs/audits/22A-report.md`; verified after writing this report. Tracked-file diff is empty. Only this report and its required parent directory were created; application code, tests, configurations, dependencies and existing logs remain unchanged.
- No commits or pushes occurred. No branch was created. No existing uncommitted work was present initially or overwritten.

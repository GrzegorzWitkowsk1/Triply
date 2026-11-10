# Triply #22B — Final integration verification and deployment readiness

Date: 2026-11-09. Verified working tree based on HEAD `a6a8ec8864f2f2a81cf673182bca1f0963803183`, branch `chore/technical-audit`. The remediation implementation is uncommitted; this report describes the inspected working tree, not HEAD alone.

## Executive summary

**NEEDS FIXES.** The five remediation stages have substantial passing integration evidence, but a remaining requirements-confirmation race was reproduced against disposable MongoDB using the real requirements persistence services. A stale confirmation of malformed legacy coordinates can erase coordinates repaired by a concurrent requirements edit. No application fix was authorized or applied.

The full API suite passed **1,066 tests / 66 files**. The full frontend suite initially had **574 passes / 1 failure**; the failed file passed in isolation, and a complete rerun with four workers passed **575 tests / 62 files**. All three workspace typechecks and production builds passed, as did the E2E typecheck, **19 selected Chromium regressions**, effective Compose validation and `git diff --check`.

Repository configuration is not activated infrastructure. The existing development MongoDB still exposes host port 27018 on IPv4/IPv6 wildcard addresses, runs standalone MongoDB, and contains application data. It cannot satisfy the new readiness contract or transactional guest writes. The backup-first activation and rollback plan below was **not executed**.

This verification does not establish public-launch readiness. A separate adversarial AI and external API security audit remains required. The disabled Assistant was left disabled; its existing availability and confirmation-recovery issues remain deferred.

## TODO and scope

- [x] Read `22A-report.md` and every available `22B.*-report.md`.
- [x] Inspect the existing working tree, tests, identity boundaries and deployment configuration.
- [x] Run safe tests, typechecks, production builds, Chromium regressions and static checks.
- [x] Inspect local MongoDB topology, data inventory and storage without changing it.
- [x] Investigate cross-stage races and classify confirmed findings separately from limitations.
- [x] Prepare an activation, verification and rollback plan without executing it.
- [x] Verify preservation of existing tracked and untracked work and write this report.

Available stage reports: `22B.2-report.md`, `22B.3-report.md`, `22B.4-report.md`, `22B.5-report.md`. No separate #22B.1 report exists. Stage numbering in this report follows the current mission: #22B.1 is atomic attraction backfill, #22B.2 is guest fencing. The B1/B2 roadmap labels in #22A use the opposite order.

No application behavior, dependencies, lockfile, environment file, CI configuration or Docker configuration was changed. No production database or live AI/external API provider was accessed. Tests used owned disposable MongoDB instances and mocked provider responses. Only local development database metadata/counts were queried on the existing container; no application documents were printed. Sanitized local URI inspection printed only scheme, loopback host, port, database and option-presence booleans.

## Verification matrix

| Stage | Code/integration assessment | Executed evidence | Outstanding qualification |
| --- | --- | --- | --- |
| #22B.1 — atomic attraction backfill | Backfill reloads a raw owned snapshot, uses a narrow update guarded by status, timestamp and relevant persisted inputs, and returns current owned data if CAS loses. Generated candidate pools are retained. | Full API suite includes `tripDraft.backfill.test.ts`: requirements/destination changes, same-millisecond discovery, generation claim/completion, identical backfills, guest dirty-document isolation, HTTP detail reconciliation and deletion. | Backfill itself passed review. Adjacent requirements confirmation still uses document save without a current-snapshot predicate; confirmed defect F-01 below. Do not treat that wider mutation boundary as closed. |
| #22B.2 — guest activity/migration | Five-minute non-renewable activity leases; legacy recovery; durable handoff revision and resource write in one transaction; migration touches the same handoff in its ownership-transfer/receipt transaction. Owner predicates remain distinct for account/guest data. | Full API includes guest migration, standalone refusal, guest routes, Saved merges, rollback/retry, expired writers, restart simulation, late release and mutation-boundary inventory. Chromium guest/migration suites passed. | Existing Docker MongoDB is standalone. Real OS process-kill, independent API processes and partitions were not exercised. Drain all old binaries before rollout. |
| #22B.3 — admission/generation | MongoDB owner/scope gates precede expensive handlers and guest/provider reservations. Generation run UUID/start/expiry and MongoDB `$$NOW` protect completion/failure. Overall cancellation propagates through providers and waits, with checks inside guest persistence. | Full API includes `resourceLifecycle.routes.test.ts`, `generationContext.test.ts`, admission/Geoapify accounting suites and generation races. Browser creation/recovery passed. | Four-minute work budget and five-minute guest lease are bounded availability policies, not workload benchmarks. Per-owner admission is not a global capacity cap. Already submitted writes and accepted provider calls cannot be retracted. |
| #22B.4 — frontend recovery/validation | Payload-free cross-tab invalidation, session recheck, mutation-aware cancellation and snapshot GET reduce stale UI without provider rediscovery. Independent itinerary/visit/Budget revisions are retained. Critical responses are validated; render boundary offers explicit retry/navigation. | Complete frontend rerun passed; real two-tab Journey/Budget test passed without extra provider calls or sensitive broadcasts; snapshot route and malformed-response tests passed in full suites; two stale/preview browser regressions passed. | First full frontend attempt had a retry-UI timing failure (F-04). Validation is deliberately partial across the application. Assistant confirmation recovery is not implemented by this stage. |
| #22B.5 — readiness/liveness/loopback | Bounded primary/session/topology metadata probe; concurrent-probe coalescing; no successful-result cache; shutdown fence. Probe routes bypass session storage and ETag/304 conversion and disclose no URI/topology/error details. Compose renders loopback-only publishing. | Full API includes real replica-set transaction/discovery smoke, real standalone rejection, disconnect/reconnect, bounded stuck probes, liveness, signed-cookie and shutdown tests. Compose CLI validation passed. Browser startup gate passed. | Live container still uses its old public standalone configuration. No activation, persistent-database transaction smoke or LAN reachability test was performed. |

Passing tests support these specific invariants; they do not establish that every original #22A finding is resolved.

## Exact commands and results

All commands below use installed dependencies and Bun 1.3.14. No dependency install/upgrade or Turbo invocation was needed: workspace scripts were run directly. PowerShell wrappers redirected output to separate new files, captured `$LASTEXITCODE`, printed the tail and returned the native exit code. PowerShell sometimes labels Bun's stderr script banner as `NativeCommandError`; the exit codes and test summaries below determine the result.

Evidence directory for this verification:

`C:\Users\grzes\AppData\Local\Temp\triply-22b-final-20261109-100828`

This directory contains baseline hashes/status, successful and failed invocation logs, temporary TypeScript diagnostic tests and fresh Playwright output directories. Existing repository diagnostic logs were not deleted or redirected over. Playwright used `--reporter=list` and new `--output` directories to avoid cleaning existing report/artifact directories.

| Working directory | Exact command | Result |
| --- | --- | --- |
| `apps/api` | `bun run test` | Approved execution: **66 files / 1,066 tests passed**, exit 0, 55.46 s. Includes transaction/migration, generation admission/cancellation, snapshot GET, health and provider credit regressions. Log: `api-tests-approved.log`. |
| `apps/web` | `bun run test` | Initial executable full run: **61 files passed / 1 failed; 574 tests passed / 1 failed**, exit 1, 99.95 s. `GuestSession.test.tsx` could not find `role="alert"` in the guest-creation-failure/retry test. Log: `web-tests-approved.log`. |
| `apps/web` | `bun run test src/auth/GuestSession.test.tsx` | **1 file / 9 tests passed**, exit 0, 5.50 s. Log: `web-guest-retry.log`. |
| `apps/web` | `bun run test --maxWorkers=4` | Complete rerun: **62 files / 575 tests passed**, exit 0, 71.36 s. Translation validation: 0 errors / 0 warnings; 185 contextual repeated-value groups. Log: `web-tests-bounded.log`. |
| root | `bun run --cwd packages/shared build` | Passed, exit 0; rebuilt shared `dist` before downstream typechecks/builds. |
| root | `bun run --cwd packages/shared typecheck` | Passed, exit 0. |
| root | `bun run --cwd apps/api typecheck` | Passed, exit 0. |
| root | `bun run --cwd apps/web typecheck` | Passed, exit 0; includes translation scripts. |
| root | `bun run --cwd apps/api typecheck:e2e` | Passed, exit 0. |
| root | `bun run --cwd apps/api build` | Passed, exit 0. |
| root | `bun run --cwd apps/web build` | Approved execution passed, exit 0; Vite build 26.33 s. Existing Zod annotation and >500 kB chunk warnings remain. JS 1,669.19 kB / 483.44 kB gzip; CSS 124.66 kB / 24.59 kB gzip; favicon 800.23 kB. Log: `web-build-approved.log`. |
| root | `bun run playwright test apps/api/e2e/smoke.spec.ts apps/api/e2e/journey.spec.ts apps/api/e2e/guest.spec.ts apps/api/e2e/guestMigration.spec.ts apps/api/e2e/recovery.spec.ts --reporter=list --output "$auditDir/playwright-main-approved"` | **17 Chromium tests passed**, exit 0, 2.9 min. `$auditDir` is the evidence directory above. Log: `playwright-main-approved.log`. |
| root | `bun run playwright test apps/api/e2e/tripExperience.spec.ts --grep 'AI day previews\|stale day preview' --reporter=list --output "$auditDir/playwright-preview"` | **2 Chromium tests passed**, exit 0, 23.0 s. Log: `playwright-preview.log`. The PowerShell single-quoted regex argument used a literal alternation `AI day previews|stale day preview`; the backslash in this Markdown table escapes its column separator. |
| root | `docker compose config --format json` | Passed, exit 0. Effective publishing is host `127.0.0.1`, published/target `27018`, TCP. MongoDB command, healthcheck, restart policy and `triply_mongo_data:/data/db` preserved. Docker config-read warnings in the sandbox did not prevent rendering. |
| root | `git -c safe.directory=C:/Users/grzes/Desktop/Files/Triply diff --check` | Passed, exit 0; existing LF/CRLF conversion warnings only. Repeated after report creation. |

`packages/shared/package.json` has no test script and no standalone test/spec files were found there. Shared typecheck/build passed; shared behavior is also consumed by API/web tests. No invented shared-test pass is claimed.

Initial sandbox executions of API tests, frontend tests and the frontend build failed to load Vitest/Vite configuration because esbuild could not traverse the parent path. Approved reruns outside the sandbox produced the executable results above. Initial Docker daemon reads failed on named-pipe permissions; approved read-only reruns succeeded. Plain Git status initially rejected dubious ownership; subsequent commands used the per-command `safe.directory` override, without editing global Git configuration.

The initial sandbox Playwright command used the same five specs with output `$auditDir/playwright-main`. Its Vite server failed on access permissions before test execution; the waiting invocation was interrupted, owned ports were checked, and the approved invocation used a new artifact path. Existing development servers were not reused, stopped or restarted. Successful harnesses shut down their own servers and disposable databases.

Not run: the entire configured Playwright matrix, dependency vulnerability feeds, external load tests, real-provider integration, literal process-kill/partition tests, production checks or Docker runtime activation. Full browser expectations still include the disabled Assistant; selected regression passes are not a clean full-browser-gate claim.

### Additional diagnostic results

Temporary diagnostic tests lived only in the evidence directory; application/test files in the repository were not changed. Commands ran from `apps/api`:

```powershell
$auditDir = 'C:\Users\grzes\AppData\Local\Temp\triply-22b-final-20261109-100828'
bun run vitest run --root "$auditDir" --config "$auditDir/probe.config.ts" confirmation-probe.test.ts
bun run vitest run --root "$auditDir" --config "$auditDir/probe.config.ts" confirmation-legacy-probe.test.ts
bun run vitest run --root "$auditDir" --config "$auditDir/probe.config.ts" confirmation-requirements-race.test.ts
```

- `confirmation-probe.test.ts`: 1 failed, exit 1, 3.28 s. The initial hypothesis that an unchanged valid location would be overwritten was **not reproduced**: current latitude remained 41.9, rather than the hypothesized 48.85. This was a failed diagnostic expectation, not an additional application regression.
- `confirmation-legacy-probe.test.ts`: 1 passed, exit 0, 2.74 s. Assertions confirm that a stale malformed legacy location becomes `null` after an intervening valid location update. A passing reproduction asserts the defective state, not successful remediation.
- `confirmation-requirements-race.test.ts`: 1 passed, exit 0, 2.78 s. Replaced the intervening raw update with the real `saveTripRequirements` service and retained the same defective outcome. Weather/attraction provider functions were mocked; unexpected `fetch` throws. The test creates its own local MongoDB process, disconnects and stops it in `finally`.

An earlier direct `bun run "$auditDir/confirmation-probe.ts"` attempt exited 1 before executing the probe because Bun could not resolve `punycode/` in the installed dependency graph. Vitest then executed the diagnostics successfully; this was not treated as an application runtime finding.

## Cross-stage integration and security findings

| ID | Severity | Classification | Status |
| --- | --- | --- | --- |
| F-01 | **Medium** | Confirmed code defect: stale requirements confirmation can undo a concurrent legacy-location repair | Reproduced; requires an authorized fix before closing this verification. |
| F-02 | **High** | Deployment blocker: existing development database is standalone while guest persistence requires transactions | Confirmed runtime state; no activation attempted. Severity reflects essential guest-operation availability, not an observed ownership breach. |
| F-03 | **Medium** | Deployment blocker/security configuration drift: unauthenticated development MongoDB remains wildcard-published | Confirmed Docker publishing; actual LAN/firewall reachability not measured. |
| F-04 | **Low** | Test stability issue: full frontend guest retry test failed once, then passed focused and bounded full runs | Root cause unconfirmed. Preserve failure evidence; do not declare flakiness fixed by a rerun. |
| F-05 | **Low** | Coverage/documentation gaps: no separate #22B.1 report, no literal crash/independent-process experiment, activation/restore not exercised | Explicit limits, not evidence of broken transactional fencing. |

No Critical issue was confirmed. No High code defect or cross-owner access was confirmed in the inspected #22B implementation. The register is scoped; it is not a claim that the whole application has no other issues.

### F-01 — confirmation still has a stale document save boundary

Evidence: `apps/api/src/services/tripDraft.ts:586–599`, `apps/api/src/routes/trips.ts` confirmation handler, and `apps/api/src/models/Trip.ts` schema options. `confirmTripRequirements` validates its loaded snapshot, assigns confirmed/missing fields, normalizes `analysis.location`, then calls `guestWrite(session => trip.save({ session }))`. There is no owner/status/current-requirements CAS on this save and no schema-wide optimistic concurrency option. Mongoose array versioning does not detect concurrent requirements updates made through `findOneAndUpdate` without advancing `__v`.

The verified interleaving:

1. Create a complete Paris draft in an owned disposable database. Insert a synthetic legacy malformed location `{lat: 999, lng: 2.35}` through the raw collection and load snapshot A.
2. Load snapshot B and call real `saveTripRequirements(B, {destination: "Rome", country: "Italy", location: {lat: 41.9, lng: 12.5}}, [])`. Assert that repaired latitude is 41.9.
3. Call real `confirmTripRequirements(A)`. Its stale location fails shared validation and is changed to `null`, which is a dirty path on A.
4. Read the persisted document: destination is still `Rome`, country is still `Italy`, but **location is `null`**. Confirmation succeeded instead of rejecting or reconciling with the current snapshot.

This is a deterministic service-boundary race using the same services as the HTTP handlers. It is not an OS-scheduler timing test or a full HTTP race. Malformed legacy coordinates were injected only into the disposable fixture; their existence in the persistent development data was not checked or assumed. Normal valid-coordinate overwriting was specifically rejected by the first diagnostic. The defect can lose repaired coordinates and cause another destination lookup; it does not demonstrate itinerary/expense loss or cross-account writes.

Relationship to #22B: the atomic attraction backfill is protected, and the guest transaction still serializes against migration. Neither protects two same-owner requirements operations from this stale confirmation save. #22A's backfill roadmap explicitly called for auditing this adjacent confirmation write, so it should not disappear into a blanket #22B closure.

Recommended fix for a separately authorized change: make confirmation a narrow owned, status/input-snapshot-guarded persistence operation, returning a conflict or current authoritative state when it loses. Preserve legacy normalization and transactional guest fencing; add a permanent regression that asserts the repaired coordinates survive. No fix was applied here.

### Interactions that retained their intended boundaries

- **Guest/account isolation:** service owner filters distinguish `guestId + user:null` from `user + guestId:null`. Session-derived admission keys cannot be changed by body/query ownership fields. Guest handoff authority remains bound to the exact authenticated session/context; completed receipts reconcile lost acknowledgments. Public share tokens do not confer ownership/import authority.
- **Migration versus delayed writes:** admitted guest work may finish while pending if its lease remains valid. Resource persistence and import both write the handoff inside transactions, so they conflict/retry rather than allowing a stale writer past ownership transfer. Expired/released authority fails closed, including standalone/database-error cases. An AST inventory guard supplements real mutation tests; it is not proof against arbitrary future abstractions.
- **Backfill versus edits/generation:** the snapshot comparison protects candidate, analysis, weather and clustering inputs even when timestamps collide. A losing backfill reads current owned data and does not upsert a deleted/transferred trip. Snapshot GET avoids provider enrichment while retaining owner checks and existing identity recovery.
- **Admission versus billing:** one shared operation per owner across analysis/full-generation drafts, plus separate location concurrency/windows. Admission precedes guest generation start and Geoapify reservation. Rejection leaves those ledgers untouched; sent/uncertain provider work remains charged. Cancellation does not create automatic credit refunds. Durable accounting and valid-empty/fallback behavior remain covered by the full API suite.
- **Deadline versus authority:** four-minute generation deadline is capped to remaining guest activity minus one second. Run UUID/start/expiry, owner/status and MongoDB-time predicates reject expired/superseded generation completion; cancellation is checked again after entering the guest fence. Ordinary optional-provider failure still degrades appropriately. Release removes only its own token.
- **Frontend revisions/identity:** recovery coalesces invalidations, waits for local mutations, rechecks session identity and uses abortable snapshot detail reads. Identity mutation callbacks and AuthProvider cleanup retain private-cache isolation. The two-tab browser test observed exactly `invalidate`, converged visit/edit locks and an expense correction, retained one automatic expense, and made no extra provider calls.
- **Runtime validation/render recovery:** critical trip/Budget/edit/visit/preview payloads are structurally validated before trusted cache insertion, with requested-trip/day identity checks where supplied. Invalid responses expose a stable safe code, not rejected data. Render recovery does not print exception details or automatically loop. Optional metadata and unrelated endpoints are outside the schema coverage.
- **Health secrecy and behavior:** readiness uses bounded `hello` metadata from a primary with replica-set/session support; it is not a transaction/write probe. Liveness remains independent. Signed cookies cannot force session reads on probe routes, and conditional requests do not turn readiness into 304. Replies expose only deterministic status fields, not DB addresses, versions, credentials or exceptions. Health remains a point-in-time indication, not proof of every permission/quota/disk condition.

## MongoDB runtime assessment

Only read-only Docker commands and MongoDB metadata/count queries were executed. The inspected container is the local Compose development service, not a production database. Another container, `myapp-mongo`, was visible on host loopback port 27017 and was not accessed or changed.

### Actual storage, topology and data

| Property | Observed value |
| --- | --- |
| Container | `triply-mongo`, ID `982dbf542bc2d09fa9b6113fae376f0499d0a50ebdf5ef19d579ad005f90939f` |
| State at inspection | Running; started `2026-11-09T08:20:54.221164565Z`; restart policy `unless-stopped`; no configured container healthcheck |
| Image | MongoDB **7.0.37**; image ID/digest `sha256:340c1c56fb10e95cf79ff547f8664b96bc6ead9909bc355238cbf865a9695a6f` (`mongo:7` currently points to this local image) |
| Runtime command | `["mongod"]`; default internal port 27017; `NoReplicationEnabled` (code 76) |
| Published port | `0.0.0.0:27018->27017/tcp`, `[::]:27018->27017/tcp`; inspect binding has empty host IP |
| Main database volume | Named volume **`triply_mongo_data`** mounted RW at `/data/db`; source `/var/lib/docker/volumes/triply_mongo_data/_data`; approximately **332 MiB** |
| Additional volume | Anonymous volume **`15dfe23d498f2d6276af0fec0e739dcda778f1cedb4c8f5a2f9e9add01a826d7`** at `/data/configdb`; approximately **4 KiB**, no files found in read-only inspection |
| Volume provenance | Both created `2026-10-02T12:28:04Z`; named volume labels identify Compose project `triply` and logical volume `mongo_data` |
| Network | `triply_default`; address `172.19.0.2`; aliases include `mongo` and `triply-mongo`. Only this container was attached at inspection. |
| Replica discovery | `hello` has no `setName`/member list. Standalone reports writable-primary-like capability and sessions, but cannot run the required transactions. |
| Backup tools | `mongodump` **100.17.0** is available inside the existing image. No backup was created or restore attempted during this task. |
| Local application URIs | Both `.env` and `apps/api/.env` select `mongodb`, host `127.0.0.1`, port `27018`, database `/triply`, with neither `replicaSet` nor `directConnection` option. Values were not changed; credentials were not printed. |

The `triply` database contained these estimated document counts at inspection:

| Collection | Count |
| --- | ---: |
| `users` | 15 |
| `trips` | 9 |
| `destinations` | 212 |
| `saveddestinations` | 3 |
| `savedattractions` | 1 |
| `sessions` | 3 |
| `guest_handoffs` | 3 |
| `tripassistantconversations` | 6 |
| `apiUsage` | 6 |
| `guest_usage` | 0 |
| `packing_generation_leases` | 0 |
| `resource_admission` | 0 |

System databases `admin`, `config`, and `local` also exist. Counts are point-in-time estimates, not a backup manifest; session TTL and ordinary application activity may change them. Treat **all existing data and both volumes as preservation targets**. No determination that any user/trip/accounting record is disposable was made.

### Configuration compatibility

Current effective Compose specifies `mongod --replSet rs0 --bind_ip_all --port 27018`, publishes only `127.0.0.1:27018:27018`, mounts the same logical database volume, and initializes a single member `127.0.0.1:27018` only when replica-set status is `NotYetInitialized`.

The live container does not match that command, container port, published host IP, healthcheck or replica topology. Simply restarting it would retain its existing command/port bindings and would not activate these changes. Do not initiate `rs0` on its present standalone command or mistake a file/config change for an activated replica set.

There is **no existing replica-set configuration to preserve/reconfigure** in the inspected live instance. Converting existing standalone files to a single-node replica set requires a controlled restart under the replica-set command and initialization. No application ownership/schema migration is inherently required for that topology conversion, but backup, restore validation and a write-quiescence window are required before changing this data-bearing service.

Discovery compatibility:

- **Current standalone:** host clients can seed-connect through `127.0.0.1:27018`; network clients could seed-connect through `mongo:27017`. Neither gets replica-set discovery/transaction support.
- **Proposed current Compose topology:** the host can discover `127.0.0.1:27018` because published and internal ports match. The MongoDB container's own healthcheck can reach its own `127.0.0.1:27018` in its namespace.
- **A separate application container:** even if it seeds through `mongo:27018`, the advertised `127.0.0.1:27018` points to that application container itself after discovery. Ordinary discovery is incompatible. No separate Docker-network application client is configured or was found attached to this network. If such a client is required, stop this plan and design/test an advertised address resolvable and reachable from every required namespace; do not force reconfiguration or add an unreviewed `directConnection` workaround.

## Non-destructive activation plan — NOT EXECUTED

This is an operator plan for a separately authorized maintenance window. It contains future container lifecycle and backup writes that were expressly prohibited in the verification task. None of the commands in this section was executed. Use the **clone-and-cutover** approach below so the original volume remains a rollback source. Do not run `docker compose down -v`, volume pruning, database drops, or concurrent `mongod` processes against the same data directory.

### 1. Preconditions and recorded configuration

1. Obtain explicit authorization for the maintenance window, writer quiescence, backup, temporary restore-check containers, and replacing this specific MongoDB container. Inventory every local API, seed process, scheduled task and other client; the network listing alone cannot identify host writers. Drain all old API binaries before upgrading guest fencing/admission semantics. Keep the Assistant disabled.
2. Re-run the read-only container, mounts, volume, image, topology and collection/index inventory immediately before the window. Save full `docker inspect` output and effective Compose configuration privately for reconstruction, including any nondefault options; those files/backups may contain sensitive data. Record hashes, the local image digest, database feature-compatibility version and exact collection/index counts. Check disk headroom for originals, two cold archives and cloned/restored volumes. Confirm backup storage is outside the source volumes.
3. Pin activation and restore-check containers to the currently inspected **image digest**, avoiding an incidental `mongo:7` upgrade. Reconfirm the actual digest before executing. Choose new, empty volume names, for example `triply_22b_db_20261109` and `triply_22b_configdb_20261109`; do not overwrite a pre-existing volume with the same name.
4. Keep the current Compose file untouched. Prepare a separate operator override that maps `/data/db` and `/data/configdb` to the new volumes and pins the image. Render the merged configuration and verify both targets, loopback publishing and command before use. Example shape (names must match the actual newly created volumes):

```yaml
services:
  mongo:
    image: mongo@sha256:340c1c56fb10e95cf79ff547f8664b96bc6ead9909bc355238cbf865a9695a6f
    volumes:
      - mongo_22b_db:/data/db
      - mongo_22b_configdb:/data/configdb
volumes:
  mongo_22b_db:
    external: true
    name: triply_22b_db_20261109
  mongo_22b_configdb:
    external: true
    name: triply_22b_configdb_20261109
```

Use explicit project `triply` and explicit base/override file paths. Compose merges volume mounts by container target; inspect the rendered output to ensure `/data/db` points to the clone, not `triply_mongo_data`. Retain this override as part of the activated environment's operational record so a later bare Compose invocation cannot silently select the old volume.

### 2. Backup before any replacement

1. Quiesce all application writers and keep them quiesced through cutover verification. While the old standalone still runs, make a logical archive using its installed tool, for example `docker exec triply-mongo mongodump --host 127.0.0.1 --port 27017 --archive=/tmp/triply-22b-preactivation.archive.gz --gzip`, then `docker cp` that file to a new protected host backup directory. Check both exit codes and hash the copied file. Do not stream the binary archive through Windows PowerShell 5 text redirection. Do not use `--oplog` on a standalone. A full logical dump excludes `local`; the cold copy below preserves the complete on-disk rollback source.
2. Cleanly stop **only `triply-mongo`** after authorization. Confirm it is stopped and no process has the source volumes open. Do not stop Docker globally or touch `myapp-mongo`.
3. With the source stopped, create cold tar archives of **both** original volumes using short-lived, network-disabled helper containers with source mounts read-only and a separate writable backup destination. Preserve numeric ownership/permissions. For `/data/db`, the command pattern is:

```powershell
# Future operator commands only. $backupDir must be an existing protected host directory.
$mongoImage = 'mongo@sha256:340c1c56fb10e95cf79ff547f8664b96bc6ead9909bc355238cbf865a9695a6f'
docker run --rm --network none --mount 'type=volume,source=triply_mongo_data,target=/source,readonly' --mount "type=bind,source=$backupDir,target=/backup" --entrypoint tar $mongoImage -C /source -cpf /backup/data-db.tar .
```

Repeat with source volume `15dfe23d498f2d6276af0fec0e739dcda778f1cedb4c8f5a2f9e9add01a826d7` and archive `data-configdb.tar`. Verify success, archive listings and SHA-256 hashes. A live tar of WiredTiger files is not a consistent backup. Do not delete the original volumes after copying.
4. Restore the cold archives into the new empty clone volumes, using helpers that mount only clones writable and archives read-only (`tar -C /target -xpf ...`). Verify the logical dump by restoring it into a **separate empty test volume/database**, never over the original or activation clone. No `--drop` against any existing database. Start a temporary standalone restore-check container with the pinned image and no external publishing, inspect the clone's counts/indexes, then cleanly stop it before mounting the clone in the final service. No two containers may use that clone simultaneously. Retain restore evidence and all backup artifacts. If restore validation fails, stop the plan and resume the unchanged original service only after deciding how to handle the outage.

Cold clone verification establishes that the files can be opened; a hash alone does not establish restore usability. Logical restore validation is additional recovery evidence. No successful backup/restore is claimed by this report.

### 3. Activate the replica-set clone

1. After backups/restoration checks succeed, remove the **stopped old container metadata only**, without `-v`, to release the fixed `triply-mongo` name. Retain both original volumes and saved inspect/image metadata. This explicitly authorized lifecycle step is different from deleting stored data.
2. Render and inspect `docker compose -p triply -f docker-compose.yml -f <activation-override.yml> config --format json`. Then start only the `mongo` service with those exact files/project and no image pull, for example `docker compose -p triply -f docker-compose.yml -f <activation-override.yml> up -d --no-deps --pull never mongo`. Confirm the old volumes were not selected.
3. Let the existing healthcheck initialize `rs0` on the cloned standalone data and elect the single primary. The member must be exactly `127.0.0.1:27018` for the current host-client topology. If status is anything other than the expected uninitialized-to-primary transition, inspect and stop; do not run forced `rs.reconfig`, delete `local`, or retry destructive initialization. Healthcheck success alone is not the whole acceptance test.
4. Retain the originals, logical backup, cold archives, clone names, pinned image, override and maintenance record. Do not delete them after a green probe.

### 4. Verify before reopening application writes

1. Inspect the new container: command includes `--replSet rs0 --port 27018`, both clone mounts are correct, publishing is exactly `127.0.0.1:27018->27018/tcp`, no wildcard/IPv6 publication remains, and health is healthy. Check host listeners; if possible use a controlled second host to confirm port 27018 is unreachable on the LAN. That reachability experiment was not run here.
2. From inside MongoDB, read `hello`, `rs.status()` and `rs.conf()`: `setName: rs0`, writable primary, sessions, one expected member, expected advertised port. From the Windows host, connect with normal replica discovery to `mongodb://127.0.0.1:27018/triply?replicaSet=rs0` **without `directConnection=true`** and verify the discovered address and primary. Existing local URIs should also discover the set from their loopback seed; explicit `replicaSet=rs0` makes the intended set constraint reviewable. Update client configuration only as an authorized operator action if needed.
3. Compare all non-expiring collection counts, index definitions and representative owned data against the maintenance backup inventory. Explain natural session/TTL differences rather than deleting or recreating records to force counts to match. Preserve accounting/handoff/receipt records, not just trips and users.
4. Commit a real transaction through the **host application's driver** in a uniquely named, dedicated diagnostic database/collection on the local clone; verify the committed marker. Keep the diagnostic record or separately authorize its cleanup. Do not use application records as test targets. Verify a deliberately interrupted diagnostic transaction leaves no partial writes. This is future authorized local runtime testing, not a transaction already attempted on the persistent standalone.
5. Bring up only compatible API binaries, initially without user traffic. Verify `/health` is 200 with the exact safe body, `/health/live` is 200, signed-cookie/conditional probes still behave correctly, and the API uses the intended local clone. Probe timeout should exceed the one-second handler deadline. Readiness must remain 503 until the replica primary is usable.
6. Use a dedicated local guest/account fixture to verify transactional guest mutation, migration and retry receipt before reopening normal traffic. Keep provider transport mocked or disabled; do not call live AI/external providers or enable the Assistant. If those fixtures require cleanup, obtain separate scope instead of deleting existing user data. Test real outage/liveness only in a separately approved exercise or disposable replica; do not stop this newly activated database as an unsolicited health experiment.
7. Reopen writes only after these checks and F-01 remediation acceptance. Record the exact activation/verification results. Single-node `rs0` provides transactions but no replica redundancy/high availability; unauthenticated loopback development configuration is not a production security design.

### 5. Roll back safely

- **Before new writes are accepted:** stop the new API writers, cleanly stop/remove only the activated clone container without volume deletion, retain clones for diagnosis, and recreate the old standalone command using the pinned original image and the **original** named `/data/db` and recorded anonymous `/data/configdb` volumes. Restore original internal port 27017, network aliases and restart policy from saved metadata. Prefer host binding **`127.0.0.1:27018:27017`**, keeping the old broad exposure closed. Do not run the repository's replica-set Compose command against the original rollback volume. An explicit operator `docker run` reconstruction should use `--network triply_default --network-alias mongo --restart unless-stopped`, the two exact original mounts, and `mongod`; verify all additional original options from saved inspect output first.
- Verify old data/counts/indexes against the pre-cutover inventory. Compatible #22B code will correctly remain unready and reject transactional guest writes on that standalone. Restoring the old topology is a containment/data rollback, **not** a successful #22B deployment; leave affected traffic blocked. Do not mix old unfenced API binaries with upgraded workers as a shortcut.
- **After the clone has accepted new writes:** the originals are stale. Never silently switch back to them or restore the preactivation archive over the clone. Freeze writers, back up the clone and preserve all volumes, then plan a separately authorized reconciliation/export/restore of post-cutover changes. A forward topology repair may be safer than data rollback. State the recovery point explicitly; no lossless rollback is promised after divergence.
- If an original volume is damaged, restore a verified cold archive into another **new** volume under the original pinned version, validate it in isolation, and cut over only after approval. Keep the damaged volume and diagnostic logs. Never overwrite the only backup or delete replica metadata to force a restart.

## Remaining risks, accepted limitations and deferred work

| Item | Classification / disposition |
| --- | --- |
| F-01 confirmation race | Confirmed Medium defect requiring an authorized correction and permanent concurrency regression before closure. |
| Standalone/public MongoDB and untested backup activation | Runtime deployment blockers F-02/F-03; plan only, no claim of resolution. Backup usability, host discovery and real activated transactions remain acceptance gates. |
| Mixed-version guest/admission rollout | Operational blocker if old workers remain. Drain every old binary; use shared policy and MongoDB across new replicas. |
| Session/ownership safety | No regression confirmed in reviewed paths and executed tests; no penetration-test guarantee or proof of all possible IDOR paths. |
| Generation/guest timing | Non-renewable five-minute guest authority and four-minute generation budget intentionally reject very slow work. CPU work cooperates at stage/day boundaries; event-loop blocking and clock skew affect availability. Accepted bounded-lifetime policy; real worst-case capacity remains unmeasured. |
| Aggregate resources and egress | Generation/search gates are per identity. Account proliferation, global capacity, provider-wide pacing, ingress limits and process-local supplemental auth/network limiters remain deployment/security-audit concerns. |
| Provider charging | Sent/uncertain requests and crash-held reservations remain durably charged. Deadline/cancellation cannot revoke upstream work. No speculative refund or billing-policy change was made. |
| Recovery consistency | Hidden tabs defer fetches; focus has a ten-second cooldown; no continuous server push. Payload-free broadcasts cause conservative invalidation. Accepted eventual consistency; authoritative revision guards still decide writes. |
| Runtime contracts | Critical mutable responses now validate structure/identity; AI provider envelopes, other endpoints and optional metadata still have known validation gaps (#22A-10). Semantic server totals are not recomputed by response schemas. Remaining coverage belongs to #22C and the provider audit. |
| Assistant | Disabled UI remains disabled. Existing backend endpoints and #22A-13's consume-before-apply/lost-ack limitation are not removed by hiding UI and were not repaired here. Availability/docs/full-browser expectations (#22A-04) and safe confirmation recovery remain #22C/product work before any reactivation. |
| Attachments | Existing ineffective attachment affordance (#22A-21) remains #22C/product work. No ingestion feature or extraction audit was introduced. |
| Diagnostics and provider error logging | #22A-07/08 request correlation/raw upstream error logging concerns remain; provider cancellation edits do not close logging/privacy findings. Address in the planned diagnostics/security work. No actual credential leak was established here. |
| Browser/operational coverage | Selected Chromium tests passed; no full browser gate, Safari/Firefox/physical-device certification, actual multi-node election, network partition or independent-process crash test. Test-stability failure F-04 remains recorded. |
| Delivery/scaling/tooling | Existing large bundle, unbounded account histories, service cycles, locale/error-contract work and lint/visual-gate gaps remain the #22C/#22D roadmap. No new feature or broad cleanup was attempted. |
| Public launch | Authenticated production DB/TLS/secrets/probes/backups, production traffic and dependency vulnerability status are unverified. Separate adversarial prompt-injection/AI and external API audit is still required; that audit was not started. |

## Recommended next actions

1. Authorize and implement the narrow F-01 confirmation CAS/reconciliation fix, preserving guest transaction barriers and adding the reproduced legacy-location race as a permanent regression. Re-run affected integration tests and frontend confirmation compatibility checks.
2. Investigate the guest retry test's first-run failure without weakening its error/retry assertion. Retain both failed and passing evidence; confirm a stable intended CI worker policy.
3. Review/authorize the backup-first MongoDB maintenance plan. Prove restore usability, activate on cloned storage, and record host discovery, transaction, loopback and readiness acceptance before treating #22B.5 runtime deployment as complete.
4. Record coordinated old-worker draining and the operational override/volume/image inventory. Preserve backups/originals through the agreed recovery window; no cleanup is implied by this report.
5. Continue #22C scope alignment and the separately planned public-launch adversarial AI/external API audit. Keep the Assistant disabled until its availability and recovery contracts are explicitly resolved.

## Git and environment integrity

Before tests, SHA-256 hashes were captured for **608 existing tracked/untracked, non-ignored files** in the permitted Temp directory, together with the original Git status. After verification all **608 were byte-for-byte unchanged**, with no missing files. After report creation the comparison was repeated; the only new non-ignored file is `docs/audits/22B-final-verification.md`. Existing ignored diagnostics were not deleted or targeted for overwrite; generated build/test caches are not covered by the 608-file claim.

HEAD remained `a6a8ec8864f2f2a81cf673182bca1f0963803183`, branch remained `chore/technical-audit`, and the staged diff remained empty. No commit, push, branch creation/switch, reset, stash, dependency install, database migration/reset, Docker container lifecycle change or volume deletion was performed. Final Docker inspection retained the same existing container ID/start time/command/binding/mounts. Test harnesses owned their disposable processes and databases; no existing service was reused or reconfigured.

`git diff --check` passed after writing the report. The report intentionally leaves the confirmed defect and operational drift unresolved.

**NEEDS FIXES**

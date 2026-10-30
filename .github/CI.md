# Triply CI

`workflows/ci.yml` validates pull requests targeting `main` and pushes to `main`.
Both jobs use the Bun version in `package.json` and Node 24. Superseded runs
are cancelled; the workflow has read-only repository permissions and no secrets
or deployment steps.

## Monorepo validation

The validation job runs translation validation/audit, workspace typechecks,
API and frontend Vitest suites, production builds and repository integrity checks.
Turbo builds `shared/dist` before dependent tasks. Vitest runs directly so
Turbo's strict environment filtering does not discard CI test settings.

API global setup resolves/downloads the MongoDB binary once before creating
workers. Each worker receives its absolute path as `MONGOMS_SYSTEM_BINARY` and
`MONGOMS_RUNTIME_DOWNLOAD=false`. Test files retain independent databases and
own their shutdown; standalone and replica-set migration tests remain separate.
A failed preparation fails the run before test execution. Unhandled errors are
not ignored. Both Vitest suites allow at most four workers.

Frontend Vitest prebundles MUI entry points and their used subpaths together.
The separate `apps/web/vitest.config.ts` leaves the development and production
Vite optimizer configuration unchanged. Keeping subpaths on the same graph
avoids duplicate Emotion instances.

The API uses test-only configuration and empty provider keys. Tests mock
application providers; no production database or paid API is required.
JSON Vitest reports are uploaded even on failure and retained for seven days.

## Browser tests

The complete Chromium suite is divided across four GitHub-hosted runners using
`--shard=1/4` through `--shard=4/4`. Each runner has its own Fastify/Vite servers,
token-protected control service and disposable MongoDB replica set. Each shard
retains one Playwright worker because its fixtures reset shared server state.
`fullyParallel: true` enables sharding individual tests instead of whole files;
it does not make a shard concurrent while `workers: 1` is set.
Do not raise `workers` without isolating that state first.

No scenarios are excluded or retried. `fail-fast: false` lets every shard finish
and report failures. Each shard has a 25-minute job timeout. Sharding reduces
elapsed time at the cost of four runner setups; actual hosted speedup must
be measured in GitHub Actions.

Playwright uploads HTML/JSON results and failure screenshots/traces after every
run, using unique artifact names for each shard. Retention is seven days.
`test-results/results.json` contains per-test durations and final status.

## Caches and local execution

Both jobs cache Bun downloads by OS, architecture, Bun version and lockfile.
MongoDB binaries are cached separately by OS, architecture, Ubuntu release and
lockfile. An empty binary cache is safe: API global setup prepares it before
workers start; the E2E server starts its sole replica set before browser tests.
Database contents, `node_modules` and Turbo outputs are not cached by Actions.
Chromium/system dependencies are installed with Playwright in every browser job.

```sh
bun run typecheck
bun run --cwd apps/api test
bun run --cwd apps/web test
bun run build
bun run typecheck:e2e
bun run test:e2e
bun run test:e2e --shard=1/4
```

For an individual API file, use `bun run --cwd apps/api vitest run <file>`.
Appending a file to the API `test` script retains its existing `src` filter;
Vitest combines these filters and still runs the full source suite.

The local audit and consolidation recommendations are in
[`docs/testing-audit.md`](../docs/testing-audit.md). Local Windows verification
does not replace a fresh-cache Ubuntu/GitHub-hosted workflow run.

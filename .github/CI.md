# Triply CI

`workflows/ci.yml` validates pull requests targeting `main` and pushes to `main`.
The validation job on Ubuntu 24.04 runs these commands in order:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run --cwd apps/api test
bun run --cwd apps/web test
bun run build
git diff --check HEAD
git diff --exit-code HEAD -- bun.lock package.json apps/api/package.json apps/web/package.json packages/shared/package.json
```

`setup-bun` reads the exact Bun version from root `package.json`'s
`packageManager` field (currently `bun@1.3.14`). Update that field deliberately
when upgrading Bun. Actions use maintained major versions.

Only `~/.bun/install/cache` is cached, keyed by runner OS, architecture, Bun
version, and `bun.lock` hash. Installation always runs, even on a cache hit.
Neither `node_modules`, Turbo outputs, nor MongoDB databases are cached.

Typechecking covers the API, web app, and shared package. The existing Turbo
dependency graph builds `shared/dist` before app checks; builds reuse that local
result. Both test scripts run Vitest without watch mode. Tests run directly to
preserve their environment variables without changing Turbo configuration.

API tests use `NODE_ENV=test`, a public test-only session secret, empty provider
keys, and an unused loopback database URI. Existing integration tests explicitly
connect to `MongoMemoryServer.getUri()` and clean up their databases. Existing
provider tests mock AI, Geoapify, routing, weather, and other HTTP calls. No
production database or external API credentials are needed. The MongoDB binary
may be downloaded by mongodb-memory-server on a fresh runner; package and binary
downloads require network access, but application services are mocked. No MongoDB
service container is required. Compilation needs no runtime secrets and leaves
production session-secret validation unchanged.

The token has only `contents: read`; checkout does not persist credentials.
Superseded runs for the same PR or branch are cancelled. There are no deployments,
secret references, write operations to GitHub, or `pull_request_target` triggers.
Each check has a named step and preserves normal failure output and exit codes.
There is no existing report-file configuration, so diagnostics remain in job logs.

Linting is a separate follow-up: the repository currently has no lint script or
ESLint configuration. The first GitHub-hosted run must confirm Linux MongoDB binary
download/startup and the workflow's runner/action integration.

The existing separate Chromium E2E job runs `bun run test:e2e` (all specs),
including Explore discovery, destination planning, Saved and Explore hardening.
Its timeout is 25 minutes. These tests use browser-to-Fastify-to-MongoDB
communication with deterministic external provider fixtures, without production
credentials. Hardening coverage includes real server failures and recovery,
image fallback, identity isolation, generation, keyboard controls, request counts
and widths 320/375/768/1024/1440. Fault injection is confined to the existing
guarded E2E server and its token-protected loopback control service.

`collections.spec.ts` adds editorial collection navigation, editable wizard
suggestions through generation, Saved synchronization, guest import and missing
destination recovery to the same automatically discovered E2E suite.

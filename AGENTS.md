# Project instructions

This is a Turborepo monorepo.

## Package manager

Use Bun only.
Do not use npm or yarn.

## Structure

apps/web:
- React
- Vite
- TypeScript

apps/api:
- Express
- MongoDB
- Mongoose
- AI provider layer (Gemini/OpenRouter for trip parsing, no SDK — plain `fetch`)

packages/shared:
- Shared TypeScript types
- Shared zod schemas for the API contracts
- Built with `tsc` to `dist`; consumed as `@triply/shared`

## Rules

- Always use TypeScript.
- Prefer existing patterns over introducing new libraries.
- Reuse types from packages/shared.
- Keep frontend and backend contracts synchronized.
- Do not modify unrelated files.
- Explain changes before applying them.
- Create TODO list for every job.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

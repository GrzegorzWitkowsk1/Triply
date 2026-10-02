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
- Fastify
- MongoDB
- Mongoose

packages/shared:
- Shared TypeScript types

## Rules

- Always use TypeScript.
- Prefer existing patterns over introducing new libraries.
- Reuse types from packages/shared.
- Keep frontend and backend contracts synchronized.
- Do not modify unrelated files.
- Explain changes before applying them.
- Create TODO list for every job.

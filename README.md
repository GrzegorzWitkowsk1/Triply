# Triply

Trip organizer monorepo: React + TypeScript frontend, Express + TypeScript backend, MongoDB.

Brand color: `#f2664b`

## Structure

```
apps/
  api/   Express + Mongoose backend (port 4000)
  web/   Vite + React frontend (port 5173)
```

## Prerequisites

- [Bun](https://bun.sh)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

## Setup

```bash
bun install
cp .env.example apps/api/.env
docker compose up -d
```

## Run

```bash
bun run dev      # both apps at once (turborepo)
bun run dev:api  # backend only on http://localhost:4000
bun run dev:web  # frontend only on http://localhost:5173
```

## Endpoints

- `GET /health` — service health, includes MongoDB connection status
- `POST /api/auth/register` — create an account and start a session
- `POST /api/auth/login` — start a session
- `POST /api/auth/logout` — destroy the session
- `GET /api/auth/session` — current user (requires a session)
- `GET /api/profile` — profile settings for the current user
- `PUT /api/profile` — update `name` and `surname` (email is read-only)
- `PUT /api/profile/avatar` — upload a JPG/PNG avatar, multipart field `avatar`, up to `AVATAR_MAX_BYTES`
- `POST /api/profile/password` — change password; body is `currentPassword`, `newPassword`, `repeatPassword`
- `GET /api/avatars/:fileId` — public, immutable-cached avatar image (bytes are stored in MongoDB via GridFS)

The Vite dev server proxies `/health` and `/api` to the backend.

## Avatar storage

Avatars are stored as GridFS files in the `AVATAR_BUCKET` collection (`avatars` by default) and referenced from the user document by `avatarFileId`. `GET /api/profile` and the auth responses return a ready-to-use `avatarUrl`, or `null` when no avatar is set. Uploading a new avatar deletes the previous file, so re-uploads do not accumulate orphans.

## Authentication

Authentication uses an HttpOnly `triply.sid` cookie backed by MongoDB. Set a unique `SESSION_SECRET` of at least 32 characters in `apps/api/.env`. The compiled API start command forces production mode; production deployments should set `WEB_ORIGIN`, configure `TRUST_PROXY` for the reverse proxy, and forward `/api` to the API with an SPA fallback for frontend routes.

Public web routes are `/login` and `/register`; authenticated app routes are protected in the client and by the API session middleware.

## Useful commands

```bash
bun run typecheck   # typecheck both apps (turborepo)
bun run build       # build both apps (turborepo, cached)
docker compose down  # stop database (data kept in volume)
```

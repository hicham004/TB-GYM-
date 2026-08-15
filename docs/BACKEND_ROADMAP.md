# Backend Roadmap

## Current Local Backend

The app is now independent from the original hosted backend.

- Runtime: Node.js
- API: Express 5
- Auth: JWT in an HTTP-only cookie
- ORM: Prisma 7
- Storage: local SQLite-compatible database at `data/tb-gym-dev.db`
- Driver adapter: `@prisma/adapter-libsql`
- Migrations: `prisma/migrations`
- Uploads: local files in `data/uploads`
- Frontend adapter: `src/api/localClient.js`

This phase is intentionally shaped like the old entity API so the recovered React app can keep working while the backend is replaced underneath it.
The old `data/db.json` file is now only a one-time import source for existing local data.

Local Postgres was not set up on this machine because neither Docker nor `psql` is installed.
The current SQLite-compatible Prisma setup is the local development database, not the final production database.

## Production Target

Use this stack when the product is ready to leave local development:

- Node.js 24 LTS
- Express 5 or NestJS/Fastify if the API grows substantially
- PostgreSQL
- Prisma ORM
- JWT refresh/access tokens or session cookies with CSRF protection
- S3-compatible object storage for exercise videos and meal images
- OpenAI integration for AI meal import
- Dockerized API and web deploy
- CI checks for lint, build, tests, migrations, and audit

## Completed

- Removed Base44 SDK/plugin usage.
- Added a local Express API with auth, upload, and entity endpoints.
- Converted `entities/*.json` into Prisma models.
- Added indexes for `client_id`, `program_id`, `created_date`, `status`, and email.
- Swapped `server/store.js` from JSON persistence to Prisma-backed CRUD.
- Added one-time import from `data/db.json` into Prisma.

## Next Backend Phases

1. Stabilize the API.
   - Add automated tests around auth, CRUD, uploads, and client workflows.
   - Add request validation with Zod for every create/update route.
   - Convert important generic entity endpoints into explicit domain routes.

2. Harden auth and authorization.
   - Add password reset.
   - Add role-based access checks per endpoint.
   - Add admin-only routes for invites, client deletion, subscriptions, and access requests.
   - Add audit logs for destructive actions.

3. Normalize the deepest data structures.
   - Split program exercises, meals, meal ingredients, and diet day logs into relational child tables where needed.
   - Add foreign keys after the workflows are explicit enough to enforce safely.
   - Add transactional service functions for program duplication, client deletion, subscriptions, and diet logging.

4. Move to production Postgres.
   - Pick a managed Postgres host: Neon, Supabase, Railway Postgres, Prisma Postgres, Render, or AWS RDS.
   - Switch the Prisma datasource provider to `postgresql`.
   - Replace the SQLite adapter with the Postgres adapter.
   - Run migrations against a staging database first, then production.

5. Productionize uploads and AI.
   - Store uploads outside the app server.
   - Add signed URLs.
   - Connect meal import to OpenAI with server-side API keys.
   - Add rate limits and usage logs.

6. Deploy.
   - API: Render/Fly.io/Railway/AWS, depending on budget.
   - DB: Neon, Supabase, Railway Postgres, or Prisma Postgres.
   - Web: Vercel/Netlify/static hosting, or served by the API.

## References

- Node.js release status: https://nodejs.org/en/about/previous-releases
- Express: https://expressjs.com/
- Express 5 migration guide: https://expressjs.com/en/guide/migrating-5/
- Prisma SQLite support: https://www.prisma.io/docs/orm/core-concepts/supported-databases/sqlite
- Prisma database drivers: https://www.prisma.io/docs/orm/core-concepts/supported-databases/database-drivers
- Prisma PostgreSQL support: https://www.prisma.io/docs/orm/core-concepts/supported-databases/postgresql

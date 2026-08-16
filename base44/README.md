# TB Gym

Local full-stack gym coaching app recovered from an exported Base44 frontend and migrated to an owned backend.

## Run Locally

```powershell
npm install
npm run db:generate
npm run db:migrate
npm run dev
```

Open:

```text
http://127.0.0.1:5173/
```

Default local admin:

```text
email: admin@gym.local
password: admin123
```

## Backend

The API runs on `http://127.0.0.1:4000` and stores local development data in `data/tb-gym-dev.db`.
Uploaded files are stored in `data/uploads`.

Current backend stack:

- Node.js + Express 5
- JWT auth in an HTTP-only cookie
- Prisma ORM 7
- Local SQLite-compatible DB through `@prisma/adapter-libsql`
- Migration files in `prisma/migrations`
- Frontend adapter at `src/api/localClient.js`

The server keeps the recovered app moving by exposing a legacy-compatible entity API at `/api/entities/:entity`.
The old `data/db.json` file is only read once to import existing local data into Prisma, then the app uses the database.

Useful commands:

```powershell
npm run db:generate
npm run db:migrate -- --name your_migration_name
npm run db:studio
npm run lint
npm run build
```

For production, switch `DATABASE_URL` to a hosted PostgreSQL connection and update the Prisma datasource/provider as part of the production migration plan in `docs/BACKEND_ROADMAP.md`.

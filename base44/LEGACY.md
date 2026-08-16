# Legacy TB Gym Application

This directory preserves the recovered Base44-era implementation as a reference application.

It contains:

- the React 18 and Vite frontend;
- the Express compatibility API;
- the Prisma 7 and local SQLite persistence layer;
- original entity JSON definitions;
- local runtime data and uploads that existed at preservation time.

The legacy application is not the architectural foundation for the new product. Its screens and workflows are useful discovery material, but its generic entity API and client-side business rules must not be copied into the new backend.

To run the preserved application independently:

```powershell
cd base44
npm install
npm run db:generate
npm run db:migrate
npm run dev
```


# ORBIT — Subscription intelligence

ORBIT runs locally with a Python standard-library HTTP API and a persistent SQLite database. Supabase and Docker are not required.

## Run locally

Requirements: Python 3 and Node.js 20 or newer.

In the project folder, start the API and SQLite database:

```sh
npm run backend:start
```

In another terminal, start the frontend:

```sh
npm install
npm run dev
```

Open the Vite URL shown in the terminal. The API listens only on `127.0.0.1:8000`; SQLite data is stored in `backend/orbit.sqlite3`. The server initializes the schema from [`backend/schema.sql`](./backend/schema.sql) and inserts the local administrator from [`backend/seed.sql`](./backend/seed.sql) on first start.

## Sign in

- Email: `demo@orbit.local`
- Password: any non-empty value

The local demo account always enters the local administrator workspace. This password bypass is only implemented in the loopback-only local API; do not expose this development backend to a network or use it for production authentication.

## Local database

The schema and seed are plain SQL files in `backend/`. Records created in the app persist in the SQLite database. To reset the local workspace, stop the API and remove only `backend/orbit.sqlite3`, then start it again. The database is local development data; do not store production or sensitive customer data in this demo setup.

The local API currently handles login and session persistence, record CRUD, dashboard metrics, payments, quotation actions, subscription actions, and recurring invoice generation. No payment gateway or email delivery is configured.

## Hosted Supabase

The frontend has been switched to the local API. The SQL migration and Edge Functions under `supabase/` remain available for the earlier hosted-Supabase deployment, but they are not needed for this local setup.

# ORBIT — Subscription intelligence

ORBIT is a React + TypeScript subscription-management app backed by Supabase Auth, PostgreSQL, Row Level Security, and Edge Functions. It intentionally starts with an empty database: there are no hard-coded business records or fake dashboard metrics.

## Run locally

Requirements: Node.js 20 or newer, npm, and a Supabase project.

```sh
npm install
cp .env.example .env.local
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`. These are the public project URL and anon/publishable key; **never** put the service-role key in a `VITE_` variable or browser code.

Apply the schema:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Alternatively, run [`supabase/migrations/20261031000000_orbit.sql`](./supabase/migrations/20261031000000_orbit.sql) in the Supabase SQL Editor.

Deploy the authenticated business functions:

```sh
supabase functions deploy create-staff
supabase functions deploy quotation-workflows
supabase functions deploy record-payment
supabase functions deploy subscription-action
supabase functions deploy run-billing
```

Start the app:

```sh
npm run dev
```

## First administrator

Public registration always creates a customer account. After registering and verifying the owner email, promote that account to the initial workspace administrator from the Supabase SQL Editor (replace the example address):

```sql
update public.profiles
set role = 'admin'
where id = (
  select id from auth.users where email = lower('owner@example.com')
);

insert into public.staff (profile_id, full_name, email)
select id, full_name, lower('owner@example.com')
from public.profiles
where id = (select id from auth.users where email = lower('owner@example.com'))
on conflict (profile_id) do nothing;
```

Creating additional staff accounts is only available to admins through the protected `create-staff` function. Staff passwords must be 9+ characters and include uppercase, lowercase, and a special character.

## Supabase settings

- Add the app origin and `/reset-password` to Supabase Auth's site and redirect URL allow-lists.
- Enable email confirmation and configure the project email provider before inviting real customers.
- Supabase Edge Functions provide `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to the server runtime. Do not copy the service key to the frontend.
- Set `APP_ORIGIN` to the deployed app origin for Edge Function CORS.
- To run billing on a schedule, set a high-entropy `ORBIT_SCHEDULE_SECRET` in Edge Function secrets and configure a scheduler to `POST` to `/functions/v1/run-billing` with `x-orbit-schedule-secret` and JSON body `{"source":"scheduled"}`. The function checks this secret before using its service-role client. Manual billing runs require an authenticated admin or staff account.

## Included workflows

- Email/password registration, login, sign-out, and password reset; new public accounts are always customers.
- Admin-managed products, product variants, plans, quotation templates, taxes, discounts, and staff.
- Quotation line creation, send/confirm transitions, and atomic conversion to a subscription.
- Subscription pause, resume, cancellation, renewal, and plan/role checks.
- Idempotent recurring billing with a unique subscription-period invoice key, per-run error records, retryable drafts, tax and eligible subscription-discount application.
- Invoice confirmation, cancellation safeguards, print-to-PDF, partial payment allocation, and balance-based paid status. Payments are manual records only; no payment gateway is implied.
- Customer-scoped portal data enforced by database RLS, not just route visibility.
- Database-calculated dashboard and report aggregates, paginated searchable module tables, and CSV export.

## Validation

```sh
npm run build
npm audit --omit=dev
```

The app cannot connect to a real Supabase project until project credentials are configured. No credentials, payment gateway keys, or seeded customer data are included.

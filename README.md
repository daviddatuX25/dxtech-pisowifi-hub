# Announcement Room

A branch-aware private notice board for offers and issue reports. Users identify their own device with one Device ID, name, and branch; administrators review requests and manually fulfill approved offers in the separate external system.

## Stack

- Vite + TypeScript static SPA
- Cloudflare Pages for the frontend
- Supabase Postgres, Edge Functions, private Storage, and Auth
- Optional browser push through Web Push and a scheduled Supabase Edge Function

The browser is never asked for a MAC address or hardware fingerprint. The Device ID is user-entered, normalized to uppercase in the UI, and unique to one profile in the database. Profile editing keeps the same profile session and history.

## Local setup

1. Install Node.js 20+ and the Supabase CLI.
2. Copy `.env.example` to `.env.local`.
3. Fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from Supabase Project Settings → API.
4. Add a public VAPID key to `VITE_VAPID_PUBLIC_KEY` if push notifications are needed. Generate a pair with `npx web-push generate-vapid-keys`.
5. Install and build:

   ```sh
   npm install
   npm run build
   npm run dev
   ```

Without Supabase values, the UI stays in an explicit configuration state and does not pretend that submissions are saved.

## Supabase setup

From this directory, link the project and apply the migration:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Set Edge Function secrets. Keep the service-role and VAPID private keys server-side only:

```sh
supabase secrets set \
  SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY \
  NOTIFY_WORKER_SECRET=YOUR_LONG_RANDOM_SECRET \
  VAPID_SUBJECT=mailto:owner@example.com \
  VAPID_PUBLIC_KEY=YOUR_WEB_PUSH_PUBLIC_KEY \
  VAPID_PRIVATE_KEY=YOUR_WEB_PUSH_PRIVATE_KEY \
  ALLOWED_ORIGIN=https://YOUR_PAGES_DOMAIN.example
```

Deploy both functions:

```sh
supabase functions deploy api --no-verify-jwt
supabase functions deploy notify-worker --no-verify-jwt
```

The `api` function performs its own profile-token and Supabase Auth checks. The worker performs its own `x-cron-secret` check because it is invoked by a scheduler.

## Admin access

1. Create an administrator in Supabase Auth with email/password.
2. Insert the same Auth user UUID into `public.admins` from the SQL editor:

   ```sql
   insert into public.admins (user_id, display_name)
   values ('AUTH_USER_UUID', 'Owner');
   ```

3. Open `#/admin`, sign in, create branches, then configure promotions and capacities.

The launch seed includes `Lisa’s Canteen [Candon] Branch` and `Pudoc Branch`; the Device ID reference image is persisted at `public/device-id-help.jpg`. Configure credentials and promotion names in the admin surface after deployment.

## Push worker schedule

Invoke the worker every few minutes from an external scheduler or Supabase-compatible cron integration:

```sh
curl -X POST \
  -H 'x-cron-secret: YOUR_LONG_RANDOM_SECRET' \
  https://YOUR_PROJECT_REF.supabase.co/functions/v1/notify-worker
```

The worker claims pending jobs, retries transient delivery failures, retires expired subscriptions, and marks jobs failed after five attempts. A denied or unsupported browser permission leaves the room usable.

## Privacy and operations

- `student-documents` is a private Storage bucket; administrators receive short-lived signed URLs only after authentication.
- Accepted student document types: JPG, PNG, WebP; maximum size: 5 MiB.
- Public users never query private tables directly; the API uses profile sessions and a service role.
- Request approval and per-branch slot consumption happen in one locked database function, so pending requests do not reserve capacity and concurrent approvals cannot overbook.
- Review the retention period, production domain, branch list, and rejection/reopen policy before launch; these are intentionally not fabricated here.

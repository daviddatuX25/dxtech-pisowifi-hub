# Announcement Room

A branch-aware private notice board for offers and issue reports. Users identify their own device with one Device ID, name, and branch; administrators review requests and manually fulfill approved offers in the separate external system.

## Stack

- Vite + TypeScript static SPA
- Render or Cloudflare Pages for the static frontend
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

From this directory, link the project and apply all pending migrations:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push --remote
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

### Updating an existing deployment

Render hosts the frontend; redeploying it does not apply Supabase database migrations or update Edge Functions. Apply database changes before deploying the matching API:

```sh
supabase migration list
supabase db push --remote &&
supabase functions deploy api --no-verify-jwt
```

Voucher imports require `0006_branch_isolated_vouchers.sql`, which adds the unique `(promotion_id, branch_id, code)` constraint. Without it, the old API can save a promotion and then fail to import its vouchers. `0008_atomic_promotion_save.sql` makes promotion, capacity, voucher, and audit writes transactional: a failed voucher insert rolls back the whole save. The updated API reports `SCHEMA_OUTDATED` if the required schema or RPC is missing.

After updating, edit the existing empty promotion and paste its vouchers again rather than creating another promotion. A failed earlier import does not retain the pasted codes in the database.

`--remote` explicitly targets the linked Supabase project instead of a local Docker stack. Frontend changes, including the Delete button, also require deploying the updated frontend code to Render.

### Deleting promotions

In **Admin → Promotions → Existing Promotions**, choose **Delete** on the target promo and confirm its name. Deletion permanently removes the unused promotion, its unused vouchers, and its branch capacities. Pending publication notifications are canceled, and the deletion is retained in the audit log.

Any customer request (pending, approved, or rejected), claimed voucher, or approved capacity prevents deletion. Unpublish or disable those promotions instead to preserve customer history. Empty duplicates and stocked-but-unused promotions can be deleted.

This requires `0009_delete_promotion.sql`, the updated `api` Edge Function, and the updated frontend. Deletion is admin-only and transactional; database or audit failures leave the promotion intact.

The database regression scripts run against a disposable local database with all migrations applied:

```sh
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/promotion_save.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/promotion_delete.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/promotion_declared_duration.sql
```

They check voucher saving and rollback, branch isolation, duplicate preservation, approved-capacity conflicts, deletion and history protection, notification cleanup, and RPC access restrictions. Their fixtures are rolled back.

### Voucher times and A4 promo posters

- **Quick Paste Codes:** paste comma-separated codes and enter **Common Batch Voucher Duration** once (for example, `1 Hour`). Every code without its own time receives that duration.
- **Spreadsheet imports:** use the same common duration for rows without a time. A duration supplied by a spreadsheet row takes precedence. New voucher imports require a declared time for every row; existing legacy inventory remains readable.
- **Share / QR:** the sharing dialog previews the saved promo title, description, and declared promo time on the approved A4 poster. It defaults to an empty QR box for later placement; choose **Add a scannable promo QR** to embed the actual promo link. Private voucher codes are never printed.
- Download a **2480 × 3508 PNG with 300-dpi metadata** or a self-contained **210 × 297 mm SVG**. The embedded poster fonts are self-hosted, with their SIL Open Font Licenses in `src/assets/poster/`.
- **Declared promo time:** edit this optional field on any existing or new promotion. It is stored separately in `promotions.declared_duration` (up to 80 characters), takes priority on posters, and does not rewrite imported voucher times or customer claims. Clearing it restores the inventory-derived fallback: a single known available time is shown exactly, while mixed/undeclared inventory and manual top-ups are labelled honestly.

The labelled sample artwork is available at `/promo-poster-a4-preview.png` and `/promo-poster-a4-preview.svg`. Its sample title and time are not live promotion data.

Editable declarations require `0010_promotion_declared_duration.sql`, which backfills existing promos only when every voucher has the same nonblank time. Mixed or unknown inventory is not guessed. Apply migrations before deploying the matching API, then deploy the updated Render frontend:

```sh
supabase db push --remote &&
supabase functions deploy api --no-verify-jwt
```

Redeploying only the frontend leaves voucher posters showing an explicit duration-data-unavailable warning until the API is updated.

### Printing and fixed QR placement

Choose **Print** on an existing promotion to open the approved A4 poster in its own print window and invoke the browser print dialog. It uses saved data, not unsaved editor drafts. **Print A4** in the sharing dialog prints its current QR/placeholder selection. The print window retains a reprint button; canceling the browser dialog is not reported as a successful print.

`src/poster-layout.ts` is the canonical geometry for printing, SVG previews, PNG exports, and QR insertion. Each generated SVG embeds its placement map as metadata. Coordinates below start at the top-left of an A4 portrait page at 100% / Actual size with zero CSS page margins:

| Region | SVG rectangle (x, y, width, height) | A4 rectangle in mm, rounded |
|---|---|---|
| Visible QR frame | `58, 847, 216, 216` | `15.34, 224.01, 57.13, 57.13` |
| QR insertion area, including its own quiet zone | `74, 863, 184, 184` | `19.57, 228.24, 48.66, 48.66` |

The viewBox is `794 × 1123`; the PNG is `2480 × 3508`. The insertion area is approximately `x=231, y=2696, 575 × 575 px` in that PNG. Preserve the surrounding white space. Disable browser headers/footers; printer “fit to page” or hardware margins can change physical placement.



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

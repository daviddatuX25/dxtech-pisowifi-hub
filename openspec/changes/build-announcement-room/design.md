## Context

This is a greenfield, mostly static announcement room for a small audience. Users complete one onboarding form, then use one home screen to view promotions or report issues. Administrators publish branch-specific promotions, review submissions, approve individual or bulk requests, copy Device IDs into a separate operational system, and optionally notify subscribed users. There is no automatic reward redemption or external destination URL.

The browser cannot provide a MAC address or trustworthy hardware identity. The user-entered Device ID is an operational identifier, not an authentication credential; one normalized Device ID maps to one profile row. The backend must own request state, slot accounting, private student documents, and administrator actions.

## Goals / Non-Goals

**Goals:**

- Deliver one static SPA with onboarding, Promos, Issues, request history, and admin routes.
- Keep the public experience short: profile data is entered once and reused.
- Support configurable promotion names, audiences, branches, and capacities.
- Keep pending requests from consuming slots; consume capacity only on approval.
- Make individual and bulk review safe under concurrent admin actions.
- Store student documents privately and expose them only to authenticated admins through short-lived URLs.
- Make browser notifications optional and failure-tolerant.
- Keep all reward fulfillment manual through the administrator's separate system.
- Leave a clear migration path from the first deployment to stronger user authentication if abuse requires it.

**Non-Goals:**

- MAC-address collection, browser fingerprint permission prompts, or claims of hardware-level device enforcement.
- Automatic reward delivery, redemption links, destination redirects, payment processing, or partner-system integration.
- Public user accounts, passwords, or identity verification beyond submitted profile data in the first version.
- A general-purpose CMS, analytics platform, chat system, or mobile native application.

## Decisions

### 1. Static SPA with Supabase backend

The frontend SHALL be a Vite-built TypeScript single-page application deployable as static assets to Cloudflare Pages. Supabase SHALL provide Postgres, Edge Functions, Auth for administrators, and private Storage.

- **Why:** This keeps hosting simple while providing transactions, authentication, and private files.
- **Alternative considered:** Render web service; rejected for the first version because a sleeping server and custom auth add operational work.
- **Alternative considered:** Fully static JSON/localStorage; rejected because slot counts, approvals, private uploads, and notifications require server state.

### 2. Anonymous profile sessions for public users

Users SHALL not create passwords in the first version. Onboarding SHALL create a profile and receive an opaque profile-session token. The browser SHALL retain the token locally and send it to public Edge Functions. The database SHALL store only a hash of the token. Public functions SHALL return only the current profile's data and requests. The profile editor updates that same row for a new name or Device ID, while preserving the profile token, branch, and history.

The session is a convenience handle, not proof of identity. A user who clears browser storage may need to onboard again; a malicious user can still submit false self-reported details.

- **Why:** It preserves the simple onboarding requested while preventing anonymous callers from enumerating all submissions.
- **Alternative considered:** Supabase Auth for every user; deferred because it adds password/email friction.
- **Alternative considered:** Direct public database access with RLS; rejected because anonymous profile ownership and document handling are clearer behind narrow functions.

### 3. Edge Functions own public and admin commands

The SPA SHALL call narrow functions for onboarding, profile updates, public promo listing, promo requests, issue submission, push subscription registration, admin queries, and admin mutations. Admin functions SHALL validate a Supabase Auth JWT and an admin-role record before using privileged database access. The service-role key SHALL exist only in Edge Function secrets.

Request validation SHALL run in the function even when the browser performs the same validation. Public responses SHALL exclude private documents, admin notes, audit logs, and unrelated users.

### 4. Relational state model

The initial schema SHALL use these ownership boundaries:

```text
branches
profiles ──< student_documents
profiles ──< promo_requests >── promotions
profiles ──< issues
promotions ──< promotion_slots >── branches
profiles ──< push_subscriptions
admins ──< audit_logs
notification_jobs reference promotion/request/issue events
```

Core fields:

- `profiles`: `device_id`, `name`, `branch_id`, privacy-consent timestamp, and opaque-session metadata. The normalized `device_id` is unique across profiles. The legacy `id_value` storage column mirrors `device_id` for compatibility and is constrained equal.
- `promotions`: administrator-defined name, description, audience (`everyone` or `students`), publication/active state, and notify-on-publish flag.
- `promotion_slots`: promotion, branch, capacity, and approved count.
- `promo_requests`: profile, promotion, branch snapshot, status (`pending`, `approved`, `rejected`), optional student document, reviewer, and timestamps; unique profile/promotion.
- `issues`: profile, branch snapshot, subtype (`ghost_credit` or `lost_points`), numeric details, description, status, reviewer, and timestamps.
- `student_documents`: private storage path, accepted MIME type, size, owner, and deletion metadata.
- `push_subscriptions`: profile, endpoint, encrypted subscription fields, active state, and timestamps.
- `notification_jobs`: event type, target subscription/profile, payload, attempts, status, and last error.
- `audit_logs`: administrator, action, target, outcome, and timestamp.

### 5. Slot capacity is consumed only by approval

Public availability SHALL be calculated as `capacity - approved_count`. Submitting a pending request SHALL not alter capacity. The approval command SHALL lock the relevant `promotion_slots` row, verify remaining capacity, update the request and count in one transaction, and create the notification/audit events in the same transaction.

Bulk approval SHALL process selected pending requests in stable request-ID order and return approved, skipped, and failed identifiers. A concurrent approval cannot drive available capacity below zero.

### 6. Promotion audience and student evidence

Promotions SHALL use configurable names such as Anniversary or Student Aid. Audience is a separate field: Everyone or Students only. A student-only promotion that requires evidence SHALL reject a request without an accepted private student document. A general promotion SHALL not require a document.

The onboarding uploader MAY collect a document early, but the request flow SHALL also allow a user to upload or replace one when a student promotion needs it.

### 7. Issues are a separate workflow

The user home screen SHALL expose Promos and Issues as separate areas. The first issue subtypes are fixed to Ghost credit and Lost points, while display copy remains configurable. Ghost credit stores affected unit (`money`, `time`, or `coins`), inserted amount, credited amount, and optional description. Lost points stores points lost and optional description. Issues do not consume promotion slots.

### 8. Browser notifications are an optional outbox feature

The frontend SHALL request notification permission only after an explicit user click and only when Notifications, Service Worker, and Push APIs are available over HTTPS. The system SHALL register a Web Push subscription using VAPID keys, store it privately, and mark stale subscriptions inactive after provider failure.

Publishing a promotion with notification enabled and approving/reviewing a submission SHALL create notification jobs. A scheduled or manually invokable Edge Function SHALL deliver jobs and update attempts. Delivery failure SHALL not roll back the originating promotion or review mutation.

There is no notification requirement for users who decline permission. The interface SHALL explain that notifications are optional.

### 9. Private document storage

Student images SHALL use a private Supabase Storage bucket with non-guessable paths. Backend validation SHALL enforce JPEG, PNG, and WebP and a configurable size limit, initially 5 MiB. Admin review SHALL issue short-lived signed URLs only after authorization.

### 10. Admin review and manual fulfillment

Admin routes SHALL include login, overview, promotions, requests, issues, branches, and subscribers. Requests SHALL support status/branch/promotion filters, individual approve/reject, bulk selection, visible results, and Copy ID. Approval SHALL not call another reward system and SHALL not create a URL. The administrator copies the ID and fulfills the request outside this application.

### 11. Security boundary

- Public users can access published availability and mutate only their own profile-session-scoped submissions. A unique constraint permits only one profile row per normalized Device ID.
- Admin JWT plus admin-role membership is required for private reads and mutations.
- RLS SHALL default to deny for anonymous direct access; Edge Functions use explicit authorization.
- All client input is validated for length, character set, numeric bounds, MIME type, and allowed enum values.
- Admin mutations and document deletion are audited.
- Rate limits apply to onboarding, submissions, uploads, login attempts, and push registration.
- No MAC or hardware fingerprint prompt is implemented.

## Risks / Trade-offs

- [Anonymous identity is weak] → Use opaque profile sessions, duplicate constraints, rate limits, and manual review; add verified email/phone later if abuse matters.
- [Device ID may be wrong or shared] → Display the `10.0.0.1` instructions and screenshot; treat it as an operational lookup value, not authentication.
- [Public student documents are sensitive] → Private bucket, backend MIME/size checks, signed URLs, audit logs, and a retention policy.
- [Push support varies by browser and device] → Feature-detect, keep notifications optional, and preserve an in-app request history.
- [Concurrent bulk approvals can exhaust capacity] → Transactional row locks and deterministic per-request results.
- [Anonymous sessions can be lost] → Keep the profile token locally and require re-onboarding if it is lost; do not expose a public search by Device ID.
- [Supabase/Cloudflare free-tier limits can change] → Keep provider boundaries narrow and record quotas/alerts during deployment.
- [Student documents create privacy obligations] → Confirm applicable retention, consent, deletion, and access requirements before production launch.

## Migration Plan

1. Create the static app, Supabase project, schema migrations, private storage bucket, admin role, and Edge Function secrets in a non-production project.
2. Seed branches and create the first admin account.
3. Deploy the SPA to a temporary Cloudflare Pages preview and verify onboarding, promo listing, issue submission, and admin review.
4. Configure VAPID keys and HTTPS push testing; notification failure must not affect normal requests.
5. Publish the production frontend and backend, then seed real branch names and offers.
6. Roll back frontend assets to the previous deployment if needed; disable the affected promotion or function before rolling back data mutations. Database migrations SHALL be additive and reversible where practical.
7. Delete test profiles, student documents, requests, subscriptions, and notification jobs before production use.

## Open Questions

- Confirm the final wording for Device ID help and the profile-edit recovery contact before production.
- Confirm the final branch list and whether a user's branch can be changed after onboarding.
- Confirm the maximum upload size and document retention period; the 5 MiB limit is an implementation assumption.
- Confirm whether rejected requests are permanently final or may be reopened by an administrator; the initial design treats them as final.
- Confirm whether issue review should use Approved/Rejected only or add Resolved; the initial design uses the same three statuses for a simple dashboard.
- Confirm the applicable privacy notice, consent wording, and deletion/contact process before collecting real student documents.
- Confirm the production domain and whether browser push should be enabled at launch or after the core workflow is verified.

## Why

The project needs one simple announcement room where people register their basic details, discover branch-specific promotions, and report service issues without claiming rewards automatically. Administrators need a secure dashboard to publish offers, review requests, approve individual or bulk submissions, copy the Device ID into a separate reward system, and optionally notify users through browser push notifications.

## What Changes

- Add a first-run onboarding flow for one Device ID, name, branch, optional school-ID upload, privacy consent, and optional browser notifications.
- Add same-session profile editing for the name or Device ID without creating a second profile.
- Add a single user home screen with separate Promos and Issues areas.
- Add configurable promotion names, descriptions, audiences, branches, and per-branch available slot counts.
- Display available slots without consuming one when a user submits a request.
- Add promo requests with pending, approved, and rejected states.
- Require school-ID evidence only when a student-only promotion requests it and keep uploaded documents private.
- Add issue reporting with Ghost credit and Lost points subtypes.
- Capture Ghost credit affected unit, amount inserted, amount credited, and a short description.
- Capture Lost points quantity and a short description.
- Add admin authentication and a dashboard for offers, requests, issues, branches, and subscribers.
- Add individual approval, bulk approval, rejection, request filtering, and one-click ID copying.
- Send a push notification for new published promotions and approved requests only to users who granted notification permission.
- Remove automatic destination URLs, redemption links, MAC-address collection, and browser fingerprint permission prompts.

## Capabilities

### New Capabilities

- `user-onboarding`: First-run profile collection, validation, privacy consent, optional student document, notification subscription, and same-session profile editing.
- `promo-management`: Admin-created promotions, configurable audience, branch slots, publication, and public availability.
- `promo-requests`: User promo requests, duplicate prevention, approval/rejection, slot accounting, and request status.
- `issue-reporting`: Ghost credit and Lost points issue submission and review.
- `admin-dashboard`: Authenticated administration, filtering, individual/bulk actions, audit history, and Device ID copying.
- `browser-notifications`: Feature-detected web push permission, subscriptions, and conditional notifications.
- `student-verification`: Private school-ID upload and admin-only review for student promotions.

### Modified Capabilities

None.

## Impact

- New static frontend application in the project root.
- New Supabase database schema, private storage bucket, Row Level Security policies, and Edge Functions.
- New admin authentication configuration and admin-role records.
- New browser push/VAPID configuration and notification delivery function.
- No external reward or redemption integration in this change; administrators continue to use their separate system manually.
- Personal data and student documents require access controls, retention decisions, validation, rate limiting, and privacy disclosures.

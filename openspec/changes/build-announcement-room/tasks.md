## 1. Project and environment setup

- [x] 1.1 Create the static TypeScript SPA scaffold and development scripts
- [x] 1.2 Add environment loading for public Supabase URL/key and server-only function secrets
- [x] 1.3 Add route shell for onboarding, user home, admin login, and admin dashboard
- [x] 1.4 Add shared validation, API error, status, and formatting utilities

## 2. Database and storage foundation

- [x] 2.1 Create migrations for branches, profiles, profile sessions, and admin roles
- [x] 2.2 Create migrations for promotions, branch slot capacity, and promo requests
- [x] 2.3 Create migrations for issues, student documents, push subscriptions, notification jobs, and audit logs
- [x] 2.4 Add uniqueness, enum, numeric, and capacity constraints
- [x] 2.5 Configure private student-document storage and access policies
- [x] 2.6 Add seed workflow for branches and the first administrator

## 3. Public onboarding and profile

- [x] 3.1 Implement onboarding form for Device ID, name, branch, and privacy consent
- [x] 3.2 Normalize uppercase alphanumeric Device ID input and show inline validation
- [x] 3.3 Add clickable `10.0.0.1` instructions and configurable help screenshot slot
- [x] 3.4 Implement anonymous profile-session creation and local session persistence
- [x] 3.5 Implement optional school-ID upload and replacement flow
- [x] 3.6 Implement optional notification enrollment controls
- [x] 3.7 Add same-session profile editing and lost-session recovery path
- [x] 3.8 Enforce one profile per Device ID with a server-side unique constraint

## 4. Public promotions and requests

- [x] 4.1 Implement active promotion listing filtered by branch and audience
- [x] 4.2 Display per-branch availability calculated from approved capacity
- [x] 4.3 Implement configurable promo cards and request form
- [x] 4.4 Enforce student-document requirements for student-only promotions
- [x] 4.5 Implement duplicate request prevention and request history
- [x] 4.6 Implement public request error, success, and pending states

## 5. Public issue reporting

- [x] 5.1 Implement Issues area with Ghost credit and Lost points choices
- [x] 5.2 Implement Ghost credit form for unit, inserted amount, credited amount, and description
- [x] 5.3 Implement Lost points form for points lost and description
- [x] 5.4 Validate numeric relationships and attach saved profile context
- [x] 5.5 Implement issue history and status display

## 6. Administrator authentication and dashboard

- [x] 6.1 Implement Supabase administrator login, session restore, and logout
- [x] 6.2 Enforce admin-role authorization in every admin function
- [x] 6.3 Implement dashboard overview counts and navigation
- [x] 6.4 Implement branch management
- [x] 6.5 Implement promotion creation, editing, publishing, disabling, and slot editing
- [x] 6.6 Implement promo request filters, detail view, and Copy ID action
- [x] 6.7 Implement individual promo request approval and rejection
- [x] 6.8 Implement bulk promo request approval/rejection with partial result reporting
- [x] 6.9 Implement issue filters, detail view, and review actions
- [x] 6.10 Implement private student-document signed URL viewing
- [x] 6.11 Implement audit log writes and administrator-visible action history

## 7. Backend command and concurrency rules

- [x] 7.1 Implement validated public Edge Functions for profiles, promos, requests, issues, uploads, and subscriptions
- [x] 7.2 Implement transactional individual approval with slot row locking
- [x] 7.3 Implement deterministic transactional bulk approval with capacity-safe outcomes
- [x] 7.4 Implement admin promotion mutations and issue review commands
- [x] 7.5 Add rate limiting, CORS, payload limits, and safe error responses
- [x] 7.6 Add allowlists for upload types and limits and verify storage ownership

## 8. Notifications

- [x] 8.1 Add service worker and feature-detected Web Push subscription flow
- [x] 8.2 Add VAPID secret configuration and subscription persistence
- [x] 8.3 Create notification outbox jobs for published promos and review outcomes
- [x] 8.4 Implement notification delivery worker with retries and stale-subscription cleanup
- [x] 8.5 Ensure notification failures do not roll back business mutations

## 9. Verification and release

- [ ] 9.1 Add targeted tests for onboarding validation and profile-session ownership
- [ ] 9.2 Add targeted tests for issue field validation and status transitions
- [ ] 9.3 Add targeted tests for duplicate requests and concurrent capacity-safe approvals
- [ ] 9.4 Add targeted tests for admin authorization, bulk outcomes, document privacy, and ID copying
- [ ] 9.5 Run a local end-to-end smoke flow for onboarding, promo request, issue report, and admin review
- [ ] 9.6 Run a notification smoke flow on an HTTPS preview deployment
- [ ] 9.7 Configure production secrets, storage policies, admin account, and branch seed data
- [ ] 9.8 Deploy static frontend and Edge Functions and document operational setup

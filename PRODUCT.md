# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated: Vite + TypeScript static SPA on Cloudflare Pages, backed by Supabase Postgres, Edge Functions, private Storage, and administrator Auth.

## Users

Primary users are people at the configured branches who use the room to discover promotions, request offers, and report machine or service issues. The owner/operator is the authenticated administrator who publishes offers, reviews submissions, and manually fulfills approved requests in a separate system.

## Product Purpose

The announcement room gives branch users one place to onboard once, see relevant promotions, submit requests, report Ghost credit or Lost points issues, and check statuses. Success means the owner can publish branch-specific slot counts and process requests quickly without automatic reward integrations.

## Positioning

The product combines a simple announcement feed with an operational review queue: user profile context is captured once, then reused for both promotions and issue reports while the owner retains manual control of fulfillment.

## Operating Context

Users may need instructions to find a Device ID at `10.0.0.1`; the repo bundles `public/device-id-help.jpg` showing the ID location. Administrators copy a user's ID into a separate reward or service system after review.

## Capabilities and Constraints

- First-run onboarding collects one Device ID, name, branch, privacy consent, optional school-ID image, and optional browser notifications.
- Device ID accepts alphanumeric input and displays letters in uppercase; the database allows only one profile per normalized Device ID.
- Existing users can edit their name or Device ID from the home screen without creating a second profile; the profile session token remains unchanged.
- The browser cannot provide a MAC address or guaranteed hardware fingerprint; no such permission prompt is implemented.
- The user home screen separates Promos and Issues.
- Public UI copy uses concise Taglish while retaining familiar promo, issue, and status terms.
- Promotions have administrator-defined names, audience (Everyone or Students only), branches, capacities, and publication state.
- Pending promo requests do not consume slots; approval consumes capacity atomically.
- Issues initially include Ghost credit and Lost points.
- Ghost credit collects affected unit, amount inserted, amount credited, and optional description.
- Lost points collects points lost and optional description.
- Administrators can review individually or in bulk, copy IDs, and optionally trigger browser notifications.
- Student documents use safe defaults: private admin-only storage, JPEG/PNG/WebP, 5 MiB maximum, short-lived viewing URLs, and deletion controls. Retention and final notice wording remain configurable before production.
- There are no automatic redemption links, destination URLs, reward integrations, or user passwords in the first release.

## Evidence on Hand

Supplied launch seed branches are `Lisa’s Canteen [Candon] Branch` and `Pudoc Branch`; the supplied Device ID screenshot is persisted at `public/device-id-help.jpg`. Production credentials and promotion data remain unset.

## Product Principles

- Keep the user's path short and repeatable.
- Make operational status visible and unambiguous.
- Let the administrator control fulfillment manually.
- Treat personal and student data as private by default.
- Prefer honest browser capabilities over misleading security prompts.

## Accessibility & Inclusion

The web interface SHALL support keyboard navigation, visible focus states, labels tied to inputs, readable validation messages, responsive mobile layouts, and status communication that does not depend on color alone. Notification permission remains optional so users can use the core workflow without push support.

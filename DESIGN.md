# Announcement Room design system

## Product surface

Announcement Room is a branch dispatch board, not a generic social feed. The first screen is a dark, high-contrast setup form. The public home then separates Promos from Issues, while the admin route behaves like an operational queue.

## Visual direction

- Graphite-blue shell with white work panels.
- Orange is reserved for actions, section codes, links, and review emphasis.
- Ice-blue blocks carry instructions and lightweight system notes.
- Monospace uppercase labels identify routes, records, statuses, and capacity.
- Large left-aligned headlines establish the operating context; dense forms and tables stay rectangular and quiet.
- No gradients, decorative blobs, marketing imagery, or external offer links.

## Tokens

```css
--navy: #101b25;
--navy-soft: #172936;
--surface: #f5f8f9;
--paper: #ffffff;
--ice: #e9f1f4;
--ink: #12202a;
--ink-soft: #4f606b;
--line: #cbd8de;
--orange: #f06d3c;
--orange-dark: #c84d22;
--mint: #d5ebe1;
--green: #2f7b5e;
--yellow: #f4d36b;
--red: #bd473d;
```

## Components

- `brand`: compact three-bar mark and room name.
- `section-code`: monospace uppercase location marker.
- `form-panel`: white record surface for onboarding and admin forms.
- `help-strip`: ice-blue instructional band with the clickable `10.0.0.1` route and the persisted `/device-id-help.jpg` reference image below it.
- `primary-action` / `secondary-action`: high-contrast operational controls with visible focus rings.
- `status`: pending, approved, and rejected labels reused across requests and issues.
- `data-table`: admin review queue with inline Copy ID and review actions.
- `detail-panel`: selected request or issue inspection surface before review.

## Interaction rules

- Device IDs are normalized to uppercase while invalid punctuation remains visible for correction; one normalized Device ID maps to one profile.
- The public profile editor changes only the name or Device ID, preserves the profile session and history, and keeps branch context locked.
- Students-only promos require a private school ID image at request time; everyone promos do not.
- Pending requests do not consume capacity. Approval is manual and writes the slot count transactionally.
- Browser notifications are opt-in, feature-detected, and never block onboarding.
- School ID images never render in public views; admins receive short-lived signed URLs.
- Public copy uses concise Taglish; admin actions keep familiar operational terms.
- Empty public promo, request, and report states place the sync action inside the empty view; the header refresh control hides while that contextual action is visible.
- The app names the separate reward system but never redirects to it.

## Responsive behavior

- Desktop: two-column onboarding and admin login; rail plus workspace for authenticated views.
- Narrow screens: stacked setup content, single-column forms, wrapped action groups, and horizontally scrollable admin tables.
- Mobile input targets retain visible focus outlines and native controls.

## Accessibility and resilience

- Labels are associated with every form control.
- Errors use `role="alert"`; success updates use `role="status"`.
- Disabled and loading states prevent duplicate submissions.
- The static app shows an explicit Supabase configuration callout instead of pretending to save data when credentials are absent.
- Cloudflare Pages headers disable framing, reduce referrer leakage, and restrict browser capabilities.

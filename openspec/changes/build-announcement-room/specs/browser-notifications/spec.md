## ADDED Requirements

### Requirement: Notifications must be opt-in and feature-detected
The system SHALL provide an explicit Enable notifications action and SHALL request browser permission only after a user gesture. The system SHALL use feature detection for Notifications, Service Workers, and Push API support rather than assuming Chrome. Notifications SHALL remain optional for onboarding and all requests.

#### Scenario: Supported browser grants permission
- **WHEN** an onboarded user clicks Enable notifications in a secure supported context and grants permission
- **THEN** the system registers a service worker, creates a push subscription, stores it for the user's profile, and displays Enabled

#### Scenario: User denies permission
- **WHEN** the user denies the browser notification prompt
- **THEN** the system marks notifications unavailable for that browser and permits continued site use

#### Scenario: Browser lacks push support
- **WHEN** the browser does not support the required notification APIs
- **THEN** the system hides the permission prompt, explains that notifications are unavailable, and permits continued site use

### Requirement: New published promotions can notify subscribers
When an administrator publishes a promotion and chooses to notify subscribers, the system SHALL enqueue a notification for active subscriptions. The notification SHALL identify the promotion name and SHALL NOT include private user data.

#### Scenario: New promotion is published with notifications enabled
- **WHEN** an administrator publishes a promotion with Notify subscribers selected
- **THEN** active eligible subscriptions receive or are queued for a new-promotion notification

#### Scenario: Promotion is saved without notification
- **WHEN** an administrator publishes a promotion with notifications disabled
- **THEN** no new-promotion push notification is queued

### Requirement: Approved requests can notify their requester
When an administrator approves a user's promo request or reviews an issue, the system SHALL send a notification only when the user's active push subscription exists and notification permission was previously granted.

#### Scenario: Approved request belongs to a subscriber
- **WHEN** an administrator approves a pending request for a user with an active push subscription
- **THEN** the system queues an approval notification for that user

#### Scenario: Approved request belongs to a non-subscriber
- **WHEN** an administrator approves a request for a user without an active subscription
- **THEN** the approval succeeds and no push notification is attempted

### Requirement: Stale subscriptions must not break business actions
A failed, expired, or rejected push subscription SHALL be marked inactive or removed after delivery failure. Notification delivery failure SHALL NOT roll back a promotion publication or request approval.

#### Scenario: Push delivery fails
- **WHEN** a notification provider reports that a subscription is invalid
- **THEN** the system deactivates that subscription and preserves the completed business mutation

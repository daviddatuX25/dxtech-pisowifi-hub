## ADDED Requirements

### Requirement: Users can submit one request per promotion
The system SHALL allow an onboarded user to submit a request for an eligible published promotion in the user's branch. The request SHALL automatically attach the saved profile, promotion, branch, and submission time. A profile SHALL have at most one request for a given promotion unless an administrator explicitly reopens it.

#### Scenario: Eligible user submits a promo request
- **WHEN** an onboarded user submits a valid request for an active promotion with required student evidence when applicable
- **THEN** the system creates exactly one pending request and shows its status to the user

#### Scenario: User submits a duplicate request
- **WHEN** the profile already has a pending, approved, or rejected request for the promotion
- **THEN** the system refuses the duplicate and shows the existing request status

#### Scenario: User requests an unavailable promotion
- **WHEN** the promotion is unpublished, disabled, outside the user's branch, or has no available slots
- **THEN** the system refuses the request and explains that it is unavailable

### Requirement: Promo requests must have explicit statuses
Each promo request SHALL have exactly one status: Pending, Approved, or Rejected. New requests SHALL start as Pending. Users SHALL be able to see the status and promotion name of their own requests without seeing other users' requests.

#### Scenario: Pending request is viewed
- **WHEN** a user opens their request list after submitting a request
- **THEN** the request appears with Pending status

#### Scenario: Request is approved
- **WHEN** an administrator approves a pending promo request
- **THEN** the request status becomes Approved and the system records the reviewer and review time

#### Scenario: Request is rejected
- **WHEN** an administrator rejects a pending promo request
- **THEN** the request status becomes Rejected and the system records the reviewer and review time

### Requirement: Approval must consume capacity atomically
The system SHALL approve a request only when capacity remains for its promotion and branch. The capacity decrement and status transition SHALL occur in one database transaction so concurrent approvals cannot exceed capacity. Approval SHALL not generate a redemption link or automatic external action.

#### Scenario: Individual approval has capacity
- **WHEN** an administrator approves a pending request while at least one slot remains
- **THEN** the system atomically marks the request Approved and reduces available capacity by one

#### Scenario: Individual approval has no capacity
- **WHEN** an administrator approves a pending request after all capacity is consumed
- **THEN** the system leaves the request Pending and reports that no slot remains

#### Scenario: Approved request is processed again
- **WHEN** an administrator attempts to approve an already approved or rejected request
- **THEN** the system performs no second approval or capacity decrement

### Requirement: Bulk approval must report partial outcomes
The admin interface SHALL allow an administrator to select multiple pending requests and approve them in one action. The backend SHALL process each request with the same capacity and status rules and SHALL return counts and identifiers for approved and skipped requests.

#### Scenario: Bulk approval fits available capacity
- **WHEN** the administrator selects pending requests whose count does not exceed remaining capacity
- **THEN** all eligible selections become Approved and each consumes one slot

#### Scenario: Bulk approval exceeds available capacity
- **WHEN** the administrator selects more requests than remaining capacity
- **THEN** the system approves only the requests that fit, leaves the remainder Pending, and reports the partial result clearly

### Requirement: Approval is a manual handoff
The system SHALL show the user's Device ID and provide a copy-to-clipboard action in individual and bulk review workflows. The administrator SHALL use that Device ID in a separate system to provide the reward or resolve the operational handoff.

#### Scenario: Administrator copies an ID
- **WHEN** the administrator clicks Copy ID for a request
- **THEN** the exact saved Device ID is copied to the clipboard and a success indication is shown

#### Scenario: Approved request is displayed
- **WHEN** the administrator opens an approved request
- **THEN** the dashboard shows its Device ID, profile details, promotion, branch, approval time, and no redemption URL

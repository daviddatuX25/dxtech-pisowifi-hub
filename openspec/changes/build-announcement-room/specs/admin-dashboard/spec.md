## ADDED Requirements

### Requirement: Administrators must authenticate
The system SHALL protect all administration screens and write operations behind authenticated administrator accounts. A non-authenticated visitor SHALL be redirected to the admin login screen and SHALL not receive private request, issue, or document data.

#### Scenario: Administrator signs in
- **WHEN** a valid administrator submits credentials
- **THEN** the system creates an authenticated session and displays the admin dashboard

#### Scenario: Invalid administrator credentials are submitted
- **WHEN** login credentials are invalid or the account is not assigned administrator access
- **THEN** the system refuses access and shows a non-sensitive error

### Requirement: Dashboard must separate operational areas
The authenticated dashboard SHALL provide separate views for overview, promos, promo requests, issues, branches, and notification subscribers. The overview SHALL show counts for pending promo requests, pending issues, active promos, and subscribers.

#### Scenario: Administrator opens the dashboard
- **WHEN** an authenticated administrator loads the dashboard
- **THEN** the system displays navigation to each operational area and current summary counts

### Requirement: Administrators can filter and inspect submissions
The requests and issues views SHALL support filtering by status and branch, and the promo requests view SHALL also support filtering by promotion. An administrator SHALL be able to inspect the saved profile context, submitted fields, timestamps, and relevant student evidence.

#### Scenario: Administrator filters pending requests
- **WHEN** the administrator selects Pending and a branch filter
- **THEN** the system lists only matching pending submissions

#### Scenario: Administrator opens request details
- **WHEN** the administrator selects a submission
- **THEN** the system shows its full review details and available actions without exposing data from unrelated submissions

### Requirement: Administrators can perform individual and bulk review actions
The dashboard SHALL provide individual approve and reject actions for pending promo requests and issues. The promo request view SHALL provide checkbox selection and bulk approval or rejection. The system SHALL show a confirmation and result summary for bulk actions.

#### Scenario: Administrator approves one request
- **WHEN** the administrator approves a pending request with valid business conditions
- **THEN** the system changes its status, records the administrator and timestamp, and refreshes the list

#### Scenario: Administrator approves selected requests
- **WHEN** the administrator selects multiple pending promo requests and confirms bulk approval
- **THEN** the system processes them using atomic slot rules and reports approved, skipped, and failed items

### Requirement: Administrators can copy Device IDs
Individual request and issue details SHALL show the stored Device ID with a Copy ID action. The action SHALL copy only the Device ID value and SHALL provide visible success or failure feedback.

#### Scenario: Clipboard copy succeeds
- **WHEN** the administrator clicks Copy ID in a supported browser
- **THEN** the exact ID is copied and the interface confirms it

#### Scenario: Clipboard copy is unavailable
- **WHEN** the browser blocks clipboard access
- **THEN** the interface provides the ID as selectable text and explains that it can be copied manually

### Requirement: Administrative changes must be auditable
The system SHALL record administrator identity, action, target submission or promotion, outcome, and timestamp for authentication-protected mutations, including publish, disable, approve, reject, and bulk review actions.

#### Scenario: Review action is completed
- **WHEN** an administrator changes a request or issue status
- **THEN** an audit record is created with the actor, action, target, outcome, and time

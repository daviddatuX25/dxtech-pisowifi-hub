## ADDED Requirements

### Requirement: Administrators can manage named promotions
The system SHALL allow an authenticated administrator to create, edit, publish, disable, and view promotions. Each promotion SHALL have an administrator-defined name and MAY have a description, audience, and publication state. The system SHALL NOT require or store a redemption destination URL.

#### Scenario: Administrator creates a promotion
- **WHEN** an authenticated administrator submits a valid promotion name and at least one branch slot allocation
- **THEN** the system saves the promotion as a draft or published offer according to the selected action

#### Scenario: Administrator disables a promotion
- **WHEN** an authenticated administrator disables a published promotion
- **THEN** the promotion is removed from the public available-promos list and existing requests remain visible to administrators

### Requirement: Promotions must support audience and branch configuration
Each promotion SHALL support an audience of Everyone or Students only and SHALL support one or more configured branches with a non-negative slot capacity per branch. Promotion names such as Anniversary or Student Aid SHALL be data values, not hardcoded categories.

#### Scenario: Everyone promotion is published
- **WHEN** an administrator publishes an Everyone promotion for a branch
- **THEN** an onboarded user in that branch can see the promotion

#### Scenario: Student-only promotion is published
- **WHEN** an administrator publishes a Students only promotion
- **THEN** the promotion is marked as requiring student eligibility evidence before request submission

#### Scenario: Promotion has no capacity for a branch
- **WHEN** a branch allocation is zero or all capacity has been approved
- **THEN** the public interface shows zero available slots and does not allow a new request for that branch

### Requirement: Public users can see active promotions and available slots
The public user interface SHALL show active published promotions that match the user audience and branch, including the promotion name, description when present, branch, and available slot count. The API SHALL NOT expose private requests, student documents, admin notes, or internal credentials.

#### Scenario: Active promotion has available slots
- **WHEN** an onboarded user loads the Promos area
- **THEN** the interface lists the matching promotion and its current available slot count with a Request action

#### Scenario: Promotion is full
- **WHEN** approved requests consume all configured capacity for a branch
- **THEN** the interface shows the promotion as full and prevents submission for that branch

### Requirement: Available slot counts are based on approved requests
The system SHALL calculate available slots as branch capacity minus approved requests for the promotion and branch. A pending request SHALL NOT consume capacity. Counts SHALL never be negative.

#### Scenario: Pending request is submitted
- **WHEN** a user submits a valid request for a promotion with one available slot
- **THEN** the request becomes pending and the displayed available slot count remains unchanged

#### Scenario: Request is approved
- **WHEN** an administrator approves a pending request
- **THEN** the system decreases the available count by one as part of the same atomic operation

#### Scenario: Rejected request is processed
- **WHEN** an administrator rejects a pending request
- **THEN** the available count is unchanged because the rejected request never consumed capacity

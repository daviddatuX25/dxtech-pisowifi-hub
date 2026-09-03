## ADDED Requirements

### Requirement: Users can choose an issue subtype
The system SHALL provide an Issues area with the subtypes Ghost credit and Lost points. Issue subtype names and descriptions SHALL be visible before the user starts the form.

#### Scenario: User opens Issues
- **WHEN** an onboarded user selects the Issues area
- **THEN** the system shows Ghost credit and Lost points as selectable issue types

### Requirement: Ghost credit issues must capture the shortfall
The Ghost credit form SHALL collect the affected unit as Money, Time, or Coins, the amount inserted, the amount credited, and an optional description. Amounts SHALL be numeric and non-negative, and the credited amount SHALL NOT exceed the inserted amount. The form SHALL explain the issue in plain language, including that less time, money, or credit was recorded than was inserted.

#### Scenario: User reports a money shortfall
- **WHEN** the user selects Money, enters 10 as inserted, and 7 as credited
- **THEN** the system creates a pending Ghost credit issue showing a 3-unit shortfall

#### Scenario: User reports a time shortfall
- **WHEN** the user selects Time, enters the inserted and credited time values, and submits valid data
- **THEN** the system stores the values with the Time unit and shows the issue as pending

#### Scenario: Credited amount exceeds inserted amount
- **WHEN** the user enters a credited amount greater than the inserted amount
- **THEN** the system rejects submission and identifies the invalid relationship

### Requirement: Lost points issues must capture points lost
The Lost points form SHALL collect the number of points lost and an optional description. Points lost SHALL be a positive numeric value.

#### Scenario: User reports lost points
- **WHEN** the user enters a positive points-lost value and submits the form
- **THEN** the system creates a pending Lost points issue attached to the user's profile and branch

#### Scenario: User omits points lost
- **WHEN** the user submits Lost points without a positive quantity
- **THEN** the system rejects submission and identifies the required field

### Requirement: Issues must attach the saved user context
The system SHALL attach the onboarded profile, Device ID, name, branch, subtype, submitted values, and submission time to every issue. Users SHALL not need to re-enter profile information on each issue report.

#### Scenario: User submits an issue
- **WHEN** an onboarded user submits a valid issue form
- **THEN** the issue includes the user's current saved profile context and has Pending status

### Requirement: Issues must support review status
Each issue SHALL have exactly one status: Pending, Approved, or Rejected. An authenticated administrator SHALL be able to view issue details, change the status, and record reviewer and review time.

#### Scenario: Administrator reviews an issue
- **WHEN** an administrator approves or rejects a pending issue
- **THEN** the system records the new status, reviewer, and review time

#### Scenario: User views issue status
- **WHEN** the user opens their request history
- **THEN** the system shows the issue subtype and current status without exposing other users' issues

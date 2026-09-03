## ADDED Requirements

### Requirement: User must complete first-run onboarding
The system SHALL present onboarding before a user can view or submit promos and issues. Onboarding SHALL collect one Device ID, name, branch, and privacy consent. The system SHALL retain the profile for later requests without requiring the user to re-enter unchanged profile fields.

#### Scenario: New user completes onboarding
- **WHEN** a new user submits a valid Device ID, name, branch, and privacy consent
- **THEN** the system creates a profile and shows the user home screen

#### Scenario: Returning user opens the site
- **WHEN** a previously onboarded user returns with the stored profile handle
- **THEN** the system loads the home screen with the saved profile details

#### Scenario: Required onboarding data is missing
- **WHEN** the user submits onboarding with a missing required field or without privacy consent
- **THEN** the system identifies the invalid field and does not create the profile

### Requirement: Device ID input must be normalized and validated
The Device ID field SHALL accept only ASCII letters and digits, SHALL automatically display letters in uppercase, and SHALL reject empty or non-alphanumeric values. The system SHALL treat the manually entered Device ID as user-provided data and SHALL NOT claim that it is a browser MAC address.

#### Scenario: Lowercase Device ID is entered
- **WHEN** the user types lowercase letters into Device ID
- **THEN** the field displays the letters in uppercase and submission uses the uppercase value

#### Scenario: Device ID contains punctuation
- **WHEN** the user enters spaces, punctuation, or symbols in Device ID
- **THEN** the system rejects the value with a clear validation message

### Requirement: One Device ID maps to one profile
The database SHALL enforce uniqueness on the normalized Device ID. Creating a profile with a Device ID already linked to another profile SHALL fail with a recovery message instead of creating a duplicate.

#### Scenario: Existing Device ID is submitted during onboarding
- **WHEN** a user submits a Device ID already linked to a profile
- **THEN** the system rejects the new profile and tells the user to use the existing profile session or contact an administrator

### Requirement: Existing users can edit profile details
The home screen SHALL provide a profile edit action that updates the current profile's name or Device ID in place. The update SHALL preserve the profile ID, session token, branch, requests, reports, and student document. A Device ID already linked to another profile SHALL be rejected.

#### Scenario: User edits name or Device ID
- **WHEN** an onboarded user saves valid profile details with a valid profile session
- **THEN** the system updates the same profile and keeps the user in the home screen with the same session and history

#### Scenario: User chooses a Device ID already in use
- **WHEN** an onboarded user saves a Device ID linked to another profile
- **THEN** the system rejects the edit and leaves the current profile unchanged

### Requirement: Device ID instructions must be accessible
The onboarding screen SHALL show these instructions near the Device ID field: go to `10.0.0.1`, then scroll down to find the ID. The address SHALL be a clickable link and the interface SHALL display the bundled `/device-id-help.jpg` reference image, while allowing an administrator-configured image override.

#### Scenario: User opens the router address
- **WHEN** the user clicks the `10.0.0.1` instruction link
- **THEN** the browser opens the configured local router address without changing the saved form values

#### Scenario: Help screenshot is configured
- **WHEN** an onboarding help image exists
- **THEN** the interface displays it with text explaining that it highlights where the ID can be found

### Requirement: Student document upload is optional during onboarding
The system SHALL allow a user to upload a school ID image during onboarding without making it required for general access. The system SHALL require a valid document before submitting a student-only promo when that promo requires verification.

#### Scenario: General user omits a school document
- **WHEN** the user completes onboarding without a school ID image
- **THEN** the system permits onboarding and access to non-student promos

#### Scenario: Student promo requires missing evidence
- **WHEN** the user requests a student-only promo without an accepted school document
- **THEN** the system blocks submission and asks the user to upload the document

### Requirement: Notification enrollment is optional
The system SHALL offer notification enrollment during onboarding and from the user home screen, but SHALL NOT block onboarding or requests when the user declines, the browser does not support push, or permission has already been denied.

#### Scenario: User grants notification permission
- **WHEN** the user clicks Enable notifications and grants browser permission
- **THEN** the system stores the push subscription for that profile and shows notifications as enabled

#### Scenario: User declines or cannot use notifications
- **WHEN** the user declines permission or the browser lacks push support
- **THEN** the system records notifications as disabled and the user can continue using the site

### Requirement: The system must not request MAC address or fingerprint access
The system SHALL NOT show a fake permission prompt or claim that it can retrieve a MAC address or unique hardware fingerprint from a normal browser. The profile session token SHALL provide browser continuity only; the server-side unique Device ID constraint SHALL prevent duplicate profile rows.

#### Scenario: User reaches device verification controls
- **WHEN** the onboarding form is displayed in a normal browser
- **THEN** the interface explains that hardware MAC access is unavailable and does not request it

## ADDED Requirements

### Requirement: Student documents must be private
The system SHALL store school ID images in a private storage location. Public users SHALL never receive direct unauthenticated access to another user's document. Only authenticated administrators SHALL be able to request a short-lived view URL for review.

#### Scenario: User uploads a school ID
- **WHEN** an onboarded user uploads an accepted school ID image
- **THEN** the system stores it privately and associates it with the user's profile

#### Scenario: Unauthenticated visitor requests a document
- **WHEN** a visitor without administrator access requests a student document URL
- **THEN** the system refuses access without revealing whether the document exists

#### Scenario: Administrator views a document
- **WHEN** an authenticated administrator requests a document for a request under review
- **THEN** the system returns a short-lived authorized view URL

### Requirement: Uploads must be constrained
The system SHALL accept only configured image MIME types, SHALL enforce a maximum file size, SHALL generate a non-executable storage name, and SHALL validate the upload on the backend. The default accepted types SHALL be JPEG, PNG, and WebP.

#### Scenario: Valid image is uploaded
- **WHEN** a user uploads a JPEG, PNG, or WebP within the configured size limit
- **THEN** the system accepts it and shows the uploaded state

#### Scenario: Invalid file is uploaded
- **WHEN** a user uploads a disallowed type or oversized file
- **THEN** the system rejects it and leaves any existing accepted document unchanged

### Requirement: Student evidence must gate student-only requests
A student-only promotion SHALL declare whether evidence is required. When evidence is required, the request flow SHALL require an uploaded document before creating a pending request. The document SHALL be available to administrators in request review.

#### Scenario: Student-only request has evidence
- **WHEN** the user submits a student-only promotion request with an accepted document
- **THEN** the system creates the pending request and links the document for administrator review

#### Scenario: Student-only request lacks evidence
- **WHEN** the user submits a student-only promotion request without an accepted document
- **THEN** the system blocks submission and explains that student verification is required

### Requirement: Administrators can replace and delete student documents
The system SHALL allow an authenticated administrator to delete a document when retention is no longer required, and SHALL allow the user to replace their own document through the profile or request flow. Deletion SHALL be recorded in the audit log.

#### Scenario: User replaces a document
- **WHEN** a user uploads a replacement document
- **THEN** the system associates the new accepted document with the profile and does not expose the old document publicly

#### Scenario: Administrator deletes a document
- **WHEN** an administrator deletes a student document
- **THEN** the document is removed or made inaccessible and the deletion is recorded with actor and timestamp

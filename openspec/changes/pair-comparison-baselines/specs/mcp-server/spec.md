## ADDED Requirements

### Requirement: Paired comparison baseline publication
The session manager SHALL lazily prepare normalized clean and bookmarked comparison baselines as one resource from the immutable original source, independently of live-session normalization options. It SHALL share one attempt among concurrent callers, publish only a complete pair, and permit retries after failure. Retired sessions or superseded sources SHALL NOT publish a pending pair.

#### Scenario: Shared paired success
- **WHEN** concurrent callers request original comparison baselines
- **THEN** they SHALL receive the same complete pair from one preparation attempt
- **AND** legacy fields SHALL reflect that pair only after both buffers are prepared

#### Scenario: Shared failure and retry
- **WHEN** any preparation stage fails
- **THEN** all waiting callers SHALL reject and neither half SHALL become ready
- **AND** later callers SHALL share a fresh attempt

#### Scenario: Retirement or source replacement during preparation
- **WHEN** a session expires, closes, is replaced, or its source is superseded during preparation
- **THEN** the old attempt SHALL reject without publishing
- **AND** it SHALL NOT disturb a newer attempt

#### Scenario: Original baseline isolation
- **WHEN** the live document was opened without normalization or has been edited
- **THEN** both comparison baselines SHALL still contain the normalized immutable original
- **AND** baseline preparation SHALL preserve live document, ZIP, cache and serialization history

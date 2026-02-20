## ADDED Requirements

### Requirement: Public Trust Entry Exists on the Site
The site SHALL expose a top-level trust surface that is reachable from the landing page.

#### Scenario: landing page links to trust section
- **WHEN** a user visits the site landing page
- **THEN** they can navigate to a trust route without leaving the site

#### Scenario: trust route links to system card
- **WHEN** a user opens the trust route
- **THEN** the page includes a link to the generated system card

### Requirement: System Card Is Generated from Existing Evidence
The system card SHALL be generated from existing OpenSpec traceability and Allure artifacts, not maintained as hand-authored duplicate data.

#### Scenario: generator refreshes traceability matrices before rendering
- **WHEN** the system card generator runs
- **THEN** it executes the existing OpenSpec coverage validators to refresh matrix files

#### Scenario: generator summarizes allure run status
- **WHEN** the system card generator runs
- **THEN** it reads current Allure result JSON artifacts and emits per-package status totals and a latest run timestamp

#### Scenario: generated output is deterministic and committed to site content
- **WHEN** the system card generator writes output
- **THEN** it writes `site/src/trust/system-card.md` with stable section ordering and explicit source file references

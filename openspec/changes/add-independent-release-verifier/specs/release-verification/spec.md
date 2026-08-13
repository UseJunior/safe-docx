## ADDED Requirements

### Requirement: Release verification is independent from artifact generation

The release verifier SHALL consume finished artifact paths and hashes and SHALL
NOT import or receive mutation, comparison, replay, or generator IR from the
implementations that produced those artifacts.

#### Scenario: [REL-VERIFY-01] Generator-local success is insufficient
- **GIVEN** a tracked DOCX whose generator-local replay certificate passes
- **WHEN** an independent required check fails or cannot run
- **THEN** the release certificate SHALL NOT pass
- **AND** no delivery-ready verdict SHALL be emitted

### Requirement: Finished tracked bytes reproduce both clean states exactly

The verifier SHALL independently derive accept-all and reject-all projections
from the finished tracked DOCX and compare them with independently supplied
intended-clean and original operands.

#### Scenario: [REL-VERIFY-02] Exact two-direction replay passes
- **WHEN** accept-all equals intended-clean and reject-all equals original
- **THEN** semantic replay SHALL pass
- **AND** hashes and nonempty projection counts SHALL be recorded

#### Scenario: [REL-VERIFY-03] Mutation control proves sensitivity
- **WHEN** one expected projection character is deliberately mutated
- **THEN** equality SHALL fail
- **AND** the unmutated artifact SHALL remain unchanged

### Requirement: Authored redlines preserve every available common token

The compiled independent checker SHALL compare the exact token LCS of aligned
original/revised paragraphs with ordinary non-revision tokens in the emitted
tracked paragraph.

#### Scenario: [REL-VERIFY-04] Surgical edit has zero minimality loss
- **GIVEN** a paragraph with an exact surgical tracked edit
- **WHEN** minimality verification runs
- **THEN** lost preservable tokens SHALL equal zero
- **AND** preservation efficiency SHALL equal 100 percent

#### Scenario: [REL-VERIFY-05] Coarse replacement fails despite exact projections
- **GIVEN** a redline that deletes and reinserts text that could remain ordinary
- **AND** accept-all and reject-all are otherwise exact
- **WHEN** minimality verification runs under authored policy
- **THEN** the release certificate SHALL fail with paragraph diagnostics

### Requirement: Package and comment integrity remain separate gates

The verifier SHALL report archive readability, selected-part integrity, and
conditional native-comment record/range/reference consistency independently
from semantic text replay.

#### Scenario: [REL-VERIFY-06] Corrupt package cannot pass
- **WHEN** any required package entry is corrupt, ambiguous, unsafe, or unreadable
- **THEN** package integrity SHALL fail or be not-run with a typed reason

#### Scenario: [REL-VERIFY-07] Required comments must be internally consistent
- **GIVEN** a manifest requiring native comments
- **WHEN** records, range starts, range ends, and references disagree
- **THEN** comment integrity SHALL fail

### Requirement: Rendered artifacts are independently bound and falsifiable

When a PDF is required, the renderer verifier SHALL use a disposable profile,
compare extracted PDF text with the independently derived markup view, measure
configured revision colors, and render a same-input negative control.

#### Scenario: [REL-VERIFY-08] Conventional legal redline render passes
- **WHEN** insertions render blue and underlined, deletions red and struck
- **AND** PDF text equals the tracked markup view
- **AND** the by-author control fails configured-color floors
- **THEN** render verification SHALL pass with bounded measurements

#### Scenario: [REL-VERIFY-09] Missing renderer is incomplete, not green
- **GIVEN** a manifest requiring PDF verification
- **WHEN** a required renderer, rasterizer, or text extractor is unavailable
- **THEN** the render verdict SHALL be `not_run`
- **AND** the release certificate SHALL be incomplete with exit code 3

### Requirement: Public fixtures exclude confidential matter substance

Public fixtures SHALL be synthetic or minimized and de-identified with explicit
provenance and redistribution status. Real matters SHALL be referenced only by
gitignored local manifests and SHALL never be copied into tracked outputs.

#### Scenario: [REL-VERIFY-10] Private corpus remains path-based and local
- **WHEN** a private manifest references a completed matter
- **THEN** the runner SHALL read it in place and emit only ignored certificates
- **AND** SHALL refuse tracked fixture or output paths

#### Scenario: [REL-VERIFY-11] Public regression fixture passes leak checks
- **WHEN** a minimized fixture is proposed for tracking
- **THEN** forbidden identifiers, metadata, comments, and substantive matter text SHALL be absent
- **AND** a provenance/license sidecar SHALL authorize its inclusion

### Requirement: Release verdicts distinguish failure from unavailable evidence

Every required gate SHALL report `pass`, `fail`, or `not_run`. A required
`not_run` result SHALL never be represented as pass.

#### Scenario: [REL-VERIFY-12] Exit status reflects truth
- **WHEN** all required gates pass
- **THEN** the CLI SHALL exit 0
- **WHEN** a completed check fails
- **THEN** the CLI SHALL exit 1
- **WHEN** no completed check fails but a required check is not-run
- **THEN** the CLI SHALL exit 3

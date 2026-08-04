## ADDED Requirements

### Requirement: CLI can project verifier evidence for LLM consumption

The installed Safe DOCX CLI SHALL accept
`--certificate-format <full|llm>` for verified comparisons. Omission or `llm`
SHALL project the canonical public v1 certificate into a deterministic
`safe-docx.llm-verification-certificate` schema without changing the Lean
checker protocol or the canonical certificate producer. Explicit `full` SHALL
preserve the canonical public v1 certificate shape. Supplying the format flag
SHALL imply verification.

#### Scenario: [CLI-CERT-01] Full format remains backward compatible

- **GIVEN** a passing canonical public v1 certificate
- **WHEN** certificate format is explicitly `full`
- **THEN** the CLI JSON and requested artifact SHALL contain the unchanged
  canonical certificate
- **AND** the result SHALL identify the emitted format as `full`

#### Scenario: [CLI-CERT-02] LLM format is consistent across outputs

- **GIVEN** a passing canonical public v1 certificate
- **WHEN** certificate format is omitted or explicitly `llm`
- **THEN** the CLI JSON and requested artifact SHALL contain the same normalized
  LLM certificate
- **AND** the result SHALL identify the emitted format as `llm`

### Requirement: LLM certificate is normalized, versioned, and loss-aware

The LLM certificate SHALL distinguish its schema version, the canonical public
certificate protocol, and the internal checker protocol. It SHALL place the
verdict, reconstruction mode, scope counts, exclusions, status summaries, and
anomalies before detailed evidence. Generic story checks SHALL use stable
invariant IDs whose prose definitions occur exactly once, and stories with
identical result vectors SHALL share deterministic grouped result sets.

The projection SHALL retain package and main-XML hashes, story identities and
token counts, the canonical reason when present, and every presence mismatch,
fixed-story failure, relationship-selection failure, note-integrity failure,
and comment-integrity failure. Compaction SHALL NOT turn `failed`, `not_run`,
`not_applicable`, or `not_evaluated` evidence into a pass or omit it.

#### Scenario: [CLI-CERT-03] Uniform passes are grouped without repeated claims

- **GIVEN** multiple fixed or relationship stories with the same invariant
  status vector
- **WHEN** the LLM projection is produced
- **THEN** those story IDs SHALL share one result set
- **AND** each invariant claim SHALL occur only in the definitions table
- **AND** invariant and story status totals SHALL equal the canonical evidence

#### Scenario: [CLI-CERT-04] Non-passing evidence survives projection

- **GIVEN** canonical failed or non-evaluated checks and structured anomalies
- **WHEN** the LLM projection is produced
- **THEN** every non-passing invariant relation and anomaly SHALL remain
  explicitly represented
- **AND** exclusions SHALL remain distinct from failures
- **AND** the projection verdict SHALL equal the canonical certificate status

#### Scenario: [CLI-CERT-05] Projection ordering is deterministic

- **WHEN** the same canonical certificate is projected repeatedly
- **THEN** serialized JSON SHALL be byte-identical
- **AND** invariant definitions, stories, result sets, and anomaly collections
  SHALL use their documented stable order

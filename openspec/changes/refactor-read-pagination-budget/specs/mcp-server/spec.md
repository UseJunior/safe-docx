## ADDED Requirements

### Requirement: Shared pagination admission accounting
Read pagination SHALL share admission accounting across equivalent local and
Google modes, separately tracking consumed input and rendered output. Every
nonempty budgeted page SHALL admit at least one node and every nonterminal budgeted page
SHALL return the exact next one-based input offset. Explicit offset, limit or
nonempty node_ids SHALL continue to disable implicit budgeting.

#### Scenario: First node exceeds the budget
- **GIVEN** the first node exceeds the implicit content budget
- **WHEN** a local read renders it
- **THEN** it is returned with budget_exceeded_by_first_node
- **AND** continuation resumes after exactly the consumed input

#### Scenario: A table spans pages
- **GIVEN** a contiguous table exceeds the remaining text budget
- **WHEN** the page stops inside that table
- **THEN** admitted cells appear once in document order with one closing marker
- **AND** the continuation starts at the first unconsumed cell

#### Scenario: Google formats and explicit selectors
- **GIVEN** a Google document read using toon, simple or json
- **WHEN** implicit budgeting is active
- **THEN** the requested format is rendered using shared admission accounting
- **AND** explicit pagination or targeting continues to bypass that budget

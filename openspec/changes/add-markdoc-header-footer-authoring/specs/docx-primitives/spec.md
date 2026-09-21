## ADDED Requirements

### Requirement: Package revision projection includes selected header and footer stories

The accept and reject engines SHALL relationship-walk the section bindings and
project every distinct selected physical header/footer story exactly once.
Counters SHALL aggregate with body and supported side-story counters. Header or
footer parts not selected by a section relationship SHALL remain untouched.

#### Scenario: [SDX-PRIM-STORY-01] Selected header revisions project package-wide
- **GIVEN** multiple section selectors resolve to one physical header containing supported tracked insertions and deletions
- **AND** the package also contains an unselected orphan header part
- **WHEN** package accept-all or reject-all is applied
- **THEN** the selected physical header SHALL be projected exactly once
- **AND** accept-all SHALL recover its accepted text and aggregate accept counters
- **AND** reject-all SHALL recover its rejected text and aggregate `insertionsRemoved` and `deletionsRestored`
- **AND** the orphan header part SHALL remain byte-for-byte unchanged

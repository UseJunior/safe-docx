## ADDED Requirements

### Requirement: Scoped inline conversion formatting
The ODF inline emitter SHALL restore each outer formatting scope after its inner
repeated tag closes, inherit omitted nested font attributes, and keep scope state
local to one appended paragraph. It SHALL tolerate extra closes and crossing tags.

#### Scenario: Repeated formatting and siblings
- **WHEN** bold, italic, underline, highlight, or font tags repeat inside an outer tag
- **THEN** closing an inner tag restores the outer value until its own closing tag
- **AND** following unformatted siblings use default formatting

#### Scenario: Malformed and empty scopes
- **WHEN** nested tags are empty, crossing tags close, or extra closing tags occur
- **THEN** each tag affects only its own scope without underflow or paragraph leakage

### Requirement: Safe nested hyperlink degradation
The ODF inline emitter SHALL activate only a sanitized outermost hyperlink, flatten
nested links into that scope, and report every nested link as `nested-hyperlink`.
Rejected URLs SHALL retain `unsafe-hyperlink-href` reporting.

#### Scenario: Safe outer link with nested links
- **WHEN** safe or rejected inner URLs occur within a safe outer link
- **THEN** all enclosed text remains in the outer link until the outer close
- **AND** following siblings are outside that link

#### Scenario: Rejected outer link
- **WHEN** a rejected outer URL encloses a safe inner URL at any depth
- **THEN** neither URL becomes active and following sibling links work normally

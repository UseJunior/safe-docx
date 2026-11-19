## ADDED Requirements
### Requirement: Nested field comment coordinates
The reader SHALL calculate inline comment coordinates with tolerant nested field
traversal across paragraphs in each story, ignoring text in any open field code
region. It SHALL isolate text boxes from the containing document story.

#### Scenario: nested field results do not shift inline comment markers
- **WHEN** read_file renders inline comments after a nested field
- **THEN** the markers SHALL wrap the intended visible text

#### Scenario: comment coordinate traversal spans paragraphs without crossing stories
- **WHEN** comment coordinates are indexed over multiple paragraphs and text boxes
- **THEN** field state SHALL persist within each story and remain isolated from other stories

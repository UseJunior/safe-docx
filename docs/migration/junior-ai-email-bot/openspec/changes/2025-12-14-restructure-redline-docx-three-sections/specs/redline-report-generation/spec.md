## ADDED Requirements

### Requirement: Three-Section DOCX Report Structure

The redline pipeline SHALL generate a comprehensive Word (DOCX) report with three distinct sections:

1. **Summary Table Section** (Issues List): A high-level summary table showing key changes with columns for Issue Heading, Original Draft, Revised Draft, and Legal Implications. This section SHALL use landscape orientation with narrow margins.

2. **Detailed Analysis Section**: A complete detailed analysis table including row numbers, issue descriptions, original draft text, revised draft text, legal implications, and risk scores with color-coded backgrounds. This section SHALL use landscape orientation with narrow margins. This section SHALL include the VeriQuotes citation legend explaining green text verification.

3. **Full Redline Document Section**: The complete redline document appended as an appendix, containing bookmarks/hyperlink targets that correspond to citations in the detailed analysis table.

The DOCX report SHALL support internal hyperlink navigation from detailed analysis rows to their corresponding locations in the appended redline document.

The DOCX report SHALL use section-specific page numbering with the format "Issues List - Page X" for the summary and analysis sections.

#### Scenario: User receives comprehensive DOCX report

- **WHEN** the redline pipeline generates output documents
- **THEN** the Word document SHALL contain three sections: Summary Table, Detailed Analysis, and Full Redline Document
- **AND** the detailed analysis table entries SHALL link to bookmarked paragraphs in the redline appendix
- **AND** the document SHALL use the filename prefix "Issues List for" to indicate its comprehensive nature
- **AND** the VeriQuotes legend SHALL appear before the detailed analysis table

#### Scenario: Hyperlink navigation works within DOCX

- **WHEN** a user clicks on a citation link in the detailed analysis table
- **THEN** the document SHALL navigate to the corresponding bookmarked paragraph in the redline document appendix
- **AND** "Back to Top" links in the appendix SHALL navigate back to the analysis section

#### Scenario: Page numbering uses Issues List format

- **WHEN** viewing the summary or detailed analysis sections
- **THEN** the footer SHALL display "Issues List - Page X" where X is the page number

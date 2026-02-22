# Change: Restructure Redline DOCX Output to Three Sections

## Why

The current redline pipeline generates a summary-only Word document ("Issues List") containing just the summary table, while the comprehensive PDF report contains the detailed analysis with hyperlinks to the appended redline document. Users want the Word document to mirror the PDF structure with all three sections, enabling clickable navigation within the DOCX and providing a complete standalone document for editing/forwarding.

## What Changes

- **MODIFIED**: The "Issues List" DOCX output will now include three sections:
  1. **Summary Table** (Issues List) - High-level overview of key changes
  2. **Detailed Analysis** - Full analysis table with risk scores (currently only in PDF)
  3. **Full Redline Document** - The complete redline document appendix with hyperlink/bookmark targets

- **REMOVED**: The client-facing Word report (`_generate_client_facing_word_report`) will be removed as it becomes redundant
- The PDF report structure remains unchanged
- Include VeriQuotes legend in the DOCX for quote verification context
- Section-specific page numbering: "Issues List - Page X" for the summary/analysis sections
- Hyperlink targets (bookmarks) in the redline document appendix will enable navigation from the detailed analysis table

## Impact

- **Affected code**: `workflows/redline_pipeline/report_generator.py`
  - Modify `_generate_summary_only_word_report` to include detailed analysis, VeriQuotes legend, and redline appendix
  - Remove `_generate_client_facing_word_report` function
  - Update `generate_document` to no longer call the removed function
  - Update page numbering hook for section-specific "Issues List - Page X" format
- **User-facing change**: Users will receive ONE comprehensive DOCX (instead of two) that can be used for both review and editing
- **Breaking change**: Users who relied on the separate client-facing Word report will no longer receive it; the Issues List now contains all that content plus the redline appendix

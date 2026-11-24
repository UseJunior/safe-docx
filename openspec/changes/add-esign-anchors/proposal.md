# Add e-signature anchors to Markdoc creation

## Why

E-signature integrations locate fields by searching PDF text for placement markers. Authors need to place those markers without introducing visible text into the signature block or modifying the generated DOCX outside the creation pipeline.

## What changes

Add an inline creation tag for a plain-text marker, with fixed white, small run formatting. Verify PDF extraction and rendering against a generated signature block.

## Impact

The change affects the docx-markdoc creation syntax and its DOCX and PDF verification.

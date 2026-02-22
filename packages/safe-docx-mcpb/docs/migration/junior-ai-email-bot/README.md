# Safe Docx

Format-preserving Word document editing using atomic node operations. Never corrupts your `.docx` files.

## Why Safe Docx?

**The Problem:** Direct XML manipulation of Word documents is risky. String-based edits can corrupt formatting, break document structure, or produce files that won't open.

**The Solution:** Safe Docx uses atomic node operations that target individual document elements. Each edit operates on a specific node - never raw XML strings. Your formatting survives every change.

| Approach | Risk | Safe Docx |
|----------|------|-----------|
| Raw XML editing | Corrupts structure | Atomic node operations |
| String replacement | Breaks formatting | Targets specific runs |
| Copy-paste | Loses styles | Preserves all formatting |

## What It Does

Safe Docx lets Claude edit Microsoft Word documents on your local computer:

- **Open** any `.docx` file from your Downloads, Documents, or other folders
- **Search** for text using grep (supports regex patterns)
- **Edit** specific paragraphs while preserving bold, italic, underline, and styles
- **Insert** new paragraphs that inherit formatting from surrounding text
- **Save** edited documents back to your filesystem

## How It Works

1. **Atomic Operations**: Each edit targets specific document nodes, not raw XML
2. **Stable Paragraph IDs**: Bookmarks (jr_para_*) provide reliable targeting across sessions
3. **Format Preservation**: Bold, italic, fonts, and styles survive every edit
4. **Local Processing**: Documents stay on your computer - nothing uploaded

## Example Usage

### Example 1: Quick Text Change

**You:** "Change the payment term from 30 days to 45 days in ~/Downloads/contract.docx"

Claude will:
1. Open the document
2. Search for "30 days"
3. Replace with "45 days" (keeping formatting)
4. Save to ~/Downloads/contract_edited.docx

### Example 2: Update Party Names

**You:** "In my NDA at ~/Documents/NDA_template.docx, replace 'ACME Corp' with 'NewCo Industries' everywhere"

Claude will:
1. Open the document
2. Find all instances of "ACME Corp"
3. Replace each one while preserving formatting
4. Save the updated document

### Example 3: Add a New Clause

**You:** "Add a confidentiality clause after section 3 in ~/Downloads/agreement.docx"

Claude will:
1. Open the document
2. Find section 3 using grep
3. Insert a new paragraph after it (with matching formatting)
4. Save the document

## Requirements

- macOS, Windows, or Linux
- Python 3.10 or higher (uses `uv` for dependency management)
- Documents must be in `.docx` format (Microsoft Word)

## Privacy Policy

Safe Docx processes all documents locally on your computer:

- **No cloud uploads**: Document content never leaves your machine
- **No data collection**: We don't collect, store, or transmit your documents
- **No external calls**: All operations happen locally via the MCP protocol
- **Session-only storage**: Document data exists only during your editing session

See our full [Privacy Policy](https://usejunior.com/privacy) for details.

## Support

- Website: https://usejunior.com
- Email: support@usejunior.com
- Issues: https://github.com/usejunior/safe-docx/issues

## License

MIT License - see LICENSE file for details.

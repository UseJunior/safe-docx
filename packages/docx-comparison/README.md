# @usejunior/docx-comparison

Document comparison engine with track changes output. Compares two DOCX files and produces a redlined version with insertions and deletions marked using OOXML track changes.
OpenAgreements project, built by the UseJunior team.

## Features

- **Baseline A (WmlComparer)**: Wraps the battle-tested WmlComparer engine via .NET CLI
- **Baseline B (Pure TypeScript)**: Native implementation using diff-match-patch
- **Benchmark harness**: Compare both baselines for quality and performance

## Installation

```bash
npm install @usejunior/docx-comparison
```

## Usage

### Basic Comparison (Baseline B - Pure TypeScript)

```typescript
import { DocxArchive } from '@usejunior/docx-comparison';
import { alignParagraphs } from '@usejunior/docx-comparison/baselines/diffmatch/paragraphAlignment';
import { diffRuns } from '@usejunior/docx-comparison/baselines/diffmatch/runDiff';
import { renderTrackChanges } from '@usejunior/docx-comparison/baselines/diffmatch/trackChangesRenderer';

// Load documents
const original = await DocxArchive.load(originalBuffer);
const revised = await DocxArchive.load(revisedBuffer);

// Extract and compare paragraphs
const originalParagraphs = extractParagraphs(await original.getDocumentXml());
const revisedParagraphs = extractParagraphs(await revised.getDocumentXml());

const alignment = alignParagraphs(originalParagraphs, revisedParagraphs);

// For each matched paragraph, compute run-level diff
for (const match of alignment.matched) {
  const runDiff = diffRuns(match.original.runs, match.revised.runs);
  const trackChangesXml = renderTrackChanges(runDiff.mergedRuns, {
    author: 'Comparison',
    date: new Date(),
  });
  // Use trackChangesXml to update the document
}
```

### Using WmlComparer (Baseline A - requires .NET)

```typescript
import { compareWithDotnet, isRedlineAvailable } from '@usejunior/docx-comparison/baselines/wmlcomparer/DotnetCli';

// Check if .NET and Docxodus are available
if (await isRedlineAvailable('/path/to/Docxodus')) {
  const result = await compareWithDotnet(originalBuffer, revisedBuffer, {
    author: 'Comparison',
    docxodusPath: '/path/to/Docxodus',
  });

  // result.document contains the redlined DOCX
  // result.stats contains change counts
}
```

## Running Benchmarks

### Prerequisites for Baseline A

1. **Install .NET 8+**:
   - macOS: `brew install dotnet`
   - Ubuntu: `sudo apt-get install dotnet-sdk-8.0`
   - Windows: Download from https://dotnet.microsoft.com/download

2. **Clone Docxodus**:
   ```bash
   git clone https://github.com/JSv4/Docxodus.git /path/to/Docxodus
   ```

3. **Build the redline tool**:
   ```bash
   cd /path/to/Docxodus
   dotnet build tools/redline/redline.csproj
   ```

### Running the Benchmark

```bash
# Run benchmark against test fixtures
npm run benchmark src/testing/fixtures --docxodus=/path/to/Docxodus

# Options:
#   --docxodus=<path>   Path to Docxodus repository
#   --author=<name>     Author name for revisions
#   --no-baseline-a     Skip Baseline A (WmlComparer)
#   --no-baseline-b     Skip Baseline B (pure TS)
```

### Expected Output

```
Found 8 fixture(s)
Running: simple-word-change
Running: paragraph-insert
Running: paragraph-delete
...

=== Benchmark Summary ===

Fixture: simple-word-change
  Baseline A: 1 ins, 1 del, 245ms
  Baseline B: 1 ins, 1 del, 12ms
```

## Test Fixtures

Test fixtures are in `src/testing/fixtures/`:

| Fixture | Description |
|---------|-------------|
| `simple-word-change` | Single word substitution |
| `paragraph-insert` | Adding a paragraph |
| `paragraph-delete` | Removing a paragraph |
| `run-level-change` | Changes within text runs |
| `multiple-changes` | Multiple edits in one paragraph |
| `no-change` | Identical documents |
| `empty-to-content` | Empty to content transition |
| `complete-rewrite` | All content changed |

### Generating Fixtures

```bash
npx tsx src/testing/fixtures/generateFixtures.ts
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Type check
npm run lint
```

## Architecture

```
src/
├── core-types.ts         # WmlComparer core data structures
├── atomizer.ts           # Document atomization for LCS
├── move-detection.ts     # Move detection algorithm
├── format-detection.ts   # Format change detection
├── numbering.ts          # Legal numbering corner cases
├── footnotes.ts          # Footnote/endnote numbering
├── baselines/
│   ├── wmlcomparer/      # Baseline A: WmlComparer wrapper
│   │   ├── DotnetCli.ts  # Shell out to .NET CLI
│   │   └── DocxodusWasm.ts  # WASM integration (future)
│   └── diffmatch/        # Baseline B: Pure TypeScript
│       ├── paragraphAlignment.ts  # LCS-based paragraph matching
│       ├── runDiff.ts    # diff-match-patch integration
│       └── trackChangesRenderer.ts  # OOXML generation
├── benchmark/            # A/B comparison harness
│   ├── runner.ts
│   ├── metrics.ts
│   └── reporter.ts
└── shared/
    ├── docx/
    │   └── DocxArchive.ts  # DOCX ZIP handling
    └── ooxml/
        ├── namespaces.ts   # OOXML namespace constants
        └── types.ts        # TypeScript interfaces
```

## Core Types (WmlComparer)

The package includes TypeScript equivalents of WmlComparer's core C# data structures, enabling a pure TypeScript implementation of document comparison.

### CorrelationStatus

Tracks the comparison state of atoms:

```typescript
import { CorrelationStatus } from '@usejunior/docx-comparison';

// Available statuses:
// - Unknown: Not yet processed
// - Equal: Content matches in both documents
// - Deleted: Only in original (removed)
// - Inserted: Only in revised (added)
// - MovedSource: Content was moved from this location
// - MovedDestination: Content was moved to this location
// - FormatChanged: Text matches but formatting differs
```

### ComparisonUnitAtom

The atomic unit of comparison:

```typescript
import { createComparisonUnitAtom, atomizeTree } from '@usejunior/docx-comparison';

// Atomize a document tree
const atoms = atomizeTree(documentElement, [], {
  uri: 'word/document.xml',
  contentType: '...',
});

// Each atom contains:
// - contentElement: The leaf element (w:t, w:br, etc.)
// - ancestorElements: Path from root to parent
// - ancestorUnids: Unique identifiers for correlation
// - sha1Hash: For quick equality checks
// - correlationStatus: Current comparison state
```

### Move Detection

Detect relocated content after LCS comparison:

```typescript
import { detectMovesInAtomList, jaccardWordSimilarity } from '@usejunior/docx-comparison';

// Run after LCS comparison
detectMovesInAtomList(atoms, {
  detectMoves: true,
  moveSimilarityThreshold: 0.8,  // Min similarity for move match
  moveMinimumWordCount: 5,       // Min words to consider for move
  caseInsensitiveMove: true,
});

// Atoms matching deleted/inserted blocks will be marked as:
// - MovedSource: Original location of moved content
// - MovedDestination: New location of moved content
```

### Format Change Detection

Detect formatting changes (bold, italic, font size, etc.):

```typescript
import { detectFormatChangesInAtomList } from '@usejunior/docx-comparison';

// Run after LCS and move detection
detectFormatChangesInAtomList(atoms, { detectFormatChanges: true });

// Equal atoms with different formatting will be marked as FormatChanged
// with details in atom.formatChange
```

### Legal Numbering

Handle OOXML numbering corner cases for legal documents:

```typescript
import {
  detectContinuationPattern,
  formatNumber,
  expandLevelText,
} from '@usejunior/docx-comparison';

// Detect "orphan" list items (e.g., "4." instead of "3.4")
const info = detectContinuationPattern(ilvl, startValue, levelNumbers);

// Format numbers in various styles
formatNumber(1, 'lowerRoman');  // "i"
formatNumber(1, 'upperLetter'); // "A"

// Expand level text with placeholders
expandLevelText('%1.%2', [3, 2], levels);  // "3.2"
```

### Footnote Numbering

Track sequential footnote/endnote numbering by document order:

```typescript
import { FootnoteNumberingTracker } from '@usejunior/docx-comparison';

const tracker = new FootnoteNumberingTracker(documentRoot);

// Get display number by XML ID
const displayNum = tracker.getFootnoteDisplayNumber('42');  // Returns 1 if first footnote

// Handle 91 footnotes correctly (IDs 2-92 → display 1-91)
tracker.getFootnoteCount();  // 91
```

## Decision Criteria

After running benchmarks, choose your approach:

| Scenario | Recommendation |
|----------|----------------|
| WmlComparer works well | Use Baseline A, port features gradually |
| Pure TS close to WmlComparer | Port remaining pieces to Baseline B |
| Legal numbering issues | Fix with pre/post processing |
| Large performance gap | Profile and optimize |

## License

MIT

import { WORD_HIGHLIGHTS } from './cli-options.js';
import { HEADING_NUMBER_SCHEMES } from './create/list-numbering.js';
import {
  CREATION_BLOCK_TAGS,
  CREATION_FRONTMATTER_KEYS,
  CREATION_INLINE_TAGS,
  FILL_IN_MODES,
  FIRST_PAGE_NONE,
  FOOTER_LAYOUTS,
  PAGE_NUMBER_FORMATS,
  PARAGRAPH_LAYOUT_ALIGNMENTS,
  PARAGRAPH_LAYOUT_HANGING_INDENTS,
  PARAGRAPH_LAYOUT_LEFT_INDENTS,
  RUNNING_TEXT_ALIGNMENTS,
  XREF_FORMATS,
  XREF_NUMBERS,
  XREF_SHOWS,
} from './create/validate.js';

/**
 * The help of one `docx-markdoc` subcommand. `docx-markdoc <command> --help`
 * prints it, and the top-level usage lists every command's synopsis, so a new
 * subcommand registers here once and both stay in step.
 */
export type CommandHelp = {
  /** Each way to call the command, after `docx-markdoc `. */
  synopsis: readonly string[];
  summary: string;
  arguments: ReadonlyArray<readonly [string, string]>;
  options: ReadonlyArray<readonly [string, string]>;
  outputs: readonly string[];
  /** Further sections, such as the creation grammar of `create`. */
  more?: () => string[];
};

const HELP_OPTION = ['-h, --help', 'Print this help and exit.'] as const;

/** Every subcommand, in the order the top-level usage lists them. */
export const COMMAND_HELP: Readonly<Record<string, CommandHelp>> = {
  import: {
    synopsis: ['import <source.docx> <anchored.docx> <document.mdoc>'],
    summary: 'Import an existing Word document as hash-pinned brownfield Markdoc. The source is only read.',
    arguments: [
      ['<source.docx>', 'The Word document to import.'],
      ['<anchored.docx>', 'New file: a copy of the source with a bookmark on every editable paragraph.'],
      ['<document.mdoc>', 'New file: the readable Markdoc revision file pinned to the anchored copy.'],
    ],
    options: [HELP_OPTION],
    outputs: [
      '<anchored.docx> and <document.mdoc>; both must be new paths.',
      'stderr: one XREF_KEPT_AS_TEXT warning per cross-reference imported as its cached text.',
    ],
  },
  validate: {
    synopsis: ['validate <document.mdoc> [anchored.docx]', 'validate --create <document.mdoc> [--style-profile profile.json]'],
    summary: 'Lint a Markdoc file without writing anything. By default the file is brownfield Markdoc from import; with --create it is a creation source for create.',
    arguments: [
      ['<document.mdoc>', 'The Markdoc file to lint.'],
      ['[anchored.docx]', 'Brownfield only: also check the edits against the anchored source from import.'],
    ],
    options: [
      ['--create', 'Lint a creation source with the checks create runs before it renders: the frontmatter, the closed tag grammar and the section structure. Nothing is generated or written.'],
      ['--style-profile <profile.json>', 'With --create: check the source under this style profile, as create would.'],
      HELP_OPTION,
    ],
    outputs: [
      'stdout: the parsed document as JSON (brownfield), or a summary with sections, blocks and frontmatter (--create).',
      'stderr: one ERROR <code>: <message> (line N) line per problem, the same lines compile or create would print; exit code 1.',
      'No file is written.',
    ],
  },
  inspect: {
    synopsis: ['inspect <anchored.docx> [paragraph-id ...]'],
    summary: 'Print diagnostic records for the paragraphs of an anchored source. The output is for reading and cannot be compiled.',
    arguments: [
      ['<anchored.docx>', 'An anchored source written by import.'],
      ['[paragraph-id ...]', 'Only these paragraph ids (bookmark names); default every paragraph.'],
    ],
    options: [HELP_OPTION],
    outputs: ['stdout: one JSON record per paragraph. No file is written.'],
  },
  compile: {
    synopsis: ['compile <anchored.docx> <document.mdoc> <output-dir> [options]'],
    summary: 'Apply the edits in a brownfield Markdoc file to its anchored source, derive native tracked changes, and verify that reject-all equals the source and accept-all equals the clean document.',
    arguments: [
      ['<anchored.docx>', 'The anchored source written by import.'],
      ['<document.mdoc>', 'The edited Markdoc revision file.'],
      ['<output-dir>', 'Directory for the outputs; created when missing. Each output file must be new.'],
    ],
    options: [
      ['--external-comments', 'Include external-facing rationales as Word comments (the default unless the Markdoc says otherwise).'],
      ['--no-external-comments', 'Leave external-facing rationales out of the redline.'],
      ['--dangerously-include-internal-comments', 'Also write internal rationales as comments; requires --internal-output.'],
      ['--internal-output <path.docx>', 'Where the redline with internal comments goes; its name gets an INTERNAL COMMENTS INCLUDED suffix.'],
      ['--note-profile <profile.json>', 'How each note audience is presented, as a JSON profile.'],
      ['--external-notes <mode>', 'preserve, comment, footnote or omit external-facing notes (not with --note-profile).'],
      ['--internal-notes <mode>', 'preserve, comment, footnote or omit internal notes (not with --note-profile).'],
      ['--unspecified-notes <mode>', 'preserve, comment, footnote or omit notes with no audience (not with --note-profile).'],
      HELP_OPTION,
    ],
    outputs: [
      '<output-dir>/clean.docx: the edited document without tracked changes.',
      "<output-dir>/redline.docx, or 'redline - EXTERNAL COMMENTS INCLUDED.docx' when external comments are included: the tracked-change redline.",
      '<output-dir>/verification.json: the verification certificate, also printed on stdout.',
      'Exit code 1 with DELIVERY_NOT_READY when draft completeness blocks delivery.',
    ],
  },
  verify: {
    synopsis: ['verify <anchored.docx> <document.mdoc> [options]'],
    summary: 'Run every compile check without writing any output.',
    arguments: [
      ['<anchored.docx>', 'The anchored source written by import.'],
      ['<document.mdoc>', 'The edited Markdoc revision file.'],
    ],
    options: [
      ['--external-comments', 'Verify with external-facing rationales as comments.'],
      ['--no-external-comments', 'Verify with external-facing rationales left out.'],
      ['--note-profile <profile.json>', 'How each note audience is presented, as a JSON profile.'],
      ['--external-notes <mode>', 'preserve, comment, footnote or omit external-facing notes.'],
      ['--internal-notes <mode>', 'preserve, comment, footnote or omit internal notes.'],
      ['--unspecified-notes <mode>', 'preserve, comment, footnote or omit notes with no audience.'],
      HELP_OPTION,
    ],
    outputs: [
      'stdout: the verification certificate as JSON. No file is written.',
      'Exit code 2 when the projection verifies but draft completeness blocks delivery.',
    ],
  },
  'compile-greenfield': {
    synopsis: ['compile-greenfield <template.docx> <document.mdoc> <output-dir> [--style-profile profile.json]'],
    summary: 'Create a new clean form in a one-section house template from tag-free Markdoc: the template supplies styles, page setup and any headers or footers; the Markdoc supplies every body paragraph.',
    arguments: [
      ['<template.docx>', 'The template to build from.'],
      ['<document.mdoc>', 'The greenfield Markdoc body.'],
      ['<output-dir>', 'A directory that must not exist yet.'],
    ],
    options: [
      ['--style-profile <profile.json>', 'Map Markdoc block kinds to template styles.'],
      HELP_OPTION,
    ],
    outputs: [
      '<output-dir>/clean.docx: the filled document.',
      '<output-dir>/verification.json: the certificate, also printed on stdout.',
    ],
  },
  create: {
    synopsis: ['create <document.mdoc> <output-dir> [--style-profile profile.json] [--no-pdf] [--require-pdf] [--replace | --dangerously-overwrite-edited-docx]'],
    summary: 'Build a new Word document from creation Markdoc, with no template, and verify it before publishing anything. Lint a source first with validate --create.',
    arguments: [
      ['<document.mdoc>', 'The creation source; its file name (without .mdoc) is the <stem> of the outputs.'],
      ['<output-dir>', 'Directory for the outputs; created when missing.'],
    ],
    options: [
      ['--style-profile <profile.json>', 'Override font, sizePt, spacingAfterPt, lineSpacing, marginsIn, titleSizePt, signatureTabIn or justify.'],
      ['--no-pdf', 'Skip the PDF render and its word check.'],
      ['--require-pdf', 'Fail when LibreOffice or pdftotext is missing instead of skipping the PDF.'],
      ['--replace', 'Rebuild over existing outputs, only when <stem>.docx is the DOCX the last build certified.'],
      ['--dangerously-overwrite-edited-docx', 'Rebuild over an edited or uncertified DOCX, keeping its bytes in .<stem>.create-overwritten-<uuid>/.'],
      HELP_OPTION,
    ],
    outputs: [
      '<output-dir>/<stem>.docx: the document.',
      '<output-dir>/<stem>.txt: its text, read back from the DOCX.',
      '<output-dir>/<stem>.pdf: when LibreOffice and pdftotext are installed (not with --no-pdf).',
      '<output-dir>/<stem>.verification.json: the certificate of every check.',
      '<output-dir>/<stem>.failed-verification.json: written instead when a check fails; nothing is published.',
      'stdout: a one-line summary of the checks.',
    ],
    more: creationGrammarHelp,
  },
  pull: {
    synopsis: ['pull <edited.docx> <document.mdoc> [--apply [--output new.mdoc]] [--certificate stem.verification.json] [--style-profile profile.json] [--json]'],
    summary: 'Bring Word edits on a create output back into its creation .mdoc. Compares the edited DOCX with the build its certificate records and reports each change against source lines; with --apply, writes the changes into a new .mdoc that keeps the creation markup. The inputs are only read.',
    arguments: [
      ['<edited.docx>', 'A create output edited in Word (or elsewhere). Tracked changes must be accepted or rejected first.'],
      ['<document.mdoc>', 'The creation source the last build was made from; its SHA-256 must match the certificate.'],
    ],
    options: [
      ['--apply', 'Write the changes pull can express into a new .mdoc; the original is never overwritten.'],
      ['--output <new.mdoc>', 'With --apply: where to write it (default <stem>.pulled.mdoc beside the source); must be a new path.'],
      ['--certificate <path>', 'The build\'s <stem>.verification.json (default: beside the edited DOCX, named after it).'],
      ['--style-profile <profile.json>', 'The style profile the build used, when the certificate records one; default the certificate\'s own profile.'],
      ['--json', 'Print the report as JSON instead of text.'],
      HELP_OPTION,
    ],
    outputs: [
      'stdout: one line per change (changed, deleted or added paragraph with its source line, header or footer per section) and one DIAGNOSTIC <code> line per edit create cannot express or pull could not place.',
      'With --apply: the pulled .mdoc. When it reproduces the edited DOCX in full (no diagnostic), also <stem>.pull.json beside the certificate, which lets create --replace replace that edited DOCX with the build of exactly this pulled source.',
      'Exit code 0: no changes; 2: changes or diagnostics reported; 1: an error (an argument problem, a missing or mismatched certificate, tracked changes).',
    ],
  },
  'export-edits': {
    synopsis: ['export-edits <document.mdoc> <output.json>'],
    summary: 'Export the before/after pairs of the edits in a brownfield Markdoc file.',
    arguments: [
      ['<document.mdoc>', 'A brownfield Markdoc revision file whose edits all carry their before state.'],
      ['<output.json>', 'New file for the edit pairs.'],
    ],
    options: [HELP_OPTION],
    outputs: ['<output.json>: the edit pairs as JSON.'],
  },
  'comments-to-footnotes': {
    synopsis: ['comments-to-footnotes <input.docx> <output.docx> [options]'],
    summary: 'Turn the Word comments of a document into footnotes at their anchors.',
    arguments: [
      ['<input.docx>', 'The document whose comments are converted. It is only read.'],
      ['<output.docx>', 'New file for the converted document.'],
    ],
    options: [
      ['--prefix <text>', 'Text before each footnote body, such as a reviewer label.'],
      ['--prefix-separator <text>', 'Text between the prefix and the body.'],
      ['--bold-prefix', 'Make the prefix bold.'],
      ['--prefix-color <RRGGBB>', 'Colour of the prefix.'],
      ['--prefix-highlight <color>', `Highlight of the prefix: ${WORD_HIGHLIGHTS.join(', ')}.`],
      ['--body-color <RRGGBB>', 'Colour of the footnote body (alias --color).'],
      ['--body-highlight <color>', `Highlight of the footnote body (alias --highlight): ${WORD_HIGHLIGHTS.join(', ')}.`],
      ['--flatten-threads', 'Also convert comments that have replies, folding the thread into one footnote (lossy); without it such a comment is refused.'],
      HELP_OPTION,
    ],
    outputs: [
      '<output.docx>: the converted document.',
      'stdout: the conversion report as JSON.',
    ],
  },
};

/** The top-level usage: every command's synopsis. */
export function topLevelUsage(): string {
  return [
    'Usage:',
    ...Object.values(COMMAND_HELP).flatMap((help) => help.synopsis.map((line) => `  docx-markdoc ${line}`)),
    '',
    "Run 'docx-markdoc <command> --help' for a command's arguments, options and outputs.",
  ].join('\n');
}

function table(rows: ReadonlyArray<readonly [string, string]>): string[] {
  const width = Math.max(...rows.map(([name]) => name.length));
  return rows.map(([name, text]) => `  ${name.padEnd(width)}  ${text}`);
}

/** The help of one subcommand, or undefined for an unknown command. */
export function commandHelp(command: string): string | undefined {
  const help = Object.hasOwn(COMMAND_HELP, command) ? COMMAND_HELP[command] : undefined;
  if (!help) return undefined;
  return [
    'Usage:',
    ...help.synopsis.map((line) => `  docx-markdoc ${line}`),
    '',
    help.summary,
    '',
    'Arguments:',
    ...table(help.arguments),
    '',
    'Options:',
    ...table(help.options),
    '',
    'Outputs:',
    ...help.outputs.map((line) => `  ${line}`),
    ...(help.more ? ['', ...help.more()] : []),
  ].join('\n');
}

/** Marks a grammar entry this file has no description for; a test fails on it. */
export const UNDOCUMENTED = '(undocumented)';

const alignments = RUNNING_TEXT_ALIGNMENTS.join(' | ');
const either = (values: readonly string[]): string => values.join(' | ');

/**
 * The value each creation frontmatter key takes. The key set and the closed
 * value sets come from `create/validate.ts`, so a value added there shows up
 * here; a key added there without an entry here prints {@link UNDOCUMENTED}.
 */
const CREATION_KEY_VALUES: Readonly<Record<string, string>> = {
  title: '<text>: the document title property, not a visible paragraph (write a # heading for that); default the first # heading',
  author: '<text>: the document author property',
  date: 'YYYY-MM-DD or a UTC ISO timestamp: the document date properties',
  header: `<text>: the running header (on {% section %}, header=false for an empty one)`,
  'header-align': `${alignments} (default center); needs header text`,
  'header-first': `<text> | ${FIRST_PAGE_NONE}: the first page's header (${FIRST_PAGE_NONE} for no header on page 1)`,
  footer: '<text>: the footer text',
  'footer-align': `${alignments}; needs footer text`,
  'footer-italic': 'true (default) | false: italic or upright footer text',
  'footer-layout': `${either(FOOTER_LAYOUTS)} (default ${FOOTER_LAYOUTS[0]}); one-line puts the text left and the number right and needs both`,
  'footer-first': `<text> | ${FIRST_PAGE_NONE}: the first page's footer text (${FIRST_PAGE_NONE} for an empty footer)`,
  'page-numbers': 'true | false: a page number in the footer',
  'page-number-align': `${alignments}; needs page-numbers`,
  'page-number-format': `${either(PAGE_NUMBER_FORMATS)} (default ${PAGE_NUMBER_FORMATS[0]}): "1", "- 1 -" or "Page 1 of N"; needs page-numbers`,
  'fill-ins': `${either(FILL_IN_MODES)} (default ${FILL_IN_MODES[0]}): only {% fill %} is a fill-in, or every [...] is`,
  'heading-numbers': `${either(HEADING_NUMBER_SCHEMES)}: ## is ARTICLE I, ### is Section 1.01`,
};

/** What each creation tag does and, where one is closed, the values of its attributes. */
const CREATION_TAG_HELP: Readonly<Record<string, string>> = {
  center: '{% center %}...{% /center %}: a centred paragraph',
  legend: '{% legend %}...{% /legend %}: a legend, such as a signature-page notice, kept with the block before it',
  'paragraph-layout': `{% paragraph-layout ... %}...{% /paragraph-layout %}: body paragraphs with their own layout; align=${either(PARAGRAPH_LAYOUT_ALIGNMENTS)}, indent-left=${either(PARAGRAPH_LAYOUT_LEFT_INDENTS)} (inches), indent-hanging=${either(PARAGRAPH_LAYOUT_HANGING_INDENTS)} (inches, at most indent-left)`,
  signer: '{% signer name="..." date="..." /%}: a signature block',
  'page-break': '{% page-break /%}: start the next block on a new page',
  section: '{% section ... /%}: start a new section; takes the running-text keys above as attributes for the next section (header=false, page-numbers=true)',
  table: '{% table widths="..." %}: a table with column widths',
  footnote: '{% footnote id="..." %}...{% /footnote %}: the body of the footnote whose {% fnref %} has the same id',
  literal: '{% literal %}...{% /literal %}: literal text, no markup',
  fill: '{% fill %}...{% /fill %}: a fill-in',
  u: '{% u %}...{% /u %}: underlined text',
  fnref: '{% fnref id="..." /%}: a footnote reference mark',
  xref: `{% xref to="..." /%}: a cross-reference to a {% #id %} heading or list item; show=${either([...XREF_SHOWS])}, number=${either([...XREF_NUMBERS])}, format=${either([...XREF_FORMATS])}`,
};

function attributes(allowed: ReadonlySet<string>): string {
  return allowed.size === 0 ? '' : ` (${[...allowed].join(', ')})`;
}

/**
 * The creation grammar `create` admits, derived from the constants in
 * `create/validate.ts`: every frontmatter key with its values, every block
 * and inline tag with its attributes.
 */
export function creationGrammarHelp(): string[] {
  const keys = [...CREATION_FRONTMATTER_KEYS];
  const keyWidth = Math.max(...keys.map((key) => key.length));
  const tagLine = (tag: string, allowed: ReadonlySet<string>) => `  ${tag}${attributes(allowed)}: ${CREATION_TAG_HELP[tag] ?? UNDOCUMENTED}`;
  return [
    'Frontmatter keys (key: value lines between --- fences; they set the first section):',
    ...keys.map((key) => `  ${key.padEnd(keyWidth)}  ${CREATION_KEY_VALUES[key] ?? UNDOCUMENTED}`),
    '',
    `{% section %} attributes: ${[...CREATION_BLOCK_TAGS.section!].join(', ')}`,
    '',
    'Block tags:',
    ...Object.entries(CREATION_BLOCK_TAGS).map(([tag, allowed]) => tagLine(tag, allowed)),
    '',
    'Inline tags:',
    ...Object.entries(CREATION_INLINE_TAGS).map(([tag, allowed]) => tagLine(tag, allowed)),
    '',
    'Also: # ## ### headings, paragraphs, **bold**, *italic*, ordered and bullet lists, > quotes, and {% #id %} targets. See the README for the full grammar.',
  ];
}

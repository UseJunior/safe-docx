import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import JSZip from 'jszip';

export type XmlDoc = Document;

/**
 * Standard XML declaration for serialized OOXML parts. xmldom's serializer
 * omits the declaration, so every emitted part prepends this manually.
 */
export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const XML_WHITESPACE_BEFORE_MARKUP = /^[\t\n\r ]+(?=<)/;

/**
 * Remove what may legally (BOM) or harmlessly (whitespace) precede an XML
 * part's first `<`: one leading U+FEFF byte-order mark, then any XML
 * whitespace before the first markup character (#1024). JSZip's
 * `async('string')` keeps a BOM as U+FEFF, and xmldom rejects both a BOM
 * character and whitespace in front of the `<?xml` declaration. Text that
 * already starts with `<` is returned unchanged.
 */
export function stripXmlLeadingNoise(xml: string): string {
  if (xml.charCodeAt(0) === 0x3c /* < */) return xml;
  const withoutBom = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
  return withoutBom.replace(XML_WHITESPACE_BEFORE_MARKUP, '');
}

/** Archive entries whose text is XML: `.xml` parts and `.rels` relationship parts. */
export function isXmlPartPath(path: string): boolean {
  return /\.(xml|rels)$/i.test(path);
}

/**
 * A package part failed to parse as XML. Names the part so the failure is
 * actionable instead of a bare xmldom `ParseError` (#1024).
 */
export class XmlPartParseError extends Error {
  readonly partName: string;
  /** Which input package held the part, e.g. `original` or `revised`. */
  readonly source: string | undefined;

  constructor(partName: string, cause: unknown, source?: string) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    const where = source ? ` in the ${source} document` : '';
    super(`Failed to parse XML part ${partName}${where}: ${detail}`, { cause });
    this.name = 'XmlPartParseError';
    this.partName = partName;
    this.source = source;
  }
}

/**
 * One start tag declares the same namespace prefix (or the default namespace)
 * twice with different URIs (#1032). Which binding the producer meant cannot
 * be known, so the part is refused rather than guessed at. Package-level entry
 * points wrap it in {@link XmlPartParseError} naming the part.
 */
export class XmlNamespaceRedeclarationError extends Error {
  /** Qualified name of the element whose start tag repeats the declaration. */
  readonly elementName: string;
  /** The repeated declaration attribute, e.g. `xmlns:w` or `xmlns`. */
  readonly attributeName: string;
  readonly firstValue: string;
  readonly secondValue: string;

  constructor(elementName: string, attributeName: string, firstValue: string, secondValue: string) {
    super(
      `<${elementName}> declares ${attributeName} twice with different namespace URIs ` +
        `("${firstValue}" and "${secondValue}"); a repeated attribute is not well-formed XML ` +
        `and the intended binding is ambiguous`,
    );
    this.name = 'XmlNamespaceRedeclarationError';
    this.elementName = elementName;
    this.attributeName = attributeName;
    this.firstValue = firstValue;
    this.secondValue = secondValue;
  }
}

/** A parse failure that does not yet say which part failed. */
export function isUnattributedXmlParseError(error: unknown): boolean {
  return (
    error instanceof Error &&
    !(error instanceof XmlPartParseError) &&
    (error.name === 'ParseError' || error instanceof XmlNamespaceRedeclarationError)
  );
}

/**
 * Rethrow helper for package-level entry points: when `error` is a raw xmldom
 * `ParseError`, find the part that fails to parse in `buffer` and return a
 * {@link XmlPartParseError} naming it; otherwise return `error` unchanged.
 */
export async function attributeXmlParseError(
  error: unknown,
  buffer: Buffer | Uint8Array,
  source?: string,
): Promise<unknown> {
  if (!isUnattributedXmlParseError(error)) return error;
  return (await findUnparseableXmlPart(buffer, source)) ?? error;
}

export interface ParseXmlOptions {
  /**
   * Package path of the part being parsed (for example `word/styles.xml`).
   * When given, a parse failure throws {@link XmlPartParseError} naming it.
   */
  partName?: string;
}

export function parseXml(xml: string, options?: ParseXmlOptions): XmlDoc {
  const text = stripXmlLeadingNoise(xml);
  try {
    try {
      return parseXmlText(text);
    } catch (error) {
      // Only on this specific failure: drop exact repeats of a namespace
      // declaration and parse again, so the hot path never scans (#1032).
      if (!isRedefinedNamespaceDeclarationError(error)) throw error;
      const repaired = removeRepeatedNamespaceDeclarations(text);
      if (repaired === null) throw error;
      return parseXmlText(repaired);
    }
  } catch (error) {
    if (options?.partName !== undefined) throw new XmlPartParseError(options.partName, error);
    throw error;
  }
}

/**
 * Report xmldom diagnostics the way its default handler does, except the
 * repeated namespace declaration that {@link parseXml} handles itself: an
 * exact repeat is tolerated, a conflicting one becomes a typed error, so
 * logging it as fatal would be noise. Returning normally keeps xmldom's
 * behaviour; a `fatalError` still throws `ParseError` after reporting.
 */
function reportXmlDiagnostic(level: string, message: string, context: unknown): void {
  if (level === 'fatalError' && REDEFINED_NAMESPACE_DECLARATION.test(message)) return;
  const locator = (context as { locator?: { lineNumber?: number; columnNumber?: number } } | undefined)?.locator;
  const where = locator ? `\n@#[line:${locator.lineNumber},col:${locator.columnNumber}]` : '';
  console.error(`[xmldom ${level}]\t${message}`, where);
}

function parseXmlText(text: string): XmlDoc {
  // application/xml ensures XML parsing rules (vs HTML-ish parsing).
  // xmldom 0.9.x returns its own module-scoped Document type; cast to global
  // Document to avoid type conflicts with the DOM lib.
  const doc = new DOMParser({ onError: reportXmlDiagnostic }).parseFromString(
    text,
    'application/xml',
  ) as unknown as Document;

  // xmldom uses a <parsererror> element for some failures; keep a minimal check.
  const parseErrors = doc.getElementsByTagName('parsererror');
  if (parseErrors && parseErrors.length > 0) {
    const msg = parseErrors[0]?.textContent?.trim() || 'XML parse error';
    throw new Error(msg);
  }
  return doc;
}

/** xmldom's fatal error for a repeated `xmlns` / `xmlns:prefix` attribute. */
const REDEFINED_NAMESPACE_DECLARATION = /^Attribute xmlns(?::\S+)? redefined\b/;

function isRedefinedNamespaceDeclarationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'ParseError' &&
    REDEFINED_NAMESPACE_DECLARATION.test(error.message)
  );
}

const XML_NAME_AT = /[^\s/>=]+/y;

function isXmlWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

/**
 * Remove a namespace declaration (`xmlns` or `xmlns:prefix`) that repeats an
 * earlier declaration of the same name with the identical value on the same
 * start tag, e.g. `<w:document xmlns:w="…main" xmlns:w="…main">` (#1032).
 *
 * A repeated attribute violates XML 1.0 well-formedness constraint "Unique Att
 * Spec" (§3.1), but an exact repeat of a namespace declaration binds the prefix
 * to the same URI either way, so dropping it cannot change what any name means.
 * Repeats with different values throw {@link XmlNamespaceRedeclarationError}.
 * Repeats of any other attribute are left alone, so the parse still fails.
 *
 * Only start tags are read: comments, CDATA sections, processing instructions
 * and end tags are skipped whole, and character data is never examined.
 * Returns null when there is nothing to remove or the markup cannot be scanned
 * with confidence (a DOCTYPE, an unterminated construct, a malformed
 * attribute); the caller then reports the original parse error.
 */
export function removeRepeatedNamespaceDeclarations(xml: string): string | null {
  const removals: Array<[number, number]> = [];
  const length = xml.length;
  let i = 0;
  while (i < length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    let next: number;
    if (xml.startsWith('<!--', lt)) next = indexAfter(xml, '-->', lt + 4);
    else if (xml.startsWith('<![CDATA[', lt)) next = indexAfter(xml, ']]>', lt + 9);
    else if (xml.startsWith('<?', lt)) next = indexAfter(xml, '?>', lt + 2);
    else if (xml.startsWith('<!', lt)) return null; // DOCTYPE: not an OOXML part shape; do not guess.
    else if (xml.startsWith('</', lt)) next = indexAfter(xml, '>', lt + 2);
    else next = scanStartTag(xml, lt, removals);
    if (next < 0) return null;
    i = next;
  }
  if (removals.length === 0) return null;
  let out = '';
  let from = 0;
  for (const [start, end] of removals) {
    out += xml.slice(from, start);
    from = end;
  }
  return out + xml.slice(from);
}

/** Index just past the next `terminator` at or after `from`, or -1. */
function indexAfter(xml: string, terminator: string, from: number): number {
  const end = xml.indexOf(terminator, from);
  return end < 0 ? -1 : end + terminator.length;
}

/**
 * Scan the start tag opening at `lt`; record each exact repeat of a namespace
 * declaration (with the whitespace before it) in `removals`. Returns the index
 * after the tag, or -1 when the tag cannot be read.
 */
function scanStartTag(xml: string, lt: number, removals: Array<[number, number]>): number {
  XML_NAME_AT.lastIndex = lt + 1;
  const elementMatch = XML_NAME_AT.exec(xml);
  if (!elementMatch) return -1;
  const elementName = elementMatch[0];
  const declarations = new Map<string, string>();
  let j = lt + 1 + elementName.length;
  for (;;) {
    const whitespaceStart = j;
    while (j < xml.length && isXmlWhitespace(xml.charCodeAt(j))) j++;
    if (j >= xml.length) return -1;
    if (xml[j] === '>') return j + 1;
    if (xml.startsWith('/>', j)) return j + 2;
    if (j === whitespaceStart) return -1;
    XML_NAME_AT.lastIndex = j;
    const nameMatch = XML_NAME_AT.exec(xml);
    if (!nameMatch) return -1;
    const attributeName = nameMatch[0];
    j += attributeName.length;
    while (j < xml.length && isXmlWhitespace(xml.charCodeAt(j))) j++;
    if (xml[j] !== '=') return -1;
    j++;
    while (j < xml.length && isXmlWhitespace(xml.charCodeAt(j))) j++;
    const quote = xml[j];
    if (quote !== '"' && quote !== "'") return -1;
    const valueEnd = xml.indexOf(quote, j + 1);
    if (valueEnd < 0) return -1;
    const value = xml.slice(j + 1, valueEnd);
    j = valueEnd + 1;
    if (attributeName !== 'xmlns' && !attributeName.startsWith('xmlns:')) continue;
    const prior = declarations.get(attributeName);
    if (prior === undefined) declarations.set(attributeName, value);
    else if (prior === value) removals.push([whitespaceStart, j]);
    else throw new XmlNamespaceRedeclarationError(elementName, attributeName, prior, value);
  }
}

/**
 * Parse every XML part of a package and return the first one that fails,
 * or null when all parse. Used to name the offending part when a parse error
 * surfaces from code that only held the part's text.
 */
export async function findUnparseableXmlPart(
  buffer: Buffer | Uint8Array,
  source?: string,
): Promise<XmlPartParseError | null> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return null;
  }
  const paths = Object.values(zip.files)
    .filter((file) => !file.dir && isXmlPartPath(file.name))
    .map((file) => file.name)
    .sort();
  for (const path of paths) {
    const text = await zip.file(path)!.async('string');
    try {
      parseXml(text);
    } catch (error) {
      return new XmlPartParseError(path, error, source);
    }
  }
  return null;
}

export function serializeXml(doc: XmlDoc): string {
  return new XMLSerializer().serializeToString(doc);
}

export function textContent(node: Node | null | undefined): string {
  return node?.textContent ?? '';
}

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

/** A raw xmldom `ParseError` that does not yet say which part failed. */
export function isUnattributedXmlParseError(error: unknown): boolean {
  return (
    error instanceof Error &&
    !(error instanceof XmlPartParseError) &&
    error.name === 'ParseError'
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
  let doc: Document;
  try {
    // application/xml ensures XML parsing rules (vs HTML-ish parsing).
    // xmldom 0.9.x returns its own module-scoped Document type; cast to global
    // Document to avoid type conflicts with the DOM lib.
    doc = new DOMParser().parseFromString(text, 'application/xml') as unknown as Document;

    // xmldom uses a <parsererror> element for some failures; keep a minimal check.
    const parseErrors = doc.getElementsByTagName('parsererror');
    if (parseErrors && parseErrors.length > 0) {
      const msg = parseErrors[0]?.textContent?.trim() || 'XML parse error';
      throw new Error(msg);
    }
  } catch (error) {
    if (options?.partName !== undefined) throw new XmlPartParseError(options.partName, error);
    throw error;
  }
  return doc;
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

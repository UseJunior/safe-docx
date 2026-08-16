import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { commentIds, projectDocumentXml } from './xml.js';
import type { Projection, Verdict } from './types.js';

const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 512;
const MAX_XML_BYTES = 8 * 1024 * 1024;

export interface IndependentDocx {
  bytes: Buffer;
  hash: string;
  documentXml: string;
  accept: Projection;
  reject: Projection;
  packageVerdict: Verdict;
  commentVerdict: Verdict;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function boundedFile(path: string): Promise<Buffer> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`Artifact is not a regular file: ${path}`);
  if (info.size > MAX_ARCHIVE_BYTES) throw new Error(`Artifact exceeds ${MAX_ARCHIVE_BYTES} byte limit: ${path}`);
  return readFile(path);
}

function invalidEntry(name: string): boolean {
  return name.startsWith('/') || name.includes('\\') || name.split('/').some((part) => part === '..');
}

async function boundedText(zip: JSZip, name: string): Promise<string> {
  const file = zip.file(name);
  if (!file) throw new Error(`Missing required ZIP entry: ${name}`);
  const bytes = await file.async('uint8array');
  if (bytes.byteLength > MAX_XML_BYTES) throw new Error(`ZIP entry exceeds ${MAX_XML_BYTES} byte limit: ${name}`);
  return new TextDecoder().decode(bytes);
}

/** Requiring native comments means at least this many valid comments must exist. */
const REQUIRED_COMMENT_MINIMUM = 1;

function idMultiset(ids: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

/**
 * Verifies that native comment markup is internally consistent: range starts,
 * range ends, references, and comment records must carry the same identifier
 * multiset, and each identifier must be defined exactly once. Comparing
 * multiplicities — not just membership and total length — rejects documents a
 * set-style comparison cannot distinguish from valid ones, such as identifiers
 * duplicated identically across all four collections. The transitional
 * `wml.xsd` alone does not reject duplicate identifiers (it permits unbounded
 * `w:comment` children and carries no uniqueness constraint); the violated
 * rule is the normative prose defining the annotation identifier as a unique
 * identifier for the comment.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.4.2
 * @see https://github.com/UseJunior/safe-docx/issues/863
 */
function commentIntegrity(documentXml: string, commentsXml: string | null, required: boolean): Verdict {
  if (!required) return { status: 'not_run', required: false, reason: 'Native comments not required.' };
  const starts = commentIds(documentXml, 'commentRangeStart');
  const ends = commentIds(documentXml, 'commentRangeEnd');
  const references = commentIds(documentXml, 'commentReference');
  const records = commentsXml ? commentIds(commentsXml, 'comment') : [];
  const exact = (left: string[], right: string[]) => {
    if (left.length !== right.length) return false;
    const expected = idMultiset(right);
    return [...idMultiset(left)].every(([id, count]) => expected.get(id) === count);
  };
  const consistent = starts.every(Boolean) && ends.every(Boolean) && references.every(Boolean) && records.every(Boolean)
    && exact(starts, ends) && exact(starts, references) && exact(starts, records);
  if (!consistent) {
    return { status: 'fail', required: true, reason: 'Native comment records, range starts, range ends, and references disagree.', details: { starts, ends, references, records } };
  }
  // Identical duplication across all four collections survives the multiset
  // comparison, so the definitions must additionally be duplicate-free.
  const duplicates = [...idMultiset(records)].filter(([, count]) => count > 1).map(([id]) => id);
  if (duplicates.length > 0) {
    return {
      status: 'fail',
      required: true,
      reason: `Native comment IDs are duplicated across range starts, range ends, references, and records: ${duplicates.join(', ')}. Each annotation identifier must be unique.`,
      details: { duplicates, starts, ends, references, records },
    };
  }
  // Consistency of an empty set is vacuous: requiring native comments demands
  // at least one valid comment, so zero comments fails closed (issue #858).
  if (records.length < REQUIRED_COMMENT_MINIMUM) {
    return {
      status: 'fail',
      required: true,
      reason: `Native comments were required but the tracked DOCX contains none: expected minimum ${REQUIRED_COMMENT_MINIMUM}, actual ${records.length}.`,
      details: { expectedMinimum: REQUIRED_COMMENT_MINIMUM, count: records.length },
    };
  }
  return { status: 'pass', required: true, details: { expectedMinimum: REQUIRED_COMMENT_MINIMUM, count: starts.length } };
}

/**
 * Independently reads a bounded DOCX subset. This module deliberately does not
 * depend on Safe DOCX parsers, mutators, comparers, or generators.
 */
export async function readIndependentDocx(path: string, requireNativeComments = false): Promise<IndependentDocx> {
  const bytes = await boundedFile(path);
  try {
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
    const names = Object.keys(zip.files);
    if (names.length > MAX_ENTRIES) throw new Error(`ZIP has more than ${MAX_ENTRIES} entries.`);
    if (names.some(invalidEntry)) throw new Error('ZIP contains an unsafe entry path.');
    const documentXml = await boundedText(zip, 'word/document.xml');
    await boundedText(zip, '[Content_Types].xml');
    const commentsXml = zip.file('word/comments.xml') ? await boundedText(zip, 'word/comments.xml') : null;
    return {
      bytes,
      hash: sha256(bytes),
      documentXml,
      accept: projectDocumentXml(documentXml, 'accept'),
      reject: projectDocumentXml(documentXml, 'reject'),
      packageVerdict: { status: 'pass', required: true, details: { entries: names.length } },
      commentVerdict: commentIntegrity(documentXml, commentsXml, requireNativeComments),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      bytes,
      hash: sha256(bytes),
      documentXml: '',
      accept: { paragraphs: [], text: '' },
      reject: { paragraphs: [], text: '' },
      packageVerdict: { status: 'fail', required: true, reason },
      commentVerdict: { status: 'not_run', required: requireNativeComments, reason: 'DOCX archive was unreadable.' },
    };
  }
}

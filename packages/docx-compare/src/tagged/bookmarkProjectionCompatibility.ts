import { XMLSerializer } from '@xmldom/xmldom';
import { DocxArchive, parseXml } from '@usejunior/docx-core';

const MAX_BOOKMARK_NAME_LENGTH = 40;
const GENERATED_NAME_PREFIX = '_safe_docx_original_';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

function bookmarkNames(document: Document): string[] {
  return Array.from(document.getElementsByTagName('w:bookmarkStart'))
    .map((start) => start.getAttribute('w:name'))
    .filter((name): name is string => name !== null);
}

function replaceTargetToken(
  matched: string,
  prefix: string,
  token: string,
  renames: ReadonlyMap<string, string>,
): string {
  const quoted = token.startsWith('"') && token.endsWith('"');
  const target = quoted ? token.slice(1, -1) : token;
  const renamed = renames.get(target);
  if (!renamed) return matched;
  return `${prefix}${quoted ? `"${renamed}"` : renamed}`;
}

function instructionBookmarkTargets(instruction: string): string[] {
  const targets: string[] = [];
  const capture = (pattern: RegExp): void => {
    const match = pattern.exec(instruction);
    const token = match?.[1];
    if (!token) return;
    targets.push(token.startsWith('"') && token.endsWith('"') ? token.slice(1, -1) : token);
  };
  const keyword = /^\s*([A-Z]+)/iu.exec(instruction)?.[1]?.toUpperCase();
  if (keyword && ['REF', 'PAGEREF', 'NOTEREF'].includes(keyword)) {
    capture(/^\s*[A-Z]+\s+("[^"]+"|[^\s\\]+)/iu);
  } else if (keyword === 'HYPERLINK') {
    capture(/\\l\s+("[^"]+"|[^\s\\]+)/iu);
  } else if (keyword === 'TOC') {
    capture(/\\b\s+("[^"]+"|[^\s\\]+)/iu);
  }
  return targets;
}

function rewriteFieldInstruction(
  instruction: string,
  renames: ReadonlyMap<string, string>,
): string {
  const keyword = /^\s*([A-Z]+)/iu.exec(instruction)?.[1]?.toUpperCase();
  if (keyword && ['REF', 'PAGEREF', 'NOTEREF'].includes(keyword)) {
    return instruction.replace(
      /^(\s*[A-Z]+\s+)("[^"]+"|[^\s\\]+)/iu,
      (matched, prefix: string, token: string) =>
        replaceTargetToken(matched, prefix, token, renames),
    );
  }
  const bookmarkSwitch = keyword === 'HYPERLINK' ? 'l' : keyword === 'TOC' ? 'b' : undefined;
  if (!bookmarkSwitch) return instruction;
  const pattern = new RegExp(`(\\\\${bookmarkSwitch}\\s+)("[^"]+"|[^\\s\\\\]+)`, 'iu');
  return instruction.replace(
    pattern,
    (matched, prefix: string, token: string) =>
      replaceTargetToken(matched, prefix, token, renames),
  );
}

function rewriteInstructionFragments(
  nodes: readonly Element[],
  renames: ReadonlyMap<string, string>,
): boolean {
  if (nodes.length === 0) return false;
  const fragments = nodes.map((node) => node.textContent ?? '');
  const rewritten = rewriteFieldInstruction(fragments.join(''), renames);
  if (rewritten === fragments.join('')) return false;

  let offset = 0;
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    const length = index === nodes.length - 1
      ? rewritten.length - offset
      : Math.min(fragments[index]!.length, rewritten.length - offset);
    const text = rewritten.slice(offset, offset + Math.max(0, length));
    node.textContent = text;
    if (/^\s|\s$/u.test(text)) node.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    offset += Math.max(0, length);
  }
  return true;
}

function complexFieldInstructions(document: Document): string[] {
  interface FieldFrame {
    instructionNodes: Element[];
    collectingInstruction: boolean;
  }
  const instructions: string[] = [];
  const stack: FieldFrame[] = [];
  const flush = (frame: FieldFrame | undefined): void => {
    if (!frame || frame.instructionNodes.length === 0) return;
    instructions.push(frame.instructionNodes.map((node) => node.textContent ?? '').join(''));
  };
  const elements = [document.documentElement, ...Array.from(
    document.documentElement.getElementsByTagName('*'),
  )] as Element[];
  for (const element of elements) {
    if (element.tagName === 'w:fldChar') {
      const type = element.getAttribute('w:fldCharType');
      if (type === 'begin') stack.push({ instructionNodes: [], collectingInstruction: true });
      else if (type === 'separate') {
        const frame = stack.at(-1);
        if (frame?.collectingInstruction) {
          flush(frame);
          frame.collectingInstruction = false;
        }
      } else if (type === 'end') {
        const frame = stack.pop();
        if (frame?.collectingInstruction) flush(frame);
      }
      continue;
    }
    if (
      (element.tagName === 'w:instrText' || element.tagName === 'w:delInstrText') &&
      stack.at(-1)?.collectingInstruction
    ) stack.at(-1)!.instructionNodes.push(element);
  }
  for (const frame of stack) if (frame.collectingInstruction) flush(frame);
  for (const field of Array.from(document.getElementsByTagName('w:fldSimple'))) {
    const instruction = field.getAttribute('w:instr');
    if (instruction !== null) instructions.push(instruction);
  }
  return instructions;
}

/** Collect bookmark names referenced by fields and internal hyperlinks. */
export function collectBookmarkReferenceNamesInXml(xml: string): string[] {
  const document = parseXml(xml);
  const names = new Set(complexFieldInstructions(document).flatMap(instructionBookmarkTargets));
  for (const hyperlink of Array.from(document.getElementsByTagName('w:hyperlink'))) {
    const anchor = hyperlink.getAttribute('w:anchor');
    if (anchor) names.add(anchor);
  }
  return [...names].sort();
}

/**
 * Rewrite bookmark targets in supported complete, possibly fragmented field
 * instructions without changing the surrounding run or field topology.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.45
 */
function rewriteComplexFieldInstructions(
  document: Document,
  renames: ReadonlyMap<string, string>,
): number {
  interface FieldFrame {
    instructionNodes: Element[];
    collectingInstruction: boolean;
  }

  let rewritten = 0;
  const stack: FieldFrame[] = [];
  const elements = [document.documentElement, ...Array.from(
    document.documentElement.getElementsByTagName('*'),
  )] as Element[];
  for (const element of elements) {
    if (element.tagName === 'w:fldChar') {
      const type = element.getAttribute('w:fldCharType');
      if (type === 'begin') {
        stack.push({ instructionNodes: [], collectingInstruction: true });
      } else if (type === 'separate') {
        const frame = stack.at(-1);
        if (frame?.collectingInstruction) {
          if (rewriteInstructionFragments(frame.instructionNodes, renames)) rewritten++;
          frame.collectingInstruction = false;
        }
      } else if (type === 'end') {
        const frame = stack.pop();
        if (frame?.collectingInstruction &&
          rewriteInstructionFragments(frame.instructionNodes, renames)) rewritten++;
      }
      continue;
    }
    if (
      (element.tagName === 'w:instrText' || element.tagName === 'w:delInstrText') &&
      stack.at(-1)?.collectingInstruction
    ) {
      stack.at(-1)!.instructionNodes.push(element);
    }
  }
  for (const frame of stack) {
    if (rewriteInstructionFragments(frame.instructionNodes, renames)) rewritten++;
  }
  for (const field of Array.from(document.getElementsByTagName('w:fldSimple'))) {
    const instruction = field.getAttribute('w:instr');
    if (instruction === null) continue;
    const replacement = rewriteFieldInstruction(instruction, renames);
    if (replacement !== instruction) {
      field.setAttribute('w:instr', replacement);
      rewritten++;
    }
  }
  return rewritten;
}

export interface BookmarkTargetRewriteResult {
  xml: string;
  renamedBookmarks: number;
  rewrittenFields: number;
  rewrittenHyperlinks: number;
}

export interface BookmarkIdDisambiguationResult {
  xml: string;
  remappedRanges: number;
}

/**
 * Move original bookmark IDs out of the revised ID namespace when equal IDs
 * identify differently named ranges. Bookmark IDs are package-local and do
 * not identify the same semantic range across independently authored files;
 * disambiguating them before alignment prevents unrelated nested boundaries
 * from being paired by numeric coincidence.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 */
export function disambiguateOriginalBookmarkIds(
  originalXml: string,
  revisedXml: string,
): BookmarkIdDisambiguationResult {
  const original = parseXml(originalXml);
  const revised = parseXml(revisedXml);
  const startsById = (document: Document): Map<string, Element[]> => {
    const grouped = new Map<string, Element[]>();
    for (const start of Array.from(document.getElementsByTagName('w:bookmarkStart'))) {
      const id = start.getAttribute('w:id');
      if (!id) continue;
      const starts = grouped.get(id) ?? [];
      starts.push(start);
      grouped.set(id, starts);
    }
    return grouped;
  };
  const originalStarts = startsById(original);
  const revisedStarts = startsById(revised);
  const usedNumericIds = [original, revised].flatMap((document) => [
    ...Array.from(document.getElementsByTagName('w:bookmarkStart')),
    ...Array.from(document.getElementsByTagName('w:bookmarkEnd')),
  ]).map((boundary) => Number(boundary.getAttribute('w:id')))
    .filter((id) => Number.isSafeInteger(id) && id >= 0);
  let nextId = Math.max(-1, ...usedNumericIds) + 1;
  const replacements = new Map<string, string>();
  for (const [id, starts] of originalStarts) {
    if (starts.length !== 1) continue;
    const originalName = starts[0]!.getAttribute('w:name');
    const revisedNames = new Set((revisedStarts.get(id) ?? [])
      .map((start) => start.getAttribute('w:name'))
      .filter((name): name is string => name !== null));
    if (!originalName || revisedNames.size === 0 || revisedNames.has(originalName)) continue;
    replacements.set(id, String(nextId++));
  }
  if (replacements.size === 0) return { xml: originalXml, remappedRanges: 0 };
  for (const tag of ['w:bookmarkStart', 'w:bookmarkEnd']) {
    for (const boundary of Array.from(original.getElementsByTagName(tag))) {
      const id = boundary.getAttribute('w:id');
      const replacement = id === null ? undefined : replacements.get(id);
      if (replacement) boundary.setAttribute('w:id', replacement);
    }
  }
  return {
    xml: new XMLSerializer().serializeToString(original),
    remappedRanges: replacements.size,
  };
}

/**
 * Rename selected bookmark starts and every supported matching field or
 * internal-hyperlink target in one WordprocessingML story. The same map is
 * applied to every `word/*.xml` part by
 * {@link renameOriginalBookmarkTargetsAcrossWordParts}, so references outside
 * the story that owns the bookmark remain synchronized.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.13.6.2
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.45
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.22
 */
export function renameBookmarkTargetsInXml(
  xml: string,
  renames: ReadonlyMap<string, string>,
): BookmarkTargetRewriteResult {
  const document = parseXml(xml);
  let renamedBookmarks = 0;
  for (const start of Array.from(document.getElementsByTagName('w:bookmarkStart'))) {
    const name = start.getAttribute('w:name');
    const replacement = name === null ? undefined : renames.get(name);
    if (!replacement) continue;
    start.setAttribute('w:name', replacement);
    renamedBookmarks++;
  }
  const rewrittenFields = rewriteComplexFieldInstructions(document, renames);
  let rewrittenHyperlinks = 0;
  for (const hyperlink of Array.from(document.getElementsByTagName('w:hyperlink'))) {
    const anchor = hyperlink.getAttribute('w:anchor');
    const replacement = anchor === null ? undefined : renames.get(anchor);
    if (!replacement) continue;
    hyperlink.setAttribute('w:anchor', replacement);
    rewrittenHyperlinks++;
  }
  return {
    xml: new XMLSerializer().serializeToString(document),
    renamedBookmarks,
    rewrittenFields,
    rewrittenHyperlinks,
  };
}

export function createOriginalBookmarkRenameMap(
  names: readonly string[],
  existingNames: ReadonlySet<string>,
): ReadonlyMap<string, string> {
  const used = new Set(existingNames);
  const renames = new Map<string, string>();
  let ordinal = 1;
  for (const name of [...new Set(names)].sort()) {
    let candidate: string;
    do {
      candidate = `${GENERATED_NAME_PREFIX}${ordinal++}`.slice(0, MAX_BOOKMARK_NAME_LENGTH);
    } while (used.has(candidate));
    used.add(candidate);
    renames.set(name, candidate);
  }
  return renames;
}

export async function collectWordPartBookmarkNames(
  archives: readonly DocxArchive[],
): Promise<Set<string>> {
  const names = new Set<string>();
  for (const archive of archives) {
    for (const path of archive.listFiles().filter((entry) => /^word\/.*\.xml$/u.test(entry))) {
      const xml = await archive.getFile(path);
      if (!xml) continue;
      for (const name of bookmarkNames(parseXml(xml))) names.add(name);
    }
  }
  return names;
}

export async function renameOriginalBookmarkTargetsAcrossWordParts(
  archive: DocxArchive,
  renames: ReadonlyMap<string, string>,
): Promise<{ renamedBookmarks: number; rewrittenFields: number; rewrittenHyperlinks: number }> {
  let renamedBookmarks = 0;
  let rewrittenFields = 0;
  let rewrittenHyperlinks = 0;
  for (const path of archive.listFiles().filter((entry) => /^word\/.*\.xml$/u.test(entry)).sort()) {
    const xml = await archive.getFile(path);
    if (!xml) continue;
    const rewritten = renameBookmarkTargetsInXml(xml, renames);
    if (
      rewritten.renamedBookmarks === 0 &&
      rewritten.rewrittenFields === 0 &&
      rewritten.rewrittenHyperlinks === 0
    ) continue;
    archive.setFile(path, rewritten.xml);
    renamedBookmarks += rewritten.renamedBookmarks;
    rewrittenFields += rewritten.rewrittenFields;
    rewrittenHyperlinks += rewritten.rewrittenHyperlinks;
  }
  return { renamedBookmarks, rewrittenFields, rewrittenHyperlinks };
}

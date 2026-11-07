import { OOXML, W, buildParagraphIndex, getParagraphBookmarkId, type DocxDocument } from '@usejunior/docx-core';

export type AffectedRefField = {
  bookmark: string;
  instruction: string;
  paragraph_id: string | null;
};

export function collectLocalUserBookmarks(paragraph: Element): string[] {
  const endIds = new Set<string>();
  for (const endEl of Array.from(paragraph.getElementsByTagNameNS(OOXML.W_NS, W.bookmarkEnd))) {
    const id = endEl.getAttributeNS(OOXML.W_NS, 'id') ?? endEl.getAttribute('w:id');
    if (id) endIds.add(id);
  }
  const names: string[] = [];
  for (const startEl of Array.from(paragraph.getElementsByTagNameNS(OOXML.W_NS, W.bookmarkStart))) {
    const id = startEl.getAttributeNS(OOXML.W_NS, 'id') ?? startEl.getAttribute('w:id');
    const name = startEl.getAttributeNS(OOXML.W_NS, 'name') ?? startEl.getAttribute('w:name');
    if (!id || !name || !endIds.has(id)) continue;
    if (name.startsWith('_bk_') || name === '_GoBack') continue;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

export function hasDeletedParagraphMark(paragraph: Element): boolean {
  for (const child of Array.from(paragraph.childNodes)) {
    if (child.nodeType !== 1 || (child as Element).namespaceURI !== OOXML.W_NS || (child as Element).localName !== W.pPr) {
      continue;
    }
    for (const pPrChild of Array.from(child.childNodes)) {
      if (pPrChild.nodeType !== 1 || (pPrChild as Element).namespaceURI !== OOXML.W_NS || (pPrChild as Element).localName !== W.rPr) {
        continue;
      }
      for (const rPrChild of Array.from(pPrChild.childNodes)) {
        if (
          rPrChild.nodeType === 1 &&
          (rPrChild as Element).namespaceURI === OOXML.W_NS &&
          ((rPrChild as Element).localName === W.del || (rPrChild as Element).localName === W.moveFrom)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function extractTargetedBookmark(instruction: string, candidateBookmarks: ReadonlySet<string>): string | null {
  const explicit = /^\s*(?:REF|PAGEREF|NOTEREF)\s+(?:"([^"]+)"|([^\s\\]+))/iu.exec(instruction);
  if (explicit) {
    const target = explicit[1] ?? explicit[2] ?? null;
    return target && candidateBookmarks.has(target) ? target : null;
  }
  const implicit = /^\s*(?:"([^"]+)"|([^\s\\]+))(?:\s+\\|$)/u.exec(instruction);
  if (implicit) {
    const target = implicit[1] ?? implicit[2] ?? null;
    return target && candidateBookmarks.has(target) ? target : null;
  }
  return null;
}

export function collectTargetingRefFields(
  doc: DocxDocument,
  removedParagraph: Element,
  bookmarks: readonly string[],
): AffectedRefField[] {
  if (bookmarks.length === 0) return [];
  const candidateSet = new Set(bookmarks);
  const results: AffectedRefField[] = [];
  for (const p of doc.getParagraphs()) {
    if (p === removedParagraph) continue;
    const paraId = getParagraphBookmarkId(p);
    const index = buildParagraphIndex(p, { skipTrackedDeletions: true });
    for (const field of index.fields) {
      const bookmark = extractTargetedBookmark(field.instruction, candidateSet);
      if (bookmark) {
        results.push({
          bookmark,
          instruction: field.instruction.trim(),
          paragraph_id: paraId,
        });
      }
    }
    for (const simple of Array.from(p.getElementsByTagNameNS(OOXML.W_NS, 'fldSimple'))) {
      let inDel = false;
      for (let cur = simple.parentNode; cur && cur !== p; cur = cur.parentNode) {
        if (
          cur.nodeType === 1 &&
          (cur as Element).namespaceURI === OOXML.W_NS &&
          ((cur as Element).localName === W.del || (cur as Element).localName === W.moveFrom)
        ) {
          inDel = true;
          break;
        }
      }
      if (inDel) continue;
      const instr = simple.getAttributeNS(OOXML.W_NS, 'instr') ?? simple.getAttribute('w:instr') ?? '';
      const bookmark = extractTargetedBookmark(instr, candidateSet);
      if (bookmark) {
        results.push({
          bookmark,
          instruction: instr.trim(),
          paragraph_id: paraId,
        });
      }
    }
  }
  return results;
}


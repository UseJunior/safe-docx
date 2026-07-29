/**
 * Remove tracked changes caused only by refreshed TOC PAGEREF cached results.
 *
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.18
 * @conformance ECMA-376 edition 5, Part 1 § 17.16.5.45
 * @see https://github.com/UseJunior/safe-docx/issues/716
 */

import { OOXML, parseXml } from '@usejunior/docx-core';
import { XMLSerializer } from '@xmldom/xmldom';
import {
  isTocParagraphStyle,
  pagerefComparisonIdentity,
} from '../../fieldComparisonSemantics.js';
import { acceptAllChanges, rejectAllChanges } from './trackChangesAcceptorAst.js';

const serializer = new XMLSerializer();
const CACHE_SENTINEL = '__safe_docx_pageref_cache__';

function paragraphStyleId(paragraph: Element): string | null {
  const style = Array.from(
    paragraph.getElementsByTagNameNS(OOXML.W_NS, 'pStyle'),
  )[0];
  return (
    style?.getAttributeNS(OOXML.W_NS, 'val') ??
    style?.getAttribute('w:val') ??
    null
  );
}

function hasTrackedInsertionOrDeletion(paragraph: Element): boolean {
  return (
    paragraph.getElementsByTagNameNS(OOXML.W_NS, 'ins').length > 0 ||
    paragraph.getElementsByTagNameNS(OOXML.W_NS, 'del').length > 0
  );
}

function namespaceDeclarations(document: Document): string {
  return Array.from(document.documentElement.attributes)
    .filter(
      (attribute) =>
        attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:'),
    )
    .map(
      (attribute) =>
        `${attribute.name}="${attribute.value
          .replaceAll('&', '&amp;')
          .replaceAll('"', '&quot;')}"`,
    )
    .join(' ');
}

function wrapParagraph(document: Document, paragraph: Element): string {
  return (
    `<w:document ${namespaceDeclarations(document)}>` +
    `<w:body>${serializer.serializeToString(paragraph)}</w:body>` +
    '</w:document>'
  );
}

function firstParagraph(documentXml: string): Element | undefined {
  return Array.from(
    parseXml(documentXml).getElementsByTagNameNS(OOXML.W_NS, 'p'),
  )[0];
}

/**
 * Produce a run-boundary-insensitive structural fingerprint while replacing
 * the visible result of each PAGEREF field with a sentinel. Run boundaries can
 * differ after projecting tracked changes even when their formatting is the
 * same, so run properties are retained but bare w:r wrappers are not.
 */
function cacheInsensitiveFingerprint(paragraph: Element): string | undefined {
  const stack: Array<{
    instruction: string[];
    separated: boolean;
    pageref: boolean;
  }> = [];
  const tokens: string[] = [];
  let sawPagerefCache = false;

  const walk = (node: Node): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) continue;
      if (child.nodeType !== 1) continue;
      const element = child as Element;

      if (
        element.namespaceURI === OOXML.W_NS &&
        element.localName === 'fldChar'
      ) {
        const type =
          element.getAttributeNS(OOXML.W_NS, 'fldCharType') ??
          element.getAttribute('w:fldCharType');
        if (type === 'begin') {
          stack.push({ instruction: [], separated: false, pageref: false });
        } else if (type === 'separate' && stack.length > 0) {
          const field = stack[stack.length - 1]!;
          field.separated = true;
          field.pageref =
            pagerefComparisonIdentity(field.instruction.join('')) !== undefined;
        } else if (type === 'end' && stack.length > 0) {
          stack.pop();
        }
        tokens.push(`field:${type ?? ''}`);
      } else if (
        element.namespaceURI === OOXML.W_NS &&
        (element.localName === 'instrText' ||
          element.localName === 'delInstrText') &&
        stack.length > 0 &&
        !stack[stack.length - 1]!.separated
      ) {
        const instructionText = element.textContent ?? '';
        stack[stack.length - 1]!.instruction.push(instructionText);
        tokens.push(`instruction:${instructionText.trim().replace(/\s+/gu, ' ')}`);
      } else if (
        element.namespaceURI === OOXML.W_NS &&
        (element.localName === 't' || element.localName === 'delText') &&
        stack.some((field) => field.separated && field.pageref)
      ) {
        tokens.push(`text:${CACHE_SENTINEL}`);
        sawPagerefCache = true;
      } else if (
        element.namespaceURI === OOXML.W_NS &&
        (element.localName === 't' || element.localName === 'delText')
      ) {
        tokens.push(`text:${element.textContent ?? ''}`);
      } else if (
        element.namespaceURI === OOXML.W_NS &&
        element.localName === 'r'
      ) {
        // Bare run boundaries are an artifact of tracked-change projection.
        walk(element);
        continue;
      } else if (
        element.namespaceURI === OOXML.W_NS &&
        element.localName === 'rPr' &&
        element.parentNode?.nodeType === 1 &&
        (element.parentNode as Element).namespaceURI === OOXML.W_NS &&
        (element.parentNode as Element).localName === 'r' &&
        Array.from((element.parentNode as Element).childNodes)
          .filter((sibling) => sibling.nodeType === 1)
          .every((sibling) => {
            const siblingElement = sibling as Element;
            return (
              siblingElement.namespaceURI === OOXML.W_NS &&
              (siblingElement.localName === 'rPr' ||
                siblingElement.localName === 'fldChar')
            );
          })
      ) {
        // The accept/reject projector can leave an empty field skeleton whose
        // boundary-only runs retain their properties. Those properties do not
        // format any visible content and disappear with the skeleton below.
        continue;
      } else {
        const attributes = Array.from(element.attributes)
          .filter(
            (attribute) =>
              attribute.name !== 'xmlns' &&
              !attribute.name.startsWith('xmlns:'),
          )
          .map(
            (attribute) =>
              `${attribute.namespaceURI ?? ''}:${attribute.localName}=${attribute.value}`,
          )
          .sort()
          .join('|');
        tokens.push(
          `start:${element.namespaceURI ?? ''}:${element.localName}:${attributes}`,
        );
        walk(element);
        tokens.push(`end:${element.namespaceURI ?? ''}:${element.localName}`);
        continue;
      }

      walk(element);
    }
  };

  walk(paragraph);
  const normalizedTokens: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (
      tokens[index] === 'field:begin' &&
      tokens[index + 1] === 'field:separate' &&
      tokens[index + 2] === 'field:end'
    ) {
      index += 2;
      continue;
    }
    normalizedTokens.push(tokens[index]!);
  }
  return sawPagerefCache ? normalizedTokens.join('\n') : undefined;
}

/**
 * Preserve the original cached page number when a tracked TOC paragraph's two
 * projections are otherwise structurally identical. The original cache is
 * deliberately retained because emitting the revised value without a tracked
 * change would make reject-all unable to recover the original package.
 */
export function suppressVolatileTocPagerefCacheRevisions(
  documentXml: string,
): string {
  const document = parseXml(documentXml);
  const paragraphs = Array.from(
    document.getElementsByTagNameNS(OOXML.W_NS, 'p'),
  );

  for (const paragraph of paragraphs) {
    if (
      !isTocParagraphStyle(paragraphStyleId(paragraph)) ||
      !hasTrackedInsertionOrDeletion(paragraph)
    ) {
      continue;
    }

    const wrapped = wrapParagraph(document, paragraph);
    const accepted = firstParagraph(acceptAllChanges(wrapped));
    const rejected = firstParagraph(rejectAllChanges(wrapped));
    if (!accepted || !rejected) continue;

    const acceptedFingerprint = cacheInsensitiveFingerprint(accepted);
    const rejectedFingerprint = cacheInsensitiveFingerprint(rejected);
    if (
      acceptedFingerprint === undefined ||
      acceptedFingerprint !== rejectedFingerprint
    ) {
      continue;
    }

    paragraph.parentNode?.replaceChild(
      document.importNode(rejected, true),
      paragraph,
    );
  }

  return serializer.serializeToString(document);
}

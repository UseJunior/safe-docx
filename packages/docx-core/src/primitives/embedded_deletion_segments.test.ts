import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { acceptChanges } from './accept_changes.js';
import { rejectChanges } from './reject_changes.js';
import { createRevisionContext, createRevisionIdState } from './track-changes-emitter.js';
import {
  DeletionSegmentBuilder,
  getParagraphText,
  replaceParagraphTextRange,
  validateSiblingRangeReachability,
} from './text.js';
import { parseXml, serializeXml } from './xml.js';

const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Document Primitives' });

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const MINIMAL_DRAWING =
  '<w:drawing>' +
  '<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
  '<wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Picture 1"/>' +
  '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
  '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:nvPicPr><pic:cNvPr id="1" name="Picture 1"/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill>' +
  '<pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';

const MINIMAL_PICT =
  '<w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" id="_s1" style="width:100pt;height:80pt"/></w:pict>';

function trackedCtx() {
  return createRevisionContext({
    author: 'SafeDocX AI',
    date: '2026-08-15T10:00:00Z',
    idState: createRevisionIdState(),
  });
}

function makeDoc(bodyXml: string): Document {
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<w:body>${bodyXml}</w:body>` +
    `</w:document>`;
  return parseXml(xml);
}

function firstParagraph(doc: Document): Element {
  return doc.getElementsByTagNameNS(W_NS, 'p').item(0)!;
}

function paragraphContentSequence(p: Element): string[] {
  const out: string[] = [];
  const embeddedTag = (el: Element): string | null => {
    for (const local of ['drawing', 'pict', 'object', 'contentPart']) {
      if (el.getElementsByTagNameNS(W_NS, local).length > 0 || (el.namespaceURI === W_NS && el.localName === local)) {
        return `[${local}]`;
      }
    }
    return null;
  };
  for (const child of Array.from(p.childNodes)) {
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (el.namespaceURI !== W_NS) continue;
    if (el.localName === 'pPr') continue;
    if (el.localName === 'r') {
      const tag = embeddedTag(el);
      out.push(tag ?? Array.from(el.getElementsByTagNameNS(W_NS, 't')).map((t) => t.textContent ?? '').join(''));
    } else if (el.localName === 'del') {
      out.push('del:' + Array.from(el.getElementsByTagNameNS(W_NS, 'delText')).map((t) => t.textContent ?? '').join(''));
    } else if (el.localName === 'ins') {
      out.push('ins:' + Array.from(el.getElementsByTagNameNS(W_NS, 't')).map((t) => t.textContent ?? '').join(''));
    }
  }
  return out;
}

describe('DeletionSegmentBuilder (issue #1312)', () => {
  test('creates in-place w:del containers and splits segments on termination', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let doc: Document;
    let p: Element;
    let builder: DeletionSegmentBuilder;
    let r1: Element;
    let r2: Element;
    let r3: Element;

    await given('a paragraph with three runs and an active RevisionContext', () => {
      doc = makeDoc(
        '<w:p>' +
          '<w:r><w:t>One</w:t></w:r>' +
          '<w:r><w:t>Two</w:t></w:r>' +
          '<w:r><w:t>Three</w:t></w:r>' +
        '</w:p>',
      );
      p = firstParagraph(doc);
      const runs = Array.from(p.getElementsByTagNameNS(W_NS, 'r'));
      r1 = runs[0]!;
      r2 = runs[1]!;
      r3 = runs[2]!;
      builder = new DeletionSegmentBuilder(doc, trackedCtx());
    });

    await when('first two runs are removed in the same segment', () => {
      builder.removeRunInPlace(r1);
      builder.removeRunInPlace(r2);
    });

    await then('a single w:del was created containing both deleted runs', () => {
      expect(builder.getSegmentCount()).toBe(1);
      const del = builder.getActiveDeletion();
      expect(del).not.toBeNull();
      const delTexts = Array.from(del!.getElementsByTagNameNS(W_NS, 'delText')).map((t) => t.textContent);
      expect(delTexts).toEqual(['One', 'Two']);
    });

    await when('the segment is terminated and a third run is removed', () => {
      builder.terminateSegment();
      builder.removeRunInPlace(r3);
    });

    await then('a second separate w:del segment was opened for the third run', () => {
      expect(builder.getSegmentCount()).toBe(2);
      const dels = Array.from(p.getElementsByTagNameNS(W_NS, 'del'));
      expect(dels).toHaveLength(2);
      expect(dels[0]!.getElementsByTagNameNS(W_NS, 'delText').item(0)!.textContent).toBe('One');
      expect(dels[1]!.getElementsByTagNameNS(W_NS, 'delText').item(0)!.textContent).toBe('Three');
    });
  });

  test('cleans runs directly when no RevisionContext is active', async ({
    given,
    when,
    then,
  }: AllureBddContext) => {
    let doc: Document;
    let p: Element;
    let builder: DeletionSegmentBuilder;

    await given('a paragraph with runs and an untracked builder', () => {
      doc = makeDoc('<w:p><w:r><w:t>Untracked</w:t></w:r></w:p>');
      p = firstParagraph(doc);
      builder = new DeletionSegmentBuilder(doc, undefined);
    });

    await when('the run is removed', () => {
      const r = p.getElementsByTagNameNS(W_NS, 'r').item(0)!;
      builder.removeRunInPlace(r);
    });

    await then('the run is detached from the paragraph and zero w:del elements exist', () => {
      expect(p.getElementsByTagNameNS(W_NS, 'r')).toHaveLength(0);
      expect(p.getElementsByTagNameNS(W_NS, 'del')).toHaveLength(0);
      expect(builder.getSegmentCount()).toBe(0);
    });
  });
});

describe('embedded content deletion segments in replaceParagraphTextRange (issue #1312)', () => {
  test('multiple embedded objects terminate segments without moving and round-trip via accept/reject', async ({
    given,
    when,
    then,
    and,
  }: AllureBddContext) => {
    let doc: Document;
    let p: Element;
    let initialOrder: string[];

    await given('a paragraph with three text runs interleaved with two embedded objects', () => {
      doc = makeDoc(
        '<w:p>' +
          '<w:r><w:t>Alpha </w:t></w:r>' +
          `<w:r>${MINIMAL_DRAWING}</w:r>` +
          '<w:r><w:t> Beta </w:t></w:r>' +
          `<w:r>${MINIMAL_PICT}</w:r>` +
          '<w:r><w:t> Gamma</w:t></w:r>' +
        '</w:p>',
      );
      p = firstParagraph(doc);
      initialOrder = paragraphContentSequence(p);
      expect(initialOrder).toEqual(['Alpha ', '[drawing]', ' Beta ', '[pict]', ' Gamma']);
      expect(getParagraphText(p)).toBe('Alpha  Beta  Gamma');
    });

    await when('the entire text span across both objects is replaced under tracked changes', () => {
      const visibleLength = getParagraphText(p).length;
      replaceParagraphTextRange(p, 0, visibleLength, 'Replacement Text', trackedCtx());
    });

    await then('three in-place deletion segments are created and objects stay in original order', () => {
      const seq = paragraphContentSequence(p);
      expect(seq).toEqual([
        'del:Alpha ',
        '[drawing]',
        'del: Beta ',
        '[pict]',
        'del: Gamma',
        'ins:Replacement Text',
      ]);
    });

    await and('acceptChanges reproduces the requested output with preserved objects', () => {
      const docCopy = parseXml(serializeXml(doc));
      const pCopy = firstParagraph(docCopy);
      acceptChanges(docCopy);
      expect(paragraphContentSequence(pCopy)).toEqual([
        '[drawing]',
        '[pict]',
        'Replacement Text',
      ]);
      expect(getParagraphText(pCopy)).toBe('Replacement Text');
    });

    await and('rejectChanges restores the exact original text and object ordering', () => {
      const docCopy = parseXml(serializeXml(doc));
      const pCopy = firstParagraph(docCopy);
      rejectChanges(docCopy);
      expect(paragraphContentSequence(pCopy)).toEqual(initialOrder);
      expect(getParagraphText(pCopy)).toBe('Alpha  Beta  Gamma');
    });
  });

  test('validateSiblingRangeReachability detects reachability and embedded content', async ({
    given,
    then,
    and,
  }: AllureBddContext) => {
    let doc: Document;
    let p: Element;
    let runs: Element[];

    await given('a paragraph with text runs and an embedded drawing', () => {
      doc = makeDoc(
        '<w:p>' +
          '<w:r><w:t>Start</w:t></w:r>' +
          `<w:r>${MINIMAL_DRAWING}</w:r>` +
          '<w:r><w:t>End</w:t></w:r>' +
        '</w:p>',
      );
      p = firstParagraph(doc);
      runs = Array.from(p.getElementsByTagNameNS(W_NS, 'r'));
    });

    await then('forward reachable range reports isReachable: true and containsEmbeddedContent: true', () => {
      const res = validateSiblingRangeReachability(runs[0]!, runs[2]!);
      expect(res.isReachable).toBe(true);
      expect(res.containsEmbeddedContent).toBe(true);
    });

    await and('reversed range reports isReachable: false', () => {
      const res = validateSiblingRangeReachability(runs[2]!, runs[0]!);
      expect(res.isReachable).toBe(false);
    });

    await and('detached node reports isReachable: false', () => {
      const detached = doc.createElementNS(W_NS, 'w:r');
      const res = validateSiblingRangeReachability(runs[0]!, detached);
      expect(res.isReachable).toBe(false);
    });
  });
});

import { describe, expect } from 'vitest';
import { testAllure } from '../testing/allure-test.js';
import { parseXml } from './xml.js';
import { acceptChanges } from './accept_changes.js';
import { rejectChanges } from './reject_changes.js';

// #1485: Accept All / Reject All resolve custom XML markup revision ranges
// around block w:customXml and w:sdt containers.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const test = testAllure.epic('Document Comparison').withLabels({ feature: 'Custom XML markup revision ranges' })
  .conformance(
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.4' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.5' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.6' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.7' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.8' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.9' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.10' },
    { spec: 'ECMA-376', edition: 5, part: 1, section: '17.13.5.11' },
  );
const META = 'w:author="A" w:date="2026-01-01T00:00:00Z"';
const para = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const customXml = (inner: string) =>
  `<w:customXml w:uri="urn:x" w:element="clause"><w:customXmlPr><w:attr w:name="a" w:val="1"/></w:customXmlPr>${inner}</w:customXml>`;
const sdt = (inner: string) =>
  `<w:sdt><w:sdtPr><w:alias w:val="Box"/><w:id w:val="5"/></w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
const ranged = (kind: string, inner: string, id = 3) =>
  `<w:customXml${kind}RangeStart w:id="${id}" ${META}/>${inner}<w:customXml${kind}RangeEnd w:id="${id}"/>`;
const document = (body: string) =>
  parseXml(`<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`);
const count = (doc: Document, local: string) => doc.getElementsByTagNameNS(W, local).length;
const texts = (doc: Document) => Array.from(doc.getElementsByTagNameNS(W, 't')).map(t => t.textContent);
const rangeLocals = ['Ins', 'Del', 'MoveFrom', 'MoveTo'].flatMap(k => [`customXml${k}RangeStart`, `customXml${k}RangeEnd`]);
const markerCount = (doc: Document) => rangeLocals.reduce((n, l) => n + count(doc, l), 0);

type Case = { kind: string; removedOn: 'accept' | 'reject' };
const cases: Case[] = [
  { kind: 'Del', removedOn: 'accept' },
  { kind: 'MoveFrom', removedOn: 'accept' },
  { kind: 'Ins', removedOn: 'reject' },
  { kind: 'MoveTo', removedOn: 'reject' },
];
const containers = [
  { name: 'block customXml', wrap: customXml, locals: ['customXml'] },
  { name: 'block sdt', wrap: sdt, locals: ['sdt'] },
  { name: 'customXml nested in sdt', wrap: (i: string) => sdt(customXml(i)), locals: ['sdt', 'customXml'] },
];

describe('custom XML markup revision ranges (#1485)', () => {
  for (const { kind, removedOn } of cases) {
    for (const c of containers) {
      for (const op of ['accept', 'reject'] as const) {
        const removes = op === removedOn;
        test(`${op} of a ${kind} range around a ${c.name} ${removes ? 'unwraps' : 'keeps'} the container`, () => {
          const doc = document(para('before') + ranged(kind, c.wrap(para('inside'))) + para('after'));
          (op === 'accept' ? acceptChanges : rejectChanges)(doc);
          expect(markerCount(doc)).toBe(0);
          expect(texts(doc)).toEqual(['before', 'inside', 'after']);
          for (const local of c.locals) expect(count(doc, local)).toBe(removes ? 0 : 1);
          expect(count(doc, 'customXmlPr') + count(doc, 'sdtPr')).toBe(removes ? 0 : c.locals.length);
          const body = doc.getElementsByTagNameNS(W, 'body').item(0)!;
          if (removes) expect(Array.from(body.childNodes).filter(n => n.nodeType === 1).length).toBe(4);
        });
      }
    }
  }

  test('a range that encloses no container keeps its markers', () => {
    for (const op of [acceptChanges, rejectChanges]) {
      const doc = document(ranged('Del', para('plain')) + ranged('Ins', '', 4));
      op(doc);
      expect(markerCount(doc)).toBe(4);
    }
  });

  test('a cross-structure range holding only one tag of a container is left unresolved', () => {
    // Spec example shape (§17.13.5.5): the range ends inside the outer container.
    const xml = `<w:customXmlDelRangeStart w:id="3" ${META}/>` +
      customXml(customXml(para('x')) + '<w:customXmlDelRangeEnd w:id="3"/>');
    for (const op of [acceptChanges, rejectChanges]) {
      const doc = document(xml);
      op(doc);
      expect(markerCount(doc)).toBe(2);
      expect(count(doc, 'customXml')).toBe(2);
    }
  });

  test('accept counts the resolved ranges', () => {
    const doc = document(ranged('Del', customXml(para('a'))) + ranged('Ins', sdt(para('b')), 4) + ranged('MoveTo', sdt(para('c')), 5));
    const result = acceptChanges(doc);
    expect(result.deletionsAccepted).toBe(1);
    expect(result.insertionsAccepted).toBe(1);
    expect(result.movesResolved).toBe(1);
    expect(count(doc, 'customXml')).toBe(0);
    expect(count(doc, 'sdt')).toBe(2);
  });
});

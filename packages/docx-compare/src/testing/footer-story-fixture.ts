import { DocxArchive } from '@usejunior/docx-core';
import { buildDocxFromBodyXml } from './ooxml-fixtures.js';

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const FOOTER_RELATIONSHIP = `${R_NS}/footer`;
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * A one-section document whose `sectPr` selects a default footer carrying
 * `footerText`; `null` builds the same body with no footer at all.
 *
 * The pair (footer present, footer removed) is the smallest removed-story
 * input: since #754 the redline marks the footer's content as a tracked
 * deletion and reports nothing in `unrepresentedChanges` for it. Use
 * `buildDocxWithTitlePage` for an input that stays unrepresented.
 */
export async function buildDocxWithDefaultFooter(
  bodyText: string,
  footerText: string | null,
): Promise<Buffer> {
  const body = `<w:p><w:r><w:t>${bodyText}</w:t></w:r></w:p>`;
  const base = await buildDocxFromBodyXml(body, [], { namespaces: { r: R_NS } });
  if (footerText === null) return base;
  const archive = await DocxArchive.load(base);
  archive.setDocumentXml((await archive.getDocumentXml()).replace(
    '<w:sectPr/>',
    '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/></w:sectPr>',
  ));
  archive.setFile(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rIdFooter" Type="${FOOTER_RELATIONSHIP}" Target="footer1.xml"/></Relationships>`,
  );
  archive.setFile(
    'word/footer1.xml',
    `<?xml version="1.0"?><w:ftr xmlns:w="${W_NS}"><w:p><w:r><w:t>${footerText}</w:t></w:r></w:p></w:ftr>`,
  );
  return archive.save();
}

/**
 * A one-section document whose `sectPr` turns a distinct first page
 * (`w:titlePg`) on or off.
 *
 * Turning it on is the smallest input on which `compareDocuments` reports a
 * non-empty `unrepresentedChanges` (#1029): the `w:sectPrChange` snapshot
 * holds the original properties, which have no `w:titlePg`, and Word's Reject
 * All applies a snapshot property by property, keeping a live property the
 * snapshot omits. The difference is therefore reported as
 * `{ scope: 'section', kind: 'changed' }` (#1181). A page-size change no
 * longer serves: its snapshot names every live attribute, so it is
 * represented.
 */
export async function buildDocxWithTitlePage(
  bodyText: string,
  titlePage: boolean,
): Promise<Buffer> {
  const body = `<w:p><w:r><w:t>${bodyText}</w:t></w:r></w:p>`;
  const archive = await DocxArchive.load(await buildDocxFromBodyXml(body));
  archive.setDocumentXml((await archive.getDocumentXml()).replace(
    '<w:sectPr/>',
    `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>${titlePage ? '<w:titlePg/>' : ''}</w:sectPr>`,
  ));
  return archive.save();
}

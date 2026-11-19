// A small but complete WordprocessingML package: content types for every part (including the
// header/footer Overrides Word needs to open the file without a repair prompt), styles and
// settings. Entries are written in a fixed order with a fixed date, so a given body always
// produces the same bytes.
import JSZip from 'jszip';

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = `${R_NS}/`;
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
export const FIXTURE_ZIP_DATE = new Date('2026-01-01T00:00:00Z');

const STYLES = `${DECL}<w:styles xmlns:w="${W_NS}"><w:docDefaults><w:rPrDefault><w:rPr>`
  + '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/>'
  + '<w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
  + '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>'
  + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>'
  + '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
  + '</w:styles>';

const SETTINGS = `${DECL}<w:settings xmlns:w="${W_NS}"><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/>`
  + '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>'
  + '</w:settings>';

/** `<w:document>` with the given body XML (paragraphs, tables and the final `w:sectPr`). */
export function documentXml(bodyXml) {
  return `${DECL}<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${bodyXml}</w:body></w:document>`;
}

/** A header or footer part holding one paragraph of text. */
export function storyXml(kind, text) {
  const root = kind === 'header' ? 'w:hdr' : 'w:ftr';
  return `${DECL}<${root} xmlns:w="${W_NS}"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></${root}>`;
}

/**
 * Build a .docx.
 * @param {string} bodyXml the content of `w:body`
 * @param {Array<{id: string, kind: 'header'|'footer', target: string, text: string}>} stories
 *   header/footer parts and the relationship ids the body uses for them
 * @returns {Promise<Buffer>}
 */
export async function buildPackage(bodyXml, stories = []) {
  const zip = new JSZip();
  const add = (name, content) => zip.file(name, content, { date: FIXTURE_ZIP_DATE });
  const overrides = [
    ['/word/document.xml', `${CT}.document.main+xml`],
    ['/word/styles.xml', `${CT}.styles+xml`],
    ['/word/settings.xml', `${CT}.settings+xml`],
    ...stories.map((s) => [`/word/${s.target}`, `${CT}.${s.kind}+xml`]),
  ];
  add('[Content_Types].xml', `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join('')
    + '</Types>');
  add('_rels/.rels', `${DECL}<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL}officeDocument" Target="word/document.xml"/></Relationships>`);
  add('word/document.xml', documentXml(bodyXml));
  add('word/_rels/document.xml.rels', `${DECL}<Relationships xmlns="${PKG_REL_NS}">`
    + `<Relationship Id="rIdStyles" Type="${REL}styles" Target="styles.xml"/>`
    + `<Relationship Id="rIdSettings" Type="${REL}settings" Target="settings.xml"/>`
    + stories.map((s) => `<Relationship Id="${s.id}" Type="${REL}${s.kind}" Target="${s.target}"/>`).join('')
    + '</Relationships>');
  add('word/styles.xml', STYLES);
  add('word/settings.xml', SETTINGS);
  for (const s of stories) add(`word/${s.target}`, storyXml(s.kind, s.text));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

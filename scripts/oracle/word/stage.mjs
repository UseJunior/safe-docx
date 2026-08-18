import JSZip from 'jszip';

export const ADDIN_ID = '9b95a185-9477-4e27-92fb-df7290c18891';
const ROOT_REL_TYPE = 'http://schemas.microsoft.com/office/2011/relationships/webextensiontaskpanes';
const WEBEXT_REL_TYPE = 'http://schemas.microsoft.com/office/2011/relationships/webextension';

export function stagedFileName({ port, jobId, token, originalFileName }) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('invalid bridge port');
  if (!/^[0-9a-f-]{36}$/i.test(jobId) || !/^[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('invalid job credentials');
  const safeOriginal = originalFileName.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80);
  return `safe-docx-word-oracle--p${port}--j${jobId}--t${token}--${safeOriginal}`;
}

export async function embedAutoOpenAddin(sourceBytes) {
  const zip = await JSZip.loadAsync(sourceBytes);
  const contentTypesPath = '[Content_Types].xml';
  const rootRelsPath = '_rels/.rels';
  const contentTypes = await requiredText(zip, contentTypesPath);
  const rootRels = await requiredText(zip, rootRelsPath);
  if (!zip.file('word/document.xml')) throw new Error('source is not a Word DOCX package');

  zip.file(contentTypesPath, appendBefore(contentTypes, '</Types>', [
    '<Override PartName="/webextensions/taskpanes.xml" ContentType="application/vnd.ms-office.webextensiontaskpanes+xml"/>',
    '<Override PartName="/webextensions/webextension1.xml" ContentType="application/vnd.ms-office.webextension+xml"/>',
  ], 'PartName="/webextensions/taskpanes.xml"'));

  const relationshipId = nextRelationshipId(rootRels);
  zip.file(rootRelsPath, appendBefore(rootRels, '</Relationships>', [
    `<Relationship Id="${relationshipId}" Type="${ROOT_REL_TYPE}" Target="webextensions/taskpanes.xml"/>`,
  ], `Type="${ROOT_REL_TYPE}"`));

  zip.file('webextensions/taskpanes.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<wetp:taskpanes xmlns:wetp="http://schemas.microsoft.com/office/webextensions/taskpanes/2010/11">' +
    '<wetp:taskpane dockstate="right" visibility="1" width="350" row="4">' +
    '<wetp:webextensionref xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/>' +
    '</wetp:taskpane></wetp:taskpanes>');
  zip.file('webextensions/_rels/taskpanes.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="${WEBEXT_REL_TYPE}" Target="webextension1.xml"/>` +
    '</Relationships>');
  zip.file('webextensions/webextension1.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<we:webextension xmlns:we="http://schemas.microsoft.com/office/webextensions/webextension/2010/11" id="{${ADDIN_ID.toUpperCase()}}">` +
    `<we:reference id="${ADDIN_ID}" version="1.0.0.0" store="developer" storeType="Registry"/>` +
    '<we:alternateReferences/><we:properties>' +
    '<we:property name="Office.AutoShowTaskpaneWithDocument" value="true"/>' +
    '</we:properties><we:bindings/>' +
    '<we:snapshot xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>' +
    '</we:webextension>');

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

async function requiredText(zip, path) {
  const file = zip.file(path);
  if (!file) throw new Error(`DOCX is missing ${path}`);
  return file.async('string');
}

function appendBefore(xml, closingTag, additions, duplicateMarker) {
  if (xml.includes(duplicateMarker)) return xml;
  const index = xml.lastIndexOf(closingTag);
  if (index < 0) throw new Error(`malformed OOXML part: missing ${closingTag}`);
  return `${xml.slice(0, index)}${additions.join('')}${xml.slice(index)}`;
}

function nextRelationshipId(xml) {
  const ids = [...xml.matchAll(/\bId="rId(\d+)"/g)].map(match => Number(match[1]));
  return `rId${Math.max(0, ...ids) + 1}`;
}

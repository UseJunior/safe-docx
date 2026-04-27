import JSZip from 'jszip';
import { DocxArchive } from '../shared/docx/DocxArchive.js';

export interface SyntheticDocxOptions {
  paragraphs: string[];
  footnoteOnParagraph?: number;
  footnoteText?: string;
  commentOnParagraph?: number;
  commentText?: string;
  commentAuthor?: string;
  // When true, the comment scenario also emits commentsExtended.xml + people.xml
  // with matching paraId / author entries. Used to test ancillary-part bootstrap.
  commentAncillaryParts?: boolean;
}

export async function buildSyntheticDocx(opts: SyntheticDocxOptions): Promise<Buffer> {
  const hasFootnote = opts.footnoteOnParagraph != null;
  const hasComment = opts.commentOnParagraph != null;

  const paragraphsXml = opts.paragraphs.map((text, idx) => {
    const escaped = text
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
    let extra = '';

    if (hasFootnote && idx === opts.footnoteOnParagraph) {
      extra += `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r>`;
    }

    if (hasComment && idx === opts.commentOnParagraph) {
      extra =
        `<w:commentRangeStart w:id="1"/>` +
        `<w:r><w:t>${escaped}</w:t></w:r>` +
        `<w:commentRangeEnd w:id="1"/>` +
        `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="1"/></w:r>`;
      return `<w:p>${extra}</w:p>`;
    }

    return `<w:p><w:r><w:t>${escaped}</w:t></w:r>${extra}</w:p>`;
  }).join('\n    ');

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"` +
    ` xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
    `<w:body>${paragraphsXml}<w:sectPr/></w:body></w:document>`;

  const contentTypeParts: string[] = [
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`,
  ];

  const docRelEntries: string[] = [];
  let rIdCounter = 1;

  const zip = new JSZip();

  if (hasFootnote) {
    const fnText = opts.footnoteText ?? 'Test footnote';
    const footnotesXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
      `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
      `<w:footnote w:id="1"><w:p><w:r><w:t>${fnText}</w:t></w:r></w:p></w:footnote>` +
      `</w:footnotes>`;
    zip.file('word/footnotes.xml', footnotesXml);
    contentTypeParts.push(
      `<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>`
    );
    rIdCounter++;
    docRelEntries.push(
      `<Relationship Id="rId${rIdCounter}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>`
    );
  }

  if (hasComment) {
    const cText = opts.commentText ?? 'Test comment';
    const cAuthor = opts.commentAuthor ?? 'Author';
    const commentsXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"` +
      ` xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
      `<w:comment w:id="1" w:author="${cAuthor}" w:date="2025-01-01T00:00:00Z">` +
      `<w:p w14:paraId="00000001"><w:r><w:t>${cText}</w:t></w:r></w:p>` +
      `</w:comment></w:comments>`;
    zip.file('word/comments.xml', commentsXml);
    contentTypeParts.push(
      `<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>`
    );
    rIdCounter++;
    docRelEntries.push(
      `<Relationship Id="rId${rIdCounter}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>`
    );

    if (opts.commentAncillaryParts) {
      const commentsExtendedXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">` +
        `<w15:commentEx w15:paraId="00000001" w15:done="0"/>` +
        `</w15:commentsEx>`;
      zip.file('word/commentsExtended.xml', commentsExtendedXml);
      contentTypeParts.push(
        `<Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.ms-word.commentsExtended+xml"/>`
      );
      rIdCounter++;
      docRelEntries.push(
        `<Relationship Id="rId${rIdCounter}" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"/>`
      );

      const peopleXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"` +
        ` xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w15:person w15:author="${cAuthor}">` +
        `<w15:presenceInfo w15:providerId="None" w15:userId="${cAuthor}@example.com"/>` +
        `</w15:person></w15:people>`;
      zip.file('word/people.xml', peopleXml);
      contentTypeParts.push(
        `<Override PartName="/word/people.xml" ContentType="application/vnd.ms-word.people+xml"/>`
      );
      rIdCounter++;
      docRelEntries.push(
        `<Relationship Id="rId${rIdCounter}" Type="http://schemas.microsoft.com/office/2011/relationships/people" Target="people.xml"/>`
      );
    }
  }

  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    contentTypeParts.join('') +
    `</Types>`;

  const rootRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;

  const docRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    docRelEntries.join('') +
    `</Relationships>`;

  zip.file('[Content_Types].xml', contentTypesXml);
  zip.file('_rels/.rels', rootRelsXml);
  zip.file('word/document.xml', documentXml);
  zip.file('word/_rels/document.xml.rels', docRelsXml);

  return (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
}

export interface SyntheticResultParts {
  documentXml: string;
  footnotesXml: string | null;
  endnotesXml: string | null;
  commentsXml: string | null;
  commentsExtendedXml: string | null;
  peopleXml: string | null;
  contentTypesXml: string | null;
  relsXml: string | null;
}

export async function getResultParts(resultBuffer: Buffer): Promise<SyntheticResultParts> {
  const archive = await DocxArchive.load(resultBuffer);
  return {
    documentXml: await archive.getDocumentXml(),
    footnotesXml: await archive.getFile('word/footnotes.xml'),
    endnotesXml: await archive.getFile('word/endnotes.xml'),
    commentsXml: await archive.getFile('word/comments.xml'),
    commentsExtendedXml: await archive.getFile('word/commentsExtended.xml'),
    peopleXml: await archive.getFile('word/people.xml'),
    contentTypesXml: await archive.getFile('[Content_Types].xml'),
    relsXml: await archive.getFile('word/_rels/document.xml.rels'),
  };
}

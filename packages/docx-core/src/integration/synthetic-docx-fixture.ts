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
  /**
   * Threaded reply to the root comment (w:id="1"). Emits a second
   * <w:comment w:id="2"> with paraId 00000002 and, when commentAncillaryParts
   * is also set, a <w15:commentEx w15:paraIdParent="00000001"> linkage and a
   * second <w15:person> for the reply author. Reply comments deliberately
   * have NO <w:commentReference> in document.xml — that's the issue #108
   * shape: replies are discoverable only via paraIdParent threading.
   */
  replyText?: string;
  replyAuthor?: string;
  /**
   * Cross-paragraph comment span. The comment opens at the start of
   * paragraphs[start] and closes at the end of paragraphs[end]. The
   * commentReference run is appended to paragraphs[end].
   *
   * Mutually exclusive with commentOnParagraph.
   */
  commentSpanParagraphs?: { start: number; end: number };
  /**
   * Bookmark spanning a single paragraph (start and end inside the same w:p).
   * Used to verify paragraph-internal bookmark preservation through rebuild.
   */
  bookmarkOnParagraph?: { paragraph: number; name: string; id?: number };
  /**
   * Body-level (sibling of <w:p>) bookmark inserted between
   * paragraphs[index - 1] and paragraphs[index]. Used to verify scaffold
   * markers do not leak into reconstructed paragraphs.
   */
  siblingBookmarkBefore?: { index: number; name: string; id?: number };
}

export async function buildSyntheticDocx(opts: SyntheticDocxOptions): Promise<Buffer> {
  const hasFootnote = opts.footnoteOnParagraph != null;
  const hasComment = opts.commentOnParagraph != null;
  const hasCommentSpan = opts.commentSpanParagraphs != null;
  const hasBookmark = opts.bookmarkOnParagraph != null;
  const hasSiblingBookmark = opts.siblingBookmarkBefore != null;

  if (hasComment && hasCommentSpan) {
    throw new Error('commentOnParagraph and commentSpanParagraphs are mutually exclusive');
  }

  const bookmarkId = opts.bookmarkOnParagraph?.id ?? 100;
  const siblingBookmarkId = opts.siblingBookmarkBefore?.id ?? 200;
  const spanStart = opts.commentSpanParagraphs?.start;
  const spanEnd = opts.commentSpanParagraphs?.end;

  const paragraphParts: string[] = opts.paragraphs.map((text, idx) => {
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

    if (hasCommentSpan && (idx === spanStart || idx === spanEnd)) {
      const before = idx === spanStart ? `<w:commentRangeStart w:id="1"/>` : '';
      const after = idx === spanEnd
        ? `<w:commentRangeEnd w:id="1"/>` +
          `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="1"/></w:r>`
        : '';
      return `<w:p>${before}<w:r><w:t>${escaped}</w:t></w:r>${after}${extra}</w:p>`;
    }

    if (hasBookmark && idx === opts.bookmarkOnParagraph!.paragraph) {
      const name = opts.bookmarkOnParagraph!.name;
      return (
        `<w:p>` +
        `<w:bookmarkStart w:id="${bookmarkId}" w:name="${name}"/>` +
        `<w:r><w:t>${escaped}</w:t></w:r>` +
        `<w:bookmarkEnd w:id="${bookmarkId}"/>` +
        extra +
        `</w:p>`
      );
    }

    return `<w:p><w:r><w:t>${escaped}</w:t></w:r>${extra}</w:p>`;
  });

  // Inject a body-level (sibling of <w:p>) bookmark before paragraphs[index].
  // Bookmark*Start*/End placed as sibling of <w:p> per ECMA-376 §17.13.5.
  if (hasSiblingBookmark) {
    const { index, name } = opts.siblingBookmarkBefore!;
    const sibling =
      `<w:bookmarkStart w:id="${siblingBookmarkId}" w:name="${name}"/>` +
      `<w:bookmarkEnd w:id="${siblingBookmarkId}"/>`;
    paragraphParts.splice(index, 0, sibling);
  }

  const paragraphsXml = paragraphParts.join('\n    ');

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

  if (hasComment || hasCommentSpan) {
    const cText = opts.commentText ?? 'Test comment';
    const cAuthor = opts.commentAuthor ?? 'Author';
    const hasReply = opts.replyText != null;
    const replyAuthor = opts.replyAuthor ?? 'Replier';
    const replyEntry = hasReply
      ? `<w:comment w:id="2" w:author="${replyAuthor}" w:date="2025-01-02T00:00:00Z">` +
        `<w:p w14:paraId="00000002"><w:r><w:t>${opts.replyText}</w:t></w:r></w:p>` +
        `</w:comment>`
      : '';
    const commentsXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"` +
      ` xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
      `<w:comment w:id="1" w:author="${cAuthor}" w:date="2025-01-01T00:00:00Z">` +
      `<w:p w14:paraId="00000001"><w:r><w:t>${cText}</w:t></w:r></w:p>` +
      `</w:comment>` +
      replyEntry +
      `</w:comments>`;
    zip.file('word/comments.xml', commentsXml);
    contentTypeParts.push(
      `<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>`
    );
    rIdCounter++;
    docRelEntries.push(
      `<Relationship Id="rId${rIdCounter}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>`
    );

    if (opts.commentAncillaryParts) {
      const replyExEntry = hasReply
        ? `<w15:commentEx w15:paraId="00000002" w15:paraIdParent="00000001" w15:done="0"/>`
        : '';
      const commentsExtendedXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">` +
        `<w15:commentEx w15:paraId="00000001" w15:done="0"/>` +
        replyExEntry +
        `</w15:commentsEx>`;
      zip.file('word/commentsExtended.xml', commentsExtendedXml);
      contentTypeParts.push(
        `<Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.ms-word.commentsExtended+xml"/>`
      );
      rIdCounter++;
      docRelEntries.push(
        `<Relationship Id="rId${rIdCounter}" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"/>`
      );

      const replyPersonEntry = hasReply
        ? `<w15:person w15:author="${replyAuthor}">` +
          `<w15:presenceInfo w15:providerId="None" w15:userId="${replyAuthor}@example.com"/>` +
          `</w15:person>`
        : '';
      const peopleXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"` +
        ` xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w15:person w15:author="${cAuthor}">` +
        `<w15:presenceInfo w15:providerId="None" w15:userId="${cAuthor}@example.com"/>` +
        `</w15:person>` +
        replyPersonEntry +
        `</w15:people>`;
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

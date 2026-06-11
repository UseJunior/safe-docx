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
  /**
   * Multi-paragraph comment range with body-level markers: the
   * commentRangeStart is emitted as a sibling of <w:p> before
   * paragraphs[startBeforeParagraph] and the commentRangeEnd as a sibling
   * after paragraphs[endAfterParagraph]. The commentReference run is
   * appended inside paragraphs[endAfterParagraph]. This is the issue #103
   * shape: range markers spanning whole paragraphs sit outside any <w:p>.
   *
   * Mutually exclusive with commentOnParagraph and commentSpanParagraphs.
   */
  siblingCommentRange?: { startBeforeParagraph: number; endAfterParagraph: number };
  /**
   * Pre-existing tracked move with explicit in-paragraph range markers.
   * paragraphs[from]'s text is wrapped in <w:moveFrom> (as w:delText)
   * bracketed by w:moveFromRangeStart/End; paragraphs[to]'s text is wrapped
   * in <w:moveTo> bracketed by w:moveToRangeStart/End. All four markers are
   * direct children of their <w:p>, sharing the given w:name. Callers should
   * pass identical text for paragraphs[from] and paragraphs[to] so the shape
   * matches what Word produces for a real tracked move. Used to verify
   * explicit move-range marker reconstruction (issue #110).
   */
  trackedMove?: { from: number; to: number; name: string; author?: string; firstId?: number };
}

export async function buildSyntheticDocx(opts: SyntheticDocxOptions): Promise<Buffer> {
  const hasFootnote = opts.footnoteOnParagraph != null;
  const hasComment = opts.commentOnParagraph != null;
  const hasCommentSpan = opts.commentSpanParagraphs != null;
  const hasBookmark = opts.bookmarkOnParagraph != null;
  const hasSiblingBookmark = opts.siblingBookmarkBefore != null;
  const hasSiblingCommentRange = opts.siblingCommentRange != null;

  if ([hasComment, hasCommentSpan, hasSiblingCommentRange].filter(Boolean).length > 1) {
    throw new Error(
      'commentOnParagraph, commentSpanParagraphs and siblingCommentRange are mutually exclusive'
    );
  }

  const bookmarkId = opts.bookmarkOnParagraph?.id ?? 100;
  const siblingBookmarkId = opts.siblingBookmarkBefore?.id ?? 200;
  const spanStart = opts.commentSpanParagraphs?.start;
  const spanEnd = opts.commentSpanParagraphs?.end;
  const hasTrackedMove = opts.trackedMove != null;
  const moveAuthor = opts.trackedMove?.author ?? 'Mover';
  const moveBaseId = opts.trackedMove?.firstId ?? 300;
  const moveDate = '2025-01-01T00:00:00Z';

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

    if (hasTrackedMove && idx === opts.trackedMove!.from) {
      const name = opts.trackedMove!.name;
      return (
        `<w:p>` +
        `<w:moveFromRangeStart w:id="${moveBaseId}" w:name="${name}" w:author="${moveAuthor}" w:date="${moveDate}"/>` +
        `<w:moveFrom w:id="${moveBaseId + 1}" w:author="${moveAuthor}" w:date="${moveDate}">` +
        `<w:r><w:delText>${escaped}</w:delText></w:r>` +
        `</w:moveFrom>` +
        `<w:moveFromRangeEnd w:id="${moveBaseId}"/>` +
        extra +
        `</w:p>`
      );
    }

    if (hasTrackedMove && idx === opts.trackedMove!.to) {
      const name = opts.trackedMove!.name;
      return (
        `<w:p>` +
        `<w:moveToRangeStart w:id="${moveBaseId + 2}" w:name="${name}" w:author="${moveAuthor}" w:date="${moveDate}"/>` +
        `<w:moveTo w:id="${moveBaseId + 3}" w:author="${moveAuthor}" w:date="${moveDate}">` +
        `<w:r><w:t>${escaped}</w:t></w:r>` +
        `</w:moveTo>` +
        `<w:moveToRangeEnd w:id="${moveBaseId + 2}"/>` +
        extra +
        `</w:p>`
      );
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

  // Inject body-level comment range markers around whole paragraphs (the
  // issue #103 shape). The range markers are siblings of <w:p>; only the
  // commentReference run anchors inside the last spanned paragraph. End is
  // spliced before start so the start index is not shifted.
  if (hasSiblingCommentRange) {
    const { startBeforeParagraph, endAfterParagraph } = opts.siblingCommentRange!;
    paragraphParts[endAfterParagraph] = paragraphParts[endAfterParagraph]!.replace(
      '</w:p>',
      `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="1"/></w:r></w:p>`
    );
    paragraphParts.splice(endAfterParagraph + 1, 0, `<w:commentRangeEnd w:id="1"/>`);
    paragraphParts.splice(startBeforeParagraph, 0, `<w:commentRangeStart w:id="1"/>`);
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

  if (hasComment || hasCommentSpan || hasSiblingCommentRange) {
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

/** Parts for {@link buildDocxFromParts}. Only the body XML is required. */
export interface DocxPartsOptions {
  /** Raw `<w:body>` children (paragraphs/tables), without the `<w:body>` wrapper. */
  bodyXml: string;
  /** Full `word/styles.xml` content. */
  stylesXml?: string;
  /** Full `word/numbering.xml` content. */
  numberingXml?: string;
  /** Extra `<Relationship …/>` entries for `word/_rels/document.xml.rels` (e.g. hyperlinks). */
  documentRelEntries?: string[];
}

/**
 * Build a loadable DOCX from raw part XML. The `testing/ooxml-fixtures.ts`
 * `buildDocxFromBodyXml` covers the body-only case for docx-core's own tests, but it lives
 * in the build-excluded testing tree; this builder is exported from the package root for
 * downstream suites (odf-core's DOCX→ODT conversion tests) and additionally accepts the
 * optional styles/numbering/relationship parts those tests exercise.
 */
export async function buildDocxFromParts(opts: DocxPartsOptions): Promise<Buffer> {
  const zip = new JSZip();

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"` +
    ` xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<w:body>${opts.bodyXml}<w:sectPr/></w:body></w:document>`;

  const overrides = [
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`,
    ...(opts.stylesXml
      ? [`<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`]
      : []),
    ...(opts.numberingXml
      ? [`<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>`]
      : []),
  ];
  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    overrides.join('') +
    `</Types>`;

  const rootRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;

  const docRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    (opts.documentRelEntries ?? []).join('') +
    `</Relationships>`;

  zip.file('[Content_Types].xml', contentTypesXml);
  zip.file('_rels/.rels', rootRelsXml);
  zip.file('word/document.xml', documentXml);
  zip.file('word/_rels/document.xml.rels', docRelsXml);
  if (opts.stylesXml) zip.file('word/styles.xml', opts.stylesXml);
  if (opts.numberingXml) zip.file('word/numbering.xml', opts.numberingXml);

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

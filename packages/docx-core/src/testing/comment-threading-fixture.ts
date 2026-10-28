import { OOXML } from '../primitives/namespaces.js';
import { escapeXmlAttr } from '../primitives/track-changes-emitter.js';
import { buildDocxWithAncillaryParts } from './ooxml-fixtures.js';

export type ThreadedCommentFixture = {
  id: number;
  paragraphs: string[];
  parentId?: number;
  author?: string;
  /** Older SafeDocX output placed the only paragraph ID on the first paragraph. */
  legacyFirstParaId?: boolean;
};

/**
 * Synthetic Word-style threads adapted from SamStull9007's issue #1224 generator.
 * Both commentEx attributes key the last paragraph (MS-DOCX §2.5.3.1); the
 * optional legacy shape deliberately retains SafeDocX's former first-only ID.
 * XML is authored independently of the comment primitives under test.
 */
export async function buildCommentThreadingDocx(comments: ThreadedCommentFixture[]): Promise<Buffer> {
  const paragraphIds = new Map(comments.map((comment) => [comment.id, comment.paragraphs.map((_, index) =>
    (index === 0 ? 0x10000000 + comment.id : 0x20000000 + comment.id * 16 + index)
      .toString(16).toUpperCase().padStart(8, '0'))]));
  const threadIds = new Map(comments.map((comment) => {
    const ids = paragraphIds.get(comment.id)!;
    return [comment.id, comment.legacyFirstParaId ? ids[0]! : ids[ids.length - 1]!];
  }));
  const commentsXml = comments.map((comment) => {
    const paragraphs = comment.paragraphs.map((text, index) => {
      const paraId = comment.legacyFirstParaId && index > 0
        ? '' : ` w14:paraId="${paragraphIds.get(comment.id)![index]}"`;
      const annotation = index === 0 ? '<w:r><w:annotationRef/></w:r>' : '';
      return `<w:p${paraId}>${annotation}<w:r><w:t>${escapeXmlAttr(text)}</w:t></w:r></w:p>`;
    }).join('');
    return `<w:comment w:id="${comment.id}" w:author="${escapeXmlAttr(comment.author ?? `Author ${comment.id}`)}"`
      + ` w:initials="A" w:date="2026-01-01T00:00:00Z">${paragraphs}</w:comment>`;
  }).join('');
  const extendedXml = comments.map((comment) =>
    `<w15:commentEx w15:paraId="${threadIds.get(comment.id)}"`
      + (comment.parentId === undefined ? '' : ` w15:paraIdParent="${threadIds.get(comment.parentId)}"`)
      + ' w15:done="0"/>').join('');
  const idsXml = comments.map((comment) => `<w16cid:commentId w16cid:paraId="${threadIds.get(comment.id)}"`
    + ` w16cid:durableId="${(0x2A000000 + comment.id).toString(16).toUpperCase()}"/>`).join('');
  const starts = comments.map(({ id }) => `<w:commentRangeStart w:id="${id}"/>`).join('');
  const ends = comments.map(({ id }) => `<w:commentRangeEnd w:id="${id}"/>`
    + `<w:r><w:commentReference w:id="${id}"/></w:r>`).join('');
  const partType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.';
  return buildDocxWithAncillaryParts({
    bodyXml: `<w:p>${starts}<w:r><w:t>Lorem ipsum dolor sit amet.</w:t></w:r>${ends}</w:p>`,
    sectPrXml: '<w:sectPr/>',
    relationships: [
      { id: 'rId1', type: `${OOXML.R_NS}/comments`, target: 'comments.xml' },
      { id: 'rId2', type: 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended', target: 'commentsExtended.xml' },
      { id: 'rId3', type: 'http://schemas.microsoft.com/office/2016/09/relationships/commentsIds', target: 'commentsIds.xml' },
      { id: 'rId4', type: 'http://schemas.microsoft.com/office/2011/relationships/people', target: 'people.xml' },
    ],
    parts: [
      { path: 'word/comments.xml', contentType: `${partType}comments+xml`,
        xml: `<w:comments xmlns:w="${OOXML.W_NS}" xmlns:w14="${OOXML.W14_NS}">${commentsXml}</w:comments>` },
      { path: 'word/commentsExtended.xml', contentType: `${partType}commentsExtended+xml`,
        xml: `<w15:commentsEx xmlns:w15="${OOXML.W15_NS}">${extendedXml}</w15:commentsEx>` },
      { path: 'word/commentsIds.xml', contentType: `${partType}commentsIds+xml`,
        xml: `<w16cid:commentsIds xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid">${idsXml}</w16cid:commentsIds>` },
      { path: 'word/people.xml', contentType: `${partType}people+xml`,
        xml: `<w15:people xmlns:w15="${OOXML.W15_NS}"/>` },
    ],
  });
}

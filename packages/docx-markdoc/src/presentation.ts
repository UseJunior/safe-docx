import { DocxDocument, buildParagraphIndex, createRevisionContext, findParagraphByBookmarkId, type FootnoteRunStyle } from '@usejunior/docx-core';
import { DocxMarkdocError } from './errors.js';
import { sha256 } from './hash.js';
import type {
  AnnotationAnchor,
  AnnotationPresentation,
  AnnotationPresentationProfile,
  AnnotationPresentationRule,
  AnnotationRun,
  AnnotationRunStyle,
  CanonicalAnnotation,
  EditOperation,
  MarkdocEditIR,
} from './types.js';

const HIGHLIGHTS = new Set(['black', 'blue', 'cyan', 'green', 'magenta', 'red', 'yellow', 'white', 'darkBlue', 'darkCyan', 'darkGreen', 'darkMagenta', 'darkRed', 'darkYellow', 'darkGray', 'lightGray', 'none']);

function normalizeStyle(style: AnnotationRunStyle | undefined, path: string): AnnotationRunStyle | undefined {
  if (!style) return undefined;
  if (style.styleId !== undefined && style.styleId.length === 0) throw new DocxMarkdocError('INVALID_ANNOTATION_STYLE', `${path}.styleId must be non-empty.`);
  if (style.fontSizeHalfPoints !== undefined && (!Number.isInteger(style.fontSizeHalfPoints) || style.fontSizeHalfPoints <= 0)) throw new DocxMarkdocError('INVALID_ANNOTATION_STYLE', `${path}.fontSizeHalfPoints must be a positive integer.`);
  const color = style.color?.toUpperCase();
  if (color && !/^[0-9A-F]{6}$/.test(color)) throw new DocxMarkdocError('INVALID_ANNOTATION_COLOR', `${path}.color must be six-digit RGB.`);
  if (style.highlight && !HIGHLIGHTS.has(style.highlight)) throw new DocxMarkdocError('INVALID_ANNOTATION_HIGHLIGHT', `${path}.highlight is not a Word highlight value.`);
  return { ...style, ...(color ? { color } : {}) };
}

function normalizeRuns(runs: AnnotationRun[] | undefined, path: string): AnnotationRun[] | undefined {
  return runs?.map((run, index) => {
    if (typeof run.text !== 'string') throw new DocxMarkdocError('INVALID_ANNOTATION_RUN', `${path}[${index}].text must be a string.`);
    if (run.hyperlink !== undefined && (!run.hyperlink || typeof run.hyperlink.destination !== 'string' || run.hyperlink.destination.length === 0)) {
      throw new DocxMarkdocError('INVALID_ANNOTATION_HYPERLINK', `${path}[${index}].hyperlink.destination must be a non-empty string.`);
    }
    return {
      text: run.text,
      ...(run.style ? { style: normalizeStyle(run.style, `${path}[${index}].style`) } : {}),
      ...(run.hyperlink ? { hyperlink: { destination: run.hyperlink.destination } } : {}),
    };
  });
}

function normalizeRule(rule: AnnotationPresentationRule, path: string): AnnotationPresentationRule {
  if (!['preserve', 'comment', 'footnote', 'omit'].includes(rule.as)) throw new DocxMarkdocError('INVALID_ANNOTATION_PRESENTATION', `${path}.as is invalid.`);
  return {
    as: rule.as,
    ...(rule.prefix ? { prefix: normalizeRuns(rule.prefix, `${path}.prefix`) } : {}),
    ...(rule.separator ? { separator: normalizeRuns(rule.separator, `${path}.separator`) } : {}),
    ...(rule.bodyStyle ? { bodyStyle: normalizeStyle(rule.bodyStyle, `${path}.bodyStyle`) } : {}),
  };
}

export function normalizeAnnotationPresentationProfile(profile: AnnotationPresentationProfile | undefined): AnnotationPresentationProfile {
  if (!profile) return {};
  const result: AnnotationPresentationProfile = {};
  for (const audience of ['internal', 'external-facing', 'unspecified'] as const) {
    const rule = profile[audience];
    if (rule) result[audience] = normalizeRule(rule, audience);
  }
  return result;
}

function projectedAs(annotation: CanonicalAnnotation, profile: AnnotationPresentationProfile): AnnotationPresentation {
  const requested = annotation.presentation ?? profile[annotation.audience]?.as;
  if (!requested) throw new DocxMarkdocError('UNROUTED_ANNOTATION', `Annotation ${annotation.id} has no presentation rule.`, { annotationId: annotation.id });
  if (!annotation.presentation && annotation.semanticRole !== 'drafting-note') {
    const source = annotation.sourcePresentation === 'authored' ? 'comment' : annotation.sourcePresentation;
    if (requested === 'omit' || (requested !== 'preserve' && requested !== source)) {
      throw new DocxMarkdocError('EXPLICIT_ANNOTATION_DECISION_REQUIRED', `Annotation ${annotation.id} requires an explicit per-annotation decision before conversion or omission.`, { annotationId: annotation.id });
    }
  }
  if (requested !== 'preserve') return requested;
  return annotation.sourcePresentation === 'authored' ? 'comment' : annotation.sourcePresentation;
}

function remapPosition(ir: MarkdocEditIR, position: { paragraphId: string; offset: number }, annotationId: string): { paragraphId: string; offset: number } {
  const operation = ir.operations.find((item): item is Exclude<EditOperation, { anchorId: string }> => !('anchorId' in item) && item.id === position.paragraphId);
  if (!operation || operation.originalText === operation.revisedText) return position;
  const before = operation.originalText;
  const after = operation.revisedText;
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  if (position.offset <= prefix) return position;
  if (position.offset >= before.length - suffix) return { ...position, offset: position.offset + after.length - before.length };
  throw new DocxMarkdocError('ANNOTATION_ANCHOR_AMBIGUOUS', `Annotation ${annotationId} intersects edited text and cannot be remapped unambiguously.`, { annotationId, paragraphId: position.paragraphId, offset: position.offset });
}

function remapAnchor(ir: MarkdocEditIR, annotation: CanonicalAnnotation): AnnotationAnchor {
  if (annotation.operationId?.length) return annotation.anchor;
  if (annotation.anchor.kind === 'point') return { kind: 'point', point: remapPosition(ir, annotation.anchor.point, annotation.id) };
  return { kind: 'range', start: remapPosition(ir, annotation.anchor.start, annotation.id), end: remapPosition(ir, annotation.anchor.end, annotation.id) };
}

function mergedBody(annotation: CanonicalAnnotation, overlay?: AnnotationRunStyle) {
  return annotation.body.map((paragraph) => ({
    runs: paragraph.runs.map((run) => ({
      text: run.text,
      style: { ...(run.style ?? {}), ...(overlay ?? {}) },
      ...(run.hyperlink ? { hyperlink: { destination: run.hyperlink.destination } } : {}),
    })),
  }));
}

function flatText(annotation: CanonicalAnnotation): string {
  return annotation.body.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');
}

export type AnnotationProjectionResult = {
  buffer: Buffer;
  profile: AnnotationPresentationProfile;
  profileDigest: string;
  dispositions: Array<{ id: string; audience: CanonicalAnnotation['audience']; as: AnnotationPresentation; lossy: boolean; warning?: string }>;
  warnings: string[];
};

export async function projectAnnotations(buffer: Buffer, ir: MarkdocEditIR, requestedProfile?: AnnotationPresentationProfile): Promise<AnnotationProjectionResult> {
  const profile = normalizeAnnotationPresentationProfile(requestedProfile);
  const annotations = ir.annotations.filter((annotation) => !annotation.id.startsWith('rationale:'));
  const planned = annotations.map((annotation) => ({ annotation, as: projectedAs(annotation, profile), anchor: remapAnchor(ir, annotation) }));
  const preflight = await DocxDocument.load(buffer);
  const documentXml = preflight.getDocumentXmlClone();
  for (const item of planned) {
    const points = item.anchor.kind === 'point' ? [item.anchor.point] : [item.anchor.start, item.anchor.end];
    for (const point of points) {
      const paragraph = findParagraphByBookmarkId(documentXml, point.paragraphId);
      if (!paragraph) throw new DocxMarkdocError('ANNOTATION_ANCHOR_UNRESOLVABLE', `Annotation ${item.annotation.id} targets missing paragraph ${point.paragraphId}.`, { annotationId: item.annotation.id });
      const length = buildParagraphIndex(paragraph).text.length;
      if (point.offset < 0 || point.offset > length) throw new DocxMarkdocError('ANNOTATION_ANCHOR_UNRESOLVABLE', `Annotation ${item.annotation.id} offset ${point.offset} exceeds paragraph length ${length}.`, { annotationId: item.annotation.id });
    }
    if (item.as === 'comment' && item.anchor.kind === 'range' && item.anchor.start.paragraphId !== item.anchor.end.paragraphId) {
      throw new DocxMarkdocError('ANNOTATION_CROSS_PARAGRAPH_COMMENT_UNSUPPORTED', `Annotation ${item.annotation.id} has a cross-paragraph comment range.`, { annotationId: item.annotation.id });
    }
  }

  const document = await DocxDocument.load(buffer);
  const sourceCommentRoots = annotations.filter((annotation) => annotation.sourcePresentation === 'comment' && !annotation.replyParentId);
  for (const annotation of sourceCommentRoots) {
    const id = Number(annotation.id.replace(/^comment:/, ''));
    if (Number.isInteger(id)) await document.deleteComment({ commentId: id });
  }
  for (const annotation of annotations.filter((item) => item.sourcePresentation === 'footnote')) {
    const id = Number(annotation.id.replace(/^footnote:/, ''));
    if (Number.isInteger(id)) await document.deleteFootnote({ noteId: id });
  }

  const commentIds = new Map<string, number>();
  const dispositions: AnnotationProjectionResult['dispositions'] = [];
  const warnings: string[] = [];
  for (const item of planned) {
    const { annotation, as, anchor } = item;
    const threadedLoss = Boolean(annotation.replyParentId) && as !== 'comment';
    const rangeLoss = as === 'footnote' && anchor.kind === 'range';
    const omissionLoss = as === 'omit';
    const pointComment = as === 'comment' && anchor.kind === 'point';
    const warning = threadedLoss
      ? 'Reply topology is not representable in a footnote or omission.'
      : rangeLoss
        ? 'The footnote reference uses the range end; the complete range remains only in the canonical annotation.'
        : omissionLoss
          ? 'The annotation is intentionally absent from this document projection.'
          : pointComment
            ? 'Comment has no selected range and was emitted as a point comment.'
            : undefined;
    dispositions.push({ id: annotation.id, audience: annotation.audience, as, lossy: threadedLoss || rangeLoss || omissionLoss, ...(warning ? { warning } : {}) });
    if (warning) warnings.push(`${annotation.id}: ${warning}`);
    if (as === 'omit') continue;
    const rule = profile[annotation.audience];
    if (as === 'footnote') {
      const point = anchor.kind === 'point' ? anchor.point : anchor.end;
      await document.addFootnote({
        paragraphId: point.paragraphId,
        visibleOffset: point.offset,
        text: flatText(annotation),
        presentation: {
          prefixRuns: rule?.prefix,
          separatorRuns: rule?.separator,
          body: mergedBody(annotation, rule?.bodyStyle) as Array<{ runs: Array<{ text: string; style?: FootnoteRunStyle }> }>,
        },
      });
      continue;
    }
    if (annotation.replyParentId) {
      const parentCommentId = commentIds.get(annotation.replyParentId);
      if (parentCommentId === undefined) throw new DocxMarkdocError('ANNOTATION_REPLY_PROJECTION_UNRESOLVABLE', `Annotation ${annotation.id} reply parent was not emitted as a comment.`, { annotationId: annotation.id });
      const result = await document.addCommentReply({
        parentCommentId,
        author: annotation.author ?? 'Markdoc', initials: annotation.initials,
        text: flatText(annotation), body: mergedBody(annotation),
      }, annotation.date ? createRevisionContext({ author: annotation.author ?? 'Markdoc', date: annotation.date }) : undefined);
      commentIds.set(annotation.id, result.commentId);
      continue;
    }
    const start = anchor.kind === 'point' ? anchor.point : anchor.start;
    const end = anchor.kind === 'point' ? anchor.point : anchor.end;
    const result = await document.addComment({
      paragraphId: start.paragraphId, start: start.offset, end: end.offset,
      author: annotation.author ?? 'Markdoc', initials: annotation.initials,
      text: flatText(annotation), body: mergedBody(annotation),
    }, annotation.date ? createRevisionContext({ author: annotation.author ?? 'Markdoc', date: annotation.date }) : undefined);
    commentIds.set(annotation.id, result.commentId);
  }
  const output = (await document.toBuffer({ cleanBookmarks: false })).buffer;
  return { buffer: output, profile, profileDigest: sha256(Buffer.from(JSON.stringify(profile))), dispositions, warnings };
}

import { describe, expect } from 'vitest';
import { testAllure, type AllureBddContext } from '../testing/allure-test.js';
import { assertSuccess, openSession, registerCleanup } from '../testing/session-test-utils.js';
import { getComments } from './get_comments.js';
import { readFile } from './read_file.js';

const test = testAllure.epic('Document Reading');

const W_DOC_OPEN =
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">';

function makeDocumentXml(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    W_DOC_OPEN +
    `<w:body>${bodyXml}</w:body></w:document>`
  );
}

type ViewNode = { id: string; text: string; clean_text: string };

async function readJsonNodes(opened: Awaited<ReturnType<typeof openSession>>): Promise<ViewNode[]> {
  const read = await readFile(opened.mgr, { file_path: opened.inputPath, format: 'json' });
  assertSuccess(read, 'read_file');
  return JSON.parse(String(read.content)) as ViewNode[];
}

async function probeNodeId(
  opened: Awaited<ReturnType<typeof openSession>>,
  nodeId: string,
): Promise<ViewNode[]> {
  const probe = await readFile(opened.mgr, {
    file_path: opened.inputPath,
    format: 'json',
    node_ids: [nodeId],
  });
  assertSuccess(probe, 'read_file node_ids probe');
  return JSON.parse(String(probe.content)) as ViewNode[];
}

describe('read_file text-empty paragraphs with anchoring content (#383)', () => {
  registerCleanup();

  test('a paragraph whose only content is an endnote reference is surfaced in the document view', async ({ given, when, then, and }: AllureBddContext) => {
    const documentXml = makeDocumentXml(
      `<w:p><w:r><w:t>Body before the endnote.</w:t></w:r></w:p>` +
        `<w:p><w:r><w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr><w:endnoteReference w:id="1"/></w:r></w:p>` +
        `<w:p><w:r><w:t>Body after the endnote.</w:t></w:r></w:p>`,
    );
    // The endnotes part exists for package realism only: this fix surfaces the
    // anchor node; endnote marker/body rendering is a separate read surface
    // that does not exist yet (the opt-in inlining follow-on alongside #207).
    const endnotesXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:endnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:endnote>` +
      `<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>` +
      `<w:endnote w:id="1"><w:p><w:r><w:t>Endnote body lives here.</w:t></w:r></w:p></w:endnote>` +
      `</w:endnotes>`;

    let opened: Awaited<ReturnType<typeof openSession>>;
    let nodes: ViewNode[];

    await given('a document whose middle paragraph contains only an endnote reference run', async () => {
      opened = await openSession([], {
        xml: documentXml,
        extraFiles: { 'word/endnotes.xml': endnotesXml },
      });
    });

    await when('read_file renders the full document as JSON', async () => {
      nodes = await readJsonNodes(opened);
    });

    await then('the endnote-only paragraph appears in the view between its neighbors', async () => {
      expect(nodes).toHaveLength(3);
      expect(nodes[0]!.clean_text).toBe('Body before the endnote.');
      expect(nodes[1]!.clean_text).toBe('');
      expect(nodes[2]!.clean_text).toBe('Body after the endnote.');
    });

    await and('a node_ids probe for the anchor paragraph resolves it', async () => {
      const probed = await probeNodeId(opened, nodes[1]!.id);
      expect(probed).toHaveLength(1);
      expect(probed[0]!.id).toBe(nodes[1]!.id);
    });
  });

  test('a paragraph whose only content is a comment anchor is surfaced and the comment attaches to it', async ({ given, when, then, and }: AllureBddContext) => {
    const documentXml = makeDocumentXml(
      `<w:p><w:r><w:t>Body before the comment.</w:t></w:r></w:p>` +
        `<w:p>` +
        `<w:commentRangeStart w:id="1"/>` +
        `<w:commentRangeEnd w:id="1"/>` +
        `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="1"/></w:r>` +
        `</w:p>` +
        `<w:p><w:r><w:t>Body after the comment.</w:t></w:r></w:p>`,
    );
    const commentsXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
      `<w:comment w:id="1" w:author="Reviewer" w:date="2025-01-01T00:00:00Z" w:initials="RV">` +
      `<w:p w14:paraId="11111111"><w:r><w:annotationRef/></w:r><w:r><w:t>Comment on an otherwise empty paragraph.</w:t></w:r></w:p>` +
      `</w:comment>` +
      `</w:comments>`;

    let opened: Awaited<ReturnType<typeof openSession>>;
    let anchorId: string;
    let nodes: ViewNode[];

    await given('a document whose middle paragraph contains only a comment range and reference run', async () => {
      opened = await openSession([], {
        xml: documentXml,
        extraFiles: { 'word/comments.xml': commentsXml },
      });
      const comments = await getComments(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(comments, 'get_comments');
      const all = comments.comments as Array<{ id: number; anchored_paragraph_id: string | null }>;
      expect(all).toHaveLength(1);
      expect(all[0]!.anchored_paragraph_id).not.toBeNull();
      anchorId = all[0]!.anchored_paragraph_id!;
    });

    await when('read_file renders the full document as JSON', async () => {
      nodes = await readJsonNodes(opened);
    });

    await then('the comment-anchor paragraph appears in the view', async () => {
      expect(nodes).toHaveLength(3);
      const anchorNode = nodes.find((n) => n.id === anchorId);
      expect(anchorNode).toBeDefined();
      expect(anchorNode!.clean_text).toBe('');
    });

    await and('a node_ids probe for the anchor paragraph resolves it and the comment thread renders against it', async () => {
      const probed = await probeNodeId(opened, anchorId);
      expect(probed).toHaveLength(1);
      expect(probed[0]!.id).toBe(anchorId);

      const rendered = await readFile(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(rendered, 'read_file with default comment rendering');
      expect(String(rendered.content)).toContain('Comment on an otherwise empty paragraph.');
    });
  });

  test('a comment range starting in an otherwise-empty paragraph keeps its anchor paragraph in the view', async ({ given, when, then, and }: AllureBddContext) => {
    // The dangling-anchor shape: getComments resolves anchored_paragraph_id
    // from where w:commentRangeStart sits, so if that paragraph is dropped the
    // reported anchor ID is unreachable by any node_ids probe — even though
    // the commentReference run lives in a later, visible paragraph.
    const documentXml = makeDocumentXml(
      `<w:p><w:r><w:t>Body before the comment.</w:t></w:r></w:p>` +
        `<w:p><w:commentRangeStart w:id="1"/></w:p>` +
        `<w:p>` +
        `<w:r><w:t>Commented text continues here.</w:t></w:r>` +
        `<w:commentRangeEnd w:id="1"/>` +
        `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="1"/></w:r>` +
        `</w:p>`,
    );
    const commentsXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
      `<w:comment w:id="1" w:author="Reviewer" w:date="2025-01-01T00:00:00Z" w:initials="RV">` +
      `<w:p w14:paraId="22222222"><w:r><w:annotationRef/></w:r><w:r><w:t>Range starts on an empty paragraph.</w:t></w:r></w:p>` +
      `</w:comment>` +
      `</w:comments>`;

    let opened: Awaited<ReturnType<typeof openSession>>;
    let anchorId: string;
    let nodes: ViewNode[];

    await given('a document whose comment range starts in an empty paragraph and ends in the next one', async () => {
      opened = await openSession([], {
        xml: documentXml,
        extraFiles: { 'word/comments.xml': commentsXml },
      });
      const comments = await getComments(opened.mgr, { file_path: opened.inputPath });
      assertSuccess(comments, 'get_comments');
      const all = comments.comments as Array<{ id: number; anchored_paragraph_id: string | null }>;
      expect(all).toHaveLength(1);
      expect(all[0]!.anchored_paragraph_id).not.toBeNull();
      anchorId = all[0]!.anchored_paragraph_id!;
    });

    await when('read_file renders the full document as JSON', async () => {
      nodes = await readJsonNodes(opened);
    });

    await then('the reported anchor paragraph is a real view node, not a dangling ID', async () => {
      expect(nodes).toHaveLength(3);
      const anchorNode = nodes.find((n) => n.id === anchorId);
      expect(anchorNode).toBeDefined();
      expect(anchorNode!.clean_text).toBe('');
    });

    await and('a node_ids probe for the anchor paragraph resolves it', async () => {
      const probed = await probeNodeId(opened, anchorId);
      expect(probed).toHaveLength(1);
      expect(probed[0]!.id).toBe(anchorId);
    });
  });

  test('anchoring content that survives only inside a tracked deletion does not resurrect its paragraph', async ({ given, when, then }: AllureBddContext) => {
    // A tracked comment-delete leaves the w:commentReference run under w:del
    // (with comments.xml untouched until the revision is accepted), and a
    // tracked image-delete wraps the w:drawing the same way. Deleted content
    // is invisible to the view's text extraction, so these paragraphs must
    // stay hidden exactly like fully-deleted text paragraphs.
    const minimalDrawing =
      `<w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
      `<wp:extent cx="914400" cy="914400"/></wp:inline></w:drawing>`;
    const documentXml = makeDocumentXml(
      `<w:p><w:r><w:t>Body before the deletions.</w:t></w:r></w:p>` +
        `<w:p><w:del w:id="9" w:author="A" w:date="2025-01-01T00:00:00Z">` +
        `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="1"/></w:r>` +
        `</w:del></w:p>` +
        `<w:p><w:del w:id="10" w:author="A" w:date="2025-01-01T00:00:00Z"><w:r>${minimalDrawing}</w:r></w:del></w:p>` +
        `<w:p><w:r><w:t>Body after the deletions.</w:t></w:r></w:p>`,
    );
    const commentsXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
      `<w:comment w:id="1" w:author="Reviewer" w:date="2025-01-01T00:00:00Z" w:initials="RV">` +
      `<w:p w14:paraId="33333333"><w:r><w:annotationRef/></w:r><w:r><w:t>Pending tracked delete.</w:t></w:r></w:p>` +
      `</w:comment>` +
      `</w:comments>`;

    let opened: Awaited<ReturnType<typeof openSession>>;
    let nodes: ViewNode[];

    await given('a document whose anchor-bearing paragraphs are wholly inside w:del wrappers', async () => {
      opened = await openSession([], {
        xml: documentXml,
        extraFiles: { 'word/comments.xml': commentsXml },
      });
    });

    await when('read_file renders the full document as JSON', async () => {
      nodes = await readJsonNodes(opened);
    });

    await then('only the two visible text paragraphs appear in the view', async () => {
      expect(nodes).toHaveLength(2);
      expect(nodes[0]!.clean_text).toBe('Body before the deletions.');
      expect(nodes[1]!.clean_text).toBe('Body after the deletions.');
    });
  });

  test('paragraphs whose only content is a drawing, picture, or embedded object are surfaced; spacing-only paragraphs stay hidden', async ({ given, when, then, and }: AllureBddContext) => {
    const minimalDrawing =
      `<w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
      `<wp:extent cx="914400" cy="914400"/></wp:inline></w:drawing>`;
    const documentXml = makeDocumentXml(
      `<w:p><w:r><w:t>Body before the images.</w:t></w:r></w:p>` +
        `<w:p><w:r>${minimalDrawing}</w:r></w:p>` +
        `<w:p><w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml"/></w:pict></w:r></w:p>` +
        `<w:p><w:r><w:object><v:shape xmlns:v="urn:schemas-microsoft-com:vml"/></w:object></w:r></w:p>` +
        `<w:p/>` +
        `<w:p><w:r><w:t>Body after the images.</w:t></w:r></w:p>`,
    );

    let opened: Awaited<ReturnType<typeof openSession>>;
    let nodes: ViewNode[];

    await given('a document with drawing-only, pict-only, object-only, and spacing-only paragraphs', async () => {
      opened = await openSession([], { xml: documentXml });
    });

    await when('read_file renders the full document as JSON', async () => {
      nodes = await readJsonNodes(opened);
    });

    await then('the three embedded-content paragraphs appear in the view and the spacing-only paragraph does not', async () => {
      expect(nodes).toHaveLength(5);
      expect(nodes[0]!.clean_text).toBe('Body before the images.');
      expect(nodes[1]!.clean_text).toBe('');
      expect(nodes[2]!.clean_text).toBe('');
      expect(nodes[3]!.clean_text).toBe('');
      expect(nodes[4]!.clean_text).toBe('Body after the images.');
    });

    await and('a node_ids probe for the drawing paragraph resolves it', async () => {
      const probed = await probeNodeId(opened, nodes[1]!.id);
      expect(probed).toHaveLength(1);
      expect(probed[0]!.id).toBe(nodes[1]!.id);
    });
  });
});

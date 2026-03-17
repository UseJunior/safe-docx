/**
 * E2E test helper — ephemeral Google Doc lifecycle management.
 *
 * Creates a test document via Drive API (impersonating via domain-wide
 * delegation) and cleans up in afterAll. If GOOGLE_TEST_DOC_ID is set,
 * uses that doc instead (skips create/delete).
 */
import { resolveCredentials } from '../../auth.js';
import type { GoogleApiClient } from '../../api-client.js';
import type { GoogleDocsCredentials } from '../../types.js';
import type { GoogleDocsDocument } from '../../document.js';

/**
 * Single source of truth for rich test document content.
 * Used by createRichTestDoc() for seeding and by E2E assertions for verification.
 */
export const RICH_DOC_CONTENT = {
  body: {
    paragraphOne: 'Paragraph one',
    paragraphTwo: 'Paragraph two',
    paragraphThreeEmoji: 'Paragraph three with emoji 🎉 and sparkles ✨',
    paragraphFourCjk: 'Paragraph four 日本語テスト',
  },
  afterTable: 'After table paragraph',
  table: {
    header: { name: 'Name', value: 'Value', notes: 'Notes' },
    row1: { name: 'Alpha', value: '100', notes: 'First entry' },
    row2: { name: 'Beta', value: '200', notes: 'Line one\nLine two' },
  },
  multiCellTexts: ['Line one', 'Line two'] as const,
} as const;

/**
 * Fetch the raw paragraphStyle for a paragraph matching `searchText`
 * by walking the raw Docs API response. Eliminates duplicated
 * fetch+walk+assert pattern in styling tests (E23, E24).
 */
export async function getRawParagraphStyle(
  doc: GoogleDocsDocument,
  docId: string,
  searchText: string,
): Promise<Record<string, unknown> | null> {
  const rawDoc = await doc.getClient().getDocument(docId);
  const tabs = (rawDoc as any).tabs ?? [];
  const bodyContent = tabs[0]?.documentTab?.body?.content ?? [];

  for (const el of bodyContent) {
    if (!el.paragraph) continue;
    let text = '';
    for (const run of el.paragraph.elements ?? []) {
      if (run.textRun?.content) text += run.textRun.content;
    }
    if (text.includes(searchText)) {
      return el.paragraph.paragraphStyle ?? null;
    }
  }
  return null;
}

export interface TestDocContext {
  docId: string;
  credentials: GoogleDocsCredentials;
  /** true if we created this doc (and should delete it) */
  isEphemeral: boolean;
  client: GoogleApiClient;
}

/**
 * Check if E2E tests should run.
 * Returns false if GOOGLE_SERVICE_ACCOUNT_KEY is not set.
 */
export function shouldRunE2E(): boolean {
  return !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
}

/**
 * Build credentials from env vars.
 */
export function buildCredentialsFromEnv(): GoogleDocsCredentials {
  return {
    type: 'service_account',
    serviceAccountKeyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    impersonateUser: process.env.GOOGLE_IMPERSONATE_USER,
  };
}

/**
 * Create an ephemeral test document via Drive API.
 * The doc is created as a Google Doc (MIME type: application/vnd.google-apps.document).
 */
export async function createTestDoc(
  credentials: GoogleDocsCredentials,
  title = 'safe-docx E2E test doc',
): Promise<TestDocContext> {
  const client = await resolveCredentials(credentials);

  // If GOOGLE_TEST_DOC_ID is set, use that doc (no create/delete)
  const existingDocId = process.env.GOOGLE_TEST_DOC_ID;
  if (existingDocId) {
    return { docId: existingDocId, credentials, isEphemeral: false, client };
  }

  // Create ephemeral doc via Drive
  const docId = await client.createFile(title, 'application/vnd.google-apps.document');

  // Seed the doc with some content via Docs API
  await client.batchUpdate(docId, {
    requests: [
      {
        insertText: {
          location: { index: 1 },
          text: 'Paragraph one\nParagraph two\nParagraph three with emoji 🎉\nParagraph four 日本語テスト\n',
        },
      },
      // Insert a table after the text
      {
        insertTable: {
          rows: 2,
          columns: 2,
          endOfSegmentLocation: {},
        },
      },
    ],
  });

  // Share with the logged-in user if different from impersonated user
  const shareWith = process.env.GOOGLE_SHARE_WITH;
  if (shareWith) {
    await client.shareFile(docId, shareWith, 'writer');
  }

  return { docId, credentials, isEphemeral: true, client };
}

/**
 * Create a rich ephemeral test document with a 3×3 table,
 * multi-paragraph cells, emoji, and CJK text.
 *
 * Structure:
 *   Paragraph one
 *   Paragraph two
 *   Paragraph three with emoji 🎉 and sparkles ✨
 *   Paragraph four 日本語テスト
 *   [3×3 table: header row + 2 data rows, one cell has 2 paragraphs]
 *   After table paragraph
 *
 * Seeding is 3-step:
 *   1. insertText at index 1 for body paragraphs
 *   2. insertTable (3 rows × 3 cols) at end of segment
 *   3. Fetch doc → discover cell indices → insertText per cell in reverse index order
 */
export async function createRichTestDoc(
  credentials: GoogleDocsCredentials,
  title = 'safe-docx E2E rich test doc',
): Promise<TestDocContext> {
  const client = await resolveCredentials(credentials);

  const existingDocId = process.env.GOOGLE_TEST_DOC_ID;
  if (existingDocId) {
    return { docId: existingDocId, credentials, isEphemeral: false, client };
  }

  // Create ephemeral doc via Drive
  const docId = await client.createFile(title, 'application/vnd.google-apps.document');

  // Step 1: Insert body paragraphs (no trailing \n — avoids empty paragraph before table)
  const { body, table } = RICH_DOC_CONTENT;
  const bodyText = [
    body.paragraphOne,
    body.paragraphTwo,
    body.paragraphThreeEmoji,
    body.paragraphFourCjk,
  ].join('\n');

  await client.batchUpdate(docId, {
    requests: [{
      insertText: {
        location: { index: 1 },
        text: bodyText,
      },
    }],
  });

  // Step 2: Insert 3×3 table at end of segment
  await client.batchUpdate(docId, {
    requests: [{
      insertTable: {
        rows: 3,
        columns: 3,
        endOfSegmentLocation: {},
      },
    }],
  });

  // Step 3: Fetch doc → discover cell paragraph indices → seed cells in reverse index order
  const docData = await client.getDocument(docId);

  const tabs = (docData as any).tabs ?? [];
  const docBody = tabs[0]?.documentTab?.body;
  if (!docBody?.content) throw new Error('Failed to read doc structure for cell seeding');

  const cellTexts = [
    [table.header.name, table.header.value, table.header.notes],
    [table.row1.name, table.row1.value, table.row1.notes],
    [table.row2.name, table.row2.value, table.row2.notes],
  ];

  const inserts: Array<{ index: number; text: string }> = [];
  let foundTable = false;

  for (const el of docBody.content) {
    if (el.table) {
      foundTable = true;
      for (let rowIdx = 0; rowIdx < (el.table.tableRows?.length ?? 0); rowIdx++) {
        const row = el.table.tableRows![rowIdx]!;
        for (let colIdx = 0; colIdx < (row.tableCells?.length ?? 0); colIdx++) {
          const cell = row.tableCells![colIdx]!;
          const firstPara = cell.content?.[0];
          if (firstPara?.startIndex != null) {
            inserts.push({
              index: firstPara.startIndex,
              text: cellTexts[rowIdx]?.[colIdx] ?? '',
            });
          }
        }
      }
    } else if (foundTable && el.paragraph) {
      // Trailing paragraph after the table
      if (el.startIndex != null) {
        inserts.push({ index: el.startIndex, text: RICH_DOC_CONTENT.afterTable });
      }
      break;
    }
  }

  // Sort in reverse index order (highest first) to prevent index drift
  inserts.sort((a, b) => b.index - a.index);

  if (inserts.length > 0) {
    await client.batchUpdate(docId, {
      requests: inserts.map(ins => ({
        insertText: {
          location: { index: ins.index },
          text: ins.text,
        },
      })),
    });
  }

  // Share with the logged-in user if specified
  const shareWith = process.env.GOOGLE_SHARE_WITH;
  if (shareWith) {
    await client.shareFile(docId, shareWith, 'writer');
  }

  return { docId, credentials, isEphemeral: true, client };
}

/**
 * Delete the ephemeral test document.
 */
export async function deleteTestDoc(ctx: TestDocContext): Promise<void> {
  if (!ctx.isEphemeral) return;
  if (process.env.KEEP_TEST_DOC) {
    console.log(`\n[E2E] KEEP_TEST_DOC set — skipping deletion.`);
    console.log(`[E2E] Doc URL: https://docs.google.com/document/d/${ctx.docId}/edit\n`);
    return;
  }
  try {
    await ctx.client.deleteFile(ctx.docId);
  } catch (err) {
    // Best effort — don't fail the suite on cleanup errors
    console.warn(`[E2E cleanup] Failed to delete doc ${ctx.docId}:`, err);
  }
}

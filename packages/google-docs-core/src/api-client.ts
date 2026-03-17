/**
 * Fetch-based Google API client — replaces the 110 MB googleapis package.
 *
 * Uses google-auth-library for token management and native fetch for HTTP.
 * All non-2xx responses throw GoogleApiError to preserve the error contract
 * expected by mapGoogleError() / withRetry() in errors.ts.
 */
import type { GDocsDocument, GDocsBatchUpdateResponse, GDocsRequest } from './google-api-types.js';

const DOCS_BASE = 'https://docs.googleapis.com/v1/documents';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3/files';

/**
 * Error class that preserves the contract expected by mapGoogleError() / withRetry().
 * extractHttpCode() checks error.code and error.response.status.
 */
export class GoogleApiError extends Error {
  code: number;
  response: { status: number; headers?: Headers };
  body?: unknown;

  constructor(status: number, message: string, body?: unknown, headers?: Headers) {
    super(message);
    this.name = 'GoogleApiError';
    this.code = status;
    this.response = { status, headers };
    this.body = body;
  }
}

export type BatchUpdateBody = {
  requests: GDocsRequest[];
  writeControl?: { requiredRevisionId?: string };
};

/**
 * Lightweight Google API client backed by native fetch.
 *
 * Covers the 6 endpoints used by google-docs-core:
 * - Docs: getDocument, batchUpdate
 * - Drive: createFile, deleteFile, shareFile, exportAsDocx
 */
export class GoogleApiClient {
  constructor(private getAccessToken: () => Promise<string>) {}

  /** GET documents/{id}?includeTabsContent=true */
  async getDocument(documentId: string): Promise<GDocsDocument> {
    const url = `${DOCS_BASE}/${encodeURIComponent(documentId)}?includeTabsContent=true`;
    return this.fetchJson<GDocsDocument>(url);
  }

  /** POST documents/{id}:batchUpdate */
  async batchUpdate(documentId: string, body: BatchUpdateBody): Promise<GDocsBatchUpdateResponse> {
    const url = `${DOCS_BASE}/${encodeURIComponent(documentId)}:batchUpdate`;
    return this.fetchJson<GDocsBatchUpdateResponse>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /** POST drive/v3/files — create a file, return the file ID */
  async createFile(name: string, mimeType: string): Promise<string> {
    const url = `${DRIVE_BASE}?fields=id`;
    const result = await this.fetchJson<{ id?: string }>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType }),
    });
    if (!result.id) throw new Error('Drive createFile: no ID returned');
    return result.id;
  }

  /** DELETE drive/v3/files/{id} */
  async deleteFile(fileId: string): Promise<void> {
    const url = `${DRIVE_BASE}/${encodeURIComponent(fileId)}`;
    await this.fetchRaw(url, { method: 'DELETE' });
  }

  /** POST drive/v3/files/{id}/permissions — share a file */
  async shareFile(fileId: string, email: string, role: string): Promise<void> {
    const url = `${DRIVE_BASE}/${encodeURIComponent(fileId)}/permissions`;
    await this.fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, type: 'user', emailAddress: email }),
    });
  }

  /**
   * GET drive/v3/files/{id}/export?mimeType=application/vnd.openxmlformats-officedocument.wordprocessingml.document
   *
   * Exports a Google Doc as a DOCX file. Returns the raw bytes as a Buffer.
   *
   * **Note:** The Drive export API has a 10 MB limit for Google Workspace files.
   * Files exceeding this limit will return an error.
   */
  async exportAsDocx(fileId: string): Promise<Buffer> {
    const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const params = new URLSearchParams({ mimeType });
    const url = `${DRIVE_BASE}/${encodeURIComponent(fileId)}/export?${params.toString()}`;
    const response = await this.fetchRaw(url);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // ── Internal fetch helpers ─────────────────────────────────────────

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchRaw(url, init);
    return response.json() as Promise<T>;
  }

  private async fetchRaw(url: string, init?: RequestInit): Promise<Response> {
    const token = await this.getAccessToken();
    if (!token) {
      throw new Error(
        'AUTH_ERROR: getAccessToken() returned null/undefined. ' +
        'Check credentials configuration.',
      );
    }

    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);

    const response = await fetch(url, { ...init, headers });

    if (!response.ok) {
      let body: unknown;
      let message: string;
      try {
        body = await response.json();
        message = (body as Record<string, Record<string, string>>)?.error?.message
          ?? JSON.stringify(body);
      } catch {
        message = response.statusText || `HTTP ${response.status}`;
      }
      throw new GoogleApiError(response.status, message, body, response.headers);
    }

    return response;
  }
}

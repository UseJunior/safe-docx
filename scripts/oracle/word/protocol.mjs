import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const PROTOCOL_VERSION = 1;
export const DEFAULT_MAX_DOCX_BYTES = 64 * 1024 * 1024;
export const DEFAULT_SLICE_BYTES = 512 * 1024;

export class OracleProtocolError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = 'OracleProtocolError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function createCredentials() {
  return {
    jobId: randomUUID(),
    token: randomBytes(32).toString('base64url'),
  };
}

export function normalizeCompareOptions(options = {}) {
  const booleanKeys = [
    'compareCaseChanges',
    'compareFieldCodes',
    'compareFormatting',
    'compareMoves',
    'compareTables',
    'compareWhitespace',
    'compareWordChanges',
  ];
  const normalized = { compareTarget: 'Current' };
  for (const key of booleanKeys) {
    if (options[key] !== undefined) {
      if (typeof options[key] !== 'boolean') {
        throw new OracleProtocolError('INVALID_OPTIONS', `${key} must be boolean`);
      }
      normalized[key] = options[key];
    }
  }
  if (options.authorName !== undefined) {
    if (typeof options.authorName !== 'string' || options.authorName.length > 255) {
      throw new OracleProtocolError('INVALID_OPTIONS', 'authorName must be a string of at most 255 characters');
    }
    normalized.authorName = options.authorName;
  }
  return normalized;
}

function decodedLength(base64) {
  if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new OracleProtocolError('INVALID_BASE64', 'slice data must be canonical base64');
  }
  return Buffer.byteLength(base64, 'base64');
}

export class WordOracleJob {
  constructor({ revisedBytes, original, options, maxDocxBytes = DEFAULT_MAX_DOCX_BYTES, credentials = createCredentials() }) {
    if (!Buffer.isBuffer(revisedBytes)) throw new TypeError('revisedBytes must be a Buffer');
    if (revisedBytes.length > maxDocxBytes) {
      throw new OracleProtocolError('PAYLOAD_TOO_LARGE', 'revised DOCX exceeds the configured size limit', 413);
    }
    this.jobId = credentials.jobId;
    this.token = credentials.token;
    this.revisedBytes = revisedBytes;
    if (!original || typeof original.sha256 !== 'string' || !Number.isSafeInteger(original.bytes) || typeof original.stagedFileName !== 'string') {
      throw new TypeError('original metadata with sha256, bytes, and stagedFileName is required');
    }
    this.original = { sha256: original.sha256, bytes: original.bytes, stagedFileName: original.stagedFileName };
    this.options = normalizeCompareOptions(options);
    this.maxDocxBytes = maxDocxBytes;
    this.status = 'pending';
    this.host = null;
    this.failure = null;
    this.slices = [];
    this.expectedSlices = null;
    this.resultBytes = null;
  }

  authorize(token) {
    if (token !== this.token) throw new OracleProtocolError('UNAUTHORIZED', 'invalid capability token', 401);
    if (this.status === 'succeeded' || this.status === 'failed' || this.status === 'expired') {
      throw new OracleProtocolError('JOB_TERMINAL', 'job is already terminal', 409);
    }
  }

  claim({ jobId, host }) {
    if (jobId !== this.jobId) throw new OracleProtocolError('UNKNOWN_JOB', 'unknown job identifier', 404);
    if (this.status !== 'pending') throw new OracleProtocolError('INVALID_STATE', 'job cannot be claimed', 409);
    if (!host || typeof host !== 'object') throw new OracleProtocolError('INVALID_HOST', 'host metadata is required');
    this.host = sanitizeHost(host);
    this.status = 'claimed';
    return {
      protocolVersion: PROTOCOL_VERSION,
      jobId: this.jobId,
      options: this.options,
      original: this.original,
      revisedBase64: this.revisedBytes.toString('base64'),
      maxResultBytes: this.maxDocxBytes,
      sliceBytes: DEFAULT_SLICE_BYTES,
    };
  }

  uploadSlice({ jobId, index, total, data }) {
    if (jobId !== this.jobId) throw new OracleProtocolError('UNKNOWN_JOB', 'unknown job identifier', 404);
    if (this.status !== 'claimed' && this.status !== 'uploading') {
      throw new OracleProtocolError('INVALID_STATE', 'job is not accepting result slices', 409);
    }
    if (!Number.isSafeInteger(index) || index < 0 || !Number.isSafeInteger(total) || total < 1) {
      throw new OracleProtocolError('INVALID_SLICE', 'slice index and total must be positive integers');
    }
    const expectedSlices = this.expectedSlices ?? total;
    if (total !== expectedSlices || index !== this.slices.length || index >= total) {
      throw new OracleProtocolError('OUT_OF_ORDER_SLICE', 'result slices must arrive once, in order', 409);
    }
    const size = decodedLength(data);
    const accumulated = this.slices.reduce((sum, slice) => sum + slice.length, 0);
    if (accumulated + size > this.maxDocxBytes) {
      throw new OracleProtocolError('PAYLOAD_TOO_LARGE', 'result DOCX exceeds the configured size limit', 413);
    }
    if (this.expectedSlices === null) this.expectedSlices = total;
    this.slices.push(Buffer.from(data, 'base64'));
    this.status = 'uploading';
    return { accepted: index, remaining: total - index - 1 };
  }

  complete({ jobId }) {
    if (jobId !== this.jobId) throw new OracleProtocolError('UNKNOWN_JOB', 'unknown job identifier', 404);
    if (this.status !== 'uploading' || this.slices.length !== this.expectedSlices) {
      throw new OracleProtocolError('INCOMPLETE_UPLOAD', 'all result slices must arrive before completion', 409);
    }
    const result = Buffer.concat(this.slices);
    assertDocxSignature(result);
    this.resultBytes = result;
    this.status = 'succeeded';
    return result;
  }

  fail({ jobId, code, message }) {
    if (jobId !== this.jobId) throw new OracleProtocolError('UNKNOWN_JOB', 'unknown job identifier', 404);
    if (!['pending', 'claimed', 'uploading'].includes(this.status)) {
      throw new OracleProtocolError('JOB_TERMINAL', 'job is already terminal', 409);
    }
    this.failure = {
      code: typeof code === 'string' && code ? code.slice(0, 80) : 'WORD_ERROR',
      message: typeof message === 'string' ? message.slice(0, 1000) : 'Word comparison failed',
    };
    this.status = 'failed';
  }

  expire() {
    if (!['succeeded', 'failed'].includes(this.status)) this.status = 'expired';
  }
}

export function assertDocxSignature(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new OracleProtocolError('INVALID_DOCX', 'result is not a ZIP-based DOCX package', 422);
  }
}

function sanitizeHost(host) {
  const pick = (value, max = 160) => (typeof value === 'string' ? value.slice(0, max) : null);
  return {
    host: pick(host.host),
    platform: pick(host.platform),
    version: pick(host.version),
    wordApiDesktop11: host.wordApiDesktop11 === true,
  };
}

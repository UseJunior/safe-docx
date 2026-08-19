export function parseJobUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'localhost' || url.port !== '38491') {
    throw new Error('Use the exact https://localhost:38491 task-pane job URL printed by the CLI.');
  }
  const params = new URLSearchParams(url.hash.slice(1));
  const bridge = new URL(params.get('bridge'));
  if (bridge.protocol !== 'https:' || !['127.0.0.1', 'localhost'].includes(bridge.hostname)) {
    throw new Error('The bridge must use HTTPS on loopback.');
  }
  const jobId = params.get('job');
  const token = params.get('token');
  if (!jobId || !token) throw new Error('The job URL is missing credentials.');
  return { bridge: bridge.origin, jobId, token };
}

export function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function diagnosticFor(error) {
  const code = typeof error?.code === 'string' ? error.code : typeof error?.name === 'string' ? error.name : 'WORD_ERROR';
  const message = typeof error?.message === 'string' ? error.message : String(error);
  return { code: code.slice(0, 80), message: message.slice(0, 1000) };
}

export function assertCurrentDocumentUrl(urlValue, expectedFileName) {
  if (typeof urlValue !== 'string' || !urlValue) {
    throw Object.assign(new Error('Word did not expose the current document URL; refusing an unverified comparison.'), { code: 'CURRENT_DOCUMENT_UNVERIFIED' });
  }
  let actual;
  try {
    const url = new URL(urlValue);
    actual = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? '');
  } catch {
    actual = urlValue.split(/[\\/]/).at(-1);
  }
  if (actual !== expectedFileName) {
    throw Object.assign(new Error(`Open the staged original named ${expectedFileName}; the active document is ${actual || 'unknown'}.`), { code: 'WRONG_CURRENT_DOCUMENT' });
  }
}

export function connectionFromDocumentUrl(urlValue) {
  if (typeof urlValue !== 'string' || !urlValue) return null;
  let fileName;
  try {
    const url = new URL(urlValue);
    fileName = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? '');
  } catch {
    fileName = urlValue.split(/[\\/]/).at(-1);
  }
  const match = /^safe-docx-word-oracle--p(\d{1,5})--j([0-9a-f-]{36})--t([A-Za-z0-9_-]{20,})--/.exec(fileName ?? '');
  if (!match) return null;
  const port = Number(match[1]);
  if (port < 1 || port > 65535) return null;
  return { bridge: `https://localhost:${port}`, jobId: match[2], token: match[3] };
}

import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { OracleProtocolError } from './protocol.mjs';

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

export async function startBridge({ job, certPath, keyPath, insecureForTests = false, host = '127.0.0.1', port = 0 }) {
  const handler = createHandler(job);
  const server = insecureForTests
    ? createHttpServer(handler)
    : createHttpsServer({ cert: await readFile(certPath), key: await readFile(keyPath) }, handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const scheme = insecureForTests ? 'http' : 'https';
  return {
    origin: `${scheme}://${insecureForTests ? host : 'localhost'}:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

export function createHandler(job) {
  return async (request, response) => {
    setCors(response);
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    try {
      const url = new URL(request.url, 'https://127.0.0.1');
      const token = bearerToken(request.headers.authorization);
      job.authorize(token);
      const body = request.method === 'GET' ? {} : await readJson(request);
      let result;
      if (request.method === 'POST' && url.pathname === '/v1/job/claim') result = job.claim(body);
      else if (request.method === 'POST' && url.pathname === '/v1/job/result/slice') result = job.uploadSlice(body);
      else if (request.method === 'POST' && url.pathname === '/v1/job/result/complete') {
        job.complete(body);
        result = { status: job.status };
      } else if (request.method === 'POST' && url.pathname === '/v1/job/fail') {
        job.fail(body);
        result = { status: job.status };
      } else throw new OracleProtocolError('NOT_FOUND', 'unknown bridge endpoint', 404);
      sendJson(response, 200, result);
    } catch (error) {
      const known = error instanceof OracleProtocolError;
      sendJson(response, known ? error.httpStatus : 500, {
        error: known ? error.code : 'INTERNAL_ERROR',
        message: known ? error.message : 'bridge request failed',
      });
    }
  };
}

function bearerToken(value) {
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7) : '';
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new OracleProtocolError('REQUEST_TOO_LARGE', 'request body is too large', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new OracleProtocolError('INVALID_JSON', 'request body must be JSON');
  }
}

function setCors(response) {
  response.setHeader('Access-Control-Allow-Origin', 'https://localhost:38491');
  response.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Cache-Control', 'no-store');
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

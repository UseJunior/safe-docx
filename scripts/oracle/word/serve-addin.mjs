#!/usr/bin/env node
import { createServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  cert: { type: 'string' }, key: { type: 'string' }, port: { type: 'string', default: '38491' },
} });
if (!values.cert || !values.key) throw new Error('--cert and --key are required');
const root = fileURLToPath(new URL('.', import.meta.url));
const icon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAFoAAABaCAYAAAA4qEECAAAAAXNSR0IArs4c6QAAAKVJREFUeF7t0AEJAAAMBKFD/Xv7GZiwgSTX3Qe8VcQqYhWxilhFrCJWEauIVcQqYhWxilhFrCJWEauIVcQqYhWxilhFrCJWEauIVcQqYhWxilhFrCJWEauIVcQqYhWxilhFrCJWEauIVcQqYhWxilhFrCJWEauIVcQqYhWxilhFrCJWEauIVcQqYhWxilhFrCJWEauIVcQqYhWxilhFrCJWEauIVcQqYhWxilhFrCJWEauIVcQq8gBFBgGz6BimuwAAAABJRU5ErkJggg==', 'base64');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };

const server = createServer({ cert: await readFile(resolve(values.cert)), key: await readFile(resolve(values.key)) }, async (request, response) => {
  try {
    const pathname = new URL(request.url, 'https://localhost').pathname;
    if (pathname === '/assets/icon-32.png' || pathname === '/assets/icon-80.png') {
      response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }).end(icon);
      return;
    }
    const allowed = new Set(['/taskpane.html', '/taskpane.js', '/taskpane-core.mjs', '/manifest.xml']);
    if (!allowed.has(pathname)) { response.writeHead(404).end('Not found'); return; }
    const bytes = await readFile(resolve(root, pathname.slice(1)));
    response.writeHead(200, { 'content-type': mime[extname(pathname)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(bytes);
  } catch {
    response.writeHead(500).end('Unable to serve add-in asset');
  }
});
server.listen(Number(values.port), '127.0.0.1', () => {
  console.log(`Word oracle add-in served at https://localhost:${values.port}/taskpane.html`);
  console.log(`Manifest: https://localhost:${values.port}/manifest.xml`);
});

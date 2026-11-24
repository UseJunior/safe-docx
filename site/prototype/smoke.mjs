import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DocxArchive, parseXml } from '@usejunior/docx-core';
import { acceptAllChanges, rejectAllChanges } from '@usejunior/docx-compare';
import { chromium } from 'playwright';

const route = '/labs/docx-compare';
const fixture = name => fileURLToPath(new URL('../../' + name, import.meta.url));
const goodPair = ['source.docx', 'revised.docx']
  .map(name => fixture('tests/test_documents/text-box/' + name));
const badPair = [
  'ILPA-Model-Limited-Partnership-Agreement-WOF_v2.docx',
  'ILPA-Model-Limited-Parnership-Agreement-Deal-By-Deal_v1.docx',
].map(name => fixture('tests/test_documents/redline/' + name));

async function serveBuild() {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url)));
  const headers = Object.fromEntries(config.headers.at(-1).headers.map(({ key, value }) => [key, value]));
  const types = { 'index.html': 'text/html', 'demo.css': 'text/css', 'demo.js': 'text/javascript',
    'worker.js': 'text/javascript' };
  const server = createServer(async (request, response) => {
    const file = request.url === route ? 'index.html' : request.url.slice(route.length + 1);
    if (!Object.hasOwn(types, file) || !request.url.startsWith(route)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const bytes = await readFile(new URL('../_site' + route + '/' + file, import.meta.url));
      response.writeHead(200, { ...headers, 'Content-Type': types[file] }).end(bytes);
    } catch {
      response.writeHead(500).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

async function text(bytes, project = xml => xml) {
  const xml = await (await DocxArchive.load(bytes)).getDocumentXml();
  return Array.from(parseXml(project(xml)).getElementsByTagName('w:t'), element => element.textContent).join('');
}

const production = process.argv.includes('--production');
const server = production ? undefined : await serveBuild();
const origin = production ? 'https://safedocx.com' : 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.SDX_CHROMIUM });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const requests = [];
  const errors = [];
  page.on('request', request => requests.push(request));
  page.on('pageerror', error => errors.push(error));
  const response = await page.goto(origin + route);
  assert.equal(response?.status(), 200);
  assert.match(response.headers()['x-robots-tag'], /noindex/u);
  assert.match(response.headers()['content-security-policy'], /default-src 'none'/u);
  const original = page.locator('#original');
  const revised = page.locator('#revised');
  const compare = page.getByRole('button', { name: 'Compare documents' });
  const download = page.getByRole('link', { name: 'Download redline' });
  const status = page.getByRole('status');
  assert.equal(await compare.isDisabled(), true);

  async function checkDownload() {
    const pending = page.waitForEvent('download');
    await download.click();
    const downloaded = await pending;
    const output = await readFile(await downloaded.path());
    const [before, after] = await Promise.all(goodPair.map(file => readFile(file)));
    assert.match(await status.textContent(), /redline is ready/u);
    assert.equal(await text(output, rejectAllChanges), await text(before));
    assert.equal(await text(output, acceptAllChanges), await text(after));
  }

  await original.setInputFiles(goodPair[0]);
  await revised.setInputFiles(goodPair[1]);
  await compare.click();
  await checkDownload();

  await original.setInputFiles(badPair[0]);
  await revised.setInputFiles(badPair[1]);
  await compare.click();
  await page.getByText('No redline was created.', { exact: false }).waitFor({ timeout: 180_000 });
  assert.equal(await download.count(), 0);
  assert.deepEqual(errors, []);
  const assetPaths = new Set([route, ...['demo.js', 'demo.css', 'worker.js'].map(file => route + '/' + file)]);
  for (const request of requests) {
    const url = new URL(request.url());
    assert.equal(request.method(), 'GET');
    assert.equal(request.postData(), null);
    assert.equal(url.origin, origin);
    assert.equal(url.search, '');
    assert.ok(assetPaths.has(url.pathname), 'Unexpected browser request: ' + url.pathname);
  }
  console.log('Passed: browser local-file round trip and refusal without a download or upload.');
} finally {
  await browser?.close();
  server?.close();
}

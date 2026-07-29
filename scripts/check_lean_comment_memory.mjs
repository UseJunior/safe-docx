import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import JSZip from 'jszip';

const W_NS =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PAYLOAD_BYTES = 16_775_168;
const MAX_RSS_BYTES = 1.5 * 1024 * 1024 * 1024;
const TIMEOUT_MS = 120_000;
const CHECKER = resolve(
  'verification/lean/.lake/build/bin/leanDocxChecker',
);

function packageXml(payloadKind) {
  if (payloadKind === 'small') {
    return `<w:comments xmlns:w="${W_NS}">` +
      '<w:comment w:id="7"><w:p/></w:comment></w:comments>';
  }
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const output = Buffer.allocUnsafe(PAYLOAD_BYTES);
  let state = payloadKind === 'text' ? 0x7101 : 0x7102;
  for (let index = 0; index < output.length; index++) {
    if (index % 4 === 0) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      output[index] = alphabet.charCodeAt((state >>> 0) % alphabet.length);
    } else {
      output[index] = 120;
    }
  }
  const payload = output.toString('ascii');
  const comment = payloadKind === 'text'
    ? `<w:comment w:id="7"><w:p><w:r><w:t>${payload}</w:t></w:r></w:p></w:comment>`
    : `<w:comment w:id="7" w:author="${payload}"><w:p/></w:comment>`;
  return `<w:comments xmlns:w="${W_NS}">${comment}</w:comments>`;
}

async function buildPackage(payloadKind) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '</Types>',
  );
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="${W_NS}"><w:body><w:p><w:r>` +
      '<w:commentReference w:id="7"/>' +
      '</w:r></w:p><w:sectPr/></w:body></w:document>',
  );
  zip.file(
    'word/_rels/document.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rIdComments" Type="${R_NS}/comments" Target="comments.xml"/>` +
      '</Relationships>',
  );
  zip.file('word/comments.xml', packageXml(payloadKind));
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) delete zip.files[entry.name];
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

function timingCommand() {
  if (process.platform === 'darwin') {
    return 'ulimit -s 8192; exec /usr/bin/time -l "$SAFE_DOCX_CHECKER"';
  }
  return 'ulimit -s 8192; exec /usr/bin/time -f "SAFE_DOCX_TIME:%e:%M" "$SAFE_DOCX_CHECKER"';
}

function parseMetrics(stderr) {
  if (process.platform === 'darwin') {
    const wall = /\s([0-9.]+) real/.exec(stderr);
    const rss = /(\d+)\s+maximum resident set size/.exec(stderr);
    if (!wall || !rss) throw new Error(`unable to parse macOS time output:\n${stderr}`);
    return { wallSeconds: Number(wall[1]), peakRssBytes: Number(rss[1]) };
  }
  const match = /SAFE_DOCX_TIME:([0-9.]+):(\d+)/.exec(stderr);
  if (!match) throw new Error(`unable to parse GNU time output:\n${stderr}`);
  return {
    wallSeconds: Number(match[1]),
    peakRssBytes: Number(match[2]) * 1024,
  };
}

function runChecker(request, scratch) {
  return new Promise((resolveRun, reject) => {
    const child = spawn('/bin/sh', ['-c', timingCommand()], {
      detached: true,
      env: {
        ...process.env,
        SAFE_DOCX_CHECKER: CHECKER,
        SAFE_DOCX_LEAN_TEMP_ROOT: scratch,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      process.kill(-child.pid, 'SIGKILL');
    }, TIMEOUT_MS);
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      const errorText = Buffer.concat(stderr).toString('utf8');
      if (timedOut) {
        reject(new Error(`checker exceeded ${TIMEOUT_MS}ms`));
      } else if (code !== 0) {
        reject(new Error(
          `checker exited ${code}:\n${errorText}\n${Buffer.concat(stdout)}`,
        ));
      } else {
        resolveRun({
          response: Buffer.concat(stdout).toString('utf8'),
          ...parseMetrics(errorText),
        });
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

async function measure(payloadKind) {
  const scratch = await mkdtemp(join(tmpdir(), `safe-docx-lean-${payloadKind}-`));
  try {
    const path = join(scratch, `${payloadKind}.docx`);
    const smallPath = join(scratch, 'small.docx');
    await Promise.all([
      writeFile(path, await buildPackage(payloadKind)),
      writeFile(smallPath, await buildPackage('small')),
    ]);
    const result = await runChecker({
      protocolVersion: 6,
      originalDocxPath: path,
      revisedDocxPath: smallPath,
      comparedDocxPath: smallPath,
    }, scratch);
    const parsed = JSON.parse(result.response);
    if (parsed.protocolVersion !== 6 || parsed.passed !== true) {
      throw new Error(`${payloadKind} checker response was not a protocol-v6 pass`);
    }
    if (result.peakRssBytes >= MAX_RSS_BYTES) {
      throw new Error(
        `${payloadKind} peak RSS ${result.peakRssBytes} exceeded ${MAX_RSS_BYTES}`,
      );
    }
    return result;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

for (const payloadKind of ['text', 'attribute']) {
  const result = await measure(payloadKind);
  console.log(JSON.stringify({
    payloadKind,
    payloadBytes: PAYLOAD_BYTES,
    wallSeconds: result.wallSeconds,
    peakRssBytes: result.peakRssBytes,
    maxRssBytes: MAX_RSS_BYTES,
    timeoutMs: TIMEOUT_MS,
  }));
}

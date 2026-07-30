import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const IRRELEVANT_EVENT_COUNT = Number.parseInt(
  process.env.SAFE_DOCX_IRRELEVANT_EVENT_COUNT ?? '200000',
  10,
);
const CHECKER = resolve(
  'verification/lean/.lake/build/bin/leanDocxChecker',
);

function packageXml(payloadKind) {
  if (payloadKind === 'small' || payloadKind === 'small-topology' ||
      payloadKind === 'irrelevant-events' ||
      payloadKind === 'early-crossing' || payloadKind === 'late-crossing' ||
      payloadKind === 'missing-relationship-early') {
    return `<w:comments xmlns:w="${W_NS}">` +
      '<w:comment w:id="7"><w:p/></w:comment></w:comments>';
  }
  if (payloadKind === 'maximum-markers') {
    return `<w:comments xmlns:w="${W_NS}">` +
      Array.from({ length: 4096 }, (_, id) =>
        `<w:comment w:id="${id}"><w:p/></w:comment>`).join('') +
      '</w:comments>';
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
  const crossingMarkers = '<w:commentRangeStart w:id="7"/>'.repeat(4097);
  if (IRRELEVANT_EVENT_COUNT % 8 !== 0) {
    throw new Error('irrelevant event count must be divisible by eight');
  }
  const topologyPayload = payloadKind === 'small-topology' ||
    payloadKind === 'irrelevant-events' ||
    payloadKind === 'early-crossing' || payloadKind === 'late-crossing' ||
    payloadKind === 'missing-relationship-early';
  const irrelevantStoryEvents = '<x:ignored/>x'.repeat(
    IRRELEVANT_EVENT_COUNT / 8,
  );
  const body = payloadKind === 'maximum-markers'
    ? Array.from({ length: 4096 }, (_, id) =>
      `<w:commentRangeStart w:id="${id}"/>`).join('') +
      Array.from({ length: 4096 }, (_, id) =>
        `<w:commentRangeEnd w:id="${id}"/>`).join('') +
      Array.from({ length: 4096 }, (_, id) =>
        `<w:r><w:commentReference w:id="${id}"/></w:r>`).join('')
    : payloadKind === 'irrelevant-events'
      ? '<w:r><w:commentReference w:id="7"/></w:r>' +
        irrelevantStoryEvents
    : payloadKind === 'early-crossing'
      ? crossingMarkers + irrelevantStoryEvents
    : payloadKind === 'late-crossing'
      ? irrelevantStoryEvents
    : payloadKind === 'missing-relationship-early'
      ? '<w:commentRangeStart w:id="7"/>' + irrelevantStoryEvents
    : '<w:r><w:commentReference w:id="7"/></w:r>';
  const headerReferences = topologyPayload
    ? '<w:headerReference w:type="default" r:id="rIdHeaderDefault"/>' +
      '<w:headerReference w:type="even" r:id="rIdHeaderEven"/>' +
      '<w:headerReference w:type="first" r:id="rIdHeaderFirst"/>'
    : '';
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:x="urn:safe-docx:irrelevant">` +
      `<w:body><w:p>${body}</w:p><w:sectPr>${headerReferences}</w:sectPr>` +
      '</w:body></w:document>',
  );
  const headerRelationships = topologyPayload
    ? `<Relationship Id="rIdHeaderDefault" Type="${R_NS}/header" Target="header1.xml"/>` +
      `<Relationship Id="rIdHeaderEven" Type="${R_NS}/header" Target="header2.xml"/>` +
      `<Relationship Id="rIdHeaderFirst" Type="${R_NS}/header" Target="header3.xml"/>`
    : '';
  zip.file(
    'word/_rels/document.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      (payloadKind === 'missing-relationship-early' ? '' :
        `<Relationship Id="rIdComments" Type="${R_NS}/comments" Target="comments.xml"/>`) +
      headerRelationships +
      '</Relationships>',
  );
  if (topologyPayload) {
    for (let index = 1; index <= 3; index++) {
      const terminalCrossing = payloadKind === 'late-crossing' && index === 3
        ? crossingMarkers
        : '';
      const headerEvents = payloadKind === 'small-topology'
        ? ''
        : irrelevantStoryEvents;
      zip.file(
        `word/header${index}.xml`,
        `<w:hdr xmlns:w="${W_NS}" xmlns:x="urn:safe-docx:irrelevant">` +
          `<w:p>${headerEvents}${terminalCrossing}</w:p></w:hdr>`,
      );
    }
  }
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

async function addNvcaCommentTopology(source) {
  const zip = await JSZip.loadAsync(source);
  const relationshipsPath = 'word/_rels/document.xml.rels';
  const relationshipsEntry = zip.file(relationshipsPath);
  const documentEntry = zip.file('word/document.xml');
  if (!relationshipsEntry || !documentEntry) {
    throw new Error('NVCA fixture lacks the conventional Main Document parts');
  }
  const relationships = await relationshipsEntry.async('string');
  if (relationships.includes(`${R_NS}/comments`)) {
    throw new Error('NVCA fixture unexpectedly already selects legacy comments');
  }
  zip.file(
    relationshipsPath,
    relationships.replace(
      '</Relationships>',
      `<Relationship Id="rIdLean729Comments" Type="${R_NS}/comments" ` +
        'Target="comments-lean-729.xml"/></Relationships>',
    ),
  );
  zip.file(
    'word/comments-lean-729.xml',
    `<w:comments xmlns:w="${W_NS}">` +
      [710, 711, 712, 713, 714, 715]
        .map((id) => `<w:comment w:id="${id}"><w:p/></w:comment>`)
        .join('') +
      '</w:comments>',
  );
  const documentXml = await documentEntry.async('string');
  zip.file(
    'word/document.xml',
    documentXml.replace(
      '</w:p>',
      '<w:commentRangeStart w:id="710"/>' +
        '<w:r><w:t>NVCA comment range</w:t></w:r>' +
        '<w:commentRangeEnd w:id="710"/>' +
        '<w:r><w:commentReference w:id="710"/></w:r></w:p>',
    ),
  );
  const retainedStories = [
    ['word/header1.xml', '</w:hdr>', 712,
      '<w:p><w:r><w:t>NVCA header range</w:t></w:r></w:p>'],
    ['word/footer1.xml', '</w:ftr>', 713,
      '<w:p><w:r><w:t>NVCA footer range</w:t></w:r></w:p>'],
    ['word/footnotes.xml', '</w:footnotes>', 714,
      '<w:footnote w:id="1000"><w:p></w:p></w:footnote>'],
    ['word/endnotes.xml', '</w:endnotes>', 715,
      '<w:endnote w:id="1000"><w:p></w:p></w:endnote>'],
  ];
  for (const [partPath, closing, id, container] of retainedStories) {
    const entry = zip.file(partPath);
    if (!entry) throw new Error(`NVCA fixture lacks ${partPath}`);
    const xml = await entry.async('string');
    const ranged = container
      .replace('<w:p>', `<w:p><w:commentRangeStart w:id="${id}"/>`)
      .replace(
        '</w:p>',
        `<w:commentRangeEnd w:id="${id}"/>` +
          `<w:r><w:commentReference w:id="${id}"/></w:r></w:p>`,
      );
    zip.file(partPath, xml.replace(closing, `${ranged}${closing}`));
  }
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
    const topologyPayload = payloadKind === 'irrelevant-events' ||
      payloadKind === 'early-crossing' || payloadKind === 'late-crossing' ||
      payloadKind === 'missing-relationship-early';
    const nvca = payloadKind === 'nvca-comment-topology'
      ? await addNvcaCommentTopology(
        await readFile(resolve('tests/test_documents/nvca-regression/source.docx')),
      )
      : null;
    await Promise.all([
      writeFile(path, nvca ?? await buildPackage(payloadKind)),
      writeFile(
        smallPath,
        nvca ?? await buildPackage(topologyPayload ? 'small-topology' : 'small'),
      ),
    ]);
    const result = await runChecker({
      protocolVersion: 7,
      originalDocxPath: path,
      revisedDocxPath: smallPath,
      comparedDocxPath: smallPath,
    }, scratch);
    const parsed = JSON.parse(result.response);
    const crossing = payloadKind === 'early-crossing' ||
      payloadKind === 'late-crossing';
    const missingRelationship = payloadKind === 'missing-relationship-early';
    if (parsed.protocolVersion !== 7 ||
        parsed.passed !== !(crossing || missingRelationship) ||
        parsed.checker !==
          'safe-docx-lean-conventional-main-comment-range-integrity-checker') {
      throw new Error(
        `${payloadKind} checker response had an unexpected protocol-v7 status: ` +
        JSON.stringify({
          passed: parsed.passed,
          selectionIssues: parsed.selectionIssues,
          commentIntegrityIssues: parsed.commentIntegrityIssues,
        }),
      );
    }
    if (crossing && !parsed.commentIntegrityIssues.some((issue) =>
      issue.code === 'COMMENT_RANGE_START_OCCURRENCE_LIMIT_EXCEEDED')) {
      throw new Error(`${payloadKind} did not report the exact range-start crossing`);
    }
    if (missingRelationship) {
      const issues = parsed.commentIntegrityIssues;
      if (issues.length !== 1 ||
          issues[0].code !== 'COMMENT_RELATIONSHIP_REQUIRED' ||
          issues[0].ordinalSpace !== 'rangeStart' ||
          issues[0].sourceSetOrdinal !== 0 ||
          issues[0].sourceEventOrdinal >= 16) {
        throw new Error(
          'missing-relationship gate did not stop at the first retained marker',
        );
      }
    }
    if (payloadKind === 'maximum-markers') {
      const inventory = parsed.commentInventories[0];
      if (inventory.referenceOccurrences !== 4096 ||
          inventory.rangeStartOccurrences !== 4096 ||
          inventory.rangeEndOccurrences !== 4096 ||
          inventory.uniqueReferenceIds !== 4096) {
        throw new Error('maximum marker inventory did not reach every exact boundary');
      }
    }
    if (payloadKind === 'nvca-comment-topology') {
      const inventories = parsed.commentInventories;
      if (inventories.length !== 3 || !inventories.every((inventory) =>
        inventory.status === 'passed' &&
        inventory.referenceOccurrences === 5 &&
        inventory.rangeStartOccurrences === 5 &&
        inventory.rangeEndOccurrences === 5 &&
        inventory.uniqueReferenceIds === 5 &&
        inventory.definitions === 6 &&
        inventory.unreferencedDefinitions === 1)) {
        throw new Error(
          'NVCA topology gate did not retain the complete non-vacuous inventory',
        );
      }
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

const payloadKinds = [
  'nvca-comment-topology',
  'text',
  'attribute',
  'maximum-markers',
  'irrelevant-events',
  'missing-relationship-early',
  'early-crossing',
  'late-crossing',
];
const selectedPayloadKinds = process.env.SAFE_DOCX_MEMORY_CASES
  ? payloadKinds.filter((kind) =>
    process.env.SAFE_DOCX_MEMORY_CASES.split(',').includes(kind))
  : payloadKinds;

for (const payloadKind of selectedPayloadKinds) {
  const result = await measure(payloadKind);
  console.log(JSON.stringify({
    payloadKind,
    payloadBytes: payloadKind === 'text' || payloadKind === 'attribute'
      ? PAYLOAD_BYTES
      : null,
    wallSeconds: result.wallSeconds,
    peakRssBytes: result.peakRssBytes,
    maxRssBytes: MAX_RSS_BYTES,
    timeoutMs: TIMEOUT_MS,
  }));
}

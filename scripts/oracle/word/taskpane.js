import { assertCurrentDocumentUrl, bytesToBase64, connectionFromDocumentUrl, diagnosticFor, parseJobUrl } from './taskpane-core.mjs';

const status = document.querySelector('#status');
const input = document.querySelector('#job-url');
const connect = document.querySelector('#connect');

Office.onReady(async info => {
  status.textContent = info.host === Office.HostType.Word ? 'Ready for a Word oracle job.' : 'Open this add-in in Microsoft Word.';
  if (window.location.hash.includes('bridge=')) input.value = window.location.href;
  connect.disabled = info.host !== Office.HostType.Word;
  if (info.host === Office.HostType.Word) {
    try {
      const connection = connectionFromDocumentUrl(await currentDocumentUrl());
      if (connection) await begin(connection);
    } catch (error) {
      status.textContent = `${diagnosticFor(error).code}: ${diagnosticFor(error).message}`;
    }
  }
});

connect.addEventListener('click', async () => {
  try {
    await begin(parseJobUrl(input.value.trim()));
  } catch (error) {
    const diagnostic = diagnosticFor(error);
    status.textContent = `${diagnostic.code}: ${diagnostic.message}`;
  }
});

async function begin(connection) {
  connect.disabled = true;
  try {
    await runJob(connection);
    status.textContent = 'Comparison completed and uploaded.';
  } catch (error) {
    const diagnostic = diagnosticFor(error);
    status.textContent = `${diagnostic.code}: ${diagnostic.message}`;
    await reportFailure(connection, diagnostic);
    throw error;
  } finally { connect.disabled = false; }
}

async function runJob(connection) {
  const supported = Office.context.requirements.isSetSupported('WordApiDesktop', '1.2');
  const diagnostics = Office.context.diagnostics ?? {};
  const host = {
    host: diagnostics.host ?? 'Word', platform: diagnostics.platform ?? 'unknown',
    version: diagnostics.version ?? 'unknown', wordApiDesktop12: supported,
  };
  if (!supported) throw Object.assign(new Error('WordApiDesktop 1.2 is unavailable in this Word build.'), { code: 'WORD_API_UNSUPPORTED' });
  status.textContent = 'Claiming comparison job…';
  const job = await request(connection, '/v1/job/claim', { jobId: connection.jobId, host });
  status.textContent = 'Verifying the active staged original…';
  const currentUrl = await currentDocumentUrl();
  assertCurrentDocumentUrl(currentUrl, job.original.stagedFileName);
  status.textContent = 'Word is comparing the documents…';
  await Word.run(async context => {
    const compareOptions = { ...job.options, compareTarget: Word.CompareTarget.current };
    context.document.compareFromBase64(job.revisedBase64, compareOptions);
    await context.sync();
  });
  status.textContent = 'Exporting compared DOCX…';
  const slices = await exportCurrentDocument();
  for (let index = 0; index < slices.length; index += 1) {
    status.textContent = `Uploading result ${index + 1}/${slices.length}…`;
    await request(connection, '/v1/job/result/slice', {
      jobId: connection.jobId, index, total: slices.length, data: bytesToBase64(slices[index]),
    });
  }
  await request(connection, '/v1/job/result/complete', { jobId: connection.jobId });
}

function currentDocumentUrl() {
  return new Promise((resolve, reject) => {
    Office.context.document.getFilePropertiesAsync(result => {
      if (result.status === Office.AsyncResultStatus.Succeeded) resolve(result.value.url);
      else reject(Object.assign(new Error(result.error?.message ?? 'Unable to identify the active document.'), { code: 'CURRENT_DOCUMENT_UNVERIFIED' }));
    });
  });
}

function exportCurrentDocument() {
  return new Promise((resolve, reject) => {
    Office.context.document.getFileAsync(Office.FileType.Compressed, { sliceSize: 512 * 1024 }, fileResult => {
      if (fileResult.status !== Office.AsyncResultStatus.Succeeded) {
        reject(Object.assign(new Error(fileResult.error?.message ?? 'Compressed DOCX export failed.'), { code: 'WORD_EXPORT_UNAVAILABLE' }));
        return;
      }
      const file = fileResult.value;
      const slices = [];
      const read = index => file.getSliceAsync(index, sliceResult => {
        if (sliceResult.status !== Office.AsyncResultStatus.Succeeded) {
          const sliceError = Object.assign(new Error(sliceResult.error?.message ?? 'DOCX slice export failed.'), { code: 'WORD_EXPORT_FAILED' });
          file.closeAsync(() => reject(sliceError));
          return;
        }
        slices.push(new Uint8Array(sliceResult.value.data));
        if (index + 1 < file.sliceCount) read(index + 1);
        else file.closeAsync(closeResult => {
          if (closeResult.status === Office.AsyncResultStatus.Succeeded) resolve(slices);
          else reject(Object.assign(new Error(closeResult.error?.message ?? 'DOCX export handle did not close.'), { code: 'WORD_EXPORT_CLOSE_FAILED' }));
        });
      });
      read(0);
    });
  });
}

async function request(connection, path, body) {
  const response = await fetch(`${connection.bridge}${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.message ?? 'Bridge request failed.'), { code: result.error ?? 'BRIDGE_ERROR' });
  return result;
}

async function reportFailure(connection, diagnostic) {
  try { await request(connection, '/v1/job/fail', { jobId: connection.jobId, ...diagnostic }); } catch { /* terminal or unreachable */ }
}

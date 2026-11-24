const original = document.querySelector('#original');
const revised = document.querySelector('#revised');
const compare = document.querySelector('#compare');
const download = document.querySelector('#download');
const status = document.querySelector('#status');
const limit = 10_000_000;
let worker;
let url;
let runId = 0;

function reset() {
  runId += 1;
  worker?.terminate();
  worker = undefined;
  if (url) URL.revokeObjectURL(url);
  url = undefined;
  download.hidden = true;
  download.removeAttribute('href');
  status.textContent = '';
  compare.disabled = !original.files.length || !revised.files.length;
}

original.addEventListener('change', reset);
revised.addEventListener('change', reset);
window.addEventListener('pagehide', reset);
window.addEventListener('pageshow', reset);

compare.addEventListener('click', () => {
  reset();

  const files = [original.files[0], revised.files[0]];
  if (!files.every(file => file && /\.docx$/i.test(file.name) && file.size > 0 && file.size <= limit)) {
    status.textContent = 'Choose two nonempty .docx files, up to 10 MB each.';
    return;
  }

  runComparison(files);
});

function runComparison(files) {
  const current = runId;
  compare.disabled = true;
  status.textContent = 'Comparing documents…';
  const fail = () => {
    if (current !== runId) return;
    reset();
    status.textContent = 'Comparison could not be completed. Check that both files open in Word and try again.';
  };

  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onerror = fail;
    worker.onmessage = ({ data }) => {
      if (current !== runId) return;
      if (!data.document) {
        if (data.fidelityViolation) {
          reset();
          status.textContent = 'Safe DOCX could not verify that Accept All and Reject All preserve both versions. No redline was created.';
        } else {
          fail();
        }
        return;
      }
      reset();
      url = URL.createObjectURL(new Blob([data.document], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }));
      download.href = url;
      download.hidden = false;
      status.textContent = 'Your redline is ready.';
    };
    worker.postMessage(files);
  } catch {
    fail();
  }
}

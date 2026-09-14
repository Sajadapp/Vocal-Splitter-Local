const MODEL_SIZE_MB = 172;

const audioFile = document.querySelector('#audioFile');
const dropZone = document.querySelector('#dropZone');
const fileMeta = document.querySelector('#fileMeta');
const separateButton = document.querySelector('#separateButton');
const cancelButton = document.querySelector('#cancelButton');
const statusText = document.querySelector('#statusText');
const statusDetail = document.querySelector('#statusDetail');
const progressBar = document.querySelector('#progressBar');
const resultsCard = document.querySelector('#resultsCard');

let selectedFile = null;
let worker = null;
let currentResults = null;
let isProcessing = false;

function setStatus(title, detail, progress = null) {
  statusText.textContent = title;
  statusDetail.textContent = detail;
  if (progress !== null) progressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'حجم نامشخص';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} کیلوبایت`;
  return `${(bytes / 1024 / 1024).toFixed(1)} مگابایت`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

async function readAudio(file) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    const length = decoded.length;
    const left = decoded.getChannelData(0).slice();
    const right = decoded.numberOfChannels > 1 ? decoded.getChannelData(1).slice() : left.slice();
    return { left, right, sampleRate: decoded.sampleRate, length };
  } finally {
    await context.close();
  }
}

function resampleChannel(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const outputLength = Math.max(1, Math.round(input.length * toRate / fromRate));
  const output = new Float32Array(outputLength);
  const ratio = fromRate / toRate;
  for (let i = 0; i < outputLength; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    const a = input[Math.min(index, input.length - 1)] || 0;
    const b = input[Math.min(index + 1, input.length - 1)] || a;
    output[i] = a + (b - a) * fraction;
  }
  return output;
}

function encodeWav(left, right, sampleRate) {
  const frames = Math.min(left.length, right.length);
  const buffer = new ArrayBuffer(44 + frames * 4);
  const view = new DataView(buffer);
  const writeString = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + frames * 4, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, frames * 4, true);

  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    const l = Math.max(-1, Math.min(1, left[i] || 0));
    const r = Math.max(-1, Math.min(1, right[i] || 0));
    view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    view.setInt16(offset + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
    offset += 4;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function baseName(name) {
  return name.replace(/\.[^/.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_') || 'track';
}

function selectFile(file) {
  if (!file || !file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|ogg|flac)$/i.test(file.name)) {
    setStatus('فایل نامعتبر', 'لطفاً یک فایل صوتی قابل‌پخش انتخاب کنید.', 0);
    return;
  }
  selectedFile = file;
  resultsCard.hidden = true;
  currentResults = null;
  fileMeta.hidden = false;
  fileMeta.innerHTML = `<strong>${file.name}</strong> · ${formatBytes(file.size)}`;
  separateButton.disabled = false;
  setStatus('آماده', 'فایل انتخاب شد. برای شروع روی دکمهٔ زیر بزنید.', 0);
}

function terminateWorker() {
  if (worker) worker.terminate();
  worker = null;
}

function handleWorkerMessage(event) {
  const data = event.data || {};
  if (data.type === 'model-progress') {
    const loaded = data.loaded || 0;
    const total = data.total || MODEL_SIZE_MB * 1024 * 1024;
    setStatus('در حال دانلود مدل', `${formatBytes(loaded)} از حدود ${formatBytes(total)} · این مرحله فقط بار اول انجام می‌شود.`, loaded / total * 100);
    return;
  }
  if (data.type === 'model-cached') {
    setStatus('مدل آماده است', 'مدل از حافظهٔ محلی خوانده شد.', 100);
    return;
  }
  if (data.type === 'status') {
    setStatus('در حال آماده‌سازی', data.message, 100);
    return;
  }
  if (data.type === 'log') {
    setStatus('در حال پردازش', data.message, null);
    return;
  }
  if (data.type === 'progress') {
    setStatus('در حال جداسازی', `قطعهٔ ${data.currentSegment} از ${data.totalSegments}`, data.progress * 100);
    return;
  }
  if (data.type === 'done') {
    currentResults = {
      sampleRate: data.sampleRate,
      vocalsLeft: new Float32Array(data.vocalsLeft),
      vocalsRight: new Float32Array(data.vocalsRight),
      instrumentalLeft: new Float32Array(data.instrumentalLeft),
      instrumentalRight: new Float32Array(data.instrumentalRight)
    };
    isProcessing = false;
    separateButton.disabled = false;
    cancelButton.hidden = true;
    resultsCard.hidden = false;
    setStatus('تمام شد', 'دو خروجی آمادهٔ دانلود هستند.', 100);
    terminateWorker();
    return;
  }
  if (data.type === 'error') {
    isProcessing = false;
    separateButton.disabled = !selectedFile;
    cancelButton.hidden = true;
    setStatus('خطا', data.message || 'پردازش ناموفق بود.', 0);
    terminateWorker();
  }
}

async function startSeparation() {
  if (!selectedFile || isProcessing) return;
  isProcessing = true;
  separateButton.disabled = true;
  cancelButton.hidden = false;
  resultsCard.hidden = true;
  setStatus('در حال خواندن فایل', 'فایل صوتی فقط در همین مرورگر خوانده می‌شود…', 2);

  try {
    const decoded = await readAudio(selectedFile);
    const left = resampleChannel(decoded.left, decoded.sampleRate, 44100);
    const right = resampleChannel(decoded.right, decoded.sampleRate, 44100);
    const duration = left.length / 44100;
    setStatus('در حال آماده‌سازی', `مدت فایل: ${formatDuration(duration)} · مدل روی دستگاه شما اجرا می‌شود.`, 5);

    worker = new Worker('worker.js');
    worker.onmessage = handleWorkerMessage;
    worker.onerror = (error) => {
      handleWorkerMessage({ data: { type: 'error', message: error.message || 'خطای worker' } });
    };
    worker.postMessage({ type: 'separate', left: left.buffer, right: right.buffer }, [left.buffer, right.buffer]);
  } catch (error) {
    isProcessing = false;
    separateButton.disabled = false;
    cancelButton.hidden = true;
    setStatus('خطا در خواندن فایل', error.message || 'فرمت فایل پشتیبانی نمی‌شود.', 0);
    terminateWorker();
  }
}

function cancelSeparation() {
  if (!isProcessing) return;
  isProcessing = false;
  terminateWorker();
  separateButton.disabled = !selectedFile;
  cancelButton.hidden = true;
  setStatus('لغو شد', 'می‌توانید دوباره پردازش را شروع کنید.', 0);
}

function downloadResult(kind) {
  if (!currentResults || !selectedFile) return;
  const name = baseName(selectedFile.name);
  if (kind === 'vocals') {
    downloadBlob(encodeWav(currentResults.vocalsLeft, currentResults.vocalsRight, currentResults.sampleRate), `${name}_vocals.wav`);
  } else {
    downloadBlob(encodeWav(currentResults.instrumentalLeft, currentResults.instrumentalRight, currentResults.sampleRate), `${name}_instrumental.wav`);
  }
}

audioFile.addEventListener('change', (event) => selectFile(event.target.files?.[0]));
separateButton.addEventListener('click', startSeparation);
cancelButton.addEventListener('click', cancelSeparation);
for (const button of document.querySelectorAll('.download-button')) {
  button.addEventListener('click', () => downloadResult(button.dataset.result));
}

for (const eventName of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('is-dragging');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('is-dragging');
  });
}
dropZone.addEventListener('drop', (event) => selectFile(event.dataTransfer.files?.[0]));

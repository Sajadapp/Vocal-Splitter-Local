import * as ort from 'onnxruntime-web/webgpu';
import { DemucsProcessor, CONSTANTS } from 'demucs-web';

const MODEL_URL = CONSTANTS.DEFAULT_MODEL_URL;
const MODEL_CACHE_KEY = 'htdemucs_embedded-v1';

// WASM binaries are shipped with the extension, so the fallback does not need a CDN.
ort.env.wasm.wasmPaths = new URL('ort/', self.location.href).href;
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

let processor = null;
let loadingPromise = null;

function send(message, transfer = []) {
  self.postMessage(message, transfer);
}

function openModelDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('vocal-splitter-cache', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('models');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getCachedModel() {
  try {
    const db = await openModelDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('models', 'readonly');
      const request = tx.objectStore('models').get(MODEL_CACHE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function cacheModel(buffer) {
  try {
    const db = await openModelDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('models', 'readwrite');
      tx.objectStore('models').put(buffer, MODEL_CACHE_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // The model remains usable in memory even if browser storage is unavailable.
  }
}

async function fetchModelBuffer() {
  const cached = await getCachedModel();
  if (cached instanceof ArrayBuffer) {
    send({ type: 'model-cached', bytes: cached.byteLength });
    return cached;
  }

  const response = await fetch(MODEL_URL);
  if (!response.ok) throw new Error(`دانلود مدل ناموفق بود: HTTP ${response.status}`);

  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    send({ type: 'model-progress', loaded: buffer.byteLength, total: total || buffer.byteLength });
    await cacheModel(buffer);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    send({ type: 'model-progress', loaded, total });
  }

  const combined = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const buffer = combined.buffer;
  await cacheModel(buffer);
  return buffer;
}

async function ensureModel() {
  if (processor) return processor;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    processor = new DemucsProcessor({
      ort,
      modelPath: MODEL_URL,
      sessionOptions: {
        executionProviders: ['webgpu', 'wasm'],
        graphOptimizationLevel: 'basic',
        enableCpuMemArena: false,
        enableMemPattern: false
      },
      onProgress: ({ progress, currentSegment, totalSegments }) => {
        send({ type: 'progress', progress, currentSegment, totalSegments });
      },
      onLog: (phase, message) => {
        send({ type: 'log', phase, message });
      }
    });

    const modelBuffer = await fetchModelBuffer();
    send({ type: 'status', message: 'مدل در حال آماده‌سازی است…' });
    await processor.loadModel(modelBuffer);
    return processor;
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

function addInto(target, source) {
  for (let i = 0; i < target.length; i += 1) target[i] += source[i];
}

function makeInstrumental(result, length) {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  addInto(left, result.drums.left);
  addInto(left, result.bass.left);
  addInto(left, result.other.left);
  addInto(right, result.drums.right);
  addInto(right, result.bass.right);
  addInto(right, result.other.right);
  return { left, right };
}

self.onmessage = async (event) => {
  const data = event.data || {};
  if (data.type !== 'separate') return;

  try {
    const left = new Float32Array(data.left);
    const right = new Float32Array(data.right);
    const model = await ensureModel();

    send({ type: 'status', message: 'در حال جداسازی قطعه‌های صوتی…' });
    const result = await model.separate(left, right);
    const instrumental = makeInstrumental(result, left.length);

    send(
      {
        type: 'done',
        sampleRate: CONSTANTS.SAMPLE_RATE,
        vocalsLeft: result.vocals.left.buffer,
        vocalsRight: result.vocals.right.buffer,
        instrumentalLeft: instrumental.left.buffer,
        instrumentalRight: instrumental.right.buffer
      },
      [
        result.vocals.left.buffer,
        result.vocals.right.buffer,
        instrumental.left.buffer,
        instrumental.right.buffer
      ]
    );
  } catch (error) {
    send({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : ''
    });
  }
};

import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const ortDist = path.join(root, 'node_modules/onnxruntime-web/dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(path.join(root, 'public'), dist, { recursive: true });
await mkdir(path.join(dist, 'ort'), { recursive: true });

for (const file of [
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm'
]) {
  await cp(path.join(ortDist, file), path.join(dist, 'ort', file));
}

await build({
  entryPoints: [path.join(root, 'src/popup.js'), path.join(root, 'src/worker.js')],
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' }
});

console.log(`Built extension in ${dist}`);

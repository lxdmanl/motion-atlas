import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = join(root, 'public', 'mediapipe');
const packageRoot = join(root, 'node_modules', '@mediapipe', 'tasks-vision');
const modelName = 'pose_landmarker_full.task';
// Pin the model artifact version; never use the moving /latest/ URL.
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
// SHA-256 verified from the versioned Google-hosted artifact, 2026-10-04.
const modelSha256 = '5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1';
const modelDocumentation = 'https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker#models';
const manifestPath = join(destination, 'manifest.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const describe = (path, bytes) => ({ path, bytes: bytes.byteLength, sha256: hash(bytes) });

function validateWasm(bytes, name) {
  if (!WebAssembly.validate(bytes)) throw new Error(`${name} is incomplete or invalid WebAssembly. Finish/retry npm install before copying runtime assets.`);
}

function validateModel(bytes) {
  // A task is a ZIP bundle of the detector and landmark TFLite models. Reject
  // an HTML error page or truncated archive before it reaches the browser.
  const tail = bytes.subarray(Math.max(0, bytes.length - 65_557));
  if (bytes.length < 1_000_000 || !bytes.includes(Buffer.from('pose_detector.tflite'))
    || !bytes.includes(Buffer.from('pose_landmarks_detector.tflite'))
    || tail.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) < 0) {
    throw new Error('Downloaded full.task is not a complete MediaPipe pose model bundle.');
  }
  if (hash(bytes) !== modelSha256) throw new Error('Pose model SHA-256 does not match the pinned version 1 artifact.');
}

async function atomicWrite(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, path);
}

async function readManifest() {
  try { return JSON.parse(await readFile(manifestPath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function acquireModel(previousManifest) {
  if (previousManifest?.model?.sourceUrl === modelUrl) {
    try {
      const existing = await readFile(join(destination, modelName));
      const entry = previousManifest.files.find(file => file.path === modelName);
      if (entry?.sha256 === hash(existing)) { validateModel(existing); return existing; }
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn(`Cached model needs replacement: ${error.message}`);
    }
  }
  console.log(`Downloading version 1 of ${modelName} from Google…`);
  let failure;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(modelUrl, { signal: AbortSignal.timeout(90_000) });
      if (!response.ok) throw new Error(`Google model download returned HTTP ${response.status}.`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const contentLength = Number(response.headers.get('content-length'));
      if (contentLength && !response.headers.get('content-encoding') && bytes.length !== contentLength) {
        throw new Error(`Model download ended early (${bytes.length}/${contentLength} bytes).`);
      }
      validateModel(bytes);
      return bytes;
    } catch (error) { failure = error; console.warn(`Download attempt ${attempt}/2: ${error.message}`); }
  }
  throw failure;
}

async function verify() {
  const manifest = await readManifest();
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error('Run npm run assets:pose to create the local model manifest.');
  for (const entry of manifest.files) {
    if (!/^(pose_landmarker_full\.task|wasm\/vision_[a-z_]+\.(js|wasm))$/.test(entry.path)) throw new Error('Unexpected asset path in manifest.');
    const bytes = await readFile(join(destination, entry.path));
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw new Error(`Asset checksum mismatch: ${entry.path}`);
    if (entry.path.endsWith('.wasm')) validateWasm(bytes, entry.path);
    if (entry.path === modelName) validateModel(bytes);
  }
  console.log(`Verified ${manifest.files.length} local pose assets and SHA-256 checksums (tasks-vision ${manifest.runtime.version}).`);
}

async function setup() {
  const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  const wasmRoot = join(packageRoot, 'wasm');
  const names = (await readdir(wasmRoot)).filter(name => /^vision_[a-z_]+\.(js|wasm)$/.test(name)).sort();
  // Module workers need their actual module build, including its matching binary.
  for (const required of ['vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm']) {
    if (!names.includes(required)) throw new Error(`Missing ${required}. The @mediapipe/tasks-vision install is incomplete or incompatible.`);
  }
  const runtimeFiles = await Promise.all(names.map(async name => {
    const bytes = await readFile(join(wasmRoot, name));
    if (name.endsWith('.wasm')) validateWasm(bytes, name);
    else if (bytes.length < 1000 || !bytes.includes(Buffer.from('ModuleFactory'))) throw new Error(`Incomplete runtime loader: ${name}`);
    return { path: `wasm/${name}`, bytes };
  }));
  const previousManifest = await readManifest();
  const model = await acquireModel(previousManifest);
  const files = [{ path: modelName, bytes: model }, ...runtimeFiles];
  for (const file of files) await atomicWrite(join(destination, file.path), file.bytes);
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    model: { name: 'Pose Landmarker Full', variant: 'float16', version: '1', sourceUrl: modelUrl, documentation: modelDocumentation },
    runtime: { package: '@mediapipe/tasks-vision', version: packageJson.version, license: packageJson.license,
      source: `https://www.npmjs.com/package/@mediapipe/tasks-vision/v/${packageJson.version}` },
    files: files.map(file => describe(file.path, file.bytes)),
  };
  await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await verify();
  console.log('Pose model and WASM now load locally; camera frames never need to leave this browser.');
}

try {
  if (process.argv.includes('--verify')) await verify();
  else await setup();
} catch (error) {
  console.error(`Pose asset setup failed: ${error.message}`);
  process.exitCode = 1;
}

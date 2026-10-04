import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

// These integration checks intentionally use a synthetic blank camera stream.
// They verify actual WASM/worker/lifecycle behavior, not pose-estimation accuracy.
const viteModule = (name: string) => `/@fs/${resolve(process.cwd(), 'app', 'tracking', name).replaceAll('\\', '/')}`;
const workerModule = `${viteModule('pose.worker.ts')}?worker`;
const trackerModule = viteModule('PoseTracker.ts');

test.setTimeout(60_000);
// Use a same-origin static page so unrelated atlas/UI loading cannot mask worker failures.
test.beforeEach(async ({ page }) => { await page.goto('/mediapipe/manifest.json'); });

test('local model and module WASM load; a blank frame does not invent a pose', async ({ page }) => {
  const answer = await page.evaluate(async url => {
    const { default: PoseWorker } = await import(/* @vite-ignore */ url);
    const worker = new PoseWorker() as Worker;
    try {
      return await new Promise<{ delegate: string; landmarkCount: number; worldCount: number; capturedAt: number }>((resolveResult, reject) => {
        const timeout = setTimeout(() => reject(new Error('Worker model initialization/result timeout')), 45_000);
        let delegate = '';
        worker.onerror = event => { clearTimeout(timeout); reject(new Error(event.message)); };
        worker.onmessage = async ({ data }) => {
          if (data.type === 'error') { clearTimeout(timeout); reject(new Error(data.message)); }
          if (data.type === 'ready') {
            delegate = data.delegate;
            const canvas = new OffscreenCanvas(640, 480);
            const context = canvas.getContext('2d')!;
            context.fillStyle = '#222222';
            context.fillRect(0, 0, 640, 480);
            const bitmap = await createImageBitmap(canvas);
            worker.postMessage({ type: 'frame', bitmap, timestamp: 1000, capturedAt: 123456 }, [bitmap]);
          }
          if (data.type === 'result') {
            clearTimeout(timeout);
            resolveResult({ delegate, landmarkCount: data.landmarks.length, worldCount: data.worldLandmarks.length, capturedAt: data.capturedAt });
          }
        };
        worker.postMessage({ type: 'init', wasmPath: `${location.origin}/mediapipe/wasm`, modelPath: `${location.origin}/mediapipe/pose_landmarker_full.task` });
      });
    } finally { worker.terminate(); }
  }, workerModule);
  expect(['GPU', 'CPU']).toContain(answer.delegate);
  expect(answer).toMatchObject({ landmarkCount: 0, worldCount: 0, capturedAt: 123456 });
});

test('missing model produces an actionable error instead of a hanging worker', async ({ page }) => {
  const error = await page.evaluate(async url => {
    const { default: PoseWorker } = await import(/* @vite-ignore */ url);
    const worker = new PoseWorker() as Worker;
    try {
      return await new Promise<string>((resolveResult, reject) => {
        const timeout = setTimeout(() => reject(new Error('Missing-model error timeout')), 30_000);
        worker.onmessage = ({ data }) => {
          if (data.type === 'error') { clearTimeout(timeout); resolveResult(data.message); }
          if (data.type === 'ready') { clearTimeout(timeout); reject(new Error('Missing model unexpectedly initialized')); }
        };
        worker.onerror = event => { clearTimeout(timeout); reject(new Error(event.message)); };
        worker.postMessage({ type: 'init', wasmPath: `${location.origin}/mediapipe/wasm`, modelPath: `${location.origin}/mediapipe/missing-test-model.task` });
      });
    } finally { worker.terminate(); }
  }, workerModule);
  expect(error.length).toBeGreaterThan(0);
});

test('tracker stops its synthetic camera, worker and subsequent callbacks', async ({ page }) => {
  const result = await page.evaluate(async url => {
    const { PoseTracker } = await import(/* @vite-ignore */ url);
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext('2d')!;
    const paint = setInterval(() => {
      context.fillStyle = '#242424';
      context.fillRect(0, 0, 640, 480);
    }, 33);
    const stream = canvas.captureStream(30);
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async () => stream;
    const video = document.createElement('video');
    video.style.display = 'none';
    document.body.append(video);
    const tracker = new PoseTracker();
    let callbacks = 0;
    const snapshots: { angleDeg: number | null; status: string }[] = [];
    try {
      await tracker.start(video, { onSnapshot: (snapshot: { angleDeg: number | null; status: string }) => { callbacks++; snapshots.push(snapshot); },
        onLandmarks: () => { callbacks++; } });
      await new Promise(resolveDelay => setTimeout(resolveDelay, 300));
      tracker.stop();
      const countAfterStop = callbacks;
      await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
      return { callbacksStopped: callbacks === countAfterStop, trackStates: stream.getTracks().map(track => track.readyState),
        videoReleased: video.srcObject === null, angles: snapshots.map(snapshot => snapshot.angleDeg) };
    } finally {
      tracker.dispose();
      clearInterval(paint);
      stream.getTracks().forEach(track => track.stop());
      video.remove();
      navigator.mediaDevices.getUserMedia = originalGetUserMedia;
    }
  }, trackerModule);
  expect(result.callbacksStopped).toBe(true);
  expect(result.videoReleased).toBe(true);
  expect(result.trackStates).toEqual(['ended']);
  expect(result.angles.every(angle => angle === null)).toBe(true);
});

test('camera rejection is reported and the tracker can be disposed', async ({ page }) => {
  const result = await page.evaluate(async url => {
    const { PoseTracker } = await import(/* @vite-ignore */ url);
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Camera denied by integration test', 'NotAllowedError'); };
    const tracker = new PoseTracker();
    const snapshots: { status: string; message?: string }[] = [];
    let error = '';
    try {
      await tracker.start(document.createElement('video'), { onSnapshot: (snapshot: { status: string; message?: string }) => snapshots.push(snapshot) });
    } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
    finally { tracker.dispose(); navigator.mediaDevices.getUserMedia = originalGetUserMedia; }
    return { error, last: snapshots.at(-1) };
  }, trackerModule);
  expect(result.last?.status).toBe('error');
  expect(result.error).toContain('相機權限');
});

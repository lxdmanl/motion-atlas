import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const warmupMs = 15_000;
const durationMs = 10 * 60_000;
const intervalMs = 10_000;
test.use({ video: 'off', trace: 'off' });

type Sample = {
  elapsedMs: number;
  timestamp: string;
  fps: number;
  geometries: number;
  textures: number;
  angleDeg: number;
  focus: string | undefined;
  usedJSHeapSize: number | null;
  totalJSHeapSize: number | null;
  jsHeapSizeLimit: number | null;
};

test.describe('opt-in 3D stability soak', () => {
  test.skip(process.env.RUN_SOAK !== '1', 'Set RUN_SOAK=1 to run the ten-minute 3D-only soak.');

  test('full-body demo remains animated with stable renderer object counts for ten minutes', async ({ page, browserName, browser }, testInfo) => {
    test.setTimeout(13 * 60_000);
    const startedAt = new Date().toISOString();
    const outputDirectory = resolve('output/playwright/soak');
    const outputPath = resolve(outputDirectory, `soak-${startedAt.replaceAll(':', '-')}-${process.pid}.json`);
    const samples: Sample[] = [];
    const pageErrors: string[] = [];
    const unexpectedApiRequests: string[] = [];
    const mediaRequests: string[] = [];
    let status: 'running' | 'passed' | 'failed' = 'running';
    let failure: string | null = null;
    let measurementStartedAt: string | null = null;

    await mkdir(outputDirectory, { recursive: true });
    page.on('pageerror', error => pageErrors.push(error.message));
    // This scope intentionally excludes camera, pose estimation, voice and AI calls.
    await page.exposeFunction('__recordSoakMediaRequest', (kind: string) => { mediaRequests.push(kind); });
    await page.addInitScript(() => {
      if (navigator.mediaDevices) {
        navigator.mediaDevices.getUserMedia = async () => {
          await (window as unknown as { __recordSoakMediaRequest: (kind: string) => Promise<void> }).__recordSoakMediaRequest('getUserMedia');
          throw new DOMException('Media capture is disabled for this 3D-only soak.', 'NotAllowedError');
        };
      }
    });
    await page.route(/\/api\/(?:realtime|explain)(?:\/|$|\?)/, route => {
      unexpectedApiRequests.push(new URL(route.request().url()).pathname);
      return route.abort('blockedbyclient');
    });

    function summary() {
      const fps = samples.map(s => s.fps).sort((a, b) => a - b);
      const heaps = samples.map(s => s.usedJSHeapSize).filter((n): n is number => n !== null);
      const angles = samples.map(s => s.angleDeg);
      return {
        sampleCount: samples.length,
        measuredElapsedMs: samples.at(-1)?.elapsedMs ?? 0,
        fps: fps.length ? { min: fps[0], median: fps[Math.floor(fps.length / 2)], max: fps.at(-1) } : null,
        geometryCounts: [...new Set(samples.map(s => s.geometries))],
        textureCounts: [...new Set(samples.map(s => s.textures))],
        angleRangeDeg: angles.length ? [Math.min(...angles), Math.max(...angles)] : null,
        jsHeapBytes: heaps.length ? { first: heaps[0], last: heaps.at(-1), min: Math.min(...heaps), max: Math.max(...heaps) } : null,
      };
    }

    async function saveReport() {
      const report = {
        schemaVersion: 1, status, startedAt, measurementStartedAt, updatedAt: new Date().toISOString(),
        scope: 'Full-body 3D demo stability only; no real camera, MediaPipe inference, voice, microphone or OpenAI request.',
        limitations: 'Renderer object counters do not measure GPU bytes or prove the absence of every memory leak. JS heap is browser-dependent and includes garbage collection. FPS is observational, without a pass threshold.',
        concurrencyNote: process.env.SOAK_LOAD_NOTE ?? 'Concurrent host activity was not controlled; this is not an isolated performance benchmark.',
        browser: { name: browserName, version: browser.version(), channel: testInfo.project.use.channel, viewport: testInfo.project.use.viewport },
        warmupMs, targetDurationMs: durationMs, sampleIntervalMs: intervalMs,
        recording: { trace: false, video: false },
        pageErrors, mediaRequests, unexpectedApiRequests, failure,
        summary: summary(), samples,
      };
      const json = JSON.stringify(report, null, 2) + '\n';
      await writeFile(outputPath, json);
      await writeFile(resolve(outputDirectory, 'latest.json'), json);
    }

    try {
      await saveReport();
      await page.goto('/');
      const scene = page.getByTestId('anatomy-canvas');
      await expect(scene).toHaveAttribute('data-ready', 'true', { timeout: 60_000 });
      await page.getByRole('navigation', { name: '模型工具' }).getByRole('button', { name: '全身', exact: true }).click();
      await page.getByRole('button', { name: '展示模式', exact: true }).click();
      await expect(page.getByText('示範資料 · 非相機', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: '播放示範動畫', exact: true }).click();
      await expect(page.getByRole('button', { name: '暫停示範動畫', exact: true })).toBeVisible();
      await delay(warmupMs);
      const measurementStart = Date.now();
      measurementStartedAt = new Date(measurementStart).toISOString();

      for (let index = 0; index <= durationMs / intervalMs; index++) {
        await delay(Math.max(0, measurementStart + index * intervalMs - Date.now()));
        const measured = await scene.evaluate((element: HTMLElement) => {
          const memory = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
          const read = (key: string) => element.dataset[key] === undefined ? Number.NaN : Number(element.dataset[key]);
          return {
            fps: read('fps'), geometries: read('geometries'), textures: read('textures'), angleDeg: read('angle'), focus: element.dataset.focus,
            usedJSHeapSize: memory?.usedJSHeapSize ?? null, totalJSHeapSize: memory?.totalJSHeapSize ?? null, jsHeapSizeLimit: memory?.jsHeapSizeLimit ?? null,
          };
        });
        samples.push({ elapsedMs: Date.now() - measurementStart, timestamp: new Date().toISOString(), ...measured });
        await saveReport();
        if (index % 6 === 0) console.log(`[3D SOAK ${Math.floor(index / 6)}/10 min] FPS=${measured.fps}, geometries=${measured.geometries}, textures=${measured.textures}, angle=${measured.angleDeg}, heap=${measured.usedJSHeapSize ?? 'unavailable'}`);
      }

      expect(pageErrors, 'No uncaught browser exception during the soak').toEqual([]);
      expect(mediaRequests, 'No camera or microphone request is allowed').toEqual([]);
      expect(unexpectedApiRequests, 'No voice or AI endpoint should be called').toEqual([]);
      expect(samples).toHaveLength(61);
      const baseline = samples[0];
      for (const sample of samples) {
        expect(sample.focus).toBe('body');
        for (const value of [sample.fps, sample.geometries, sample.textures, sample.angleDeg]) expect(Number.isFinite(value)).toBe(true);
        expect(sample.geometries, `Geometry growth at ${sample.elapsedMs}ms`).toBeLessThanOrEqual(baseline.geometries);
        expect(sample.textures, `Texture growth at ${sample.elapsedMs}ms`).toBeLessThanOrEqual(baseline.textures);
      }
      expect(baseline.geometries).toBeGreaterThan(0);
      expect(Math.max(...samples.map(s => s.angleDeg)) - Math.min(...samples.map(s => s.angleDeg)), 'Elbow animation must continue changing').toBeGreaterThan(10);
      await expect(page.getByRole('button', { name: '暫停示範動畫', exact: true })).toBeVisible();
      status = 'passed';
    } catch (error) {
      status = 'failed';
      failure = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      await saveReport();
      await testInfo.attach('3D stability soak report', { path: outputPath, contentType: 'application/json' });
    }
  });
});

import type { MotionSnapshot } from '../contracts';
import { emptySnapshot, MotionEstimator, STALE_AFTER_MS, VISIBILITY_THRESHOLD } from './motion';
import type { PoseLandmark, WorkerInput, WorkerOutput } from './types';

export interface PoseTrackerCallbacks {
  onSnapshot: (snapshot: MotionSnapshot) => void;
  onLandmarks?: (landmarks: PoseLandmark[] | null) => void;
}

/** Owns its camera stream and worker. stop/dispose cancel all future callbacks. */
export class PoseTracker {
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private callbacks: PoseTrackerCallbacks | null = null;
  private estimator = new MotionEstimator();
  private generation = 0;
  private ready = false;
  private suspended = false;
  private inflight = false;
  private inflightAt = 0;
  private lastFrameAt = -Infinity;
  private lastVideoTime = -1;
  private acceptFramesAfter = 0;
  private frameHandle: number | null = null;
  private frameKind: 'video' | 'raf' | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private rejectInitialization: ((error: Error) => void) | null = null;
  private lastReportedStatus: MotionSnapshot['status'] = 'idle';

  async start(video: HTMLVideoElement, callbacks: PoseTrackerCallbacks): Promise<void> {
    this.stop();
    const generation = this.generation;
    this.callbacks = callbacks;
    this.video = video;
    this.estimator.reset();
    this.report(emptySnapshot('starting', '正在準備相機與本機姿態模型…'));
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
        throw new Error('相機需要 localhost 或 HTTPS，請使用 Chrome 開啟本機展示網址');
      }
      if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined' || typeof OffscreenCanvas === 'undefined') {
        throw new Error('這個瀏覽器缺少背景姿態追蹤功能，請使用新版 Chrome 或 Edge');
      }
      const stream = await this.cameraWithTimeout(generation);
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await this.playWithTimeout(video);
      if (generation !== this.generation) return;
      stream.getVideoTracks().forEach(track => track.addEventListener('ended', this.onCameraEnded));
      const worker = new Worker(new URL('./pose.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('姿態模型載入逾時，請確認本機模型檔案後重試')), 25_000);
        this.rejectInitialization = error => { clearTimeout(timeout); reject(error); };
        worker.onerror = event => {
          const error = new Error(`姿態追蹤啟動失敗：${event.message || 'Worker error'}`);
          if (!this.ready) this.rejectInitialization?.(error);
          else this.fail(error);
        };
        worker.onmessage = ({ data }: MessageEvent<WorkerOutput>) => {
          if (generation !== this.generation) return;
          if (data.type === 'ready') {
            clearTimeout(timeout);
            this.rejectInitialization = null;
            this.ready = true;
            resolve();
          } else if (data.type === 'error') {
            const error = new Error(`姿態模型無法分析：${data.message}`);
            if (!this.ready) this.rejectInitialization?.(error);
            else this.fail(error);
          } else {
            this.inflight = false;
            if (this.suspended || data.capturedAt <= this.acceptFramesAfter) return;
            const snapshot = this.estimator.update(data.landmarks, data.worldLandmarks, data.capturedAt, Date.now());
            this.report(snapshot);
            this.callbacks?.onLandmarks?.(snapshot.status === 'tracking' && snapshot.quality >= VISIBILITY_THRESHOLD ? data.landmarks : null);
          }
        };
        const init: WorkerInput = { type: 'init', wasmPath: new URL('/mediapipe/wasm', window.location.origin).href,
          modelPath: new URL('/mediapipe/pose_landmarker_full.task', window.location.origin).href };
        worker.postMessage(init);
      });
      if (generation !== this.generation) return;
      this.suspended = document.hidden;
      if (this.suspended) this.report(emptySnapshot('lost', '頁面在背景，姿態分析已暫停'));
      document.addEventListener('visibilitychange', this.onVisibilityChange);
      this.watchdog = setInterval(() => {
        if (this.suspended) return;
        if (this.inflight && performance.now() - this.inflightAt > 8_000) {
          this.fail(new Error('姿態分析逾時，請重新啟動相機'));
          return;
        }
        const snapshot = this.estimator.tick(Date.now());
        if (snapshot.status === 'lost' && this.lastReportedStatus !== 'lost') {
          this.report(snapshot);
          this.callbacks?.onLandmarks?.(null);
        }
      }, 100);
      if (!this.suspended) this.scheduleFrame();
    } catch (error) {
      if (generation !== this.generation) return;
      const resolved = this.friendlyError(error);
      this.fail(resolved);
      throw resolved;
    }
  }

  stop(): void {
    this.generation += 1;
    this.callbacks = null;
    this.rejectInitialization?.(new Error('已停止追蹤'));
    this.rejectInitialization = null;
    this.cancelFrame();
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.stream?.getTracks().forEach(track => { track.removeEventListener('ended', this.onCameraEnded); track.stop(); });
    this.stream = null;
    if (this.video) { this.video.pause(); this.video.srcObject = null; }
    this.video = null;
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
    }
    this.worker = null;
    this.ready = false;
    this.suspended = false;
    this.inflight = false;
    this.lastFrameAt = -Infinity;
    this.lastVideoTime = -1;
    this.acceptFramesAfter = 0;
    this.lastReportedStatus = 'idle';
    this.estimator.reset();
  }

  dispose(): void { this.stop(); }

  private async playWithTimeout(video: HTMLVideoElement): Promise<void> {
    let timeout: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([video.play(), new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('相機影像啟動逾時，請重新連接相機後重試')), 8_000);
      })]);
    } finally { clearTimeout(timeout!); }
  }

  private async cameraWithTimeout(generation: number): Promise<MediaStream> {
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout>;
    const request = navigator.mediaDevices.getUserMedia({ audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } } });
    request.then(stream => { if (timedOut || generation !== this.generation) stream.getTracks().forEach(track => track.stop()); }, () => {});
    try {
      return await Promise.race([request, new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { timedOut = true; reject(new Error('相機授權等待逾時，請允許使用相機後重試')); }, 20_000);
      })]);
    } finally { clearTimeout(timeout!); }
  }

  private report(snapshot: MotionSnapshot) {
    this.lastReportedStatus = snapshot.status;
    this.callbacks?.onSnapshot(snapshot);
  }

  private fail(error: Error) {
    const callbacks = this.callbacks;
    this.stop();
    callbacks?.onLandmarks?.(null);
    callbacks?.onSnapshot(emptySnapshot('error', error.message));
  }

  private friendlyError(error: unknown): Error {
    if (error instanceof DOMException) {
      if (error.name === 'NotAllowedError') return new Error('尚未取得相機權限，請允許此網站使用相機後重試');
      if (error.name === 'NotFoundError') return new Error('找不到相機，請確認相機已連接');
      if (error.name === 'NotReadableError') return new Error('相機正在被其他程式使用，請關閉其他視訊程式後重試');
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  private onCameraEnded = () => this.fail(new Error('相機連線已中斷，請重新啟動追蹤'));

  private onVisibilityChange = () => {
    this.suspended = document.hidden;
    this.cancelFrame();
    this.estimator.reset();
    this.callbacks?.onLandmarks?.(null);
    if (this.suspended) this.report(emptySnapshot('lost', '頁面在背景，姿態分析已暫停'));
    else { this.acceptFramesAfter = Date.now(); this.lastVideoTime = -1; this.scheduleFrame(); }
  };

  private cancelFrame() {
    if (this.frameHandle !== null) {
      if (this.frameKind === 'video') this.video?.cancelVideoFrameCallback(this.frameHandle);
      else cancelAnimationFrame(this.frameHandle);
    }
    this.frameHandle = null;
    this.frameKind = null;
  }

  private scheduleFrame() {
    if (!this.ready || this.suspended || !this.video || this.frameHandle !== null) return;
    if (typeof this.video.requestVideoFrameCallback === 'function') {
      this.frameKind = 'video';
      this.frameHandle = this.video.requestVideoFrameCallback(this.onFrame);
    } else {
      this.frameKind = 'raf';
      this.frameHandle = requestAnimationFrame(this.onFrame);
    }
  }

  private onFrame = () => {
    this.frameHandle = null;
    this.frameKind = null;
    this.scheduleFrame();
    const video = this.video;
    const now = performance.now();
    if (!video || !this.worker || this.suspended || this.inflight || video.readyState < 2
      || now - this.lastFrameAt < 50 || video.currentTime === this.lastVideoTime) return;
    this.inflight = true;
    this.inflightAt = now;
    this.lastFrameAt = now;
    this.lastVideoTime = video.currentTime;
    const generation = this.generation;
    const capturedAt = Date.now();
    createImageBitmap(video).then(bitmap => {
      if (generation !== this.generation) { bitmap.close(); return; }
      if (this.suspended || !this.worker) { bitmap.close(); this.inflight = false; return; }
      if (Date.now() - capturedAt > STALE_AFTER_MS) { bitmap.close(); this.inflight = false; return; }
      const message: WorkerInput = { type: 'frame', bitmap, timestamp: now, capturedAt };
      try { this.worker.postMessage(message, [bitmap]); }
      catch (error) { bitmap.close(); this.fail(this.friendlyError(error)); }
    }).catch(error => { if (generation === this.generation) this.fail(this.friendlyError(error)); });
  };
}

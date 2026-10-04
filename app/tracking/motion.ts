import type { MotionSnapshot } from '../contracts';
import type { PoseLandmark } from './types';

export const RIGHT_ARM = [12, 14, 16] as const;
export const VISIBILITY_THRESHOLD = 0.65;
export const STALE_AFTER_MS = 500;

/** Elbow flexion: straight is 0°, a right angle is 90°. Uses 3D world landmarks. */
export function elbowFlexionDegrees(
  shoulder: Pick<PoseLandmark, 'x' | 'y' | 'z'>,
  elbow: Pick<PoseLandmark, 'x' | 'y' | 'z'>,
  wrist: Pick<PoseLandmark, 'x' | 'y' | 'z'>,
): number | null {
  if (![shoulder, elbow, wrist].every(point => [point.x, point.y, point.z].every(Number.isFinite))) return null;
  const upper = [shoulder.x - elbow.x, shoulder.y - elbow.y, shoulder.z - elbow.z];
  const lower = [wrist.x - elbow.x, wrist.y - elbow.y, wrist.z - elbow.z];
  const lengths = Math.hypot(...upper) * Math.hypot(...lower);
  if (lengths < 1e-8) return null;
  const dot = upper.reduce((sum, value, index) => sum + value * lower[index], 0);
  const cosine = Math.max(-1, Math.min(1, dot / lengths));
  return 180 - Math.acos(cosine) * 180 / Math.PI;
}

export function measureRightElbow(landmarks: PoseLandmark[], worldLandmarks: PoseLandmark[]) {
  const imagePoints = RIGHT_ARM.map(index => landmarks[index]);
  const worldPoints = RIGHT_ARM.map(index => worldLandmarks[index]);
  if (imagePoints.some(point => !point) || worldPoints.some(point => !point)) {
    return { angleDeg: null, quality: 0 };
  }
  const quality = Math.min(...imagePoints.map(point => Number.isFinite(point.visibility) ? point.visibility! : 0));
  const inFrame = imagePoints.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
  if (!inFrame || quality < VISIBILITY_THRESHOLD) return { angleDeg: null, quality: Math.max(0, Math.min(1, quality)) };
  const angleDeg = elbowFlexionDegrees(worldPoints[0], worldPoints[1], worldPoints[2]);
  return { angleDeg, quality: Math.max(0, Math.min(1, quality)) };
}

export function emptySnapshot(status: MotionSnapshot['status'] = 'idle', message?: string): MotionSnapshot {
  return { source: 'camera', side: 'right', joint: 'elbow', angleDeg: null, phase: 'unknown', quality: 0,
    capturedAt: 0, status, fps: 0, ...(message ? { message } : {}) };
}

/** Timestamp-based smoothing and stale-state handling, independent from browser APIs. */
export class MotionEstimator {
  private latest = emptySnapshot('starting');
  private previousAt = 0;
  private previousAngle: number | null = null;
  private velocity = 0;

  reset() {
    this.latest = emptySnapshot('starting');
    this.previousAt = 0;
    this.previousAngle = null;
    this.velocity = 0;
  }

  update(landmarks: PoseLandmark[], worldLandmarks: PoseLandmark[], capturedAt: number, now = capturedAt): MotionSnapshot {
    const measurement = measureRightElbow(landmarks, worldLandmarks);
    if (measurement.angleDeg === null || now - capturedAt > STALE_AFTER_MS) {
      this.latest = { ...this.latest, quality: measurement.quality, phase: 'unknown', message: '請讓右側肩膀、手肘與手腕完整入鏡' };
      return this.tick(now);
    }
    // A late or duplicate result must never reverse the filter's clock.
    if (this.previousAt && capturedAt <= this.previousAt) return this.tick(now);
    const elapsed = capturedAt - this.previousAt;
    const reacquired = this.previousAngle === null || elapsed > STALE_AFTER_MS;
    const alpha = reacquired ? 1 : 1 - Math.exp(-elapsed / 90);
    const angleDeg = reacquired ? measurement.angleDeg : this.previousAngle! + alpha * (measurement.angleDeg - this.previousAngle!);
    const speed = reacquired ? 0 : (angleDeg - this.previousAngle!) * 1000 / elapsed;
    this.velocity = reacquired ? 0 : this.velocity + (1 - Math.exp(-elapsed / 100)) * (speed - this.velocity);
    const phase: MotionSnapshot['phase'] = reacquired ? 'holding' : this.velocity > 8 ? 'flexing' : this.velocity < -8 ? 'extending' : 'holding';
    const fps = reacquired ? 0 : this.latest.fps ? 0.8 * this.latest.fps + 0.2 * Math.min(20, 1000 / elapsed) : Math.min(20, 1000 / elapsed);
    this.previousAngle = angleDeg;
    this.previousAt = capturedAt;
    this.latest = { source: 'camera', side: 'right', joint: 'elbow', angleDeg, phase,
      quality: measurement.quality, capturedAt, status: 'tracking', fps };
    return { ...this.latest };
  }

  tick(now: number): MotionSnapshot {
    if (!this.previousAt || now - this.previousAt > STALE_AFTER_MS) {
      this.previousAngle = null;
      this.velocity = 0;
      this.latest = { ...this.latest, angleDeg: null, phase: 'unknown', status: 'lost', fps: 0,
        quality: 0, message: '追蹤不足：請將右側肩膀、手肘與手腕移回畫面' };
    }
    return { ...this.latest };
  }
}

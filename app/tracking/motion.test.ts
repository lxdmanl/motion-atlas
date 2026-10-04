import { describe, expect, it } from 'vitest';
import { elbowFlexionDegrees, measureRightElbow, MotionEstimator, RIGHT_ARM } from './motion';
import type { PoseLandmark } from './types';

function pose(angle: number, visibility = 0.99) {
  const radians = angle * Math.PI / 180;
  const landmarks: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility }));
  const worldLandmarks: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility }));
  worldLandmarks[12] = { x: 0, y: 0.3, z: 0, visibility };
  worldLandmarks[14] = { x: 0, y: 0, z: 0, visibility };
  worldLandmarks[16] = { x: 0.3 * Math.sin(radians), y: -0.3 * Math.cos(radians), z: 0, visibility };
  return { landmarks, worldLandmarks };
}

function update(estimator: MotionEstimator, angle: number, timestamp: number, visibility = 0.99) {
  const data = pose(angle, visibility);
  return estimator.update(data.landmarks, data.worldLandmarks, timestamp);
}

describe('right elbow geometry', () => {
  it.each([0, 60, 90, 110, 150])('measures %s degrees of flexion', angle => {
    const { landmarks, worldLandmarks } = pose(angle);
    expect(measureRightElbow(landmarks, worldLandmarks).angleDeg).toBeCloseTo(angle, 6);
  });

  it('uses 3D depth and is invariant to translation and scale', () => {
    expect(elbowFlexionDegrees({ x: 4, y: 5, z: 7 }, { x: 4, y: 5, z: 5 }, { x: 6, y: 5, z: 5 })).toBeCloseTo(90);
  });

  it('rejects zero-length and non-finite bones', () => {
    const origin = { x: 0, y: 0, z: 0 };
    expect(elbowFlexionDegrees(origin, origin, { x: 1, y: 1, z: 1 })).toBeNull();
    expect(elbowFlexionDegrees({ x: NaN, y: 1, z: 0 }, origin, { x: 1, y: 0, z: 0 })).toBeNull();
  });

  it('rejects a missing, low-confidence or out-of-frame right-arm landmark', () => {
    expect(measureRightElbow([], []).angleDeg).toBeNull();
    for (const index of RIGHT_ARM) {
      const { landmarks, worldLandmarks } = pose(60);
      landmarks[index].visibility = 0.64;
      expect(measureRightElbow(landmarks, worldLandmarks).angleDeg).toBeNull();
      landmarks[index].visibility = 0.99;
      landmarks[index].x = -0.1;
      expect(measureRightElbow(landmarks, worldLandmarks).angleDeg).toBeNull();
    }
  });

  it('selects anatomical right side even when preview is mirrored', () => {
    const { landmarks, worldLandmarks } = pose(60);
    worldLandmarks[11] = { x: 0, y: 2, z: 0 };
    worldLandmarks[13] = { x: 0, y: 0, z: 0 };
    worldLandmarks[15] = { x: 0, y: -2, z: 0 };
    const mirrored = landmarks.map(point => ({ ...point, x: 1 - point.x }));
    expect(measureRightElbow(mirrored, worldLandmarks).angleDeg).toBeCloseTo(60);
  });
});

describe('tracking state', () => {
  it('smooths movement and identifies flexing / extending', () => {
    const estimator = new MotionEstimator();
    expect(update(estimator, 0, 1000).phase).toBe('holding');
    const flexing = update(estimator, 60, 1050);
    expect(flexing.angleDeg).toBeGreaterThan(0);
    expect(flexing.angleDeg).toBeLessThan(60);
    expect(flexing.phase).toBe('flexing');
    for (let t = 1100; t <= 1550; t += 50) update(estimator, 100, t);
    let extending = update(estimator, 0, 1600);
    extending = update(estimator, 0, 1650);
    expect(extending.phase).toBe('extending');
  });

  it('drops stale measurements after 500 ms and reacquires without an old-angle jump', () => {
    const estimator = new MotionEstimator();
    update(estimator, 20, 1000);
    expect(estimator.tick(1500).status).toBe('tracking');
    expect(estimator.tick(1501)).toMatchObject({ status: 'lost', angleDeg: null, phase: 'unknown', fps: 0 });
    expect(update(estimator, 110, 1600)).toMatchObject({ status: 'tracking', phase: 'holding' });
    expect(update(estimator, 110, 1650).angleDeg).toBeCloseTo(110);
  });

  it('does not infer movement from low-confidence detections', () => {
    const estimator = new MotionEstimator();
    update(estimator, 30, 1000);
    const uncertain = update(estimator, 100, 1050, 0.2);
    expect(uncertain.angleDeg).toBeCloseTo(30);
    expect(uncertain.phase).toBe('unknown');
    expect(estimator.tick(1600).angleDeg).toBeNull();
  });

  it('rejects delayed and duplicate results', () => {
    const estimator = new MotionEstimator();
    update(estimator, 60, 1000);
    expect(update(estimator, 140, 1000).angleDeg).toBeCloseTo(60);
    const data = pose(100);
    expect(estimator.update(data.landmarks, data.worldLandmarks, 1100, 1700).status).toBe('lost');
  });

  it('reset forgets the previous movement', () => {
    const estimator = new MotionEstimator();
    update(estimator, 20, 1000);
    update(estimator, 60, 1050);
    estimator.reset();
    expect(update(estimator, 100, 1100).phase).toBe('holding');
    expect(update(estimator, 100, 1150).angleDeg).toBeCloseTo(100);
  });
});

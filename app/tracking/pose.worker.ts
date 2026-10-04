import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { WorkerInput, WorkerOutput } from './types';

// Keep this worker independent from DOM globals; inference must never block React/Three.js.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerInput>) => void) | null;
  postMessage: (message: WorkerOutput) => void;
  location: Location;
};
let landmarker: PoseLandmarker | null = null;
let initMessage: Extract<WorkerInput, { type: 'init' }> | null = null;
let delegate: 'GPU' | 'CPU' = 'GPU';
let loaderAttempt = 0;

async function createLandmarker(message: Extract<WorkerInput, { type: 'init' }>, nextDelegate: 'GPU' | 'CPU') {
  const vision = await FilesetResolver.forVisionTasks(message.wasmPath, true);
  // Each createFromOptions consumes/clears the loader's global factory. A fresh
  // module evaluation is required for a GPU → CPU retry in the same worker.
  vision.wasmLoaderPath += `?attempt=${++loaderAttempt}`;
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: message.modelPath, delegate: nextDelegate },
    canvas: new OffscreenCanvas(640, 480),
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.6,
    minPosePresenceConfidence: 0.6,
    minTrackingConfidence: 0.6,
    outputSegmentationMasks: false,
  });
}

scope.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      initMessage = data;
      try {
        delegate = 'GPU';
        landmarker = await createLandmarker(data, delegate);
      } catch {
        landmarker?.close();
        delegate = 'CPU';
        landmarker = await createLandmarker(data, delegate);
      }
      scope.postMessage({ type: 'ready', delegate });
    } else if (data.type === 'frame') {
      try {
        if (!landmarker) throw new Error('姿態模型尚未就緒');
        let result;
        try {
          result = landmarker.detectForVideo(data.bitmap, data.timestamp);
        } catch (error) {
          // Some drivers create a GPU graph but fail on its first inference.
          if (delegate !== 'GPU' || !initMessage) throw error;
          landmarker.close();
          delegate = 'CPU';
          landmarker = await createLandmarker(initMessage, delegate);
          result = landmarker.detectForVideo(data.bitmap, data.timestamp);
        }
        scope.postMessage({ type: 'result', landmarks: result.landmarks[0] ?? [],
          worldLandmarks: result.worldLandmarks[0] ?? [], capturedAt: data.capturedAt });
      } finally {
        data.bitmap.close();
      }
    } else {
      landmarker?.close();
      landmarker = null;
    }
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

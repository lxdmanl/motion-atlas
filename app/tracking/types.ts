export interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export type WorkerInput =
  | { type: 'init'; wasmPath: string; modelPath: string }
  | { type: 'frame'; bitmap: ImageBitmap; timestamp: number; capturedAt: number }
  | { type: 'dispose' };

export type WorkerOutput =
  | { type: 'ready'; delegate: 'GPU' | 'CPU' }
  | { type: 'result'; landmarks: PoseLandmark[]; worldLandmarks: PoseLandmark[]; capturedAt: number }
  | { type: 'error'; message: string };

export interface MotionSnapshot {
  source: 'camera' | 'demo' | 'none';
  side: 'right';
  joint: 'elbow';
  angleDeg: number | null;
  phase: 'flexing' | 'extending' | 'holding' | 'unknown';
  quality: number;
  capturedAt: number;
  status: 'idle' | 'starting' | 'tracking' | 'lost' | 'error';
  fps: number;
  message?: string;
}

export interface ViewState {
  focus: 'body' | 'arm';
  view: 'front' | 'side' | 'back' | 'three-quarter';
  layers: { skeletal: boolean; muscular: boolean; connective: boolean };
  selected: string[];
}

export const INITIAL_MOTION: MotionSnapshot = {
  source: 'none', side: 'right', joint: 'elbow', angleDeg: null,
  phase: 'unknown', quality: 0, capturedAt: 0, status: 'idle', fps: 0,
};

export const INITIAL_VIEW: ViewState = {
  focus: 'body', view: 'three-quarter',
  layers: { skeletal: true, muscular: true, connective: false }, selected: [],
};

export interface RigManifest {
  schemaVersion: 1;
  glbUrl: string;
  replacedPartIds: string[];
  elbowBoneName: string;
  flexionAxis: 'x' | 'y' | 'z';
  flexionSign: 1 | -1;
  elbow: [number, number, number];
  shoulder: [number, number, number];
  wrist: [number, number, number];
  sourceCommit: string;
}

import type { PoseLandmark } from './types';
import { RIGHT_ARM, VISIBILITY_THRESHOLD } from './motion';

/** Canvas must have the same aspect ratio/object-fit as its video. CSS may mirror both together. */
export function drawPoseOverlay(canvas: HTMLCanvasElement, landmarks: PoseLandmark[] | null, options: { mirrored?: boolean } = {}) {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!landmarks) return;
  const points = RIGHT_ARM.map(index => landmarks[index]);
  const visible = (point: PoseLandmark | undefined): point is PoseLandmark => !!point
    && (point.visibility ?? 0) >= VISIBILITY_THRESHOLD && Number.isFinite(point.x) && Number.isFinite(point.y);
  const position = (point: PoseLandmark) => ({ x: (options.mirrored ? 1 - point.x : point.x) * canvas.width, y: point.y * canvas.height });
  const radius = Math.max(4, canvas.width / 90);
  context.save();
  context.lineWidth = Math.max(3, canvas.width / 150);
  context.strokeStyle = '#68f4de';
  context.shadowColor = '#40f0cf';
  context.shadowBlur = 8;
  for (let index = 0; index < points.length - 1; index++) {
    if (!visible(points[index]) || !visible(points[index + 1])) continue;
    const from = position(points[index]);
    const to = position(points[index + 1]);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }
  for (const point of points) {
    if (!visible(point)) continue;
    const projected = position(point);
    context.beginPath();
    context.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
    context.fillStyle = '#eafff9';
    context.fill();
  }
  context.restore();
}

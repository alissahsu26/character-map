export function getKeypoint(keypoints, name) {
  return keypoints.find((kp) => kp.name === name);
}

export function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function angleBetween(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Stable in-plane tilt (handles mirrored left-right). */
export function planarTiltAngle(left, right) {
  if (!left || !right) return 0;
  let dx = right.x - left.x;
  let dy = right.y - left.y;
  if (Math.abs(dx) < 1e-4) return 0;
  if (dx < 0) { dx = -dx; dy = -dy; }
  return Math.atan2(dy, dx);
}

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

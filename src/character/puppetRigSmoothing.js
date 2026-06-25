/** Strong EMA on the display rig — keeps PNG overlays stable during small pose drift. */
const POS_ALPHA = 0.09;
const SIZE_ALPHA = 0.06;
const ANGLE_ALPHA = 0.08;
/** Ignore sub-pixel jitter when the body is relatively still. */
const STILL_DEADZONE_PX = 2.5;
const STILL_MOTION_THRESHOLD = 0.18;
/** Follow large/fast motion more quickly so gestures stay responsive. */
const FAST_MOTION_THRESHOLD = 0.45;
const FAST_POS_ALPHA = 0.28;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpAngle(curr, prev, t) {
  if (curr == null) return prev;
  if (prev == null) return curr;
  let diff = curr - prev;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return prev + diff * t;
}

function smoothScalar(curr, prev, alpha, deadzone = 0) {
  if (curr == null) return prev ?? curr;
  if (prev == null) return curr;
  const delta = curr - prev;
  if (deadzone && Math.abs(delta) < deadzone) return prev;
  return lerp(prev, curr, alpha);
}

function smoothPoint(curr, prev, alpha, deadzone = 0) {
  if (!curr) return prev ?? null;
  if (!prev) return { ...curr };
  const dx = curr.x - prev.x;
  const dy = curr.y - prev.y;
  if (deadzone && Math.hypot(dx, dy) < deadzone) return prev;
  return {
    ...curr,
    x: lerp(prev.x, curr.x, alpha),
    y: lerp(prev.y, curr.y, alpha),
  };
}

function smoothCenter(curr, prev, alpha, deadzone = 0) {
  if (!curr) return prev ?? null;
  if (!prev) return { ...curr };
  const dx = curr.cx - prev.cx;
  const dy = curr.cy - prev.cy;
  if (deadzone && Math.hypot(dx, dy) < deadzone) return prev;
  return {
    ...curr,
    cx: lerp(prev.cx, curr.cx, alpha),
    cy: lerp(prev.cy, curr.cy, alpha),
  };
}

function smoothSegment(curr, prev, posAlpha, deadzone = 0) {
  if (!curr) return prev ?? null;
  if (!prev) return { ...curr };
  const p1 = smoothPoint(
    { x: curr.x1, y: curr.y1 },
    { x: prev.x1, y: prev.y1 },
    posAlpha,
    deadzone,
  );
  const p2 = smoothPoint(
    { x: curr.x2, y: curr.y2 },
    { x: prev.x2, y: prev.y2 },
    posAlpha,
    deadzone,
  );
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}

function smoothNeck(curr, prev, posAlpha, sizeAlpha, deadzone = 0) {
  if (!curr) return prev ?? null;
  if (!prev) return { ...curr };
  const seg = smoothSegment(curr, prev, posAlpha, deadzone);
  return {
    ...seg,
    width: smoothScalar(curr.width, prev.width, sizeAlpha, deadzone * 0.5),
  };
}

/**
 * Temporal filter on the pixel-space puppet rig consumed by CharacterPuppet.
 * Reduces PNG overlay jitter from noisy landmarks without blocking real motion.
 */
export class PuppetRigSmoother {
  constructor() {
    this.prev = null;
  }

  reset() {
    this.prev = null;
  }

  smooth(rig, { motionEnergy = 0 } = {}) {
    if (!rig) {
      this.prev = null;
      return null;
    }

    if (!this.prev) {
      this.prev = structuredClone(rig);
      return rig;
    }

    const still = motionEnergy < STILL_MOTION_THRESHOLD;
    const fast = motionEnergy > FAST_MOTION_THRESHOLD;
    const posAlpha = fast ? FAST_POS_ALPHA : POS_ALPHA;
    const deadzone = still ? STILL_DEADZONE_PX : 0;

    const prev = this.prev;
    const head = smoothCenter(rig.head, prev.head, posAlpha, deadzone);
    if (head && rig.head) {
      head.radius = smoothScalar(rig.head.radius, prev.head?.radius, SIZE_ALPHA, deadzone);
      head.angle = lerpAngle(rig.head.angle, prev.head?.angle, ANGLE_ALPHA);
    }

    const torso = smoothCenter(rig.torso, prev.torso, posAlpha, deadzone);
    if (torso && rig.torso) {
      torso.width = smoothScalar(rig.torso.width, prev.torso?.width, SIZE_ALPHA, deadzone);
      torso.height = smoothScalar(rig.torso.height, prev.torso?.height, SIZE_ALPHA, deadzone);
      torso.angle = lerpAngle(rig.torso.angle, prev.torso?.angle, ANGLE_ALPHA);
    }

    const neck = smoothNeck(rig.neck, prev.neck, posAlpha, SIZE_ALPHA, deadzone);

    const leftUpperArm = smoothSegment(rig.leftUpperArm, prev.leftUpperArm, posAlpha, deadzone);
    const rightUpperArm = smoothSegment(rig.rightUpperArm, prev.rightUpperArm, posAlpha, deadzone);
    const leftLowerArm = smoothSegment(rig.leftLowerArm, prev.leftLowerArm, posAlpha, deadzone);
    const rightLowerArm = smoothSegment(rig.rightLowerArm, prev.rightLowerArm, posAlpha, deadzone);

    const leftHand = smoothCenter(rig.leftHand, prev.leftHand, posAlpha, deadzone);
    const rightHand = smoothCenter(rig.rightHand, prev.rightHand, posAlpha, deadzone);

    const joints = {
      leftShoulder: smoothPoint(rig.joints?.leftShoulder, prev.joints?.leftShoulder, posAlpha, deadzone),
      rightShoulder: smoothPoint(rig.joints?.rightShoulder, prev.joints?.rightShoulder, posAlpha, deadzone),
      leftElbow: smoothPoint(rig.joints?.leftElbow, prev.joints?.leftElbow, posAlpha, deadzone),
      rightElbow: smoothPoint(rig.joints?.rightElbow, prev.joints?.rightElbow, posAlpha, deadzone),
    };

    const smoothed = {
      ...rig,
      head,
      torso,
      neck,
      leftUpperArm,
      rightUpperArm,
      leftLowerArm,
      rightLowerArm,
      leftHand,
      rightHand,
      joints,
    };

    this.prev = smoothed;
    return smoothed;
  }
}

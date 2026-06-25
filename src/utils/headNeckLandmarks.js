import { getKeypoint, midpoint } from './poseMapping';

const POSE_WEIGHTS = {
  nose: 1.15,
  left_eye: 1.0,
  right_eye: 1.0,
  left_ear: 0.95,
  right_ear: 0.95,
};

const MIRROR_NAME = {
  left_ear: 'right_ear',
  right_ear: 'left_ear',
  left_eye: 'right_eye',
  right_eye: 'left_eye',
  left_shoulder: 'right_shoulder',
  right_shoulder: 'left_shoulder',
};

function scoreOk(kp, minConfidence) {
  return kp && kp.score >= minConfidence;
}

function resolveName(name, swapHands) {
  if (!swapHands) return name;
  return MIRROR_NAME[name] ?? name;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function weightedLandmark(keypoints, names, swapHands, minConfidence) {
  let wx = 0;
  let wy = 0;
  let w = 0;
  let count = 0;

  for (const name of names) {
    const kp = getKeypoint(keypoints, resolveName(name, swapHands));
    if (!scoreOk(kp, minConfidence)) continue;
    const baseW = POSE_WEIGHTS[name] ?? 1;
    const weight = kp.score * baseW;
    wx += kp.x * weight;
    wy += kp.y * weight;
    w += weight;
    count += 1;
  }

  if (w < 1e-6 || count === 0) return null;
  return { x: wx / w, y: wy / w, confidence: w / count };
}

function blendPoints(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function bestSidePoint(keypoints, side, swapHands, minConfidence) {
  const earName = side === 'left' ? 'left_ear' : 'right_ear';
  const eyeName = side === 'left' ? 'left_eye' : 'right_eye';
  const ear = getKeypoint(keypoints, resolveName(earName, swapHands));
  const eye = getKeypoint(keypoints, resolveName(eyeName, swapHands));

  if (scoreOk(ear, minConfidence) && scoreOk(eye, minConfidence)) {
    return {
      x: ear.x * 0.55 + eye.x * 0.45,
      y: ear.y * 0.55 + eye.y * 0.45,
      score: Math.max(ear.score, eye.score),
    };
  }
  if (scoreOk(ear, minConfidence)) return ear;
  if (scoreOk(eye, minConfidence)) return eye;
  return null;
}

function lineRoll(left, right) {
  const rdx = right.x - left.x;
  const rdy = -(right.y - left.y);
  if (Math.hypot(rdx, rdy) < 1e-4) return null;
  return Math.atan2(rdy, rdx);
}

/**
 * Fuse nose, eyes, ears, and shoulders into stable head/neck anchor points.
 */
export function extractHeadNeckLandmarks(
  keypoints,
  { swapHands = false, minConfidence = 0.5 } = {}
) {
  const nose = getKeypoint(keypoints, 'nose');
  const leftEye = getKeypoint(keypoints, resolveName('left_eye', swapHands));
  const rightEye = getKeypoint(keypoints, resolveName('right_eye', swapHands));
  const leftEar = getKeypoint(keypoints, resolveName('left_ear', swapHands));
  const rightEar = getKeypoint(keypoints, resolveName('right_ear', swapHands));
  const leftSide = bestSidePoint(keypoints, 'left', swapHands, minConfidence);
  const rightSide = bestSidePoint(keypoints, 'right', swapHands, minConfidence);

  const faceCenter = weightedLandmark(
    keypoints,
    ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear'],
    swapHands,
    minConfidence
  );
  const eyeMid = weightedLandmark(keypoints, ['left_eye', 'right_eye'], swapHands, minConfidence);
  const earMid = weightedLandmark(keypoints, ['left_ear', 'right_ear'], swapHands, minConfidence);

  const ls = getKeypoint(keypoints, resolveName('left_shoulder', swapHands));
  const rs = getKeypoint(keypoints, resolveName('right_shoulder', swapHands));
  const neckBase =
    scoreOk(ls, minConfidence) && scoreOk(rs, minConfidence) ? midpoint(ls, rs) : null;

  let neckTop = null;
  if (neckBase && faceCenter) {
    const headAnchor =
      earMid && eyeMid
        ? {
            x: earMid.x * 0.4 + eyeMid.x * 0.35 + faceCenter.x * 0.25,
            y: earMid.y * 0.4 + eyeMid.y * 0.35 + faceCenter.y * 0.25,
          }
        : faceCenter;
    neckTop = blendPoints(neckBase, headAnchor, 0.68);
  }

  const chinProxy =
    scoreOk(nose, minConfidence) && eyeMid
      ? { x: nose.x * 0.55 + eyeMid.x * 0.45, y: nose.y * 0.65 + eyeMid.y * 0.35 }
      : scoreOk(nose, minConfidence)
        ? nose
        : null;

  const hasNose = scoreOk(nose, minConfidence);
  // Valid as long as ANY facial signal is usable (faceCenter is the weighted
  // fusion across nose/eyes/ears, so it's non-null iff at least one of them
  // passed minConfidence). This keeps head tracking alive on partial
  // visibility (e.g. a profile view with only one eye/ear) instead of
  // requiring the nose specifically.
  const valid = !!faceCenter;

  return {
    valid,
    hasNose,
    nose,
    leftEye,
    rightEye,
    leftEar,
    rightEar,
    leftSide,
    rightSide,
    faceCenter,
    eyeMid,
    earMid,
    neckBase,
    neckTop,
    chinProxy,
  };
}

export function hasHeadNeckLandmarks(keypoints, minConfidence = 0.6) {
  return extractHeadNeckLandmarks(keypoints, { minConfidence }).valid;
}

/** Yaw / pitch / roll from fused landmarks; neckYaw/neckPitch from shoulder→neck segment. */
export function computeHeadNeckAngles(
  landmarks,
  videoSize,
  {
    mirrorX = false,
    yawGain = 3.8,
    pitchGain = 4.5,
    pitchNeutral = 0.12,
  } = {}
) {
  if (!landmarks?.valid) return null;

  const frameW = videoSize?.width || 640;
  const frameH = videoSize?.height || 480;
  const mirrorSign = mirrorX ? -1 : 1;

  const faceMid =
    landmarks.faceCenter ??
    (landmarks.leftSide && landmarks.rightSide
      ? midpoint(landmarks.leftSide, landmarks.rightSide)
      : null);
  if (!faceMid) return null;

  // Yaw/pitch are normally driven by the nose offset from the fused face
  // center. When the nose itself is occluded or low-confidence (common
  // mid-turn or when looking down), fall back to faceMid itself so the
  // offset is zero — a safe neutral default — rather than losing head
  // tracking entirely. Roll (below) never depended on the nose.
  const yawAnchor = landmarks.hasNose ? landmarks.nose : faceMid;

  const yaw = clamp(
    ((yawAnchor.x - faceMid.x) / frameW) * mirrorSign * yawGain,
    -0.65,
    0.65
  );

  const pitchNose = ((faceMid.y - yawAnchor.y) / frameH) * pitchGain;
  const pitchChin =
    landmarks.chinProxy && landmarks.eyeMid
      ? ((landmarks.eyeMid.y - landmarks.chinProxy.y) / frameH) * pitchGain * 0.6
      : 0;
  const pitch = clamp(pitchNose * 0.65 + pitchChin * 0.35 - pitchNeutral, -0.5, 0.5);

  const rolls = [];
  if (landmarks.leftSide && landmarks.rightSide) {
    const sideRoll = lineRoll(landmarks.leftSide, landmarks.rightSide);
    if (sideRoll != null) rolls.push({ v: sideRoll, w: 1.2 });
  }
  if (scoreOk(landmarks.leftEye) && scoreOk(landmarks.rightEye)) {
    const eyeRoll = lineRoll(landmarks.leftEye, landmarks.rightEye);
    if (eyeRoll != null) rolls.push({ v: eyeRoll, w: 1.0 });
  }
  if (scoreOk(landmarks.leftEar) && scoreOk(landmarks.rightEar)) {
    const earRoll = lineRoll(landmarks.leftEar, landmarks.rightEar);
    if (earRoll != null) rolls.push({ v: earRoll, w: 0.85 });
  }

  let roll = 0;
  if (rolls.length) {
    const totalW = rolls.reduce((sum, entry) => sum + entry.w, 0);
    roll = rolls.reduce((sum, entry) => sum + entry.v * entry.w, 0) / totalW;
    roll = clamp(roll * mirrorSign, -0.75, 0.75);
  }

  let neckYaw = 0;
  let neckPitch = 0;
  if (landmarks.neckBase && landmarks.neckTop) {
    const ndx = (landmarks.neckTop.x - landmarks.neckBase.x) * mirrorSign;
    const ndy = -(landmarks.neckTop.y - landmarks.neckBase.y);
    const neckLen = Math.hypot(ndx, ndy) || 1;
    neckYaw = clamp((ndx / frameW) * 4.2, -0.45, 0.45);
    neckPitch = clamp((ndy / neckLen) * 0.85 - 0.15, -0.35, 0.35);
  }

  return { yaw, pitch, roll, neckYaw, neckPitch };
}

/** Synthetic points for debug overlays (2D image space). */
export function derivedLandmarksForDebug(landmarks) {
  const out = [];
  const push = (name, point, score = 1) => {
    if (!point) return;
    out.push({ name, x: point.x, y: point.y, score });
  };

  push('face_center', landmarks.faceCenter, 0.95);
  push('eye_mid', landmarks.eyeMid, 0.92);
  push('ear_mid', landmarks.earMid, 0.88);
  push('neck_base', landmarks.neckBase, 0.9);
  push('neck_top', landmarks.neckTop, 0.9);
  push('chin_proxy', landmarks.chinProxy, 0.85);
  return out;
}

export function mergePoseKeypointsForDisplay(keypoints, derived = []) {
  if (!keypoints?.length) return derived;
  return [...keypoints, ...derived];
}

export const HEAD_NECK_CONNECTIONS = [
  ['left_shoulder', 'neck_base'],
  ['right_shoulder', 'neck_base'],
  ['neck_base', 'neck_top'],
  ['neck_top', 'face_center'],
  ['face_center', 'nose'],
  ['eye_mid', 'left_eye'],
  ['eye_mid', 'right_eye'],
  ['ear_mid', 'left_ear'],
  ['ear_mid', 'right_ear'],
  ['chin_proxy', 'nose'],
];

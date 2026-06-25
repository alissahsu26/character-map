/**
 * Convert MediaPipe BlazePose landmarks (33) into MoveNet-style keypoints (17)
 * so downstream bodyState / puppet / avatar code stays unchanged.
 */

const MOVENET_NAMES = [
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
];

/** BlazePose indices (or arrays to average for stability). */
const BLAZEPOSE_MAP = {
  nose: 0,
  left_eye: [1, 2, 3],
  right_eye: [4, 5, 6],
  left_ear: 7,
  right_ear: 8,
  left_shoulder: 11,
  right_shoulder: 12,
  left_elbow: 13,
  right_elbow: 14,
  // Average wrist + finger bases for a stabler wrist estimate when the wrist
  // landmark alone is partially occluded (common on the camera-facing side).
  left_wrist: [15, 17, 19],
  right_wrist: [16, 18, 20],
  left_hip: 23,
  right_hip: 24,
  left_knee: 25,
  right_knee: 26,
  left_ankle: 27,
  right_ankle: 28,
};

function landmarkScore(lm, { arm = false } = {}) {
  const visibility = lm.visibility ?? 1;
  const presence = lm.presence ?? 1;
  // Arm landmarks often have one signal dip while the other stays high; using
  // the stronger signal keeps elbows/wrists from flickering out of trust.
  if (arm) {
    return Math.max(visibility, presence) * 0.82 + Math.min(visibility, presence) * 0.18;
  }
  return Math.min(visibility, presence);
}

const ARM_LANDMARK_NAMES = new Set([
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
]);

function pickLandmark(landmarks, indexOrIndices, { arm = false } = {}) {
  if (Array.isArray(indexOrIndices)) {
    let x = 0;
    let y = 0;
    let scoreSum = 0;
    let count = 0;

    for (const idx of indexOrIndices) {
      const lm = landmarks[idx];
      if (!lm) continue;
      const score = landmarkScore(lm, { arm });
      x += lm.x * score;
      y += lm.y * score;
      scoreSum += score;
      count += 1;
    }

    if (!count || scoreSum < 1e-6) return null;
    return { x: x / scoreSum, y: y / scoreSum, score: scoreSum / count };
  }

  const lm = landmarks[indexOrIndices];
  if (!lm) return null;
  return { x: lm.x, y: lm.y, score: landmarkScore(lm, { arm }) };
}

/**
 * Boost pose wrist keypoints with the dedicated hand model when available.
 * Hand tracking is much more reliable for wrists than pose alone.
 *
 * @param {Array<{ name: string, x: number, y: number, score: number }>} keypoints
 * @param {Array<{ handedness: string, landmarks: Array<{ x: number, y: number }> }>} hands
 */
export function fuseHandWristsIntoKeypoints(keypoints, hands) {
  if (!keypoints?.length || !hands?.length) return keypoints;

  const byName = Object.fromEntries(keypoints.map((kp) => [kp.name, { ...kp }]));
  const HAND_SCORE = 0.88;

  for (const hand of hands) {
    const wrist = hand.landmarks?.[0];
    if (!wrist) continue;

    const label = (hand.handedness ?? '').toLowerCase();
    const side = label.startsWith('left') ? 'left' : 'right';
    const name = `${side}_wrist`;
    const existing = byName[name];

    if (!existing || existing.score < HAND_SCORE * 0.55) {
      byName[name] = { name, x: wrist.x, y: wrist.y, score: HAND_SCORE };
      continue;
    }

    const blend = existing.score < HAND_SCORE ? 0.72 : 0.45;
    byName[name] = {
      name,
      x: existing.x * (1 - blend) + wrist.x * blend,
      y: existing.y * (1 - blend) + wrist.y * blend,
      score: Math.max(existing.score, HAND_SCORE),
    };
  }

  return keypoints.map((kp) => byName[kp.name] ?? kp);
}

/**
 * @param {import('@mediapipe/tasks-vision').NormalizedLandmark[]} landmarks
 * @param {number} frameW
 * @param {number} frameH
 * @param {{ mirrorX?: boolean }} [options]
 */
export function mediapipePoseToMoveNet(landmarks, frameW, frameH, { mirrorX = true } = {}) {
  if (!landmarks?.length) return [];

  return MOVENET_NAMES.map((name) => {
    const arm = ARM_LANDMARK_NAMES.has(name);
    const picked = pickLandmark(landmarks, BLAZEPOSE_MAP[name], { arm });
    if (!picked) return { name, x: 0, y: 0, score: 0 };

    const nx = mirrorX ? 1 - picked.x : picked.x;
    return {
      name,
      x: nx * frameW,
      y: picked.y * frameH,
      score: picked.score,
    };
  });
}

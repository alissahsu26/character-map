import { getKeypoint } from './poseMapping';

import { LANDMARK_CONFIDENCE_THRESHOLD } from './poseConstants';
const WRIST_ABOVE_MARGIN = 0.04;

function landmarkOk(kp, minScore = LANDMARK_CONFIDENCE_THRESHOLD) {
  return kp && kp.score >= minScore;
}

/**
 * True when both arms are raised above the shoulders with confident landmarks.
 */
export function checkRaisedHands(keypoints, videoSize, minScore = LANDMARK_CONFIDENCE_THRESHOLD) {
  if (!keypoints?.length) return false;

  const ls = getKeypoint(keypoints, 'left_shoulder');
  const rs = getKeypoint(keypoints, 'right_shoulder');
  const le = getKeypoint(keypoints, 'left_elbow');
  const re = getKeypoint(keypoints, 'right_elbow');
  const lw = getKeypoint(keypoints, 'left_wrist');
  const rw = getKeypoint(keypoints, 'right_wrist');

  if (
    !landmarkOk(ls, minScore) ||
    !landmarkOk(rs, minScore) ||
    !landmarkOk(le, minScore) ||
    !landmarkOk(re, minScore) ||
    !landmarkOk(lw, minScore) ||
    !landmarkOk(rw, minScore)
  ) {
    return false;
  }

  const frameH = videoSize?.height || 480;
  const margin = frameH * WRIST_ABOVE_MARGIN;

  return lw.y < ls.y - margin && rw.y < rs.y - margin;
}

/**
 * Returns true once raised hands are held continuously for HOLD_MS.
 */
export function createCalibrationGate() {
  let holdStart = null;

  return {
    update(keypoints, videoSize) {
      const raised = checkRaisedHands(keypoints, videoSize);
      const now = performance.now();

      if (raised) {
        if (holdStart === null) holdStart = now;
        return now - holdStart >= HOLD_MS;
      }

      holdStart = null;
      return false;
    },
    reset() {
      holdStart = null;
    },
    getHoldProgress() {
      if (holdStart === null) return 0;
      return Math.min(1, (performance.now() - holdStart) / HOLD_MS);
    },
  };
}

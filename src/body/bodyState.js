import {
  getKeypoint,
  midpoint,
  distance,
  planarTiltAngle,
} from '../math/vector.js';
import { LANDMARK_CONFIDENCE_THRESHOLD } from '../utils/poseConstants.js';

const CONF = LANDMARK_CONFIDENCE_THRESHOLD;

function ok(kp) {
  return kp != null && kp.score >= CONF;
}

function norm(kp, W, H) {
  return { x: kp.x / W, y: kp.y / H, confidence: kp.score ?? 0 };
}

function normMid(a, b, W, H) {
  const m = midpoint(a, b);
  return { x: m.x / W, y: m.y / H };
}

function armRaise(shoulder, wrist, torsoH) {
  if (!ok(shoulder) || !ok(wrist)) return 0;
  const dy = shoulder.y - wrist.y;
  return Math.max(0, Math.min(1, dy / (torsoH * 0.8 || 100)));
}

function armAngle(shoulder, elbow) {
  if (!ok(shoulder) || !ok(elbow)) return 0;
  return Math.atan2(elbow.y - shoulder.y, elbow.x - shoulder.x);
}

/**
 * Convert smoothed MoveNet keypoints + videoSize into normalized BodyState.
 * All positions are 0–1 relative to the video frame.
 * Landmarks below CONF threshold are returned as null.
 */
export function computeBodyState(keypoints, videoSize) {
  if (!keypoints?.length) return null;

  const W = videoSize?.width || 640;
  const H = videoSize?.height || 480;

  const nose       = getKeypoint(keypoints, 'nose');
  const leftEye    = getKeypoint(keypoints, 'left_eye');
  const rightEye   = getKeypoint(keypoints, 'right_eye');
  const ls         = getKeypoint(keypoints, 'left_shoulder');
  const rs         = getKeypoint(keypoints, 'right_shoulder');
  const le         = getKeypoint(keypoints, 'left_elbow');
  const re         = getKeypoint(keypoints, 'right_elbow');
  const lw         = getKeypoint(keypoints, 'left_wrist');
  const rw         = getKeypoint(keypoints, 'right_wrist');
  const lh         = getKeypoint(keypoints, 'left_hip');
  const rh         = getKeypoint(keypoints, 'right_hip');
  const lk         = getKeypoint(keypoints, 'left_knee');
  const rk         = getKeypoint(keypoints, 'right_knee');
  const la         = getKeypoint(keypoints, 'left_ankle');
  const ra         = getKeypoint(keypoints, 'right_ankle');

  const headRaw =
    ok(nose) ? nose
    : (ok(leftEye) && ok(rightEye)) ? midpoint(leftEye, rightEye)
    : ok(leftEye) ? leftEye
    : ok(rightEye) ? rightEye
    : null;

  const shoulderMid =
    (ok(ls) && ok(rs)) ? midpoint(ls, rs)
    : ok(ls) ? ls
    : ok(rs) ? rs
    : null;

  const hipMid = (ok(lh) && ok(rh)) ? midpoint(lh, rh) : null;

  const shoulderWidthPx =
    (ok(ls) && ok(rs)) ? distance(ls, rs) : W * 0.25;

  const torsoHeightPx =
    shoulderMid && hipMid ? distance(shoulderMid, hipMid) : H * 0.3;

  const centerRaw =
    shoulderMid && hipMid ? midpoint(shoulderMid, hipMid)
    : shoulderMid ?? { x: W / 2, y: H / 2 };

  const activeCount = keypoints.filter((kp) => kp.score >= CONF).length;

  return {
    // normalized positions
    head:      headRaw  ? norm(headRaw,  W, H) : null,
    shoulders: {
      left:  ok(ls) ? norm(ls, W, H) : null,
      right: ok(rs) ? norm(rs, W, H) : null,
      mid:   shoulderMid ? { x: shoulderMid.x / W, y: shoulderMid.y / H } : null,
      width: shoulderWidthPx / W,
    },
    elbows: {
      left:  ok(le) ? norm(le, W, H) : null,
      right: ok(re) ? norm(re, W, H) : null,
    },
    wrists: {
      left:  ok(lw) ? norm(lw, W, H) : null,
      right: ok(rw) ? norm(rw, W, H) : null,
    },
    hips: {
      left:  ok(lh) ? norm(lh, W, H) : null,
      right: ok(rh) ? norm(rh, W, H) : null,
      mid:   hipMid ? { x: hipMid.x / W, y: hipMid.y / H } : null,
    },
    knees: {
      left:  ok(lk) ? norm(lk, W, H) : null,
      right: ok(rk) ? norm(rk, W, H) : null,
    },
    ankles: {
      left:  ok(la) ? norm(la, W, H) : null,
      right: ok(ra) ? norm(ra, W, H) : null,
    },
    center:          { x: centerRaw.x / W, y: centerRaw.y / H },
    scale:           torsoHeightPx / H,
    headTilt:        (ok(leftEye) && ok(rightEye)) ? planarTiltAngle(leftEye, rightEye) : 0,
    torsoLean:       (ok(ls) && ok(rs)) ? planarTiltAngle(ls, rs) : 0,
    leftArmAngle:    armAngle(ls, le),
    rightArmAngle:   armAngle(rs, re),
    leftArmRaise:    armRaise(ls, lw, torsoHeightPx),
    rightArmRaise:   armRaise(rs, rw, torsoHeightPx),
    motionEnergy:    0, // computed by BodyStateSmoother
    confidence:      Math.min(1, activeCount / 10),
  };
}

// ── BodyStateSmoother ──────────────────────────────────────────────────────────

const SMOOTH_ALPHA = 0.35;
const COAST_ALPHA  = 0.92; // decay applied to values when confidence is lost

function lerpVal(curr, prev, a) {
  if (curr == null) return prev ?? curr;
  if (prev == null) return curr;
  return curr * a + prev * (1 - a);
}

function lerpPt(curr, prev, a) {
  if (!curr) return prev ?? null;
  if (!prev) return curr;
  return {
    x:          lerpVal(curr.x,          prev.x,          a),
    y:          lerpVal(curr.y,          prev.y,          a),
    confidence: curr.confidence ?? prev.confidence ?? 0,
  };
}

function lerpPtPlain(curr, prev, a) {
  if (!curr) return prev ?? null;
  if (!prev) return curr;
  return { x: lerpVal(curr.x, prev.x, a), y: lerpVal(curr.y, prev.y, a) };
}

/**
 * Smooths BodyState values over time.
 * - Applies EMA for all scalar and positional fields.
 * - Holds last known good value when a landmark disappears (confidence gating).
 * - Computes motionEnergy from wrist velocity.
 */
export class BodyStateSmoother {
  constructor({ alpha = SMOOTH_ALPHA } = {}) {
    this.alpha = alpha;
    this.prev = null;
    this.motionEnergy = 0;
    this.lastTime = null;
  }

  smooth(raw) {
    const a = this.alpha;

    if (!raw) {
      // No pose detected — coast with decaying confidence
      if (this.prev) {
        const coasted = { ...this.prev, confidence: this.prev.confidence * COAST_ALPHA };
        this.prev = coasted;
        return coasted;
      }
      return null;
    }

    if (!this.prev) {
      this.prev = { ...raw };
      return raw;
    }

    // Motion energy from normalized wrist velocity
    const now = performance.now();
    const dt = this.lastTime ? Math.max(now - this.lastTime, 1) / 1000 : 0.016;
    this.lastTime = now;

    let wristSpeed = 0;
    if (raw.wrists.left && this.prev.wrists?.left) {
      wristSpeed += Math.hypot(
        raw.wrists.left.x  - this.prev.wrists.left.x,
        raw.wrists.left.y  - this.prev.wrists.left.y
      ) / dt;
    }
    if (raw.wrists.right && this.prev.wrists?.right) {
      wristSpeed += Math.hypot(
        raw.wrists.right.x - this.prev.wrists.right.x,
        raw.wrists.right.y - this.prev.wrists.right.y
      ) / dt;
    }
    // normalize: ~2 normalized units/s = fully energetic
    const targetEnergy = Math.min(1, wristSpeed / 2);
    this.motionEnergy = this.motionEnergy * 0.85 + targetEnergy * 0.15;

    const p = this.prev;
    const smoothed = {
      head: lerpPt(raw.head, p.head, a),
      shoulders: {
        left:  lerpPt(raw.shoulders.left,  p.shoulders?.left,  a),
        right: lerpPt(raw.shoulders.right, p.shoulders?.right, a),
        mid:   lerpPtPlain(raw.shoulders.mid, p.shoulders?.mid, a),
        width: lerpVal(raw.shoulders.width, p.shoulders?.width, a),
      },
      elbows: {
        left:  lerpPt(raw.elbows.left,  p.elbows?.left,  a),
        right: lerpPt(raw.elbows.right, p.elbows?.right, a),
      },
      wrists: {
        left:  lerpPt(raw.wrists.left,  p.wrists?.left,  a),
        right: lerpPt(raw.wrists.right, p.wrists?.right, a),
      },
      hips: {
        left:  lerpPt(raw.hips.left,  p.hips?.left,  a),
        right: lerpPt(raw.hips.right, p.hips?.right, a),
        mid:   lerpPtPlain(raw.hips.mid, p.hips?.mid, a),
      },
      knees: {
        left:  lerpPt(raw.knees.left,  p.knees?.left,  a),
        right: lerpPt(raw.knees.right, p.knees?.right, a),
      },
      ankles: {
        left:  lerpPt(raw.ankles.left,  p.ankles?.left,  a),
        right: lerpPt(raw.ankles.right, p.ankles?.right, a),
      },
      center:       lerpPtPlain(raw.center, p.center, a),
      scale:        lerpVal(raw.scale,        p.scale,        a),
      headTilt:     lerpVal(raw.headTilt,     p.headTilt,     a),
      torsoLean:    lerpVal(raw.torsoLean,    p.torsoLean,    a),
      leftArmAngle:  lerpVal(raw.leftArmAngle,  p.leftArmAngle,  a),
      rightArmAngle: lerpVal(raw.rightArmAngle, p.rightArmAngle, a),
      leftArmRaise:  lerpVal(raw.leftArmRaise,  p.leftArmRaise,  a),
      rightArmRaise: lerpVal(raw.rightArmRaise, p.rightArmRaise, a),
      motionEnergy: this.motionEnergy,
      confidence:   lerpVal(raw.confidence, p.confidence, a),
    };

    this.prev = smoothed;
    return smoothed;
  }
}

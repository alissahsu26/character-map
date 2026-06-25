import {
  getKeypoint,
  midpoint,
  distance,
  angleBetween,
  clamp,
  planarTiltAngle,
} from '../math/vector.js';
import { LANDMARK_CONFIDENCE_THRESHOLD } from '../utils/poseConstants.js';

const CONF = LANDMARK_CONFIDENCE_THRESHOLD;
const ARM_CONF = 0.38;
const WRIST_LOW = 0.35;
const ELBOW_HOLD = 0.28;
const ELBOW_INFER = 0.22;
const SHOULDER_FREEZE = 0.35;

/** Light EMA — landmarks only. */
const LANDMARK_ALPHA = 0.58;
/** Strong EMA — derived controls (lower alpha = smoother). */
const CONTROL_ALPHA = {
  torso: 0.14,
  arms: 0.2,
  wrists: 0.28,
};

function ok(kp) {
  return kp != null && kp.score >= CONF;
}

function armOk(kp) {
  return kp != null && kp.score >= ARM_CONF;
}

function score(kp) {
  return kp?.score ?? 0;
}

function norm(kp, W, H) {
  return { x: kp.x / W, y: kp.y / H, confidence: kp.score ?? 0 };
}

function lerpVal(curr, prev, a) {
  if (curr == null) return prev ?? curr;
  if (prev == null) return curr;
  return curr * a + prev * (1 - a);
}

function lerpAngle(curr, prev, a) {
  if (curr == null) return prev ?? curr;
  if (prev == null) return curr;
  let diff = curr - prev;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return prev + diff * a;
}

function torsoLeanFromCenters(shoulderCenter, hipCenter) {
  const vx = shoulderCenter.x - hipCenter.x;
  const vy = shoulderCenter.y - hipCenter.y;
  return Math.atan2(vx, -vy);
}

function armRaiseNorm(shoulder, wrist, hip) {
  if (!shoulder || !wrist || !hip) return 0;
  const span = hip.y - shoulder.y;
  if (Math.abs(span) < 1e-4) return 0;
  return clamp((hip.y - wrist.y) / span, 0, 1);
}

function armReachNorm(shoulder, wrist, shoulderWidth) {
  if (!shoulder || !wrist || !shoulderWidth) return 0;
  return clamp(distance(shoulder, wrist) / shoulderWidth, 0, 2);
}

function blendPoint(lowConfPt, highConfPt, weight) {
  if (!highConfPt) return lowConfPt;
  if (!lowConfPt) return highConfPt;
  const w = clamp(weight, 0, 1);
  return {
    x: lowConfPt.x * (1 - w) + highConfPt.x * w,
    y: lowConfPt.y * (1 - w) + highConfPt.y * w,
    score: Math.max(lowConfPt.score ?? 0, highConfPt.score ?? 0),
  };
}

function extrapolateWrist(shoulder, elbow, prevLowerLen) {
  const upperLen = distance(shoulder, elbow);
  const lowerLen = prevLowerLen || upperLen * 0.85;
  const ux = elbow.x - shoulder.x;
  const uy = elbow.y - shoulder.y;
  const uLen = Math.hypot(ux, uy) || 1;
  const ex = elbow.x + (ux / uLen) * lowerLen * 0.35 + (elbow.x - shoulder.x) * 0.65;
  const ey = elbow.y + (uy / uLen) * lowerLen * 0.35 + (elbow.y - shoulder.y) * 0.65;
  return { x: ex, y: ey, score: elbow.score ?? 0 };
}

/** Infer elbow from shoulder + wrist when pose loses the elbow landmark. */
function inferElbow(shoulder, wrist, side, prev) {
  const swDist = distance(shoulder, wrist);
  const upperLen = prev.upperLen || swDist * 0.55;
  const lowerLen = prev.lowerLen || swDist * 0.45;
  const total = upperLen + lowerLen || 1;
  const t = upperLen / total;

  const mx = shoulder.x + (wrist.x - shoulder.x) * t;
  const my = shoulder.y + (wrist.y - shoulder.y) * t;

  const dx = wrist.x - shoulder.x;
  const dy = wrist.y - shoulder.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = upperLen * 0.18 * (side === 'left' ? 1 : -1);
  const ex = mx + (-dy / len) * bend;
  const ey = my + (dx / len) * bend;

  const conf = Math.min(score(shoulder), score(wrist)) * 0.78;
  return { x: ex, y: ey, score: conf };
}

/**
 * Estimates stable torso and arm controls from pose landmarks.
 *
 * Pipeline:
 *   raw keypoints → light landmark smooth → derived controls (confidence-aware)
 *   → strong per-region control smooth → BodyState (no raw landmark → sprite mapping)
 */
export class BodyStateEstimator {
  constructor() {
    this.landmarks = {};
    this.controls = {};
    this.sideState = {
      left: { upperArmAngle: 0, lowerArmAngle: 0, armRaise: 0, armReach: 0, lowerLen: 0, upperLen: 0 },
      right: { upperArmAngle: 0, lowerArmAngle: 0, armRaise: 0, armReach: 0, lowerLen: 0, upperLen: 0 },
    };
    this.body = null;
    this.motionEnergy = 0;
    this.lastTime = null;
    this.debug = {};
  }

  /** @returns {{ bodyState: object|null, debug: object }} */
  estimate(keypoints, videoSize) {
    if (!keypoints?.length) {
      this.debug = { ...this.debug, poseLost: true };
      return { bodyState: this.body, debug: this.debug };
    }

    const W = videoSize?.width || 640;
    const H = videoSize?.height || 480;

    const raw = {
      nose: getKeypoint(keypoints, 'nose'),
      leftEye: getKeypoint(keypoints, 'left_eye'),
      rightEye: getKeypoint(keypoints, 'right_eye'),
      leftShoulder: getKeypoint(keypoints, 'left_shoulder'),
      rightShoulder: getKeypoint(keypoints, 'right_shoulder'),
      leftElbow: getKeypoint(keypoints, 'left_elbow'),
      rightElbow: getKeypoint(keypoints, 'right_elbow'),
      leftWrist: getKeypoint(keypoints, 'left_wrist'),
      rightWrist: getKeypoint(keypoints, 'right_wrist'),
      leftHip: getKeypoint(keypoints, 'left_hip'),
      rightHip: getKeypoint(keypoints, 'right_hip'),
      leftKnee: getKeypoint(keypoints, 'left_knee'),
      rightKnee: getKeypoint(keypoints, 'right_knee'),
      leftAnkle: getKeypoint(keypoints, 'left_ankle'),
      rightAnkle: getKeypoint(keypoints, 'right_ankle'),
    };

    const smoothedLm = this._smoothLandmarks(raw);
    const torsoRaw = this._computeTorso(smoothedLm);
    const leftRaw = this._computeArm('left', smoothedLm, torsoRaw);
    const rightRaw = this._computeArm('right', smoothedLm, torsoRaw);
    const torsoSm = this._smoothTorso(torsoRaw);
    const leftSm = this._smoothArm('left', leftRaw);
    const rightSm = this._smoothArm('right', rightRaw);

    const bodyState = this._buildBodyState(
      smoothedLm,
      torsoSm,
      leftSm,
      rightSm,
      W,
      H
    );

    this.body = bodyState;
    this.debug = {
      poseLost: false,
      rawLeftArmAngle: leftRaw.upperArmAngle,
      smoothedLeftArmAngle: leftSm.upperArmAngle,
      rawTorsoLean: torsoRaw.torsoLean,
      smoothedTorsoLean: torsoSm.torsoLean,
      leftConfidence: leftRaw.confidence,
      rightConfidence: rightRaw.confidence,
      leftFrozen: leftRaw.frozen,
      rightFrozen: rightRaw.frozen,
    };

    return { bodyState, debug: this.debug };
  }

  _smoothLandmarks(raw) {
    const a = LANDMARK_ALPHA;
    const prev = this.landmarks;
    const out = {};

    for (const key of Object.keys(raw)) {
      const curr = raw[key];
      const p = prev[key];
      if (!curr) {
        out[key] = p ? { ...p, score: (p.score ?? 0) * 0.92 } : null;
        continue;
      }
      if (!p) {
        out[key] = { ...curr };
        continue;
      }
      out[key] = {
        x: lerpVal(curr.x, p.x, a),
        y: lerpVal(curr.y, p.y, a),
        score: curr.score ?? 0,
        name: curr.name,
      };
    }

    this.landmarks = out;
    return out;
  }

  _computeTorso(lm) {
    const ls = lm.leftShoulder;
    const rs = lm.rightShoulder;
    const lh = lm.leftHip;
    const rh = lm.rightHip;

    const shoulderCenter =
      ls && rs ? midpoint(ls, rs) : ls ?? rs ?? null;
    const hipCenter =
      lh && rh ? midpoint(lh, rh) : lh ?? rh ?? null;

    let torsoLean = 0;
    let torsoScale = 0;

    if (shoulderCenter && hipCenter) {
      torsoLean = torsoLeanFromCenters(shoulderCenter, hipCenter);
    }
    if (ls && rs) {
      torsoScale = distance(ls, rs);
    }

    return { shoulderCenter, hipCenter, torsoLean, torsoScale };
  }

  _computeArm(side, lm, torso) {
    const shoulder = lm[`${side}Shoulder`];
    const elbow = lm[`${side}Elbow`];
    const wrist = lm[`${side}Wrist`];
    const hip = lm[`${side}Hip`];

    const confidence = {
      shoulder: score(shoulder),
      elbow: score(elbow),
      wrist: score(wrist),
    };

    const prev = this.sideState[side];
    const shoulderWidth = torso.torsoScale || 1;

    if (confidence.shoulder < SHOULDER_FREEZE) {
      const prevCtrl = this.controls[side];
      if (prevCtrl) {
        return { ...prevCtrl, confidence, frozen: true };
      }
      return {
        ...prev,
        shoulder,
        elbow,
        wrist,
        confidence,
        frozen: true,
      };
    }

    let effShoulder = shoulder;
    let effElbow = elbow;
    let effWrist = wrist;

    if (confidence.elbow < ELBOW_HOLD) {
      const shoulderOk = armOk(shoulder);
      const wristOk = armOk(wrist) || score(wrist) >= ELBOW_INFER;

      if (shoulderOk && wristOk) {
        const inferred = inferElbow(shoulder, wrist, side, prev);
        const holdWeight = clamp(confidence.elbow / ELBOW_HOLD, 0, 1);
        effElbow = elbow
          ? blendPoint(inferred, elbow, holdWeight)
          : inferred;
      } else {
        const prevCtrl = this.controls[side];
        return {
          upperArmAngle: prev.upperArmAngle,
          lowerArmAngle: prev.lowerArmAngle,
          armRaise: prev.armRaise,
          armReach: prev.armReach,
          shoulder: prevCtrl?.shoulder ?? shoulder,
          elbow: prevCtrl?.elbow ?? elbow,
          wrist: prevCtrl?.wrist ?? wrist,
          confidence,
          frozen: false,
        };
      }
    }

    if (confidence.wrist < WRIST_LOW) {
      const elbowWeight = 1 - clamp(confidence.wrist / WRIST_LOW, 0, 1);
      const extrapolated = extrapolateWrist(effShoulder, effElbow, prev.lowerLen);
      effWrist = blendPoint(wrist, extrapolated, elbowWeight);
      if (effElbow && effWrist) {
        prev.lowerLen = distance(effElbow, effWrist);
      }
    } else if (effElbow && effWrist) {
      prev.lowerLen = distance(effElbow, effWrist);
    }

    if (effShoulder && effElbow) {
      prev.upperLen = distance(effShoulder, effElbow);
    }

    const upperArmAngle = angleBetween(effShoulder, effElbow);
    const lowerArmAngle =
      effElbow && effWrist ? angleBetween(effElbow, effWrist) : prev.lowerArmAngle;
    const armRaise = armRaiseNorm(effShoulder, effWrist, hip ?? torso.hipCenter);
    const armReach = armReachNorm(effShoulder, effWrist, shoulderWidth);

    const result = {
      upperArmAngle,
      lowerArmAngle,
      armRaise,
      armReach,
      shoulder: effShoulder,
      elbow: effElbow,
      wrist: effWrist,
      confidence,
      frozen: false,
    };

    this.sideState[side] = {
      upperArmAngle: result.upperArmAngle,
      lowerArmAngle: result.lowerArmAngle,
      armRaise: result.armRaise,
      armReach: result.armReach,
      lowerLen: prev.lowerLen,
      upperLen: prev.upperLen,
    };

    return result;
  }

  _smoothTorso(raw) {
    const prev = this.controls.torso ?? {};
    const a = CONTROL_ALPHA.torso;
    const smoothed = {
      torsoLean: lerpAngle(raw.torsoLean, prev.torsoLean, a),
      torsoScale: lerpVal(raw.torsoScale, prev.torsoScale, a),
      shoulderCenter: raw.shoulderCenter,
      hipCenter: raw.hipCenter,
    };
    this.controls.torso = smoothed;
    return smoothed;
  }

  _smoothArm(side, raw) {
    if (raw.frozen) {
      return raw;
    }

    const prev = this.controls[side] ?? {};
    const armAlpha = CONTROL_ALPHA.arms;
    const wristAlpha = CONTROL_ALPHA.wrists;

    const smoothed = {
      upperArmAngle: lerpAngle(raw.upperArmAngle, prev.upperArmAngle, armAlpha),
      lowerArmAngle: lerpAngle(raw.lowerArmAngle, prev.lowerArmAngle, wristAlpha),
      armRaise: lerpVal(raw.armRaise, prev.armRaise, wristAlpha),
      armReach: lerpVal(raw.armReach, prev.armReach, wristAlpha),
      shoulder: raw.shoulder,
      elbow: raw.elbow,
      wrist: raw.wrist,
      confidence: raw.confidence,
      frozen: false,
    };

    this.controls[side] = smoothed;
    return smoothed;
  }

  _buildBodyState(lm, torso, left, right, W, H) {
    const nose = lm.nose;
    const leftEye = lm.leftEye;
    const rightEye = lm.rightEye;

    const headRaw =
      ok(nose) ? nose
      : (ok(leftEye) && ok(rightEye)) ? midpoint(leftEye, rightEye)
      : ok(leftEye) ? leftEye
      : ok(rightEye) ? rightEye
      : null;

    const shoulderMid = torso.shoulderCenter;
    const hipMid = torso.hipCenter;
    const shoulderWidthPx = torso.torsoScale || W * 0.25;
    const torsoHeightPx =
      shoulderMid && hipMid ? distance(shoulderMid, hipMid) : H * 0.3;

    const centerRaw =
      shoulderMid && hipMid ? midpoint(shoulderMid, hipMid)
      : shoulderMid ?? { x: W / 2, y: H / 2 };

    const activeCount = Object.values(lm).filter((kp) => kp && kp.score >= CONF).length;

    const now = performance.now();
    const dt = this.lastTime ? Math.max(now - this.lastTime, 1) / 1000 : 0.016;
    this.lastTime = now;

    let wristSpeed = 0;
    const prevBody = this.body;
    if (left.wrist && prevBody?.wrists?.left) {
      wristSpeed += Math.hypot(
        left.wrist.x / W - prevBody.wrists.left.x,
        left.wrist.y / H - prevBody.wrists.left.y
      ) / dt;
    }
    if (right.wrist && prevBody?.wrists?.right) {
      wristSpeed += Math.hypot(
        right.wrist.x / W - prevBody.wrists.right.x,
        right.wrist.y / H - prevBody.wrists.right.y
      ) / dt;
    }
    const targetEnergy = Math.min(1, wristSpeed / 2);
    this.motionEnergy = this.motionEnergy * 0.85 + targetEnergy * 0.15;

    return {
      head: headRaw ? norm(headRaw, W, H) : null,
      shoulders: {
        left: left.shoulder ? norm(left.shoulder, W, H) : null,
        right: right.shoulder ? norm(right.shoulder, W, H) : null,
        mid: shoulderMid ? { x: shoulderMid.x / W, y: shoulderMid.y / H } : null,
        width: shoulderWidthPx / W,
      },
      elbows: {
        left: left.elbow && armOk(left.elbow) ? norm(left.elbow, W, H) : null,
        right: right.elbow && armOk(right.elbow) ? norm(right.elbow, W, H) : null,
      },
      wrists: {
        left: left.wrist && armOk(left.wrist) ? norm(left.wrist, W, H) : null,
        right: right.wrist && armOk(right.wrist) ? norm(right.wrist, W, H) : null,
      },
      hips: {
        left: lm.leftHip && ok(lm.leftHip) ? norm(lm.leftHip, W, H) : null,
        right: lm.rightHip && ok(lm.rightHip) ? norm(lm.rightHip, W, H) : null,
        mid: hipMid ? { x: hipMid.x / W, y: hipMid.y / H } : null,
      },
      knees: {
        left: lm.leftKnee && ok(lm.leftKnee) ? norm(lm.leftKnee, W, H) : null,
        right: lm.rightKnee && ok(lm.rightKnee) ? norm(lm.rightKnee, W, H) : null,
      },
      ankles: {
        left: lm.leftAnkle && ok(lm.leftAnkle) ? norm(lm.leftAnkle, W, H) : null,
        right: lm.rightAnkle && ok(lm.rightAnkle) ? norm(lm.rightAnkle, W, H) : null,
      },
      center: { x: centerRaw.x / W, y: centerRaw.y / H },
      scale: torsoHeightPx / H,
      headTilt: (ok(leftEye) && ok(rightEye)) ? planarTiltAngle(leftEye, rightEye) : 0,
      torsoLean: torso.torsoLean,
      torsoScale: torso.torsoScale / W,
      leftArmAngle: left.upperArmAngle,
      rightArmAngle: right.upperArmAngle,
      leftLowerArmAngle: left.lowerArmAngle,
      rightLowerArmAngle: right.lowerArmAngle,
      leftArmRaise: left.armRaise,
      rightArmRaise: right.armRaise,
      leftArmReach: left.armReach,
      rightArmReach: right.armReach,
      motionEnergy: this.motionEnergy,
      confidence: Math.min(1, activeCount / 10),
    };
  }
}

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
const WRIST_INFER = 0.22;
const ELBOW_HOLD = 0.28;
const ELBOW_INFER = 0.22;
const SHOULDER_FREEZE = 0.35;
/** Elbow flex (rad) relative to upper arm — anatomical range + per-frame slew limit. */
const ELBOW_FLEX_MIN = -0.35;
const ELBOW_FLEX_MAX = 2.75;
const ELBOW_FLEX_SLEW = 0.22;

/** Pose wrist scores below this are too noisy to drive forearm direction. */
const WRIST_TRUST = 0.55;

/** Per-side tuning — right arm is usually camera-facing and noisier. */
const SIDE_PROFILE = {
  left: {
    elbowHold: ELBOW_HOLD,
    elbowInfer: ELBOW_INFER,
    wristLow: WRIST_LOW,
    wristInfer: WRIST_INFER,
    wristTrust: WRIST_TRUST,
    lowerAlpha: 0.18,
    landmarkDecay: 0.92,
    ikBlendMax: 0.5,
  },
  right: {
    elbowHold: 0.22,
    elbowInfer: 0.16,
    wristLow: 0.28,
    wristInfer: 0.16,
    wristTrust: WRIST_TRUST,
    lowerAlpha: 0.14,
    landmarkDecay: 0.945,
    ikBlendMax: 0.62,
  },
};

const RIGHT_ARM_LM = new Set(['rightShoulder', 'rightElbow', 'rightWrist']);

/** Light EMA — landmarks only. */
const LANDMARK_ALPHA = 0.58;
/** Strong EMA — derived controls (lower alpha = smoother). */
const CONTROL_ALPHA = {
  torso: 0.14,
  arms: 0.2,
  lowerArm: 0.18,
  wrists: 0.28,
};
/** Joint positions fed into the display puppet (lower alpha = less PNG jitter). */
const DISPLAY_POS_ALPHA = 0.12;

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

function lerpPoint(curr, prev, a) {
  if (!curr) return prev ?? null;
  if (!prev) return curr;
  return {
    x: lerpVal(curr.x, prev.x, a),
    y: lerpVal(curr.y, prev.y, a),
    score: curr.score ?? prev.score ?? 0,
    handFused: curr.handFused ?? prev.handFused,
  };
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
    handFused: !!(lowConfPt.handFused || highConfPt.handFused),
  };
}

function normalizeAngle(a) {
  let v = a;
  while (v > Math.PI) v -= 2 * Math.PI;
  while (v < -Math.PI) v += 2 * Math.PI;
  return v;
}

function relativeElbowFlex(upperArmAngle, lowerArmAngle) {
  return normalizeAngle(lowerArmAngle - upperArmAngle);
}

function clampElbowFlex(flex, prevFlex) {
  const clamped = clamp(flex, ELBOW_FLEX_MIN, ELBOW_FLEX_MAX);
  if (prevFlex == null) return clamped;
  const delta = clamped - prevFlex;
  if (Math.abs(delta) <= ELBOW_FLEX_SLEW) return clamped;
  return prevFlex + Math.sign(delta) * ELBOW_FLEX_SLEW;
}

function wristOnLowerArm(elbow, lowerArmAngle, lowerLen) {
  return {
    x: elbow.x + Math.cos(lowerArmAngle) * lowerLen,
    y: elbow.y + Math.sin(lowerArmAngle) * lowerLen,
  };
}

/** Continue forearm direction when the wrist landmark drops out. */
function extrapolateWrist(elbow, prevLowerAngle, prevLowerLen, shoulder) {
  const upperLen = shoulder ? distance(shoulder, elbow) : 0;
  const lowerLen = prevLowerLen || upperLen * 0.85 || 40;
  const angle =
    prevLowerAngle ??
    (shoulder ? angleBetween(elbow, shoulder) : Math.PI / 2);
  const pt = wristOnLowerArm(elbow, angle, lowerLen);
  return { x: pt.x, y: pt.y, score: Math.max(elbow.score ?? 0, WRIST_INFER) };
}

/**
 * 2-bone IK: place the elbow on the shoulder→wrist reach circle.
 * Picks the solution closest to prevElbow, or the one bulging outward from the torso.
 */
function solveElbowIk(shoulder, wrist, upperLen, lowerLen, prevElbow, side, torsoCenter) {
  const swDist = distance(shoulder, wrist);
  const L1 = upperLen || swDist * 0.55;
  const L2 = lowerLen || swDist * 0.45;

  let wx = wrist.x;
  let wy = wrist.y;
  const maxReach = (L1 + L2) * 0.985;
  const minReach = Math.abs(L1 - L2) * 1.015;
  if (swDist > maxReach) {
    const s = maxReach / swDist;
    wx = shoulder.x + (wrist.x - shoulder.x) * s;
    wy = shoulder.y + (wrist.y - shoulder.y) * s;
  } else if (swDist < minReach && swDist > 1e-4) {
    const s = minReach / swDist;
    wx = shoulder.x + (wrist.x - shoulder.x) * s;
    wy = shoulder.y + (wrist.y - shoulder.y) * s;
  }

  const dx = wx - shoulder.x;
  const dy = wy - shoulder.y;
  const d = Math.hypot(dx, dy) || 1e-4;
  const nx = dx / d;
  const ny = dy / d;

  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const hSq = L1 * L1 - a * a;
  const h = hSq > 0 ? Math.sqrt(hSq) : 0;

  const mx = shoulder.x + nx * a;
  const my = shoulder.y + ny * a;
  const px = -ny * h;
  const py = nx * h;

  const candidates = [
    { x: mx + px, y: my + py },
    { x: mx - px, y: my - py },
  ];

  let best = candidates[0];
  if (prevElbow) {
    let bestDist = Infinity;
    for (const c of candidates) {
      const dist = Math.hypot(c.x - prevElbow.x, c.y - prevElbow.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
  } else if (torsoCenter) {
    // Elbow bulges away from the body midline (outward on each side).
    const outward = side === 'left' ? -1 : 1;
    let bestOut = -Infinity;
    for (const c of candidates) {
      const outwardness = (c.x - torsoCenter.x) * outward;
      if (outwardness > bestOut) {
        bestOut = outwardness;
        best = c;
      }
    }
  }

  const conf = Math.min(score(shoulder), score(wrist)) * 0.82;
  return { x: best.x, y: best.y, score: conf };
}

/** Soft length correction when raw landmarks disagree on forearm proportions. */
function normalizeArmChain(shoulder, elbow, wrist, prev, side, torsoCenter) {
  const upperLen = prev.upperLen || distance(shoulder, elbow);
  const lowerLen = prev.lowerLen || distance(elbow, wrist);
  if (!upperLen || !lowerLen) return { elbow, wrist };

  const detUpper = distance(shoulder, elbow);
  const detLower = distance(elbow, wrist);
  const ratioErr = Math.abs(detUpper / detLower - upperLen / lowerLen);
  const errThreshold = side === 'right' ? 0.1 : 0.12;
  if (ratioErr < errThreshold) return { elbow, wrist };

  const profile = SIDE_PROFILE[side];
  if (score(wrist) >= profile.wristLow) return { elbow, wrist };

  const ikElbow = solveElbowIk(
    shoulder,
    wrist,
    upperLen,
    lowerLen,
    elbow,
    side,
    torsoCenter
  );
  const blend = clamp((ratioErr - errThreshold) / 0.35, 0, profile.ikBlendMax);
  const blendedElbow = blendPoint(elbow, ikElbow, blend);
  const lowerAngle = angleBetween(blendedElbow, wrist);
  const alignedWrist = wristOnLowerArm(blendedElbow, lowerAngle, lowerLen);

  return {
    elbow: blendedElbow,
    wrist: {
      x: alignedWrist.x,
      y: alignedWrist.y,
      score: Math.max(wrist.score ?? 0, WRIST_INFER),
    },
  };
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
      left: {
        upperArmAngle: 0,
        lowerArmAngle: 0,
        elbowFlex: 0,
        armRaise: 0,
        armReach: 0,
        lowerLen: 0,
        upperLen: 0,
        elbow: null,
      },
      right: {
        upperArmAngle: 0,
        lowerArmAngle: 0,
        elbowFlex: 0,
        armRaise: 0,
        armReach: 0,
        lowerLen: 0,
        upperLen: 0,
        elbow: null,
      },
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
      const decay = RIGHT_ARM_LM.has(key) ? SIDE_PROFILE.right.landmarkDecay : 0.92;
      if (!curr) {
        out[key] = p ? { ...p, score: (p.score ?? 0) * decay } : null;
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
        handFused: curr.handFused,
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
    const profile = SIDE_PROFILE[side];
    const shoulder = lm[`${side}Shoulder`];
    const elbow = lm[`${side}Elbow`];
    const wrist = lm[`${side}Wrist`];
    const hip = lm[`${side}Hip`];
    const torsoCenter = torso.shoulderCenter ?? torso.hipCenter;

    const confidence = {
      shoulder: score(shoulder),
      elbow: score(elbow),
      wrist: score(wrist),
    };

    const prev = this.sideState[side];
    const prevElbow = prev.elbow ?? elbow;
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

    const shoulderOk = armOk(shoulder);
    const wristOk = armOk(wrist) || score(wrist) >= profile.wristInfer;

    let effShoulder = shoulder;
    let effElbow = elbow;
    let effWrist = wrist;

    // Lost elbow: solve from shoulder + wrist with 2-bone IK.
    if (shoulderOk && wristOk && score(elbow) < profile.elbowHold) {
      const inferred = solveElbowIk(
        shoulder,
        wrist,
        prev.upperLen,
        prev.lowerLen,
        prevElbow,
        side,
        torsoCenter
      );
      const holdWeight = elbow ? clamp(score(elbow) / profile.elbowHold, 0, 1) : 0;
      effElbow = elbow ? blendPoint(inferred, elbow, holdWeight) : inferred;
    } else if (score(elbow) < profile.elbowInfer && !(shoulderOk && wristOk)) {
      const prevCtrl = this.controls[side];
      return {
        upperArmAngle: prev.upperArmAngle,
        lowerArmAngle: prev.lowerArmAngle,
        elbowFlex: prev.elbowFlex,
        armRaise: prev.armRaise,
        armReach: prev.armReach,
        shoulder: prevCtrl?.shoulder ?? shoulder,
        elbow: prevCtrl?.elbow ?? elbow,
        wrist: prevCtrl?.wrist ?? wrist,
        confidence,
        frozen: false,
      };
    } else if (
      shoulderOk &&
      wristOk &&
      effElbow &&
      score(wrist) < profile.wristTrust &&
      score(elbow) < (side === 'right' ? profile.elbowHold + 0.12 : 0.95)
    ) {
      const inferred = solveElbowIk(
        shoulder,
        wrist,
        prev.upperLen,
        prev.lowerLen,
        effElbow,
        side,
        torsoCenter
      );
      const elbowWeakness = side === 'right'
        ? 1 - score(elbow) / (profile.elbowHold + 0.12)
        : 1 - score(elbow) / 0.95;
      const ikWeight = clamp(elbowWeakness, 0, 0.55);
      effElbow = blendPoint(inferred, effElbow, ikWeight);
    }

    // Weak wrist: extend along the previous forearm direction, not the upper arm.
    if (score(wrist) < profile.wristTrust && effElbow && shoulderOk) {
      const wristWeight = clamp(score(wrist) / profile.wristTrust, 0, 1);
      const extrapolated = extrapolateWrist(
        effElbow,
        prev.lowerArmAngle,
        prev.lowerLen,
        effShoulder
      );
      effWrist = wrist ? blendPoint(extrapolated, wrist, wristWeight) : extrapolated;
    }

    // Stabilize noisy elbow/wrist pairs that disagree on segment lengths.
    if (shoulderOk && effElbow && effWrist) {
      const normalized = normalizeArmChain(
        effShoulder,
        effElbow,
        effWrist,
        prev,
        side,
        torsoCenter
      );
      effElbow = normalized.elbow;
      effWrist = normalized.wrist;
    }

    if (effElbow && effWrist) {
      prev.lowerLen = distance(effElbow, effWrist);
    }
    if (effShoulder && effElbow) {
      prev.upperLen = distance(effShoulder, effElbow);
    }

    if (!effElbow || !effShoulder) {
      const prevCtrl = this.controls[side];
      return {
        upperArmAngle: prev.upperArmAngle,
        lowerArmAngle: prev.lowerArmAngle,
        elbowFlex: prev.elbowFlex,
        armRaise: prev.armRaise,
        armReach: prev.armReach,
        shoulder: prevCtrl?.shoulder ?? effShoulder,
        elbow: prevCtrl?.elbow ?? effElbow,
        wrist: prevCtrl?.wrist ?? effWrist,
        confidence,
        frozen: false,
      };
    }

    const upperArmAngle = angleBetween(effShoulder, effElbow);
    const wristTrust = score(wrist);
    const handFused = wrist?.handFused === true || wristTrust >= WRIST_TRUST;
    let lowerArmAngle =
      effWrist ? angleBetween(effElbow, effWrist) : prev.lowerArmAngle;
    let elbowFlex = relativeElbowFlex(upperArmAngle, lowerArmAngle);

    if (effWrist && handFused) {
      elbowFlex = clampElbowFlex(elbowFlex, prev.elbowFlex);
      if (effElbow && effWrist) {
        prev.lowerLen = distance(effElbow, effWrist);
      }
    } else {
      elbowFlex = clampElbowFlex(elbowFlex, prev.elbowFlex);
      lowerArmAngle = upperArmAngle + elbowFlex;

      if (effWrist && effElbow) {
        const lowerLen = prev.lowerLen || distance(effElbow, effWrist) || 40;
        const aligned = wristOnLowerArm(effElbow, lowerArmAngle, lowerLen);
        const w = wristTrust >= profile.wristInfer
          ? clamp(wristTrust / profile.wristTrust, 0, 0.35)
          : 0;
        effWrist = blendPoint(aligned, effWrist, w);
      }
    }

    const armRaise = armRaiseNorm(effShoulder, effWrist, hip ?? torso.hipCenter);
    const armReach = armReachNorm(effShoulder, effWrist, shoulderWidth);

    const result = {
      upperArmAngle,
      lowerArmAngle,
      elbowFlex,
      armRaise,
      armReach,
      shoulder: effShoulder,
      elbow: effElbow,
      wrist: effWrist,
      confidence,
      frozen: false,
    };

    result.confidence = {
      shoulder: score(effShoulder),
      elbow: score(effElbow),
      wrist: score(effWrist),
      handFused: effWrist?.handFused === true || wrist?.handFused === true,
    };

    this.sideState[side] = {
      upperArmAngle: result.upperArmAngle,
      lowerArmAngle: result.lowerArmAngle,
      elbowFlex: result.elbowFlex,
      armRaise: result.armRaise,
      armReach: result.armReach,
      lowerLen: prev.lowerLen,
      upperLen: prev.upperLen,
      elbow: effElbow,
    };

    return result;
  }

  _smoothTorso(raw) {
    const prev = this.controls.torso ?? {};
    const a = CONTROL_ALPHA.torso;
    const smoothed = {
      torsoLean: lerpAngle(raw.torsoLean, prev.torsoLean, a),
      torsoScale: lerpVal(raw.torsoScale, prev.torsoScale, a),
      shoulderCenter: lerpPoint(raw.shoulderCenter, prev.shoulderCenter, DISPLAY_POS_ALPHA),
      hipCenter: lerpPoint(raw.hipCenter, prev.hipCenter, DISPLAY_POS_ALPHA),
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
    const lowerAlpha = SIDE_PROFILE[side]?.lowerAlpha ?? CONTROL_ALPHA.lowerArm;

    const posAlpha = DISPLAY_POS_ALPHA;

    const smoothed = {
      upperArmAngle: lerpAngle(raw.upperArmAngle, prev.upperArmAngle, armAlpha),
      lowerArmAngle: lerpAngle(raw.lowerArmAngle, prev.lowerArmAngle, lowerAlpha),
      elbowFlex: lerpAngle(raw.elbowFlex, prev.elbowFlex, lowerAlpha),
      armRaise: lerpVal(raw.armRaise, prev.armRaise, wristAlpha),
      armReach: lerpVal(raw.armReach, prev.armReach, wristAlpha),
      shoulder: lerpPoint(raw.shoulder, prev.shoulder, posAlpha),
      elbow: lerpPoint(raw.elbow, prev.elbow, posAlpha),
      wrist: lerpPoint(raw.wrist, prev.wrist, posAlpha),
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

    const prevHeadPx = this.controls.headPos;
    const headPx = lerpPoint(headRaw, prevHeadPx, DISPLAY_POS_ALPHA);
    if (headPx) this.controls.headPos = headPx;

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
      head: headPx ? norm(headPx, W, H) : null,
      shoulders: {
        left: left.shoulder ? norm(left.shoulder, W, H) : null,
        right: right.shoulder ? norm(right.shoulder, W, H) : null,
        mid: shoulderMid ? { x: shoulderMid.x / W, y: shoulderMid.y / H } : null,
        width: shoulderWidthPx / W,
      },
      elbows: {
        left: left.elbow && !left.frozen ? norm(left.elbow, W, H) : null,
        right: right.elbow && !right.frozen ? norm(right.elbow, W, H) : null,
      },
      wrists: {
        left: left.wrist && !left.frozen ? norm(left.wrist, W, H) : null,
        right: right.wrist && !right.frozen ? norm(right.wrist, W, H) : null,
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

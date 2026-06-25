/**
 * Build the pixel-space PuppetRig consumed by CharacterPuppet.
 * BodyState carries normalized 0-1 coords; this layer converts them to
 * display pixels (dstW × dstH) and applies the artistic angles from
 * CharacterControls.
 */
export function buildPuppetRig(bodyState, controls, dstW, dstH) {
  if (!bodyState || !controls) return null;

  function px(pt) {
    if (!pt) return null;
    return { x: pt.x * dstW, y: pt.y * dstH };
  }

  const headPx       = bodyState.head        ? px(bodyState.head)           : { x: dstW / 2, y: dstH / 4 };
  const shoulderMidPx = bodyState.shoulders.mid ? px(bodyState.shoulders.mid) : { x: dstW / 2, y: dstH / 3 };
  const hipMidPx     = bodyState.hips.mid    ? px(bodyState.hips.mid)       : { x: dstW / 2, y: dstH * 0.6 };

  const shoulderWidthPx = bodyState.shoulders.width * dstW;
  const torsoHeightPx   = Math.hypot(
    shoulderMidPx.x - hipMidPx.x,
    shoulderMidPx.y - hipMidPx.y
  ) || dstH * 0.2;

  const torsoCx = (shoulderMidPx.x + hipMidPx.x) / 2;
  const torsoCy = (shoulderMidPx.y + hipMidPx.y) / 2;

  function resolveWrist(elbowPx, wristPx, shoulderPx, lowerArmAngle) {
    if (wristPx) return wristPx;
    if (!elbowPx) return null;

    const upperLen = shoulderPx
      ? Math.hypot(elbowPx.x - shoulderPx.x, elbowPx.y - shoulderPx.y)
      : dstH * 0.14;
    const lowerLen = upperLen * 0.85;

    if (lowerArmAngle != null) {
      return {
        x: elbowPx.x + Math.cos(lowerArmAngle) * lowerLen,
        y: elbowPx.y + Math.sin(lowerArmAngle) * lowerLen,
      };
    }

    if (shoulderPx) {
      const dir = Math.atan2(elbowPx.y - shoulderPx.y, elbowPx.x - shoulderPx.x);
      return {
        x: elbowPx.x + Math.cos(dir) * lowerLen,
        y: elbowPx.y + Math.sin(dir) * lowerLen,
      };
    }

    return { x: elbowPx.x, y: elbowPx.y + lowerLen };
  }

  function armSegs(shoulderNorm, elbowNorm, wristNorm, lowerArmAngle) {
    const s = px(shoulderNorm);
    const e = px(elbowNorm);
    const w = resolveWrist(e, px(wristNorm), s, lowerArmAngle);
    const fallback = { x1: 0, y1: 0, x2: 0, y2: 0 };
    if (!s || !e) return { upper: fallback, lower: fallback, wrist: null };
    return {
      upper: { x1: s.x, y1: s.y, x2: e.x, y2: e.y },
      lower: w
        ? { x1: e.x, y1: e.y, x2: w.x, y2: w.y }
        : { x1: e.x, y1: e.y, x2: e.x, y2: e.y + dstH * 0.08 },
      wrist: w,
    };
  }

  const leftArm  = armSegs(
    bodyState.shoulders.left,
    bodyState.elbows.left,
    bodyState.wrists.left,
    bodyState.leftLowerArmAngle,
  );
  const rightArm = armSegs(
    bodyState.shoulders.right,
    bodyState.elbows.right,
    bodyState.wrists.right,
    bodyState.rightLowerArmAngle,
  );

  const lsPx = px(bodyState.shoulders.left);
  const rsPx = px(bodyState.shoulders.right);
  const lePx = px(bodyState.elbows.left);
  const rePx = px(bodyState.elbows.right);
  const lwPx = leftArm.wrist;
  const rwPx = rightArm.wrist;

  return {
    neck: {
      x1: headPx.x,
      y1: headPx.y,
      x2: shoulderMidPx.x,
      y2: shoulderMidPx.y,
      width: shoulderWidthPx * 0.35,
    },
    head: {
      cx:     headPx.x,
      cy:     headPx.y,
      radius: shoulderWidthPx * 0.35,
      angle:  controls.headTilt,
    },
    torso: {
      cx:     torsoCx,
      cy:     torsoCy,
      width:  shoulderWidthPx * 0.9,
      height: torsoHeightPx * 1.1,
      angle:  controls.torsoLean,
    },
    leftUpperArm:  leftArm.upper,
    leftLowerArm:  leftArm.lower,
    rightUpperArm: rightArm.upper,
    rightLowerArm: rightArm.lower,
    leftHand:  lwPx ? { cx: lwPx.x, cy: lwPx.y } : null,
    rightHand: rwPx ? { cx: rwPx.x, cy: rwPx.y } : null,
    joints: {
      leftShoulder:  lsPx ? { x: lsPx.x, y: lsPx.y } : null,
      rightShoulder: rsPx ? { x: rsPx.x, y: rsPx.y } : null,
      leftElbow:     lePx ? { x: lePx.x, y: lePx.y } : null,
      rightElbow:    rePx ? { x: rePx.x, y: rePx.y } : null,
    },
  };
}

/** Fixed rest pose for tuning PNG overlays in Puppet 2 calibrate mode. */
export function buildCalibrationPuppet(dstW, dstH) {
  const cx = dstW / 2;
  const shoulderY = dstH * 0.32;
  const hipY = dstH * 0.58;
  const shoulderSpan = dstW * 0.22;
  const upperLen = dstH * 0.14;
  const lowerLen = dstH * 0.12;

  const ls = { x: cx - shoulderSpan, y: shoulderY };
  const rs = { x: cx + shoulderSpan, y: shoulderY };
  const le = { x: ls.x - upperLen * 0.15, y: ls.y + upperLen };
  const re = { x: rs.x + upperLen * 0.15, y: rs.y + upperLen };
  const lw = { x: le.x, y: le.y + lowerLen };
  const rw = { x: re.x, y: re.y + lowerLen };
  const head = { x: cx, y: shoulderY - dstH * 0.12 };
  const shoulderMid = { x: cx, y: shoulderY };
  const hipMid = { x: cx, y: hipY };

  return {
    neck: {
      x1: head.x,
      y1: head.y,
      x2: shoulderMid.x,
      y2: shoulderMid.y,
      width: shoulderSpan * 0.7,
    },
    head: { cx: head.x, cy: head.y, radius: shoulderSpan * 0.55, angle: 0 },
    torso: {
      cx,
      cy: (shoulderY + hipY) / 2,
      width: shoulderSpan * 1.8,
      height: hipY - shoulderY + dstH * 0.05,
      angle: 0,
    },
    leftUpperArm:  { x1: ls.x, y1: ls.y, x2: le.x, y2: le.y },
    leftLowerArm:  { x1: le.x, y1: le.y, x2: lw.x, y2: lw.y },
    rightUpperArm: { x1: rs.x, y1: rs.y, x2: re.x, y2: re.y },
    rightLowerArm: { x1: re.x, y1: re.y, x2: rw.x, y2: rw.y },
    leftHand:  { cx: lw.x, cy: lw.y },
    rightHand: { cx: rw.x, cy: rw.y },
    joints: {
      leftShoulder:  ls,
      rightShoulder: rs,
      leftElbow:     le,
      rightElbow:    re,
    },
  };
}

/** Extended rig for Puppet 3 — adds hips/legs and neck anchor for connected limb rendering. */
export function buildCohesivePuppetRig(bodyState, controls, dstW, dstH) {
  const puppet = buildPuppetRig(bodyState, controls, dstW, dstH);
  if (!puppet || !bodyState) return puppet;

  function px(pt) {
    if (!pt) return null;
    return { x: pt.x * dstW, y: pt.y * dstH };
  }

  const ls = puppet.joints.leftShoulder;
  const rs = puppet.joints.rightShoulder;
  const shoulderMid = ls && rs
    ? { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }
    : { x: dstW / 2, y: dstH * 0.32 };

  let leftHip = px(bodyState.hips?.left);
  let rightHip = px(bodyState.hips?.right);

  if (!leftHip || !rightHip) {
    const hipMid = px(bodyState.hips?.mid) || { x: dstW / 2, y: dstH * 0.58 };
    const halfSpan = puppet.torso.width * 0.45;
    leftHip = leftHip || { x: hipMid.x - halfSpan, y: hipMid.y };
    rightHip = rightHip || { x: hipMid.x + halfSpan, y: hipMid.y };
  }

  function legSegs(hipNorm, kneeNorm, ankleNorm) {
    const h = px(hipNorm);
    const k = px(kneeNorm);
    const a = px(ankleNorm);
    const fallback = { x1: 0, y1: 0, x2: 0, y2: 0 };
    if (!h || !k) return { upper: fallback, lower: fallback, hasData: false };
    return {
      upper: { x1: h.x, y1: h.y, x2: k.x, y2: k.y },
      lower: a
        ? { x1: k.x, y1: k.y, x2: a.x, y2: a.y }
        : { x1: k.x, y1: k.y, x2: k.x, y2: k.y + dstH * 0.08 },
      hasData: true,
    };
  }

  const leftLeg = legSegs(bodyState.hips?.left, bodyState.knees?.left, bodyState.ankles?.left);
  const rightLeg = legSegs(bodyState.hips?.right, bodyState.knees?.right, bodyState.ankles?.right);

  return {
    ...puppet,
    neckBase: shoulderMid,
    leftHip,
    rightHip,
    leftUpperLeg: leftLeg.upper,
    leftLowerLeg: leftLeg.lower,
    rightUpperLeg: rightLeg.upper,
    rightLowerLeg: rightLeg.lower,
    hasLegs: leftLeg.hasData || rightLeg.hasData,
    leftFoot: bodyState.ankles?.left ? px(bodyState.ankles.left) : null,
    rightFoot: bodyState.ankles?.right ? px(bodyState.ankles.right) : null,
  };
}

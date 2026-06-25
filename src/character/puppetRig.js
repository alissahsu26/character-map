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

  function armSegs(shoulderNorm, elbowNorm, wristNorm) {
    const s = px(shoulderNorm);
    const e = px(elbowNorm);
    const w = px(wristNorm);
    const fallback = { x1: 0, y1: 0, x2: 0, y2: 0 };
    if (!s || !e) return { upper: fallback, lower: fallback };
    return {
      upper: { x1: s.x, y1: s.y, x2: e.x, y2: e.y },
      lower: w
        ? { x1: e.x, y1: e.y, x2: w.x, y2: w.y }
        : { x1: e.x, y1: e.y, x2: e.x, y2: e.y },
    };
  }

  const leftArm  = armSegs(bodyState.shoulders.left,  bodyState.elbows.left,  bodyState.wrists.left);
  const rightArm = armSegs(bodyState.shoulders.right, bodyState.elbows.right, bodyState.wrists.right);

  const lsPx = px(bodyState.shoulders.left);
  const rsPx = px(bodyState.shoulders.right);
  const lePx = px(bodyState.elbows.left);
  const rePx = px(bodyState.elbows.right);
  const lwPx = px(bodyState.wrists.left);
  const rwPx = px(bodyState.wrists.right);

  return {
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

import { clamp } from '../math/vector.js';

/**
 * Map normalized BodyState → artistic CharacterControls.
 * Values are intentionally scaled / remapped here so the renderer
 * doesn't need to know anything about the tracking domain.
 */
export function bodyStateToControls(bodyState) {
  if (!bodyState) return null;

  const {
    headTilt,
    torsoLean,
    leftArmRaise,
    rightArmRaise,
    leftArmReach,
    rightArmReach,
    leftArmAngle,
    rightArmAngle,
    leftLowerArmAngle,
    rightLowerArmAngle,
    motionEnergy,
    confidence,
    shoulders,
    wrists,
  } = bodyState;

  function fallbackReach(shoulder, wrist) {
    if (!shoulder || !wrist) return 0;
    const dist = Math.hypot(wrist.x - shoulder.x, wrist.y - shoulder.y);
    const ref = shoulders?.width || 0.2;
    return clamp(dist / (ref * 2), 0, 1);
  }

  return {
    headTilt:      headTilt * 0.8,
    torsoLean:     torsoLean * 0.7,
    leftArmRaise:  clamp(leftArmRaise,  0, 1),
    rightArmRaise: clamp(rightArmRaise, 0, 1),
    leftArmReach:  leftArmReach ?? fallbackReach(shoulders?.left, wrists?.left),
    rightArmReach: rightArmReach ?? fallbackReach(shoulders?.right, wrists?.right),
    leftArmAngle,
    rightArmAngle,
    leftLowerArmAngle,
    rightLowerArmAngle,
    bodyBounce:    motionEnergy * 0.5,
    motionEnergy,
    auraIntensity: clamp(motionEnergy * 1.5, 0, 1),
    confidence,
  };
}

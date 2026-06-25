/**
 * Pixel + rotation + scale offsets for PNG overlays in Puppet 2 (src/render/CharacterPuppet.jsx).
 * Tune with Calibrate mode, then paste logged values here.
 *
 * nudgeRot: extra degrees added on top of the skeleton-driven rotation.
 * nudgeScale: multiplier on the auto-sized PNG (1 = default).
 */
export const PUPPET_IMAGE_NUDGES = {
  torso: { nudgeX: -1, nudgeY: -57, nudgeRot: 0.0, nudgeScale: 1.00 },
  neck: { nudgeX: 0, nudgeY: 13, nudgeRot: 0.0, nudgeScale: 1.00 },
  head: { nudgeX: 0, nudgeY: 8, nudgeRot: 0.0, nudgeScale: 1.00 },
  upperArmL: { nudgeX: 15, nudgeY: 20, nudgeRot: -13.5, nudgeScale: 1.16 },
  upperArmR: { nudgeX: 0, nudgeY: 0, nudgeRot: 17.7, nudgeScale: 1.16 },
  lowerArmL: { nudgeX: 19, nudgeY: -83, nudgeRot: 11.5, nudgeScale: 1.37 },
  lowerArmR: { nudgeX: 30, nudgeY: -77, nudgeRot: 11.5, nudgeScale: 1.36 },
};


export function logPuppetImageNudges(nudges) {
  const lines = Object.entries(nudges).map(
    ([key, { nudgeX, nudgeY, nudgeRot, nudgeScale }]) =>
      `  ${key}: { nudgeX: ${Math.round(nudgeX)}, nudgeY: ${Math.round(nudgeY)}, nudgeRot: ${(nudgeRot ?? 0).toFixed(1)}, nudgeScale: ${(nudgeScale ?? 1).toFixed(2)} },`,
  );

  console.log(
    '%c[Puppet2] Paste into src/character/puppetImageConfig.js → PUPPET_IMAGE_NUDGES:',
    'color:#8ff;font-weight:bold',
  );
  console.log('export const PUPPET_IMAGE_NUDGES = {\n' + lines.join('\n') + '\n};');
}

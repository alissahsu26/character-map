/**
 * All positions are in the PARENT bone's local coordinate space.
 * The parent's local origin sits at its own anchor/pivot point.
 *
 * Coordinate conventions (PixiJS screen space):
 *   +x = right,  -x = left
 *   +y = down,   -y = up
 *   rotation: positive = clockwise, negative = counter-clockwise
 *
 * Arm raise direction:
 *   leftUpperArm:  negative rotation raises (CCW from hanging-down)
 *   rightUpperArm: positive rotation raises (CW  from hanging-down)
 */

export type BoneKey =
  | 'torso'
  | 'neck'
  | 'head'
  | 'hair'
  | 'upperArmL'
  | 'lowerArmL'
  | 'handL'
  | 'upperArmR'
  | 'lowerArmR'
  | 'handR';

export interface PartLimits {
  /** Minimum absolute rotation the bone may reach (radians). */
  min: number;
  /** Maximum absolute rotation the bone may reach (radians). */
  max: number;
}

export interface PartDef {
  asset: string;
  /** Pivot within the texture as [x_fraction, y_fraction] (0–1). */
  anchor: [number, number];
  /** Position of this pivot in the parent bone's local coordinate space. */
  position: [number, number];
  /** Logical parent bone, or null for the root-level bone. */
  parent: BoneKey | null;
  /**
   * Resting rotation (radians) applied when all control deltas are zero.
   * Tune this to make the character look correct at rest.
   */
  restRotation: number;
  /**
   * Absolute rotation limits applied AFTER adding the control delta to
   * restRotation.  Omit for bones that should never be driven.
   */
  limits?: PartLimits;
}

export const PARTS: Record<BoneKey, PartDef> = {
  // ── Body ──────────────────────────────────────────────────────────────────
  // torso: pivot at upper chest (10 % from top of sprite = shoulder line)
  torso: {
    asset: 'torso.png',
    anchor: [0.50, 0.10],
    position: [0, 0],
    parent: null,
    restRotation: 0,
    limits: { min: -0.25, max: 0.25 },
  },

  // neck: pivot at the very top of the neck sprite (connects to head)
  neck: {
    asset: 'neck.png',
    anchor: [0.50, 0.00],
    position: [0, -55],
    parent: 'torso',
    restRotation: 0,
  },

  // head: pivot where chin meets the neck top (anchor 0.72 = lower face)
  head: {
    asset: 'head.png',
    anchor: [0.50, 0.72],
    position: [0, -25],
    parent: 'neck',
    restRotation: 0,
    limits: { min: -0.35, max: 0.35 },
  },

  // hair: follows the head with no independent control
  hair: {
    asset: 'hair.png',
    anchor: [0.50, 0.65],
    position: [5, -15],
    parent: 'head',
    restRotation: 0,
  },

  // ── Left arm ──────────────────────────────────────────────────────────────
  // pivot at shoulder (8 % from top of sprite)
  upperArmL: {
    asset: 'upperArmL.png',
    anchor: [0.50, 0.08],
    position: [-105, 10],
    parent: 'torso',
    restRotation: 0,
    // Negative = CCW = arm raised; positive = CW = arm swings forward
    limits: { min: -1.8, max: 0.5 },
  },

  // pivot at elbow (8 % from top of sprite)
  lowerArmL: {
    asset: 'lowerArmL.png',
    anchor: [0.50, 0.08],
    position: [0, 170],
    parent: 'upperArmL',
    restRotation: 0,
    limits: { min: -1.5, max: 1.5 },
  },

  // pivot at wrist (5 % from top of sprite)
  handL: {
    asset: 'handL.png',
    anchor: [0.50, 0.05],
    position: [0, 175],
    parent: 'lowerArmL',
    restRotation: 0,
  },

  // ── Right arm ─────────────────────────────────────────────────────────────
  // pivot at shoulder; positive = CW = arm raised on right side
  upperArmR: {
    asset: 'upperArmR.png',
    anchor: [0.50, 0.08],
    position: [105, 10],
    parent: 'torso',
    restRotation: 0,
    limits: { min: -0.5, max: 1.8 },
  },

  lowerArmR: {
    asset: 'lowerArmR.png',
    anchor: [0.50, 0.08],
    position: [0, 170],
    parent: 'upperArmR',
    restRotation: 0,
    limits: { min: -1.5, max: 1.5 },
  },

  handR: {
    asset: 'handR.png',
    anchor: [0.50, 0.05],
    position: [0, 175],
    parent: 'lowerArmR',
    restRotation: 0,
  },
};

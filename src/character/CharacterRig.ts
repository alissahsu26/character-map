import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { PARTS, type BoneKey } from './characterRigConfig.ts';

import hairUrl      from '../character_puppet_assets/assets/character/hair.png';
import handLUrl     from '../character_puppet_assets/assets/character/handL.png';
import handRUrl     from '../character_puppet_assets/assets/character/handR.png';
import headUrl      from '../character_puppet_assets/assets/character/head.png';
import lowerArmLUrl from '../character_puppet_assets/assets/character/lowerArmL.png';
import lowerArmRUrl from '../character_puppet_assets/assets/character/lowerArmR.png';
import neckUrl      from '../character_puppet_assets/assets/character/neck.png';
import torsoUrl     from '../character_puppet_assets/assets/character/torso.png';
import upperArmLUrl from '../character_puppet_assets/assets/character/upperArmL.png';
import upperArmRUrl from '../character_puppet_assets/assets/character/upperArmR.png';

const ASSET_URLS: Record<BoneKey, string> = {
  hair:      hairUrl,
  handL:     handLUrl,
  handR:     handRUrl,
  head:      headUrl,
  lowerArmL: lowerArmLUrl,
  lowerArmR: lowerArmRUrl,
  neck:      neckUrl,
  torso:     torsoUrl,
  upperArmL: upperArmLUrl,
  upperArmR: upperArmRUrl,
};

/** Rotation deltas (radians) applied on top of each bone's restRotation. */
export interface BonePose {
  head?:      number;
  torso?:     number;
  upperArmL?: number;
  lowerArmL?: number;
  upperArmR?: number;
  lowerArmR?: number;
}

/** Subset of CharacterControls this rig cares about. */
export interface CharacterControls {
  headTilt:      number;
  torsoLean:     number;
  leftArmRaise:  number;
  rightArmRaise: number;
  [key: string]: unknown;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Dot colors per bone for debug view. */
const DOT_COLOR: Partial<Record<BoneKey, number>> = {
  head:      0xffff00,
  torso:     0xffffff,
  upperArmL: 0x00ffff,
  lowerArmL: 0xff88ff,
  handL:     0x00ff88,
  upperArmR: 0x00ffff,
  lowerArmR: 0xff88ff,
  handR:     0x00ff88,
};

export class CharacterRig {
  readonly app: Application;
  /** Positioned at canvas centre. */
  readonly root: Container;
  /** One Container per bone — local origin at the joint pivot. */
  readonly bones: Record<BoneKey, Container>;
  /** One Sprite per bone — anchor at (0,0) = bone origin. */
  readonly sprites: Record<BoneKey, Sprite>;

  private _pivotDots: Map<BoneKey, Graphics> = new Map();
  private _debugText: Text | null = null;
  private _logTick = 0;

  /** Live tuning overrides — copy logged values into characterRigConfig.ts. */
  private _calibration: {
    bone: BoneKey | null;
    mode: 'anchor' | 'position';
    anchor: [number, number];
    position: [number, number];
  } = {
    bone: null,
    mode: 'anchor',
    anchor: [0, 0],
    position: [0, 0],
  };

  private constructor(app: Application) {
    this.app = app;
    this.root = new Container();
    this.app.stage.addChild(this.root);
    this.bones   = {} as Record<BoneKey, Container>;
    this.sprites = {} as Record<BoneKey, Sprite>;
  }

  static async create(canvas: HTMLCanvasElement): Promise<CharacterRig> {
    const app = new Application();
    await app.init({
      canvas,
      width:           canvas.clientWidth,
      height:          canvas.clientHeight,
      backgroundAlpha: 0,
      antialias:       true,
      autoDensity:     true,
      resolution:      window.devicePixelRatio || 1,
    });

    const rig = new CharacterRig(app);
    await rig._loadAndBuild();
    rig._centerRoot();
    // Apply rest rotations immediately so the neutral pose is correct
    rig.applyPose({});
    return rig;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * MediaPipe path: convert CharacterControls → BonePose deltas → apply.
   * Never reads landmarks directly.
   */
  update(controls: CharacterControls | null): void {
    if (!controls) return;
    this.applyPose({
      head:      controls.headTilt,
      torso:     controls.torsoLean,
      // leftArmRaise 0–1 maps CCW to the left-arm min limit
      upperArmL: controls.leftArmRaise  * (PARTS.upperArmL.limits?.min ?? -1.8),
      // rightArmRaise 0–1 maps CW to the right-arm max limit
      upperArmR: controls.rightArmRaise * (PARTS.upperArmR.limits?.max ??  1.8),
      lowerArmL: 0,
      lowerArmR: 0,
    });
  }

  /**
   * Manual test path: apply explicit rotation deltas from rest.
   * A delta of 0 for any bone puts it back at restRotation.
   */
  applyPose(pose: Partial<BonePose>): void {
    this._applyBone('head',      pose.head      ?? 0);
    this._applyBone('torso',     pose.torso     ?? 0);
    this._applyBone('upperArmL', pose.upperArmL ?? 0);
    this._applyBone('lowerArmL', pose.lowerArmL ?? 0);
    this._applyBone('upperArmR', pose.upperArmR ?? 0);
    this._applyBone('lowerArmR', pose.lowerArmR ?? 0);

    this._syncDebugText(pose);
  }

  /** Show / hide pivot dots (small coloured circles at each joint origin). */
  setDebug(enabled: boolean): void {
    for (const dot of this._pivotDots.values()) {
      dot.visible = enabled;
    }
  }

  /**
   * Enable cursor-based tuning for one bone.
   * Drag on the canvas (via PixiRigStage) to nudge anchor or position.
   */
  setCalibration(
    bone: BoneKey | null,
    mode: 'anchor' | 'position' = 'anchor',
  ): void {
    if (!bone) {
      this._calibration.bone = null;
      return;
    }

    const cfg = PARTS[bone];
    this._calibration = {
      bone,
      mode,
      anchor: [...cfg.anchor],
      position: [...cfg.position],
    };
    this._applyCalibrationToBone(bone);
  }

  getCalibrationBone(): BoneKey | null {
    return this._calibration.bone;
  }

  getCalibrationMode(): 'anchor' | 'position' {
    return this._calibration.mode;
  }

  setCalibrationMode(mode: 'anchor' | 'position'): void {
    if (!this._calibration.bone) return;
    this._calibration.mode = mode;
  }

  /**
   * Move the calibrated bone by screen-space pixels.
   * Anchor mode: sprite follows the cursor (pivot stays on the joint dot).
   * Position mode: joint dot moves in the parent bone's local space.
   */
  nudgeCalibration(screenDx: number, screenDy: number): void {
    const boneKey = this._calibration.bone;
    if (!boneKey) return;

    const bone = this.bones[boneKey];
    const sprite = this.sprites[boneKey];
    if (!bone || !sprite) return;

    if (this._calibration.mode === 'anchor') {
      const w = sprite.texture.width || 1;
      const h = sprite.texture.height || 1;
      // Dragging the image right → anchor moves left on the texture.
      this._calibration.anchor[0] = clamp(
        this._calibration.anchor[0] - screenDx / w,
        0,
        1,
      );
      this._calibration.anchor[1] = clamp(
        this._calibration.anchor[1] - screenDy / h,
        0,
        1,
      );
    } else {
      const parent = bone.parent;
      const scale = parent
        ? Math.hypot(parent.worldTransform.a, parent.worldTransform.b)
        : 1;
      const inv = scale > 0 ? 1 / scale : 1;
      this._calibration.position[0] += screenDx * inv;
      this._calibration.position[1] += screenDy * inv;
    }

    this._applyCalibrationToBone(boneKey);
  }

  resetCalibration(): void {
    const boneKey = this._calibration.bone;
    if (!boneKey) return;

    const cfg = PARTS[boneKey];
    this._calibration.anchor = [...cfg.anchor];
    this._calibration.position = [...cfg.position];
    this._applyCalibrationToBone(boneKey);
  }

  /** Print copy-pasteable config for characterRigConfig.ts. */
  logCalibrationConfig(): void {
    const boneKey = this._calibration.bone;
    if (!boneKey) {
      console.warn('[CharacterRig] Select a bone in Calibrate mode first.');
      return;
    }

    const cfg = PARTS[boneKey];
    const anchor = this._calibration.anchor;
    const position = this._calibration.position;
    const limits = cfg.limits
      ? `\n    limits: { min: ${cfg.limits.min}, max: ${cfg.limits.max} },`
      : '';

    const snippet =
      `  ${boneKey}: {\n` +
      `    asset: '${cfg.asset}',\n` +
      `    anchor: [${anchor[0].toFixed(3)}, ${anchor[1].toFixed(3)}],\n` +
      `    position: [${Math.round(position[0])}, ${Math.round(position[1])}],\n` +
      `    parent: ${cfg.parent ? `'${cfg.parent}'` : 'null'},\n` +
      `    restRotation: ${cfg.restRotation ?? 0},${limits}\n` +
      `  },`;

    console.log(
      `%c[CharacterRig] Paste into characterRigConfig.ts → PARTS.${boneKey}:`,
      'color:#8ff;font-weight:bold',
    );
    console.log(snippet);
    console.log('[CharacterRig] anchor (drag image) | position (drag joint)');
  }

  destroy(): void {
    this.app.destroy(false, { children: true });
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _applyBone(key: BoneKey, delta: number): void {
    const bone = this.bones[key];
    if (!bone) return;
    const cfg  = PARTS[key];
    const rest = cfg.restRotation ?? 0;
    const lim  = cfg.limits;
    const val  = rest + delta;
    bone.rotation = lim ? clamp(val, lim.min, lim.max) : val;
  }

  private async _loadAndBuild(): Promise<void> {
    const keys = Object.keys(PARTS) as BoneKey[];

    const textures = await Promise.all(
      keys.map(k => Assets.load<Texture>(ASSET_URLS[k]))
    );

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const cfg = PARTS[key];

      const bone = new Container();
      bone.position.set(cfg.position[0], cfg.position[1]);
      this.bones[key] = bone;

      const sprite = new Sprite(textures[i]);
      sprite.anchor.set(cfg.anchor[0], cfg.anchor[1]);
      this.sprites[key] = sprite;
    }

    this._buildHierarchy();
    this._buildPivotDots();
    this._buildDebugText();
  }

  /**
   * Insertion order within each Container = draw order (first = behind).
   * Child bones that sit BEHIND the parent sprite: add before the sprite.
   * Child bones that sit IN FRONT of the parent sprite: add after.
   */
  private _buildHierarchy(): void {
    const b = this.bones;
    const s = this.sprites;

    this.root.addChild(b.torso);

    // Torso: arms behind body, neck/head in front
    b.torso.addChild(b.upperArmL);
    b.torso.addChild(b.upperArmR);
    b.torso.addChild(s.torso);
    b.torso.addChild(b.neck);

    // Left arm: each child bone before its parent sprite (child renders behind)
    b.upperArmL.addChild(b.lowerArmL);
    b.upperArmL.addChild(s.upperArmL);
    b.lowerArmL.addChild(b.handL);
    b.lowerArmL.addChild(s.lowerArmL);
    b.handL.addChild(s.handL);

    // Right arm (symmetric)
    b.upperArmR.addChild(b.lowerArmR);
    b.upperArmR.addChild(s.upperArmR);
    b.lowerArmR.addChild(b.handR);
    b.lowerArmR.addChild(s.lowerArmR);
    b.handR.addChild(s.handR);

    // Neck → head → hair (each in front of its parent)
    b.neck.addChild(s.neck);
    b.neck.addChild(b.head);
    b.head.addChild(s.head);
    b.head.addChild(b.hair);
    b.hair.addChild(s.hair);
  }

  private _buildPivotDots(): void {
    const keys: BoneKey[] = [
      'torso', 'head',
      'upperArmL', 'lowerArmL', 'handL',
      'upperArmR', 'lowerArmR', 'handR',
    ];

    for (const key of keys) {
      const color = DOT_COLOR[key] ?? 0xff4444;

      const dot = new Graphics();
      // Outer filled circle
      dot.circle(0, 0, 5);
      dot.fill({ color, alpha: 0.9 });
      // White centre for contrast
      dot.circle(0, 0, 2);
      dot.fill({ color: 0xffffff, alpha: 1 });

      dot.visible = false;
      // Add as last child so it renders on top within its bone container
      this.bones[key].addChild(dot);
      this._pivotDots.set(key, dot);
    }
  }

  private _buildDebugText(): void {
    this._debugText = new Text({
      text: 'pose: waiting…',
      style: { fill: 0x00ff88, fontSize: 11, fontFamily: 'monospace' },
    });
    this._debugText.position.set(8, 8);
    // Added to stage directly — floats above the character, unaffected by root transform
    this.app.stage.addChild(this._debugText);
  }

  private _syncDebugText(pose: Partial<BonePose>): void {
    if (!this._debugText) return;

    const fmt = (b: BoneKey) => this.bones[b]?.rotation.toFixed(3) ?? '-';
    const d   = (v?: number) => (v ?? 0).toFixed(3);

    this._debugText.text =
      `head      Δ${d(pose.head)}  → rot ${fmt('head')}\n` +
      `torso     Δ${d(pose.torso)}  → rot ${fmt('torso')}\n` +
      `armL.up   Δ${d(pose.upperArmL)}  → rot ${fmt('upperArmL')}\n` +
      `armL.lo   Δ${d(pose.lowerArmL)}  → rot ${fmt('lowerArmL')}\n` +
      `armR.up   Δ${d(pose.upperArmR)}  → rot ${fmt('upperArmR')}\n` +
      `armR.lo   Δ${d(pose.lowerArmR)}  → rot ${fmt('lowerArmR')}`;

    if (++this._logTick % 60 === 0) {
      console.log('[CharacterRig]',
        'head:', fmt('head'),
        '| armL:', fmt('upperArmL'),
        '| armR:', fmt('upperArmR'),
      );
    }
  }

  private _centerRoot(): void {
    const { width, height } = this.app.screen;
    this.root.position.set(width / 2, height / 2);
  }

  private _applyCalibrationToBone(boneKey: BoneKey): void {
    const bone = this.bones[boneKey];
    const sprite = this.sprites[boneKey];
    if (!bone || !sprite) return;

    sprite.anchor.set(
      this._calibration.anchor[0],
      this._calibration.anchor[1],
    );
    bone.position.set(
      this._calibration.position[0],
      this._calibration.position[1],
    );
  }
}

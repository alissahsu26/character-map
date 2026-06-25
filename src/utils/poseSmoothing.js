import { LANDMARK_CONFIDENCE_THRESHOLD } from './poseConstants';

// Hysteresis band: a landmark must reach ACQUIRE_SCORE to be trusted, but once
// trusted it stays trusted until it drops below RELEASE_SCORE. This avoids
// flicker when a point's score hovers right around the threshold (e.g. a
// partially turned head or a partially occluded limb).
const ACQUIRE_SCORE = LANDMARK_CONFIDENCE_THRESHOLD;
const RELEASE_SCORE = 0.28;
// Arms (especially the camera-facing side) dip below the global threshold more
// often; use a lower band so they stay trusted once acquired.
const ARM_ACQUIRE_SCORE = 0.38;
const ARM_RELEASE_SCORE = 0.18;
const ARM_INDICES = new Set([5, 6, 7, 8, 9, 10]); // shoulders → wrists
const WRIST_INDICES = new Set([9, 10]);
// Camera-facing arm (screen-right / index 6,8,10) drops out more often.
const FACING_ARM_INDICES = new Set([6, 8, 10]);
// Bridge brief dropouts (motion blur, a hand passing in front, a single bad
// detector frame) by coasting on the last known velocity instead of
// instantly snapping the bone to "missing".
const COAST_MS = 320;
const ARM_COAST_MS = 480;
const FACING_ARM_COAST_MS = 620;
const MAX_JUMP_RATIO = 0.28;
const FACING_ARM_MAX_JUMP_RATIO = 0.34;

class OneEuroFilter {
  constructor(minCutoff = 1.2, beta = 0.02, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x, t) {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = t;
      return x;
    }

    const dt = Math.max((t - this.tPrev) / 1000, 1 / 120);
    const dx = (x - this.xPrev) / dt;
    const aD = this.alpha(this.dCutoff, dt);
    const edx = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const a = this.alpha(cutoff, dt);
    const result = a * x + (1 - a) * this.xPrev;

    this.xPrev = result;
    this.dxPrev = edx;
    this.tPrev = t;
    return result;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
}

export class KeypointSmoother {
  constructor(keypointCount, { minCutoff = 1.2, beta = 0.02 } = {}) {
    this.filters = Array.from({ length: keypointCount }, () => ({
      x: new OneEuroFilter(minCutoff, beta),
      y: new OneEuroFilter(minCutoff, beta),
    }));
    this.track = Array.from({ length: keypointCount }, () => ({
      trusted: false,
      lastGoodT: 0,
      lastX: 0,
      lastY: 0,
      vx: 0,
      vy: 0,
    }));
  }

  smooth(raw, previous, frameW, frameH) {
    const t = performance.now();

    return raw.map((kp, i) => {
      const track = this.track[i];
      const isArm = ARM_INDICES.has(i);
      const isFacingArm = FACING_ARM_INDICES.has(i);
      const acquireScore = isArm ? ARM_ACQUIRE_SCORE : ACQUIRE_SCORE;
      const releaseScore = isFacingArm ? ARM_RELEASE_SCORE * 0.85 : (isArm ? ARM_RELEASE_SCORE : RELEASE_SCORE);
      const coastMs = isFacingArm ? FACING_ARM_COAST_MS : (isArm ? ARM_COAST_MS : COAST_MS);
      const maxJump = Math.min(frameW, frameH) * (isFacingArm ? FACING_ARM_MAX_JUMP_RATIO : MAX_JUMP_RATIO);

      if (kp.score >= acquireScore) {
        track.trusted = true;
      } else if (kp.score < releaseScore) {
        track.trusted = false;
      }
      // Between RELEASE_SCORE and ACQUIRE_SCORE: keep whatever trust state we
      // already had (the hysteresis band itself).

      if (!track.trusted) {
        const sinceGood = t - track.lastGoodT;
        if (track.lastGoodT && sinceGood <= coastMs) {
          // Coast through the dropout: extrapolate from the last known
          // velocity, decaying it to zero so motion eases to a stop instead
          // of jumping when real tracking resumes.
          const decay = 1 - sinceGood / coastMs;
          const dt = sinceGood / 1000;
          return {
            ...kp,
            x: track.lastX + track.vx * dt * decay,
            y: track.lastY + track.vy * dt * decay,
            score: acquireScore,
          };
        }
        this.filters[i].x.reset();
        this.filters[i].y.reset();
        return { ...kp, score: 0 };
      }

      const prev = previous?.[i];
      if (prev && prev.score >= acquireScore) {
        const jump = Math.hypot(kp.x - prev.x, kp.y - prev.y);
        if (jump > maxJump) {
          return {
            ...prev,
            score: Math.max(prev.score * 0.92, acquireScore),
          };
        }
      }

      const fx = this.filters[i].x.filter(kp.x, t);
      const fy = this.filters[i].y.filter(kp.y, t);

      if (track.lastGoodT) {
        const dt = Math.max((t - track.lastGoodT) / 1000, 1 / 120);
        track.vx = (fx - track.lastX) / dt;
        track.vy = (fy - track.lastY) / dt;
      }
      track.lastX = fx;
      track.lastY = fy;
      track.lastGoodT = t;

      const fusedScore = kp.handFused ? Math.max(kp.score, 0.88) : kp.score;
      const outScore = WRIST_INDICES.has(i)
        ? Math.max(fusedScore, acquireScore)
        : Math.max(kp.score, acquireScore);

      return { ...kp, x: fx, y: fy, score: outScore };
    });
  }
}

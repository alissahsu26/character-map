const MIN_SCORE = 0.3;
const MAX_JUMP_RATIO = 0.28;

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
  }

  smooth(raw, previous, frameW, frameH) {
    const maxJump = Math.min(frameW, frameH) * MAX_JUMP_RATIO;
    const t = performance.now();

    return raw.map((kp, i) => {
      if (kp.score < MIN_SCORE) {
        this.filters[i].x.reset();
        this.filters[i].y.reset();
        return kp;
      }

      const prev = previous?.[i];
      if (prev && prev.score >= MIN_SCORE) {
        const jump = Math.hypot(kp.x - prev.x, kp.y - prev.y);
        if (jump > maxJump) {
          return {
            ...prev,
            score: Math.max(prev.score * 0.92, MIN_SCORE),
          };
        }
      }

      return {
        ...kp,
        x: this.filters[i].x.filter(kp.x, t),
        y: this.filters[i].y.filter(kp.y, t),
      };
    });
  }
}

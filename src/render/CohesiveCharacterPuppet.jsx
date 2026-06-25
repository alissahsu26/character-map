import { useEffect, useRef, useState } from 'react';
import { distance } from '../math/vector.js';

const TRAIL_MAX_AGE = 300;
const TRAIL_MAX_POINTS = 20;
const BURST_SPEED_THRESHOLD = 800;
const PARTICLE_LIFE = 400;

const LIMB = {
  neck:     { len: 90,  thick: 26 },
  upperArm: { len: 100, thick: 30 },
  lowerArm: { len: 86,  thick: 24 },
  upperLeg: { len: 88,  thick: 36 },
  lowerLeg: { len: 78,  thick: 28 },
};

function volThick(p1, p2, nat) {
  const d = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
  return Math.min(nat.thick * Math.sqrt(nat.len / d), nat.thick * 2.6);
}

function Limb({ p1, p2, nat, fill, showShadow = true }) {
  const t = volThick(p1, p2, nat);
  return (
    <g>
      {showShadow && (
        <line
          x1={p1.x + 2} y1={p1.y + 4}
          x2={p2.x + 2} y2={p2.y + 4}
          stroke="rgba(0,0,0,0.38)" strokeWidth={t + 6} strokeLinecap="round"
        />
      )}
      <line
        x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
        stroke={fill} strokeWidth={t} strokeLinecap="round"
      />
      <line
        x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
        stroke="rgba(255,255,255,0.13)" strokeWidth={t * 0.3} strokeLinecap="round"
      />
    </g>
  );
}

function segEndpoints(seg) {
  return [
    { x: seg.x1, y: seg.y1 },
    { x: seg.x2, y: seg.y2 },
  ];
}

function Torso({ ls, rs, lh, rh }) {
  const smx = (ls.x + rs.x) / 2;
  const smy = (ls.y + rs.y) / 2;
  const hmx = (lh.x + rh.x) / 2;
  const hmy = (lh.y + rh.y) / 2;
  const d = [
    `M ${ls.x} ${ls.y}`,
    `Q ${smx} ${smy - 14} ${rs.x} ${rs.y}`,
    `L ${rh.x} ${rh.y}`,
    `Q ${hmx} ${hmy + 10} ${lh.x} ${lh.y}`,
    'Z',
  ].join(' ');
  return (
    <g>
      <path d={d} fill="rgba(0,0,0,0.35)" transform="translate(3,5)" />
      <path d={d} fill="#7c3aed" stroke="#4c1d95" strokeWidth={2} strokeLinejoin="round" />
      <path d={d} fill="url(#cohesiveTorsoSheen)" />
    </g>
  );
}

function Head({ cx, cy, r, tiltDeg }) {
  return (
    <g>
      <circle cx={cx + 3} cy={cy + 5} r={r} fill="rgba(0,0,0,0.35)" />
      <circle cx={cx} cy={cy} r={r} fill="#fbbf24" stroke="#d97706" strokeWidth={2.5} />
      <g transform={`rotate(${tiltDeg} ${cx} ${cy})`}>
        <circle cx={cx - 13} cy={cy - 10} r={6} fill="#1a1a2e" />
        <circle cx={cx + 13} cy={cy - 10} r={6} fill="#1a1a2e" />
        <circle cx={cx - 11} cy={cy - 13} r={2.2} fill="white" opacity={0.9} />
        <circle cx={cx + 15} cy={cy - 13} r={2.2} fill="white" opacity={0.9} />
        <path
          d={`M ${cx - 11} ${cy + 10} Q ${cx} ${cy + 22} ${cx + 11} ${cy + 10}`}
          fill="none" stroke="#d97706" strokeWidth={2.5} strokeLinecap="round"
        />
        <circle cx={cx - 22} cy={cy + 5} r={7} fill="#f97316" opacity={0.3} />
        <circle cx={cx + 22} cy={cy + 5} r={7} fill="#f97316" opacity={0.3} />
      </g>
    </g>
  );
}

function useHandEffects(puppet) {
  const trailsRef = useRef({ left: [], right: [] });
  const particlesRef = useRef([]);
  const prevHandsRef = useRef({ left: null, right: null, time: 0 });
  const [effects, setEffects] = useState({ trails: { left: [], right: [] }, particles: [] });

  useEffect(() => {
    if (!puppet) return;

    const now = performance.now();
    const dt = Math.max(now - (prevHandsRef.current.time || now), 1);
    prevHandsRef.current.time = now;

    ['left', 'right'].forEach((side) => {
      const hand = side === 'left' ? puppet.leftHand : puppet.rightHand;
      if (!hand) return;

      const pos = { x: hand.cx, y: hand.cy };
      trailsRef.current[side].push({ ...pos, age: 0 });
      while (trailsRef.current[side].length > TRAIL_MAX_POINTS) {
        trailsRef.current[side].shift();
      }

      const prev = prevHandsRef.current[side];
      if (prev) {
        const speed = (distance(prev, pos) / dt) * 1000;
        if (speed > BURST_SPEED_THRESHOLD) {
          for (let i = 0; i < 6; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speedPx = 80 + Math.random() * 120;
            particlesRef.current.push({
              x: pos.x,
              y: pos.y,
              vx: Math.cos(angle) * speedPx,
              vy: Math.sin(angle) * speedPx,
              life: PARTICLE_LIFE,
              maxLife: PARTICLE_LIFE,
              color: side === 'left' ? '#60a5fa' : '#f472b6',
            });
          }
        }
      }
      prevHandsRef.current[side] = pos;
    });

    trailsRef.current.left = trailsRef.current.left
      .map((p) => ({ ...p, age: p.age + dt }))
      .filter((p) => p.age < TRAIL_MAX_AGE);
    trailsRef.current.right = trailsRef.current.right
      .map((p) => ({ ...p, age: p.age + dt }))
      .filter((p) => p.age < TRAIL_MAX_AGE);

    particlesRef.current = particlesRef.current
      .map((p) => ({
        ...p,
        x: p.x + (p.vx * dt) / 1000,
        y: p.y + (p.vy * dt) / 1000,
        life: p.life - dt,
      }))
      .filter((p) => p.life > 0);

    setEffects({
      trails: {
        left: [...trailsRef.current.left],
        right: [...trailsRef.current.right],
      },
      particles: [...particlesRef.current],
    });
  }, [puppet]);

  return effects;
}

function TrailLayer({ points, color }) {
  return (
    <g>
      {points.map((p, i) => {
        const t = 1 - p.age / TRAIL_MAX_AGE;
        return (
          <circle
            key={`${i}-${p.x}-${p.y}`}
            cx={p.x}
            cy={p.y}
            r={6 * t + 2}
            fill={color}
            opacity={t * 0.5}
          />
        );
      })}
    </g>
  );
}

function ParticleLayer({ particles }) {
  return (
    <g>
      {particles.map((p, i) => (
        <circle
          key={`${i}-${p.life}`}
          cx={p.x}
          cy={p.y}
          r={4 + (1 - p.life / p.maxLife) * 8}
          fill={p.color}
          opacity={p.life / p.maxLife}
        />
      ))}
    </g>
  );
}

export default function CohesiveCharacterPuppet({ puppet, width, height }) {
  const effects = useHandEffects(puppet);

  if (!puppet) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="puppet-svg">
        <text x={width / 2} y={height / 2} textAnchor="middle" fill="#6b7280" fontSize={18}>
          Waiting for pose...
        </text>
      </svg>
    );
  }

  const { head, joints, neckBase, leftHip, rightHip, hasLegs } = puppet;
  const ls = joints?.leftShoulder;
  const rs = joints?.rightShoulder;

  if (!ls || !rs || !neckBase) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="puppet-svg">
        <text x={width / 2} y={height / 2} textAnchor="middle" fill="#6b7280" fontSize={18}>
          Waiting for pose...
        </text>
      </svg>
    );
  }

  const headPt = { x: head.cx, y: head.cy };
  const tiltDeg = (head.angle * 180) / Math.PI;

  const le = joints.leftElbow ? { x: joints.leftElbow.x, y: joints.leftElbow.y } : null;
  const re = joints.rightElbow ? { x: joints.rightElbow.x, y: joints.rightElbow.y } : null;
  const lw = puppet.leftHand ? { x: puppet.leftHand.cx, y: puppet.leftHand.cy } : null;
  const rw = puppet.rightHand ? { x: puppet.rightHand.cx, y: puppet.rightHand.cy } : null;

  const [rUpperLegStart, rUpperLegEnd] = segEndpoints(puppet.rightUpperLeg);
  const [rLowerLegStart, rLowerLegEnd] = segEndpoints(puppet.rightLowerLeg);
  const [lUpperLegStart, lUpperLegEnd] = segEndpoints(puppet.leftUpperLeg);
  const [lLowerLegStart, lLowerLegEnd] = segEndpoints(puppet.leftLowerLeg);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="puppet-svg">
      <defs>
        <linearGradient id="cohesiveTorsoSheen" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="white" stopOpacity="0.22" />
          <stop offset="55%" stopColor="white" stopOpacity="0.04" />
          <stop offset="100%" stopColor="black" stopOpacity="0.12" />
        </linearGradient>
        <filter id="cohesiveSoftGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <TrailLayer points={effects.trails.left} color="#60a5fa" />
      <TrailLayer points={effects.trails.right} color="#f472b6" />
      <ParticleLayer particles={effects.particles} />

      {hasLegs && (
        <>
          <Limb p1={rUpperLegStart} p2={rUpperLegEnd} nat={LIMB.upperLeg} fill="#5b21b6" />
          <Limb
            p1={rLowerLegStart}
            p2={puppet.rightFoot || rLowerLegEnd}
            nat={LIMB.lowerLeg}
            fill="#6d28d9"
          />
          {puppet.rightFoot && (
            <ellipse
              cx={puppet.rightFoot.x} cy={puppet.rightFoot.y} rx={20} ry={12}
              fill="#4c1d95" stroke="#1a1a2e" strokeWidth={2}
            />
          )}
        </>
      )}

      {re && rw && (
        <>
          <Limb p1={rs} p2={re} nat={LIMB.upperArm} fill="#be185d" />
          <Limb p1={re} p2={rw} nat={LIMB.lowerArm} fill="#db2777" />
          <circle
            cx={rw.x} cy={rw.y} r={15}
            fill="#f9a8d4" stroke="#1a1a2e" strokeWidth={2}
            filter="url(#cohesiveSoftGlow)"
          />
        </>
      )}

      <Torso ls={ls} rs={rs} lh={leftHip} rh={rightHip} />

      <Limb p1={headPt} p2={neckBase} nat={LIMB.neck} fill="#a78bfa" showShadow={false} />

      <Head cx={head.cx} cy={head.cy} r={head.radius} tiltDeg={tiltDeg} />

      {le && lw && (
        <>
          <Limb p1={ls} p2={le} nat={LIMB.upperArm} fill="#1d4ed8" />
          <Limb p1={le} p2={lw} nat={LIMB.lowerArm} fill="#3b82f6" />
          <circle
            cx={lw.x} cy={lw.y} r={15}
            fill="#93c5fd" stroke="#1a1a2e" strokeWidth={2}
            filter="url(#cohesiveSoftGlow)"
          />
        </>
      )}

      {hasLegs && (
        <>
          <Limb p1={lUpperLegStart} p2={lUpperLegEnd} nat={LIMB.upperLeg} fill="#6d28d9" />
          <Limb
            p1={lLowerLegStart}
            p2={puppet.leftFoot || lLowerLegEnd}
            nat={LIMB.lowerLeg}
            fill="#7c3aed"
          />
          {puppet.leftFoot && (
            <ellipse
              cx={puppet.leftFoot.x} cy={puppet.leftFoot.y} rx={20} ry={12}
              fill="#5b21b6" stroke="#1a1a2e" strokeWidth={2}
            />
          )}
        </>
      )}
    </svg>
  );
}

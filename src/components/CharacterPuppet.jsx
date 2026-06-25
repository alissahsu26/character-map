import { useEffect, useRef, useState } from 'react';
import { distance } from '../utils/poseMapping';

const TRAIL_MAX_AGE = 300;
const TRAIL_MAX_POINTS = 20;
const BURST_SPEED_THRESHOLD = 800;
const PARTICLE_LIFE = 400;

function ArmCapsule({ x1, y1, x2, y2, thickness, color }) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;

  return (
    <rect
      x={cx - len / 2}
      y={cy - thickness / 2}
      width={len}
      height={thickness}
      rx={thickness / 2}
      fill={color}
      stroke="#1a1a2e"
      strokeWidth={2}
      transform={`rotate(${angle} ${cx} ${cy})`}
    />
  );
}

function GlowJoint({ x, y, r = 10, color = '#a78bfa' }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r * 2} fill={color} opacity={0.2} />
      <circle cx={x} cy={y} r={r} fill={color} opacity={0.6} />
      <circle cx={x} cy={y} r={r * 0.5} fill="#fff" opacity={0.9} />
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

export default function CharacterPuppet({ puppet, width, height }) {
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

  const { head, torso, joints } = puppet;
  const armThickness = Math.max(head.radius * 0.35, 12);
  const headAngleDeg = (head.angle * 180) / Math.PI;
  const torsoAngleDeg = (torso.angle * 180) / Math.PI;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="puppet-svg">
      <defs>
        <filter id="glow">
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

      <ArmCapsule
        {...puppet.leftUpperArm}
        thickness={armThickness}
        color="#3b82f6"
      />
      <ArmCapsule
        {...puppet.leftLowerArm}
        thickness={armThickness * 0.85}
        color="#60a5fa"
      />
      <ArmCapsule
        {...puppet.rightUpperArm}
        thickness={armThickness}
        color="#ec4899"
      />
      <ArmCapsule
        {...puppet.rightLowerArm}
        thickness={armThickness * 0.85}
        color="#f472b6"
      />

      <rect
        x={torso.cx - torso.width / 2}
        y={torso.cy - torso.height / 2}
        width={torso.width}
        height={torso.height * 3}
        rx={torso.width * 0.15}
        fill="#8b5cf6"
        stroke="#1a1a2e"
        strokeWidth={2}
        transform={`rotate(${torsoAngleDeg} ${torso.cx} ${torso.cy})`}
      />

      <g transform={`rotate(${headAngleDeg} ${head.cx} ${head.cy})`}>
        <circle
          cx={head.cx}
          cy={head.cy}
          r={head.radius}
          fill="#fbbf24"
          stroke="#1a1a2e"
          strokeWidth={2}
        />
        <circle cx={head.cx - head.radius * 1.5} cy={head.cy - head.radius * 1.5} r={4} fill="#1a1a2e" />
        <circle cx={head.cx + head.radius * 1.5} cy={head.cy - head.radius * 1.5} r={4} fill="#1a1a2e" />
        <path
          d={`M ${head.cx - head.radius * 0.25} ${head.cy + head.radius * 0.2}
              Q ${head.cx} ${head.cy + head.radius * 0.45} ${head.cx + head.radius * 0.25} ${head.cy + head.radius * 0.2}`}
          fill="none"
          stroke="#1a1a2e"
          strokeWidth={2}
          strokeLinecap="round"
        />
      </g>

      {puppet.leftHand && (
        <circle
          cx={puppet.leftHand.cx}
          cy={puppet.leftHand.cy}
          r={armThickness * 0.55}
          fill="#93c5fd"
          stroke="#1a1a2e"
          strokeWidth={2}
          filter="url(#glow)"
        />
      )}
      {puppet.rightHand && (
        <circle
          cx={puppet.rightHand.cx}
          cy={puppet.rightHand.cy}
          r={armThickness * 0.55}
          fill="#f9a8d4"
          stroke="#1a1a2e"
          strokeWidth={2}
          filter="url(#glow)"
        />
      )}

      {joints?.leftShoulder && <GlowJoint {...joints.leftShoulder} color="#a78bfa" />}
      {joints?.rightShoulder && <GlowJoint {...joints.rightShoulder} color="#a78bfa" />}
      {joints?.leftElbow && <GlowJoint {...joints.leftElbow} r={8} color="#60a5fa" />}
      {joints?.rightElbow && <GlowJoint {...joints.rightElbow} r={8} color="#f472b6" />}
    </svg>
  );
}

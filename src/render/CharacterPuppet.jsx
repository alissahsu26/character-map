import { useCallback, useEffect, useRef, useState } from 'react';
import { distance } from '../math/vector.js';

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

/** Map a PNG limb segment from joint (x1,y1) → tip (x2,y2), pivoting at the joint. */
function SegmentLimbImage({
  x1,
  y1,
  x2,
  y2,
  href,
  armThickness,
  widthFactor = 6,
  heightFactor = 1.5,
  anchorX = 0.5,
  anchorY = 0.08,
  nudgeX = 0,
  nudgeY = 0,
  nudgeRot = 0,
  nudgeScale = 1,
  opacity = 1,
}) {
  const len = Math.max(Math.hypot(x2 - x1, y2 - y1), armThickness * 1.5);
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const imgW = armThickness * widthFactor * nudgeScale;
  const imgH = len * heightFactor * nudgeScale;

  return (
    <g transform={`translate(${x1} ${y1}) rotate(${angle - 90 + nudgeRot})`}>
      <image
        href={href}
        x={-imgW * anchorX + nudgeX}
        y={-imgH * anchorY + nudgeY}
        width={imgW}
        height={imgH}
        opacity={opacity}
      />
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

/** Convert screen drag into nudge offsets applied before a rotated image. */
function screenDeltaToRotatedNudge(dx, dy, rotationRad) {
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  return {
    dx: dx * cos + dy * sin,
    dy: -dx * sin + dy * cos,
  };
}

function segmentRotationRad(x1, y1, x2, y2) {
  return Math.atan2(y2 - y1, x2 - x1) - Math.PI / 2;
}

function getPartRotationRad(puppet, partKey) {
  if (!puppet) return 0;

  switch (partKey) {
    case 'upperArmL':
      return segmentRotationRad(
        puppet.leftUpperArm.x1,
        puppet.leftUpperArm.y1,
        puppet.leftUpperArm.x2,
        puppet.leftUpperArm.y2,
      );
    case 'upperArmR':
      return segmentRotationRad(
        puppet.rightUpperArm.x1,
        puppet.rightUpperArm.y1,
        puppet.rightUpperArm.x2,
        puppet.rightUpperArm.y2,
      );
    case 'lowerArmL':
      return segmentRotationRad(
        puppet.leftLowerArm.x1,
        puppet.leftLowerArm.y1,
        puppet.leftLowerArm.x2,
        puppet.leftLowerArm.y2,
      );
    case 'lowerArmR':
      return segmentRotationRad(
        puppet.rightLowerArm.x1,
        puppet.rightLowerArm.y1,
        puppet.rightLowerArm.x2,
        puppet.rightLowerArm.y2,
      );
    case 'neck':
      if (!puppet.neck) return 0;
      return segmentRotationRad(puppet.neck.x1, puppet.neck.y1, puppet.neck.x2, puppet.neck.y2);
    case 'torso':
      return puppet.torso?.angle ?? 0;
    case 'head':
      return puppet.head?.angle ?? 0;
    default:
      return 0;
  }
}

function angleFromPoint(anchor, pt) {
  return Math.atan2(pt.y - anchor.y, pt.x - anchor.x);
}

function getCalibrationAnchor(puppet, partKey) {
  if (!puppet) return null;

  switch (partKey) {
    case 'upperArmL':
      return puppet.joints?.leftShoulder;
    case 'upperArmR':
      return puppet.joints?.rightShoulder;
    case 'lowerArmL':
      return puppet.joints?.leftElbow;
    case 'lowerArmR':
      return puppet.joints?.rightElbow;
    case 'torso':
      return puppet.torso ? { x: puppet.torso.cx, y: puppet.torso.cy } : null;
    case 'head':
      return puppet.head ? { x: puppet.head.cx, y: puppet.head.cy } : null;
    case 'neck':
      return puppet.neck ? { x: puppet.neck.x2, y: puppet.neck.y2 } : null;
    default:
      return null;
  }
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

export default function CharacterPuppet({
  puppet,
  width,
  height,
  headImage,
  torsoImage,
  upperArmLImage,
  upperArmRImage,
  lowerArmLImage,
  lowerArmRImage,
  neckImage,
  imageNudges = {},
  calibratePart = null,
  calibrateMode = null,
  onPartAdjust = null,
  onNudgeDelta = null,
}) {
  const effects = useHandEffects(puppet);
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const puppetRef = useRef(puppet);
  puppetRef.current = puppet;
  const [isDragging, setIsDragging] = useState(false);

  const toSvgPoint = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * width,
      y: ((clientY - rect.top) / rect.height) * height,
    };
  }, [width, height]);

  const adjustPart = onPartAdjust
    ?? (onNudgeDelta ? (partKey, delta) => onNudgeDelta(partKey, delta.dx ?? delta, delta.dy ?? 0) : null);

  const onPointerDown = useCallback((e) => {
    if (!calibratePart || !adjustPart) return;
    e.preventDefault();
    const pt = toSvgPoint(e.clientX, e.clientY);

    if (calibrateMode === 'rotate') {
      const anchor = getCalibrationAnchor(puppetRef.current, calibratePart);
      if (!anchor) return;
      dragRef.current = { lastAngle: angleFromPoint(anchor, pt) };
    } else {
      dragRef.current = { lastPt: pt };
    }

    setIsDragging(true);
    svgRef.current?.setPointerCapture(e.pointerId);
  }, [calibratePart, calibrateMode, adjustPart, toSvgPoint]);

  const onPointerMove = useCallback((e) => {
    if (!dragRef.current || !adjustPart || !calibratePart) return;
    const pt = toSvgPoint(e.clientX, e.clientY);
    const anchor = getCalibrationAnchor(puppetRef.current, calibratePart);

    if (calibrateMode === 'rotate' && anchor) {
      const currentAngle = angleFromPoint(anchor, pt);
      const lastAngle = dragRef.current.lastAngle ?? angleFromPoint(anchor, dragRef.current);
      let dRotRad = currentAngle - lastAngle;
      while (dRotRad > Math.PI) dRotRad -= Math.PI * 2;
      while (dRotRad < -Math.PI) dRotRad += Math.PI * 2;

      if (dRotRad !== 0) {
        adjustPart(calibratePart, { dRot: (dRotRad * 180) / Math.PI });
      }
      dragRef.current = { lastAngle: currentAngle };
      return;
    }

    const lastPt = dragRef.current.lastPt ?? dragRef.current;
    const screenDx = pt.x - lastPt.x;
    const screenDy = pt.y - lastPt.y;
    if (screenDx === 0 && screenDy === 0) return;

    if (calibrateMode === 'scale') {
      adjustPart(calibratePart, { dScale: -screenDy * 0.004 });
      dragRef.current = { lastPt: pt };
      return;
    }

    const rotationRad = getPartRotationRad(puppetRef.current, calibratePart);
    const { dx, dy } = screenDeltaToRotatedNudge(screenDx, screenDy, rotationRad);
    adjustPart(calibratePart, { dx, dy });
    dragRef.current = { lastPt: pt };
  }, [calibrateMode, calibratePart, adjustPart, toSvgPoint]);

  const onPointerUp = useCallback((e) => {
    dragRef.current = null;
    setIsDragging(false);
    svgRef.current?.releasePointerCapture(e.pointerId);
  }, []);

  const getNudge = (key) => ({
    nudgeX: imageNudges[key]?.nudgeX ?? 0,
    nudgeY: imageNudges[key]?.nudgeY ?? 0,
    nudgeRot: imageNudges[key]?.nudgeRot ?? 0,
    nudgeScale: imageNudges[key]?.nudgeScale ?? 1,
  });

  if (!puppet) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="puppet-svg">
        <text x={width / 2} y={height / 2} textAnchor="middle" fill="#6b7280" fontSize={18}>
          Waiting for pose...
        </text>
      </svg>
    );
  }

  const { head, torso, neck, joints } = puppet;
  const armThickness = Math.max(head.radius * 0.35, 12);
  const headAngleDeg = (head.angle * 180) / Math.PI;
  const torsoAngleDeg = (torso.angle * 180) / Math.PI;
  const calibrateAnchor = calibratePart ? getCalibrationAnchor(puppet, calibratePart) : null;
  const isCalibrating = (partKey) => calibratePart === partKey;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="puppet-svg"
      style={{
        touchAction: calibratePart ? 'none' : undefined,
        cursor: calibratePart
          ? (isDragging ? 'grabbing' : calibrateMode === 'rotate' ? 'crosshair' : calibrateMode === 'scale' ? 'ns-resize' : 'grab')
          : undefined,
      }}
      onPointerDown={calibratePart ? onPointerDown : undefined}
      onPointerMove={calibratePart ? onPointerMove : undefined}
      onPointerUp={calibratePart ? onPointerUp : undefined}
      onPointerLeave={calibratePart ? onPointerUp : undefined}
    >
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

      {upperArmLImage ? (() => {
        const { x1, y1, x2, y2 } = puppet.leftUpperArm;
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const { nudgeX, nudgeY, nudgeRot, nudgeScale } = getNudge('upperArmL');
        return (
          <image
            href={upperArmLImage}
            x={cx - armThickness * 3 * nudgeScale + nudgeX}
            y={cy - len * 0.75 * nudgeScale + nudgeY}
            width={armThickness * 6 * nudgeScale}
            height={len * 1.5 * nudgeScale}
            transform={`rotate(${angle - 90 + nudgeRot} ${cx} ${cy})`}
            opacity={isCalibrating('upperArmL') ? 0.85 : 1}
          />
        );
      })() : (
        <ArmCapsule {...puppet.leftUpperArm} thickness={armThickness} color="#3b82f6" />
      )}
      {upperArmRImage ? (() => {
        const { x1, y1, x2, y2 } = puppet.rightUpperArm;
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const { nudgeX, nudgeY, nudgeRot, nudgeScale } = getNudge('upperArmR');
        return (
          <image
            href={upperArmRImage}
            x={cx - armThickness * 3 * nudgeScale + nudgeX}
            y={cy - len * 0.75 * nudgeScale + nudgeY}
            width={armThickness * 6 * nudgeScale}
            height={len * 1.5 * nudgeScale}
            transform={`rotate(${angle - 90 + nudgeRot} ${cx} ${cy})`}
            opacity={isCalibrating('upperArmR') ? 0.85 : 1}
          />
        );
      })() : (
        <ArmCapsule {...puppet.rightUpperArm} thickness={armThickness} color="#ec4899" />
      )}

      {neckImage && neck && (() => {
        const { x1, y1, x2, y2, width: neckW } = neck;
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        const neckLen = len * 3.5;
        const { nudgeX, nudgeY, nudgeRot, nudgeScale } = getNudge('neck');
        return (
          <image
            href={neckImage}
            x={cx - neckW * nudgeScale + nudgeX}
            y={cy - (neckLen * nudgeScale) / 2 + nudgeY}
            width={neckW * 2 * nudgeScale}
            height={neckLen * nudgeScale}
            transform={`rotate(${angle - 90 + nudgeRot} ${cx} ${cy})`}
            opacity={isCalibrating('neck') ? 0.85 : 1}
          />
        );
      })()}

      {torsoImage ? (() => {
        const { nudgeX, nudgeY, nudgeRot, nudgeScale } = getNudge('torso');
        return (
          <image
            href={torsoImage}
            x={torso.cx - torso.width * 1.25 * nudgeScale + nudgeX}
            y={torso.cy - torso.height * 1.25 * nudgeScale + nudgeY}
            width={torso.width * 2.5 * nudgeScale}
            height={torso.height * 2.5 * nudgeScale}
            transform={`rotate(${torsoAngleDeg + nudgeRot} ${torso.cx} ${torso.cy})`}
            opacity={isCalibrating('torso') ? 0.85 : 1}
          />
        );
      })() : (
        <rect
          x={torso.cx - torso.width / 2}
          y={torso.cy - torso.height / 2}
          width={torso.width}
          height={torso.height}
          rx={torso.width * 0.15}
          fill="#8b5cf6"
          stroke="#1a1a2e"
          strokeWidth={2}
          transform={`rotate(${torsoAngleDeg} ${torso.cx} ${torso.cy})`}
        />
      )}

      {lowerArmLImage ? (
        <SegmentLimbImage
          {...puppet.leftLowerArm}
          href={lowerArmLImage}
          armThickness={armThickness}
          widthFactor={5}
          {...getNudge('lowerArmL')}
          opacity={isCalibrating('lowerArmL') ? 0.85 : 1}
        />
      ) : (
        <ArmCapsule
          {...puppet.leftLowerArm}
          thickness={armThickness * 0.85}
          color="#60a5fa"
        />
      )}
      {lowerArmRImage ? (
        <SegmentLimbImage
          {...puppet.rightLowerArm}
          href={lowerArmRImage}
          armThickness={armThickness}
          widthFactor={5}
          {...getNudge('lowerArmR')}
          opacity={isCalibrating('lowerArmR') ? 0.85 : 1}
        />
      ) : (
        <ArmCapsule
          {...puppet.rightLowerArm}
          thickness={armThickness * 0.85}
          color="#f472b6"
        />
      )}

      <g transform={`rotate(${headAngleDeg + getNudge('head').nudgeRot} ${head.cx} ${head.cy})`}>
        {headImage ? (() => {
          const { nudgeX, nudgeY, nudgeScale } = getNudge('head');
          return (
            <image
              href={headImage}
              x={head.cx - head.radius * 2.5 * nudgeScale + nudgeX}
              y={head.cy - head.radius * 2.5 * nudgeScale + nudgeY}
              width={head.radius * 5 * nudgeScale}
              height={head.radius * 5 * nudgeScale}
              opacity={isCalibrating('head') ? 0.85 : 1}
            />
          );
        })() : (
          <>
            <circle
              cx={head.cx}
              cy={head.cy}
              r={head.radius}
              fill="#fbbf24"
              stroke="#1a1a2e"
              strokeWidth={2}
            />
            <circle cx={head.cx - head.radius * 0.3} cy={head.cy - head.radius * 0.15} r={4} fill="#1a1a2e" />
            <circle cx={head.cx + head.radius * 0.3} cy={head.cy - head.radius * 0.15} r={4} fill="#1a1a2e" />
            <path
              d={`M ${head.cx - head.radius * 0.25} ${head.cy + head.radius * 0.2}
                  Q ${head.cx} ${head.cy + head.radius * 0.45} ${head.cx + head.radius * 0.25} ${head.cy + head.radius * 0.2}`}
              fill="none"
              stroke="#1a1a2e"
              strokeWidth={2}
              strokeLinecap="round"
            />
          </>
        )}
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

      {joints?.leftShoulder && (
        <GlowJoint
          {...joints.leftShoulder}
          color={isCalibrating('upperArmL') ? '#fbbf24' : '#a78bfa'}
          r={isCalibrating('upperArmL') ? 12 : 10}
        />
      )}
      {joints?.rightShoulder && (
        <GlowJoint
          {...joints.rightShoulder}
          color={isCalibrating('upperArmR') ? '#fbbf24' : '#a78bfa'}
          r={isCalibrating('upperArmR') ? 12 : 10}
        />
      )}
      {calibrateAnchor && !['upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR'].includes(calibratePart) && (
        <GlowJoint {...calibrateAnchor} color="#fbbf24" r={12} />
      )}
      {joints?.leftElbow && (
        <GlowJoint
          {...joints.leftElbow}
          r={isCalibrating('lowerArmL') ? 12 : 8}
          color={isCalibrating('lowerArmL') ? '#fbbf24' : '#60a5fa'}
        />
      )}
      {joints?.rightElbow && (
        <GlowJoint
          {...joints.rightElbow}
          r={isCalibrating('lowerArmR') ? 12 : 8}
          color={isCalibrating('lowerArmR') ? '#fbbf24' : '#f472b6'}
        />
      )}
    </svg>
  );
}

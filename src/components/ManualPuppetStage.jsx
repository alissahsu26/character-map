import { useCallback, useRef, useState } from 'react';

const W = 640;
const H = 480;

const DEFAULT_JOINTS = {
  head:          { x: 320, y: 72 },
  leftShoulder:  { x: 258, y: 162 },
  rightShoulder: { x: 382, y: 162 },
  leftElbow:     { x: 210, y: 252 },
  rightElbow:    { x: 430, y: 252 },
  leftWrist:     { x: 185, y: 332 },
  rightWrist:    { x: 455, y: 332 },
  leftHip:       { x: 282, y: 302 },
  rightHip:      { x: 358, y: 302 },
  leftKnee:      { x: 267, y: 388 },
  rightKnee:     { x: 373, y: 388 },
  leftFoot:      { x: 258, y: 462 },
  rightFoot:     { x: 382, y: 462 },
};

// Natural rest lengths and thicknesses — volume preserved when stretched/compressed
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
      {/* subtle highlight */}
      <line
        x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
        stroke="rgba(255,255,255,0.13)" strokeWidth={t * 0.3} strokeLinecap="round"
      />
    </g>
  );
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
      <path d={d} fill="url(#torsoSheen)" />
    </g>
  );
}

function Head({ cx, cy, r, tiltDeg }) {
  return (
    <g>
      {/* shadow */}
      <circle cx={cx + 3} cy={cy + 5} r={r} fill="rgba(0,0,0,0.35)" />
      {/* skull */}
      <circle cx={cx} cy={cy} r={r} fill="#fbbf24" stroke="#d97706" strokeWidth={2.5} />
      {/* face features rotate with head tilt */}
      <g transform={`rotate(${tiltDeg} ${cx} ${cy})`}>
        <circle cx={cx - 13} cy={cy - 10} r={6}   fill="#1a1a2e" />
        <circle cx={cx + 13} cy={cy - 10} r={6}   fill="#1a1a2e" />
        <circle cx={cx - 11} cy={cy - 13} r={2.2} fill="white" opacity={0.9} />
        <circle cx={cx + 15} cy={cy - 13} r={2.2} fill="white" opacity={0.9} />
        <path
          d={`M ${cx - 11} ${cy + 10} Q ${cx} ${cy + 22} ${cx + 11} ${cy + 10}`}
          fill="none" stroke="#d97706" strokeWidth={2.5} strokeLinecap="round"
        />
        <circle cx={cx - 22} cy={cy + 5}  r={7} fill="#f97316" opacity={0.3} />
        <circle cx={cx + 22} cy={cy + 5}  r={7} fill="#f97316" opacity={0.3} />
      </g>
    </g>
  );
}

function DragHandle({ x, y, id, active, onPointerDown }) {
  return (
    <g
      onPointerDown={(e) => onPointerDown(e, id)}
      style={{ cursor: active ? 'grabbing' : 'grab' }}
    >
      <circle cx={x} cy={y} r={active ? 16 : 12} fill="#8b5cf6" opacity={0.25} />
      <circle
        cx={x} cy={y} r={active ? 7 : 5.5}
        fill={active ? '#e9d5ff' : '#c4b5fd'}
        stroke={active ? '#a78bfa' : '#6d28d9'}
        strokeWidth={2}
      />
    </g>
  );
}

export default function ManualPuppetStage({ width = W, height = H }) {
  const [joints, setJoints] = useState(() => structuredClone(DEFAULT_JOINTS));
  const [dragging, setDragging] = useState(null);
  const [hinted, setHinted] = useState(false);
  const svgRef = useRef(null);

  const toSVGPoint = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * width,
      y: ((clientY - r.top) / r.height) * height,
    };
  }, [width, height]);

  const onHandleDown = useCallback((e, id) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(id);
    setHinted(true);
    // Redirect all pointer events to the SVG for smooth dragging outside bounds
    svgRef.current?.setPointerCapture(e.pointerId);
  }, []);

  const onMove = useCallback((e) => {
    if (!dragging) return;
    const pt = toSVGPoint(e.clientX, e.clientY);
    setJoints((prev) => ({
      ...prev,
      [dragging]: {
        x: Math.max(0, Math.min(width, pt.x)),
        y: Math.max(0, Math.min(height, pt.y)),
      },
    }));
  }, [dragging, toSVGPoint, width, height]);

  const onUp = useCallback(() => setDragging(null), []);

  const j = joints;
  const neckBase = {
    x: (j.leftShoulder.x + j.rightShoulder.x) / 2,
    y: (j.leftShoulder.y + j.rightShoulder.y) / 2,
  };
  const headRadius = 40;
  // Tilt: 0° when head is directly above neckBase, rotates with head drag
  const tiltDeg = Math.atan2(j.head.x - neckBase.x, neckBase.y - j.head.y) * 180 / Math.PI;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="puppet-svg"
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      style={{ touchAction: 'none', userSelect: 'none' }}
    >
      <defs>
        <linearGradient id="torsoSheen" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="white" stopOpacity="0.22" />
          <stop offset="55%"  stopColor="white" stopOpacity="0.04" />
          <stop offset="100%" stopColor="black" stopOpacity="0.12" />
        </linearGradient>
        <filter id="softGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* ── back leg (right) ── */}
      <Limb p1={j.rightHip}  p2={j.rightKnee} nat={LIMB.upperLeg} fill="#5b21b6" />
      <Limb p1={j.rightKnee} p2={j.rightFoot} nat={LIMB.lowerLeg} fill="#6d28d9" />
      <ellipse
        cx={j.rightFoot.x} cy={j.rightFoot.y} rx={20} ry={12}
        fill="#4c1d95" stroke="#1a1a2e" strokeWidth={2}
      />

      {/* ── front leg (left) ── */}
      <Limb p1={j.leftHip}  p2={j.leftKnee} nat={LIMB.upperLeg} fill="#6d28d9" />
      <Limb p1={j.leftKnee} p2={j.leftFoot} nat={LIMB.lowerLeg} fill="#7c3aed" />
      <ellipse
        cx={j.leftFoot.x} cy={j.leftFoot.y} rx={20} ry={12}
        fill="#5b21b6" stroke="#1a1a2e" strokeWidth={2}
      />

      {/* ── torso ── */}
      <Torso ls={j.leftShoulder} rs={j.rightShoulder} lh={j.leftHip} rh={j.rightHip} />

      {/* ── back arm (right) ── */}
      <Limb p1={j.rightShoulder} p2={j.rightElbow} nat={LIMB.upperArm} fill="#be185d" />
      <Limb p1={j.rightElbow}    p2={j.rightWrist}  nat={LIMB.lowerArm} fill="#db2777" />
      <circle
        cx={j.rightWrist.x} cy={j.rightWrist.y} r={15}
        fill="#f9a8d4" stroke="#1a1a2e" strokeWidth={2}
        filter="url(#softGlow)"
      />

      {/* ── neck ── */}
      <Limb p1={j.head} p2={neckBase} nat={LIMB.neck} fill="#a78bfa" showShadow={false} />

      {/* ── head ── */}
      <Head cx={j.head.x} cy={j.head.y} r={headRadius} tiltDeg={tiltDeg} />

      {/* ── front arm (left) ── */}
      <Limb p1={j.leftShoulder} p2={j.leftElbow} nat={LIMB.upperArm} fill="#1d4ed8" />
      <Limb p1={j.leftElbow}    p2={j.leftWrist}  nat={LIMB.lowerArm} fill="#3b82f6" />
      <circle
        cx={j.leftWrist.x} cy={j.leftWrist.y} r={15}
        fill="#93c5fd" stroke="#1a1a2e" strokeWidth={2}
        filter="url(#softGlow)"
      />

      {/* ── drag handles (rendered last so always on top) ── */}
      {Object.entries(joints).map(([id, pos]) => (
        <DragHandle
          key={id}
          x={pos.x} y={pos.y}
          id={id}
          active={dragging === id}
          onPointerDown={onHandleDown}
        />
      ))}

      {/* ── reset button ── */}
      <g
        onClick={() => { setJoints(structuredClone(DEFAULT_JOINTS)); setDragging(null); }}
        style={{ cursor: 'pointer' }}
      >
        <rect x={8} y={8} width={62} height={26} rx={7} fill="#1a1a2e" stroke="#2e2e42" />
        <text
          x={39} y={26}
          textAnchor="middle" fill="#9ca3af" fontSize={11}
          fontFamily="system-ui, sans-serif"
        >
          Reset
        </text>
      </g>

      {/* ── first-use hint ── */}
      {!hinted && (
        <text
          x={width / 2} y={height - 14}
          textAnchor="middle" fill="#4b5563" fontSize={13}
          fontFamily="system-ui, sans-serif"
          pointerEvents="none"
        >
          Drag the purple handles to pose the puppet
        </text>
      )}
    </svg>
  );
}

import { HAND_CONNECTIONS } from '../utils/handLandmarks';

function scaleLandmark(lm, srcW, srcH, dstW, dstH) {
  return {
    x: (lm.x / srcW) * dstW,
    y: (lm.y / srcH) * dstH,
  };
}

function HandSkeleton({ landmarks, srcW, srcH, dstW, dstH, strokeWidth, jointRadius }) {
  if (!landmarks?.length) return null;

  const scaled = landmarks.map((lm) => scaleLandmark(lm, srcW, srcH, dstW, dstH));

  return (
    <g>
      {HAND_CONNECTIONS.map(([a, b]) => {
        const pA = scaled[a];
        const pB = scaled[b];
        if (!pA || !pB) return null;
        return (
          <line
            key={`${a}-${b}`}
            x1={pA.x}
            y1={pA.y}
            x2={pB.x}
            y2={pB.y}
            stroke="#7dd3fc"
            strokeWidth={strokeWidth}
            opacity={0.9}
          />
        );
      })}
      {scaled.map((lm, i) => (
        <circle
          key={i}
          cx={lm.x}
          cy={lm.y}
          r={jointRadius}
          fill="#facc15"
          opacity={0.95}
        />
      ))}
    </g>
  );
}

export default function HandSkeletonDebug({
  hands,
  visible,
  srcW,
  srcH,
  dstW,
  dstH,
  compact = false,
  className = 'hand-skeleton-overlay',
}) {
  if (!visible || !hands?.length) return null;

  const strokeWidth = compact ? 1.5 : 2;
  const jointRadius = compact ? 2.5 : 4;

  return (
    <svg
      viewBox={`0 0 ${dstW} ${dstH}`}
      width={compact ? '100%' : dstW}
      height={compact ? '100%' : dstH}
      className={className}
      preserveAspectRatio="xMidYMid meet"
    >
      {hands.map((hand, i) => (
        <HandSkeleton
          key={hand.handedness ?? i}
          landmarks={hand.landmarks}
          srcW={srcW}
          srcH={srcH}
          dstW={dstW}
          dstH={dstH}
          strokeWidth={strokeWidth}
          jointRadius={jointRadius}
        />
      ))}
    </svg>
  );
}

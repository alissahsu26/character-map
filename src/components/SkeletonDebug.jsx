import { MOVENET_CONNECTIONS } from '../utils/poseMapping';

function getKeypoint(keypoints, name) {
  return keypoints.find((kp) => kp.name === name);
}

function scaleKeypoint(kp, srcW, srcH, dstW, dstH) {
  return {
    x: (kp.x / srcW) * dstW,
    y: (kp.y / srcH) * dstH,
    score: kp.score,
    name: kp.name,
  };
}

export default function SkeletonDebug({ keypoints, visible, srcW, srcH, dstW, dstH }) {
  if (!visible || !keypoints?.length) return null;

  const scaled = keypoints.map((kp) => scaleKeypoint(kp, srcW, srcH, dstW, dstH));

  return (
    <svg
      viewBox={`0 0 ${dstW} ${dstH}`}
      width={dstW}
      height={dstH}
      className="skeleton-overlay"
    >
      {MOVENET_CONNECTIONS.map(([a, b]) => {
        const kpA = getKeypoint(scaled, a);
        const kpB = getKeypoint(scaled, b);
        if (!kpA || !kpB || kpA.score < 0.3 || kpB.score < 0.3) return null;
        return (
          <line
            key={`${a}-${b}`}
            x1={kpA.x}
            y1={kpA.y}
            x2={kpB.x}
            y2={kpB.y}
            stroke="#22d3ee"
            strokeWidth={2}
            opacity={0.7}
          />
        );
      })}
      {scaled.map((kp) => (
        <circle
          key={kp.name}
          cx={kp.x}
          cy={kp.y}
          r={5}
          fill={kp.score > 0.6 ? '#22d3ee' : '#f59e0b'}
          opacity={Math.max(kp.score, 0.3)}
        />
      ))}
    </svg>
  );
}

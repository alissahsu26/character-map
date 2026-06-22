import { useEffect, useState } from 'react';

const MODE_LABELS = {
  FULL_BODY: 'Full body',
  UPPER_BODY: 'Upper body',
  HEAD_ONLY: 'Head only',
  PARTIAL: 'Partial',
};

const DEFAULT_ACTIVE = {
  head: false,
  torso: false,
  leftArm: false,
  rightArm: false,
};

function PartRow({ label, active }) {
  return (
    <div className="tracking-part-row">
      <span>{label}</span>
      <span className={active ? 'tracking-active' : 'tracking-inactive'}>
        {active ? '✅' : '❌'}
      </span>
    </div>
  );
}

export default function TrackingDebugPanel({ stateRef, fpsRef }) {
  const [view, setView] = useState({
    mode: null,
    active: DEFAULT_ACTIVE,
    landmarks: [],
    fps: 0,
  });

  useEffect(() => {
    let rafId = 0;

    const tick = () => {
      const next = stateRef.current;
      setView({
        mode: next?.mode ?? null,
        active: next?.active
          ? {
              head: next.active.head,
              torso: next.active.torso,
              leftArm: next.active.leftArm,
              rightArm: next.active.rightArm,
            }
          : DEFAULT_ACTIVE,
        landmarks: next?.activeLandmarks ?? [],
        fps: fpsRef?.current ?? 0,
      });
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [stateRef, fpsRef]);

  return (
    <div className="tracking-debug-panel">
      <div className="tracking-fps">FPS: {view.fps}</div>
      <div className="tracking-mode">
        Mode: <strong>{view.mode ? (MODE_LABELS[view.mode] ?? view.mode) : '—'}</strong>
      </div>
      <div className="tracking-parts">
        <PartRow label="Head" active={view.active.head} />
        <PartRow label="Torso" active={view.active.torso} />
        <PartRow label="Left Arm" active={view.active.leftArm} />
        <PartRow label="Right Arm" active={view.active.rightArm} />
      </div>
      {view.landmarks.length > 0 && (
        <div className="tracking-landmarks">
          <span className="tracking-landmarks-label">Landmarks:</span>{' '}
          {view.landmarks.join(', ')}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';

const MODE_LABELS = {
  FULL_BODY: 'Full body',
  UPPER_BODY: 'Upper body',
  HEAD_ONLY: 'Head only',
  PARTIAL: 'Partial',
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

export default function TrackingDebugPanel({ stateRef }) {
  const [state, setState] = useState(null);

  useEffect(() => {
    let rafId = 0;
    let prevKey = '';

    const tick = () => {
      const next = stateRef.current;
      if (next?.mode) {
        const key = `${next.mode}:${next.active.head}:${next.active.torso}:${next.active.leftArm}:${next.active.rightArm}`;
        if (key !== prevKey) {
          prevKey = key;
          setState({ mode: next.mode, active: { ...next.active } });
        }
      } else if (prevKey) {
        prevKey = '';
        setState(null);
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [stateRef]);

  if (!state?.mode) return null;

  return (
    <div className="tracking-debug-panel">
      <div className="tracking-mode">
        Mode: <strong>{MODE_LABELS[state.mode] ?? state.mode}</strong>
      </div>
      <div className="tracking-parts">
        <PartRow label="Head" active={state.active.head} />
        <PartRow label="Torso" active={state.active.torso} />
        <PartRow label="Left Arm" active={state.active.leftArm} />
        <PartRow label="Right Arm" active={state.active.rightArm} />
      </div>
    </div>
  );
}

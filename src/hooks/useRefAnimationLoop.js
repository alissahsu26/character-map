import { useEffect, useReducer, useRef } from 'react';

/**
 * Re-render about once per frame while `active` is true.
 * Uses a mount-once rAF loop + ref for the active flag so toggling visibility
 * does not restart the effect (which can cascade setState → effect → setState).
 */
export function useRefAnimationLoop(active) {
  const [, tick] = useReducer((n) => n + 1, 0);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    let frame = 0;
    let running = true;

    const loop = () => {
      if (!running) return;
      if (activeRef.current) {
        tick();
      }
      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}

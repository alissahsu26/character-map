import { useEffect, useReducer, useRef } from 'react';
import CharacterPuppet from '../render/CharacterPuppet';
import DebugOverlay from '../render/DebugOverlay';
import { computeBodyState, BodyStateSmoother } from '../body/bodyState';
import { bodyStateToControls } from '../mapping/bodyToControls';
import { buildPuppetRig } from '../character/puppetRig';

/**
 * Data flow:
 *   keypoints (MoveNet)
 *   → computeBodyState()   → BodyState   (normalized, 0-1)
 *   → BodyStateSmoother    → smoothed BodyState
 *   → bodyStateToControls() → CharacterControls  (artistic)
 *   → buildPuppetRig()     → PuppetRig   (display pixels)
 *   → CharacterPuppet      → SVG
 */
export default function PuppetStage({ keypointsRef, videoSizeRef, width, height, showDebug }) {
  const [, tick] = useReducer((n) => n + 1, 0);
  const smootherRef = useRef(null);

  if (!smootherRef.current) {
    smootherRef.current = new BodyStateSmoother();
  }

  useEffect(() => {
    let frame;
    const loop = () => {
      tick();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  const keypoints = keypointsRef.current;
  const videoSize = videoSizeRef.current;

  const rawBodyState =
    keypoints?.length && videoSize?.width
      ? computeBodyState(keypoints, videoSize)
      : null;

  const bodyState = smootherRef.current.smooth(rawBodyState);
  const controls  = bodyStateToControls(bodyState);
  const puppet    = buildPuppetRig(bodyState, controls, width, height);

  return (
    <div style={{ position: 'relative', width, height }}>
      <CharacterPuppet puppet={puppet} width={width} height={height} />
      {showDebug && <DebugOverlay bodyState={bodyState} controls={controls} />}
    </div>
  );
}

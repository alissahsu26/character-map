import { useEffect, useReducer, useRef } from 'react';
import CohesiveCharacterPuppet from '../render/CohesiveCharacterPuppet';
import DebugOverlay from '../render/DebugOverlay';
import { BodyStateEstimator } from '../body/BodyStateEstimator';
import { bodyStateToControls } from '../mapping/bodyToControls';
import { buildCohesivePuppetRig } from '../character/puppetRig';

/**
 * Puppet 3 — pose-tracked puppet with round-capped limbs and a connected torso path.
 */
export default function Puppet3Stage({ keypointsRef, videoSizeRef, width, height, showDebug }) {
  const [, tick] = useReducer((n) => n + 1, 0);
  const estimatorRef = useRef(null);

  if (!estimatorRef.current) {
    estimatorRef.current = new BodyStateEstimator();
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

  const { bodyState, debug: estimatorDebug } = estimatorRef.current.estimate(
    keypoints?.length && videoSize?.width ? keypoints : null,
    videoSize
  );
  const controls = bodyStateToControls(bodyState);
  const puppet = buildCohesivePuppetRig(bodyState, controls, width, height);

  return (
    <div style={{ position: 'relative', width, height }}>
      <CohesiveCharacterPuppet puppet={puppet} width={width} height={height} />
      {showDebug && (
        <DebugOverlay
          bodyState={bodyState}
          controls={controls}
          estimatorDebug={estimatorDebug}
        />
      )}
    </div>
  );
}

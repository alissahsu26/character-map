import { useEffect, useReducer } from 'react';
import CharacterPuppet from './CharacterPuppet';
import { mapPoseToPuppet } from '../utils/poseMapping';

/** Live 2D puppet driven from pose keypoints (ref-based, no per-frame parent setState). */
export default function PuppetStage({ keypointsRef, videoSizeRef, width, height }) {
  const [, tick] = useReducer((n) => n + 1, 0);

  useEffect(() => {
    let frame = 0;
    const loop = () => {
      tick();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  const keypoints = keypointsRef.current;
  const videoSize = videoSizeRef.current;
  const puppet =
    keypoints?.length && videoSize?.width
      ? mapPoseToPuppet(keypoints, videoSize.width, videoSize.height, width, height)
      : null;

  return <CharacterPuppet puppet={puppet} width={width} height={height} />;
}

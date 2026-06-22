import { useEffect, useReducer } from 'react';
import SkeletonDebug from './SkeletonDebug';

/** Reads keypoints from a ref and re-renders at display refresh rate (no parent setState per frame). */
export default function KeypointsOverlay({
  keypointsRef,
  videoSizeRef,
  visible,
  dstW,
  dstH,
}) {
  const [, tick] = useReducer((n) => n + 1, 0);

  useEffect(() => {
    if (!visible) return undefined;
    let frame = 0;
    const loop = () => {
      tick();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  if (!visible) return null;

  const keypoints = keypointsRef.current;
  const videoSize = videoSizeRef.current;

  return (
    <SkeletonDebug
      keypoints={keypoints}
      visible={visible}
      srcW={videoSize.width}
      srcH={videoSize.height}
      dstW={dstW}
      dstH={dstH}
    />
  );
}

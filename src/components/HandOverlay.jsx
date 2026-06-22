import { useEffect, useReducer } from 'react';
import HandSkeletonDebug from './HandSkeletonDebug';

/** Reads hand landmarks from a ref and re-renders at display refresh rate. */
export default function HandOverlay({
  handsRef,
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

  return (
    <HandSkeletonDebug
      hands={handsRef.current}
      visible={visible}
      srcW={videoSizeRef.current.width}
      srcH={videoSizeRef.current.height}
      dstW={dstW}
      dstH={dstH}
    />
  );
}

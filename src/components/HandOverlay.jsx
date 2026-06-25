import HandSkeletonDebug from './HandSkeletonDebug';
import { useRefAnimationLoop } from '../hooks/useRefAnimationLoop';

/** Reads hand landmarks from a ref and re-renders at display refresh rate. */
export default function HandOverlay({
  handsRef,
  videoSizeRef,
  visible,
  dstW,
  dstH,
}) {
  useRefAnimationLoop(visible);

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

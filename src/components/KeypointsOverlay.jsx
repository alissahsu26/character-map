import SkeletonDebug from './SkeletonDebug';
import { useRefAnimationLoop } from '../hooks/useRefAnimationLoop';
import {
  derivedLandmarksForDebug,
  extractHeadNeckLandmarks,
  HEAD_NECK_CONNECTIONS,
  mergePoseKeypointsForDisplay,
} from '../utils/headNeckLandmarks';

/** Reads keypoints from a ref and re-renders at display refresh rate (no parent setState per frame). */
export default function KeypointsOverlay({
  keypointsRef,
  videoSizeRef,
  visible,
  dstW,
  dstH,
}) {
  useRefAnimationLoop(visible);

  if (!visible) return null;

  const keypoints = keypointsRef.current;
  const videoSize = videoSizeRef.current;

  if (!keypoints?.length) return null;

  const landmarks = extractHeadNeckLandmarks(keypoints, { swapHands: false });
  const displayKeypoints = mergePoseKeypointsForDisplay(
    keypoints,
    derivedLandmarksForDebug(landmarks)
  );

  return (
    <SkeletonDebug
      keypoints={displayKeypoints}
      visible={visible}
      srcW={videoSize.width}
      srcH={videoSize.height}
      dstW={dstW}
      dstH={dstH}
      extraConnections={HEAD_NECK_CONNECTIONS}
    />
  );
}

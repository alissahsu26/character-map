import { useEffect, useRef } from 'react';
import { usePoseTracking } from '../hooks/usePoseTracking';
import SkeletonDebug from './SkeletonDebug';
import HandSkeletonDebug from './HandSkeletonDebug';
import {
  derivedLandmarksForDebug,
  extractHeadNeckLandmarks,
  HEAD_NECK_CONNECTIONS,
  mergePoseKeypointsForDisplay,
} from '../utils/headNeckLandmarks';

const STAGE_WIDTH = 640;
const STAGE_HEIGHT = 480;
const PREVIEW_WIDTH = 160;
const PREVIEW_HEIGHT = 120;

export default function PoseTracker({
  onPoseUpdate,
  onHandUpdate,
  onStatusChange,
  fpsRef,
  showCameraSkeleton,
}) {
  const { videoRef, poses, hands, isReady, error, videoSize } = usePoseTracking(fpsRef);
  const onPoseUpdateRef = useRef(onPoseUpdate);
  const onHandUpdateRef = useRef(onHandUpdate);
  const keypoints = poses[0]?.keypoints;
  const displayKeypoints = keypoints?.length
    ? mergePoseKeypointsForDisplay(
        keypoints,
        derivedLandmarksForDebug(extractHeadNeckLandmarks(keypoints, { swapHands: true }))
      )
    : keypoints;

  onPoseUpdateRef.current = onPoseUpdate;
  onHandUpdateRef.current = onHandUpdate;

  useEffect(() => {
    onStatusChange?.({ isReady, error });
  }, [isReady, error, onStatusChange]);

  // Write keypoints to shared ref every pose frame (not only on React re-render).
  useEffect(() => {
    if (!keypoints?.length) return;
    onPoseUpdateRef.current?.(null, keypoints, videoSize);
  }, [keypoints, videoSize]);

  useEffect(() => {
    onHandUpdateRef.current?.(hands, videoSize);
  }, [hands, videoSize]);

  return (
    <div className="pose-tracker">
      <div className="webcam-preview-wrap mirror">
        <video
          ref={videoRef}
          className="webcam-preview"
          playsInline
          muted
          width={PREVIEW_WIDTH}
          height={PREVIEW_HEIGHT}
        />
        <SkeletonDebug
          keypoints={displayKeypoints}
          visible={showCameraSkeleton && isReady}
          srcW={videoSize.width}
          srcH={videoSize.height}
          dstW={PREVIEW_WIDTH}
          dstH={PREVIEW_HEIGHT}
          compact
          className="webcam-skeleton-overlay"
          extraConnections={HEAD_NECK_CONNECTIONS}
        />
        <HandSkeletonDebug
          hands={hands}
          visible={showCameraSkeleton && isReady}
          srcW={videoSize.width}
          srcH={videoSize.height}
          dstW={PREVIEW_WIDTH}
          dstH={PREVIEW_HEIGHT}
          compact
          className="webcam-hand-overlay"
        />
      </div>
      {!isReady && !error && (
        <div className="tracker-status">Loading camera &amp; pose/hand models...</div>
      )}
      {error && <div className="tracker-status tracker-error">{error}</div>}
    </div>
  );
}

export { STAGE_WIDTH, STAGE_HEIGHT };

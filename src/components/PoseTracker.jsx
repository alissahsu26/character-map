import { useEffect } from 'react';
import { usePoseTracking } from '../hooks/usePoseTracking';
import { mapPoseToPuppet } from '../utils/poseMapping';

const STAGE_WIDTH = 640;
const STAGE_HEIGHT = 480;

export default function PoseTracker({ onPoseUpdate, onStatusChange }) {
  const { videoRef, poses, isReady, error, videoSize } = usePoseTracking();

  useEffect(() => {
    onStatusChange?.({ isReady, error });
  }, [isReady, error, onStatusChange]);

  useEffect(() => {
    if (!poses.length) return;
    const keypoints = poses[0].keypoints;
    const puppet = mapPoseToPuppet(
      keypoints,
      videoSize.width,
      videoSize.height,
      STAGE_WIDTH,
      STAGE_HEIGHT
    );
    onPoseUpdate?.(puppet, keypoints, videoSize);
  }, [poses, videoSize, onPoseUpdate]);

  return (
    <div className="pose-tracker">
      <video
        ref={videoRef}
        className="webcam-preview"
        playsInline
        muted
        width={160}
        height={120}
      />
      {!isReady && !error && (
        <div className="tracker-status">Loading camera &amp; pose model...</div>
      )}
      {error && <div className="tracker-status tracker-error">{error}</div>}
    </div>
  );
}

export { STAGE_WIDTH, STAGE_HEIGHT };

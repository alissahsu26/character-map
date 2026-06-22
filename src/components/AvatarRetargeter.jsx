import { useFrame } from '@react-three/fiber';
import { retargetPoseToAvatar } from '../utils/poseToAvatar';

export default function AvatarRetargeter({
  keypointsRef,
  videoSizeRef,
  avatarBonesRef,
  trackingStateRef,
  enabled = true,
}) {
  useFrame(() => {
    if (!enabled) return;
    const bones = avatarBonesRef.current;
    const keypoints = keypointsRef.current;
    const videoSize = videoSizeRef.current;
    if (!bones || !keypoints?.length) return;

    const debug = retargetPoseToAvatar(keypoints, bones, videoSize);
    if (trackingStateRef) {
      trackingStateRef.current = debug;
    }
  });

  return null;
}

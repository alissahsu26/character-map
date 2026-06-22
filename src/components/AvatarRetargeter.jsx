import { useFrame } from '@react-three/fiber';
import { retargetPoseToAvatar } from '../utils/poseToAvatar';

export default function AvatarRetargeter({ keypointsRef, videoSizeRef, avatarBonesRef }) {
  useFrame(() => {
    const bones = avatarBonesRef.current;
    const keypoints = keypointsRef.current;
    const videoSize = videoSizeRef.current;
    if (!bones || !keypoints?.length) return;

    retargetPoseToAvatar(keypoints, bones, videoSize);
  });

  return null;
}

import { Suspense, useCallback, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import CharlieModel from './CharlieModel';
import AvatarRetargeter from './AvatarRetargeter';
import AvatarBoneHelpers from './AvatarBoneHelpers';
import LandmarkMarkers from './LandmarkMarkers';

const CAMERA_TARGET = [0, 0.9, 0];

export default function ThreeScene({
  keypointsRef,
  videoSizeRef,
  trackingStateRef,
  showBoneHelpers = false,
  showLandmarks = false,
}) {
  const avatarBonesRef = useRef(null);
  const [avatarRoot, setAvatarRoot] = useState(null);

  const handleAvatarReady = useCallback(({ root, bones }) => {
    avatarBonesRef.current = bones;
    setAvatarRoot(root);
  }, []);

  return (
    <Canvas
      className="three-canvas"
      camera={{ position: [0, 1.0, 2.4], fov: 42 }}
      gl={{ antialias: true }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 4, 3]} intensity={1.2} />
      <directionalLight position={[-2, 2, 1]} intensity={0.4} />
      <Environment preset="city" />
      <Suspense fallback={null}>
        <CharlieModel onAvatarReady={handleAvatarReady} />
      </Suspense>
      <AvatarRetargeter
        keypointsRef={keypointsRef}
        videoSizeRef={videoSizeRef}
        avatarBonesRef={avatarBonesRef}
        trackingStateRef={trackingStateRef}
      />
      <AvatarBoneHelpers root={avatarRoot} visible={showBoneHelpers} />
      <LandmarkMarkers
        keypointsRef={keypointsRef}
        videoSizeRef={videoSizeRef}
        visible={showLandmarks}
      />
      <OrbitControls target={CAMERA_TARGET} enablePan={false} minDistance={1.5} maxDistance={4} />
      <gridHelper args={[4, 16, '#2e2e42', '#1a1a2e']} position={[0, 0, 0]} />
    </Canvas>
  );
}

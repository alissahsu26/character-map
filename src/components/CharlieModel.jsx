import { useEffect, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import charlieModelUrl from '../assets/charlie_the_fox_vrc.glb?url';
import { centerAndScaleModel, inspectGlbHierarchy } from '../utils/inspectGlbHierarchy';
import { mapAvatarBones } from '../utils/mapAvatarBones';

export default function CharlieModel({ onAvatarReady }) {
  const onReadyRef = useRef(onAvatarReady);
  const { scene } = useGLTF(charlieModelUrl);

  onReadyRef.current = onAvatarReady;

  useEffect(() => {
    if (!scene) return;

    // Always reset cached GLTF scene so HMR doesn't stack rotations.
    centerAndScaleModel(scene);

    inspectGlbHierarchy(scene, 'charlie.glb');
    const avatarBones = mapAvatarBones(scene);
    onReadyRef.current?.({ root: scene, bones: avatarBones });
  }, [scene]);

  return <primitive object={scene} />;
}

useGLTF.preload(charlieModelUrl);

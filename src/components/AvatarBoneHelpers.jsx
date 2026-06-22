import { useEffect, useState } from 'react';
import { SkeletonHelper } from 'three';

export default function AvatarBoneHelpers({ root, visible }) {
  const [helper, setHelper] = useState(null);

  useEffect(() => {
    if (!root || !visible) {
      setHelper(null);
      return undefined;
    }

    const h = new SkeletonHelper(root);
    h.material.depthTest = false;
    h.renderOrder = 999;
    setHelper(h);

    return () => {
      h.geometry?.dispose();
      h.material?.dispose();
      setHelper(null);
    };
  }, [root, visible]);

  if (!helper) return null;
  return <primitive object={helper} />;
}

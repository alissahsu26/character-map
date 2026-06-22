import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import { poseLandmarksTo3D } from '../utils/poseToAvatar';

const TRACKED = new Set([
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
]);

const SPHERE_GEOMETRY = new SphereGeometry(0.025, 10, 10);

export default function LandmarkMarkers({ keypointsRef, videoSizeRef, visible }) {
  const groupRef = useRef();
  const meshesRef = useRef(new Map());

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return undefined;

    const meshes = meshesRef.current;
    for (const name of TRACKED) {
      const mesh = new Mesh(
        SPHERE_GEOMETRY,
        new MeshBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.9 })
      );
      mesh.visible = false;
      mesh.name = `landmark-${name}`;
      group.add(mesh);
      meshes.set(name, mesh);
    }

    return () => {
      for (const mesh of meshes.values()) {
        mesh.material.dispose();
        group.remove(mesh);
      }
      meshes.clear();
    };
  }, []);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;

    group.visible = visible;
    if (!visible) return;

    const markers = poseLandmarksTo3D(keypointsRef.current, videoSizeRef.current);
    const active = new Set();

    for (const m of markers) {
      if (!TRACKED.has(m.name)) continue;
      active.add(m.name);
      const mesh = meshesRef.current.get(m.name);
      if (!mesh) continue;
      mesh.visible = true;
      mesh.position.copy(m.position);
      mesh.material.color.set(m.score > 0.6 ? '#22d3ee' : '#f59e0b');
    }

    for (const [name, mesh] of meshesRef.current) {
      if (!active.has(name)) mesh.visible = false;
    }
  });

  return <group ref={groupRef} position={[0, 0.9, 0.35]} />;
}

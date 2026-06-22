import { Box3, Vector3 } from 'three';

const BONE_PATTERNS = {
  head: [/^head[_\.\d]/i, /^mixamorig:head$/i],
  leftUpperArm: [/^upper_arml/i, /^upper_arm\.l/i, /^upperarm\.l/i, /^leftarm$/i, /^mixamorig:leftarm$/i],
  rightUpperArm: [/^upper_armr/i, /^upper_arm\.r/i, /^upperarm\.r/i, /^rightarm$/i, /^mixamorig:rightarm$/i],
  leftForearm: [/^forearml/i, /^forearm\.l/i, /^lowerarm\.l/i, /^leftforearm$/i, /^mixamorig:leftforearm$/i],
  rightForearm: [/^forearmr/i, /^forearm\.r/i, /^lowerarm\.r/i, /^rightforearm$/i, /^mixamorig:rightforearm$/i],
  spine: [/^spine002/i, /^spine[_\d.]/i, /^spine$/i, /^mixamorig:spine$/i, /^spine1$/i],
  neck: [/^neck/i, /^mixamorig:neck$/i],
};

function matchesAny(name, patterns) {
  return patterns.some((re) => re.test(name));
}

function getObjectPath(object) {
  const parts = [];
  let current = object;
  while (current) {
    parts.unshift(current.name || current.type);
    current = current.parent;
  }
  return parts.join(' / ');
}

function formatHierarchyLines(object, depth = 0) {
  const indent = '  '.repeat(depth);
  const tags = [];
  if (object.isMesh) tags.push(object.skeleton ? 'skinned-mesh' : 'mesh');
  if (object.isBone) tags.push('bone');
  const tagStr = tags.length ? ` (${tags.join(', ')})` : '';
  const lines = [`${indent}${object.name || '(unnamed)'} [${object.type}]${tagStr}`];
  for (const child of object.children) {
    lines.push(...formatHierarchyLines(child, depth + 1));
  }
  return lines;
}

export function inspectGlbHierarchy(root, label = 'charlie.glb') {
  const meshes = [];
  const bones = [];
  const skeletons = [];

  root.traverse((node) => {
    if (node.isMesh) {
      meshes.push({
        name: node.name || '(unnamed)',
        type: node.type,
        path: getObjectPath(node),
        vertexCount: node.geometry?.attributes?.position?.count ?? 0,
        hasSkeleton: !!node.skeleton,
        boneCount: node.skeleton?.bones?.length ?? 0,
        material: Array.isArray(node.material)
          ? node.material.map((m) => m?.name || m?.type)
          : node.material?.name || node.material?.type,
      });

      if (node.skeleton && !skeletons.includes(node.skeleton)) {
        skeletons.push(node.skeleton);
      }
    }

    if (node.isBone) {
      bones.push({
        name: node.name || '(unnamed)',
        path: getObjectPath(node),
        parent: node.parent?.name ?? null,
        childCount: node.children.length,
      });
    }
  });

  const skeletonExists = skeletons.length > 0;
  const skeletonBoneNames = skeletons[0]?.bones?.map((b) => b.name) ?? bones.map((b) => b.name);

  const identified = {
    head: [],
    neck: [],
    leftUpperArm: [],
    rightUpperArm: [],
    leftForearm: [],
    rightForearm: [],
    spine: [],
  };

  for (const name of skeletonBoneNames) {
    for (const [role, patterns] of Object.entries(BONE_PATTERNS)) {
      if (matchesAny(name, patterns)) {
        identified[role].push(name);
      }
    }
  }

  const hierarchyLines = formatHierarchyLines(root);

  const report = {
    label,
    skeletonExists,
    skeletonCount: skeletons.length,
    meshCount: meshes.length,
    boneCount: bones.length || skeletonBoneNames.length,
    meshes,
    bones: bones.length ? bones : skeletonBoneNames.map((name) => ({ name, path: name })),
    skeletonBoneNames,
    identifiedBones: identified,
    hierarchyLines,
  };

  logInspectionReport(report);
  return report;
}

function logInspectionReport(report) {
  console.group(`=== GLB Hierarchy Inspection: ${report.label} ===`);
  console.log('Skeleton exists:', report.skeletonExists);
  console.log('Mesh count:', report.meshCount);
  console.log('Bone count:', report.boneCount);
  console.group('Meshes');
  console.table(
    report.meshes.map(({ name, type, vertexCount, hasSkeleton, boneCount, path }) => ({
      name,
      type,
      vertices: vertexCount,
      skinned: hasSkeleton,
      bones: boneCount,
      path,
    }))
  );
  console.groupEnd();
  console.group('Identified bones for pose retargeting');
  for (const [role, names] of Object.entries(report.identifiedBones)) {
    console.log(`${role}:`, names.length ? names : '(not found)');
  }
  console.groupEnd();
  console.group('Full hierarchy');
  report.hierarchyLines.forEach((line) => console.log(line));
  console.groupEnd();
  console.groupEnd();
}

export function resetModelTransform(object) {
  object.position.set(0, 0, 0);
  object.rotation.set(0, 0, 0);
  object.scale.set(1, 1, 1);
}

export function centerAndScaleModel(object, targetHeight = 1.6) {
  resetModelTransform(object);
  object.updateMatrixWorld(true);

  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const scale = targetHeight / (size.y || 1);

  object.position.sub(center);
  object.scale.setScalar(scale);
  object.updateMatrixWorld(true);

  const grounded = new Box3().setFromObject(object);
  object.position.y -= grounded.min.y;

  object.rotation.y = 0;
  object.updateMatrixWorld(true);

  return { box, size, scale };
}

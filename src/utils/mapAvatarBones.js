import { Matrix4, Quaternion, Vector3 } from 'three';

const BONE_SEARCH = {
  head: [/^head[_\.\d]/i, /^mixamorig:head$/i],
  neck: [/^neck/i, /^mixamorig:neck$/i],
  spine: [/^spine002/i, /^spine\.002/i, /^chest/i, /^spine[_\.\d]/i, /^mixamorig:spine$/i],
  leftUpperArm: [/^upper_arml/i, /^upper_arm\.l/i, /^upperarml/i, /^leftarm$/i, /^mixamorig:leftarm$/i],
  leftForearm: [/^forearml/i, /^forearm\.l/i, /^lowerarml/i, /^leftforearm$/i, /^mixamorig:leftforearm$/i],
  rightUpperArm: [/^upper_armr/i, /^upper_arm\.r/i, /^upperarmr/i, /^rightarm$/i, /^mixamorig:rightarm$/i],
  rightForearm: [/^forearmr/i, /^forearm\.r/i, /^lowerarmr/i, /^rightforearm$/i, /^mixamorig:rightforearm$/i],
};

const CHILD_HINTS = {
  head: [/^jaw/i],
  neck: [/^head/i],
  spine: [/^neck/i, /^spine002/i, /^spine\.002/i],
  leftUpperArm: [/^forearml/i, /^forearm\.l/i],
  leftForearm: [/^handl/i, /^hand\.l/i],
  rightUpperArm: [/^forearmr/i, /^forearm\.r/i],
  rightForearm: [/^handr/i, /^hand\.r/i],
};

function findBone(boneMap, patterns) {
  for (const pattern of patterns) {
    for (const [name, bone] of boneMap) {
      if (pattern.test(name)) return bone;
    }
  }
  return null;
}

function findChildBone(bone, hints) {
  for (const hint of hints) {
    for (const child of bone.children) {
      if (child.isBone && hint.test(child.name)) return child;
    }
  }
  for (const child of bone.children) {
    if (child.isBone) return child;
  }
  return null;
}

function captureBindPose(bone, childBone) {
  bone.updateWorldMatrix(true, true);

  const parentInv = new Matrix4().copy(bone.parent.matrixWorld).invert();
  const bonePos = new Vector3().setFromMatrixPosition(bone.matrixWorld);
  const childPos = new Vector3().setFromMatrixPosition(childBone.matrixWorld);
  const worldDir = childPos.sub(bonePos);
  if (worldDir.lengthSq() < 1e-8) {
    worldDir.set(0, -1, 0);
  } else {
    worldDir.normalize();
  }

  const restLocalDir = worldDir.clone().transformDirection(parentInv).normalize();

  return {
    restQuaternion: bone.quaternion.clone(),
    restLocalDir,
    restWorldDir: worldDir.clone(),
    child: childBone,
  };
}

export function mapAvatarBones(root) {
  const skinnedMeshes = [];
  root.traverse((node) => {
    if (node.isSkinnedMesh) skinnedMeshes.push(node);
  });

  if (!skinnedMeshes.length) {
    console.error('[mapAvatarBones] No skinned mesh found on avatar');
    return { root, skinnedMeshes: [], boneMap: new Map(), missing: ['skinnedMesh'], isReady: false };
  }

  const boneMap = new Map();
  for (const mesh of skinnedMeshes) {
    for (const bone of mesh.skeleton.bones) {
      boneMap.set(bone.name, bone);
    }
  }

  const missing = [];
  const slots = {};

  for (const [role, patterns] of Object.entries(BONE_SEARCH)) {
    const bone = findBone(boneMap, patterns);
    if (!bone) {
      missing.push(role);
      slots[role] = null;
      continue;
    }

    const childBone = findChildBone(bone, CHILD_HINTS[role] ?? []);
    if (!childBone) {
      missing.push(`${role} (no child for direction)`);
      slots[role] = { bone, bind: null };
      continue;
    }

    slots[role] = {
      bone,
      bind: captureBindPose(bone, childBone),
    };
  }

  const isReady = missing.length === 0;
  const bindFrame = captureAvatarBindFrame(slots, boneMap);

  if (missing.length) {
    console.warn('[mapAvatarBones] Missing or incomplete bones:', missing);
  } else {
    console.log('[mapAvatarBones] All retargeting bones mapped:', {
      head: slots.head.bone.name,
      headForward: slots.head.bind.child.name,
      neck: slots.neck.bone.name,
      spine: slots.spine.bone.name,
      leftUpperArm: slots.leftUpperArm.bone.name,
      rightUpperArm: slots.rightUpperArm.bone.name,
    });
  }

  return {
    ...slots,
    boneMap,
    root,
    skinnedMeshes,
    bindFrame,
    missing,
    isReady,
  };
}

function captureAvatarBindFrame(slots, boneMap) {
  const spineBind = slots.spine?.bind;
  const headBind = slots.head?.bind;
  const poseToAvatar = new Quaternion();
  const neutralUp = new Vector3(0, 1, 0);

  if (spineBind?.restWorldDir) {
    poseToAvatar.setFromUnitVectors(neutralUp, spineBind.restWorldDir.clone().normalize());
  }

  const headForward = headBind?.restWorldDir?.clone() ?? new Vector3(0, 0, -1);
  if (headForward.lengthSq() > 0) headForward.normalize();

  const leftEye = findBone(boneMap, [/^lefteye/i]);
  const rightEye = findBone(boneMap, [/^righteye/i]);
  let headRight = new Vector3(1, 0, 0);
  if (leftEye && rightEye) {
    leftEye.updateWorldMatrix(true, true);
    rightEye.updateWorldMatrix(true, true);
    const lp = new Vector3().setFromMatrixPosition(leftEye.matrixWorld);
    const rp = new Vector3().setFromMatrixPosition(rightEye.matrixWorld);
    headRight = rp.sub(lp);
    if (headRight.lengthSq() > 1e-8) headRight.normalize();
  }

  const headUp = new Vector3().crossVectors(headForward, headRight).normalize();
  headRight.crossVectors(headUp, headForward).normalize();

  const headRestWorldQuat = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(headRight, headUp, headForward.clone().negate())
  );

  return {
    poseToAvatar,
    neutralUp,
    headForward,
    headRight,
    headUp,
    headRestWorldQuat,
  };
}

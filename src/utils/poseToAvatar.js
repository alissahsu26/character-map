import { Quaternion, Vector3 } from 'three';
import { getKeypoint, midpoint } from './poseMapping';

export const TRACKING_MODES = {
  FULL_BODY: 'FULL_BODY',
  UPPER_BODY: 'UPPER_BODY',
  HEAD_ONLY: 'HEAD_ONLY',
  PARTIAL: 'PARTIAL',
};

const MIN_CONFIDENCE = 0.5;
const SMOOTH_ALPHA = 0.35;
const REST_BLEND_ALPHA = 0.08;
const HEAD_ALPHA = 0.38;
const NECK_ALPHA = 0.35;
const HEAD_FACE_BLEND = 0.28;
const ROTATION_DEADZONE = 0.015;
const MAX_BONE_ROTATION = Math.PI * 0.85;
const LOG_INTERVAL_MS = 3000;

const MIRROR_POSE_X = true;
const SWAP_HANDS = true;

const _vA = new Vector3();
const _vB = new Vector3();
const _defaultUp = new Vector3(0, 1, 0);
const _parentQuat = new Quaternion();
const _parentInv = new Quaternion();
const _delta = new Quaternion();
const _target = new Quaternion();
const _clamped = new Quaternion();

const boneRuntime = new Map();
let lastLogTime = 0;

function scoreOk(kp) {
  return kp && kp.score >= MIN_CONFIDENCE;
}

function poseDirection(from, to, scale = 1) {
  if (!from || !to) return null;
  const dx = (to.x - from.x) * scale;
  const dy = -(to.y - from.y) * scale;
  _vA.set(MIRROR_POSE_X ? -dx : dx, dy, 0);
  if (_vA.lengthSq() < 1e-6) return null;
  return _vA.clone().normalize();
}

function posePoint(kp, origin, scale = 1) {
  const dx = (kp.x - origin.x) * scale;
  const dy = -(kp.y - origin.y) * scale;
  return new Vector3(MIRROR_POSE_X ? -dx : dx, dy, 0);
}

function getBoneState(bone) {
  if (!bone) return null;
  let state = boneRuntime.get(bone.uuid);
  if (!state) {
    state = { lastDir: null, lastQuat: bone.quaternion.clone() };
    boneRuntime.set(bone.uuid, state);
  }
  return state;
}

function clampTargetRotation(bind, targetQuat) {
  const angle = bind.restQuaternion.angleTo(targetQuat);
  if (angle <= MAX_BONE_ROTATION) return targetQuat;
  _clamped.copy(bind.restQuaternion).slerp(targetQuat, MAX_BONE_ROTATION / angle);
  return _clamped;
}

function applyDirectionToBone(bone, bind, targetWorldDir, { active = true, alpha = SMOOTH_ALPHA } = {}) {
  if (!bone || !bind) return false;

  const state = getBoneState(bone);

  if (!active || !targetWorldDir) {
    _target.copy(bind.restQuaternion);
    bone.quaternion.slerp(_target, REST_BLEND_ALPHA);
    state.lastQuat.copy(bone.quaternion);
    return false;
  }

  if (state.lastDir && state.lastDir.angleTo(targetWorldDir) < ROTATION_DEADZONE) {
    return true;
  }

  bone.parent.updateWorldMatrix(true, false);
  bone.parent.getWorldQuaternion(_parentQuat);
  _parentInv.copy(_parentQuat).invert();

  _vA.copy(targetWorldDir).applyQuaternion(_parentInv).normalize();
  if (_vA.lengthSq() < 1e-6) return false;

  _delta.setFromUnitVectors(bind.restLocalDir, _vA);
  _target.copy(bind.restQuaternion).multiply(_delta);
  clampTargetRotation(bind, _target);

  bone.quaternion.slerp(_target, alpha);
  state.lastDir = targetWorldDir.clone();
  state.lastQuat.copy(bone.quaternion);
  return true;
}

function hasHeadLandmarks(keypoints) {
  const nose = getKeypoint(keypoints, 'nose');
  const leftEye = getKeypoint(keypoints, 'left_eye');
  const rightEye = getKeypoint(keypoints, 'right_eye');
  const leftEar = getKeypoint(keypoints, 'left_ear');
  const rightEar = getKeypoint(keypoints, 'right_ear');

  if (scoreOk(nose)) return true;
  if (scoreOk(leftEye) && scoreOk(rightEye)) return true;
  if (scoreOk(leftEar) && scoreOk(rightEar)) return true;
  return false;
}

function estimateHeadCenter(keypoints) {
  const nose = getKeypoint(keypoints, 'nose');
  const leftEye = getKeypoint(keypoints, 'left_eye');
  const rightEye = getKeypoint(keypoints, 'right_eye');
  const leftEar = getKeypoint(keypoints, 'left_ear');
  const rightEar = getKeypoint(keypoints, 'right_ear');

  if (scoreOk(nose)) return { x: nose.x, y: nose.y };
  if (scoreOk(leftEye) && scoreOk(rightEye)) return midpoint(leftEye, rightEye);
  if (scoreOk(leftEar) && scoreOk(rightEar)) return midpoint(leftEar, rightEar);
  return null;
}

function buildTorsoFrame(keypoints, frameH) {
  const ls = getKeypoint(keypoints, 'left_shoulder');
  const rs = getKeypoint(keypoints, 'right_shoulder');
  const lh = getKeypoint(keypoints, 'left_hip');
  const rh = getKeypoint(keypoints, 'right_hip');

  const scale = 2.2 / frameH;
  const shouldersOk = scoreOk(ls) && scoreOk(rs);
  const hipsOk = scoreOk(lh) && scoreOk(rh);
  const headOk = hasHeadLandmarks(keypoints);

  if (!shouldersOk && !headOk) return null;

  let shoulderMid = null;
  let hipMid = null;
  let up = null;

  if (shouldersOk) {
    shoulderMid = midpoint(ls, rs);
    if (hipsOk) {
      hipMid = midpoint(lh, rh);
      up = poseDirection(hipMid, shoulderMid, scale);
    } else {
      up = _defaultUp.clone();
    }
  } else {
    shoulderMid = estimateHeadCenter(keypoints);
    if (!shoulderMid) return null;
    up = _defaultUp.clone();
  }

  if (!up) up = _defaultUp.clone();

  return { shoulderMid, hipMid, up, scale, shouldersOk, hipsOk, headOk };
}

function toAvatarSpace(poseDir, avatarBones) {
  if (!poseDir) return null;
  if (!avatarBones?.bindFrame?.poseToAvatar) return poseDir;
  return poseDir.clone().applyQuaternion(avatarBones.bindFrame.poseToAvatar).normalize();
}

function getFaceLandmarks(keypoints) {
  const nose = getKeypoint(keypoints, 'nose');
  let left = getKeypoint(keypoints, 'left_ear');
  let right = getKeypoint(keypoints, 'right_ear');
  if (!scoreOk(left)) left = getKeypoint(keypoints, 'left_eye');
  if (!scoreOk(right)) right = getKeypoint(keypoints, 'right_eye');

  if (!scoreOk(nose) || !scoreOk(left) || !scoreOk(right)) return null;
  return { nose, left, right };
}

/** Stable head aim: bind forward + small face offset (no full-quaternion snap). */
function buildHeadDirection(keypoints, torso, avatarBones) {
  const headForward = avatarBones.bindFrame?.headForward;
  if (!headForward) return null;

  const face = getFaceLandmarks(keypoints);
  if (!face) return headForward.clone();

  const faceMid = midpoint(face.left, face.right);
  const faceAim = poseDirection(faceMid, face.nose, torso.scale);
  if (!faceAim) return headForward.clone();

  const avatarAim = toAvatarSpace(faceAim, avatarBones);
  if (!avatarAim) return headForward.clone();

  return headForward.clone().lerp(avatarAim, HEAD_FACE_BLEND).normalize();
}

function applyHeadTracking(keypoints, torso, avatarBones, { active = true, neckActive = true } = {}) {
  if (!active) {
    if (avatarBones.neck?.bind) {
      applyDirectionToBone(avatarBones.neck.bone, avatarBones.neck.bind, null, { active: false });
    }
    if (avatarBones.head?.bind) {
      applyDirectionToBone(avatarBones.head.bone, avatarBones.head.bind, null, { active: false });
    }
    return false;
  }

  const headDir = buildHeadDirection(keypoints, torso, avatarBones);
  if (!headDir) {
    if (avatarBones.neck?.bind) {
      applyDirectionToBone(avatarBones.neck.bone, avatarBones.neck.bind, null, { active: false });
    }
    if (avatarBones.head?.bind) {
      applyDirectionToBone(avatarBones.head.bone, avatarBones.head.bind, null, { active: false });
    }
    return false;
  }

  if (avatarBones.neck?.bind) {
    const spineUp = neckActive ? toAvatarSpace(torso.up, avatarBones) : null;
    applyDirectionToBone(avatarBones.neck.bone, avatarBones.neck.bind, spineUp, {
      active: neckActive && !!spineUp,
      alpha: NECK_ALPHA,
    });
  }

  if (avatarBones.head?.bind) {
    applyDirectionToBone(avatarBones.head.bone, avatarBones.head.bind, headDir, {
      active: true,
      alpha: HEAD_ALPHA,
    });
  }

  return true;
}

function assessRegions(keypoints) {
  const ls = getKeypoint(keypoints, SWAP_HANDS ? 'right_shoulder' : 'left_shoulder');
  const rs = getKeypoint(keypoints, SWAP_HANDS ? 'left_shoulder' : 'right_shoulder');
  const le = getKeypoint(keypoints, SWAP_HANDS ? 'right_elbow' : 'left_elbow');
  const re = getKeypoint(keypoints, SWAP_HANDS ? 'left_elbow' : 'right_elbow');
  const lw = getKeypoint(keypoints, SWAP_HANDS ? 'right_wrist' : 'left_wrist');
  const rw = getKeypoint(keypoints, SWAP_HANDS ? 'left_wrist' : 'right_wrist');
  const lh = getKeypoint(keypoints, 'left_hip');
  const rh = getKeypoint(keypoints, 'right_hip');

  const shoulders = scoreOk(ls) && scoreOk(rs);
  const hips = scoreOk(lh) && scoreOk(rh);
  const head = hasHeadLandmarks(keypoints);
  const leftArm = shoulders && scoreOk(ls) && scoreOk(le) && scoreOk(lw);
  const rightArm = shoulders && scoreOk(rs) && scoreOk(re) && scoreOk(rw);
  const torso = shoulders;

  return { head, torso, leftArm, rightArm, shoulders, hips };
}

function determineTrackingMode(regions) {
  const hasAnyArm = regions.leftArm || regions.rightArm;

  if (regions.shoulders && regions.hips && hasAnyArm) {
    return TRACKING_MODES.FULL_BODY;
  }
  if (regions.shoulders && hasAnyArm) {
    return TRACKING_MODES.UPPER_BODY;
  }
  if (regions.head && !regions.shoulders) {
    return TRACKING_MODES.HEAD_ONLY;
  }
  if (regions.head || hasAnyArm || regions.shoulders) {
    return TRACKING_MODES.PARTIAL;
  }
  return null;
}

function logMissingLandmarks(missing) {
  if (!missing.length) return;
  const now = performance.now();
  if (now - lastLogTime < LOG_INTERVAL_MS) return;
  lastLogTime = now;
  console.debug('[poseRetarget] Low-confidence or missing:', missing.join(', '));
}

function collectMissingLandmarks(keypoints, regions) {
  const checks = [
    ['nose', regions.head],
    ['left_shoulder', regions.shoulders],
    ['right_shoulder', regions.shoulders],
    ['left_hip', regions.hips],
    ['right_hip', regions.hips],
  ];

  const missing = [];
  for (const [name, regionOk] of checks) {
    const kp = getKeypoint(keypoints, name);
    if (!regionOk && (!kp || !scoreOk(kp))) {
      missing.push(name);
    }
  }
  return missing;
}

function updateSkeletons(avatarBones) {
  for (const mesh of avatarBones.skinnedMeshes ?? []) {
    mesh.skeleton.update();
  }
}

function retargetArms(regions, keypoints, avatarBones, aim, scale) {
  const ls = getKeypoint(keypoints, SWAP_HANDS ? 'right_shoulder' : 'left_shoulder');
  const rs = getKeypoint(keypoints, SWAP_HANDS ? 'left_shoulder' : 'right_shoulder');
  const le = getKeypoint(keypoints, SWAP_HANDS ? 'right_elbow' : 'left_elbow');
  const re = getKeypoint(keypoints, SWAP_HANDS ? 'left_elbow' : 'right_elbow');
  const lw = getKeypoint(keypoints, SWAP_HANDS ? 'right_wrist' : 'left_wrist');
  const rw = getKeypoint(keypoints, SWAP_HANDS ? 'left_wrist' : 'right_wrist');

  if (regions.leftArm && avatarBones.leftUpperArm?.bind) {
    const dir = aim(poseDirection(ls, le, scale));
    applyDirectionToBone(avatarBones.leftUpperArm.bone, avatarBones.leftUpperArm.bind, dir, {
      active: !!dir,
    });
  } else if (avatarBones.leftUpperArm?.bind) {
    applyDirectionToBone(avatarBones.leftUpperArm.bone, avatarBones.leftUpperArm.bind, null, {
      active: false,
    });
  }

  if (regions.leftArm && avatarBones.leftForearm?.bind) {
    const dir = aim(poseDirection(le, lw, scale));
    applyDirectionToBone(avatarBones.leftForearm.bone, avatarBones.leftForearm.bind, dir, {
      active: !!dir,
    });
  } else if (avatarBones.leftForearm?.bind) {
    applyDirectionToBone(avatarBones.leftForearm.bone, avatarBones.leftForearm.bind, null, {
      active: false,
    });
  }

  if (regions.rightArm && avatarBones.rightUpperArm?.bind) {
    const dir = aim(poseDirection(rs, re, scale));
    applyDirectionToBone(avatarBones.rightUpperArm.bone, avatarBones.rightUpperArm.bind, dir, {
      active: !!dir,
    });
  } else if (avatarBones.rightUpperArm?.bind) {
    applyDirectionToBone(avatarBones.rightUpperArm.bone, avatarBones.rightUpperArm.bind, null, {
      active: false,
    });
  }

  if (regions.rightArm && avatarBones.rightForearm?.bind) {
    const dir = aim(poseDirection(re, rw, scale));
    applyDirectionToBone(avatarBones.rightForearm.bone, avatarBones.rightForearm.bind, dir, {
      active: !!dir,
    });
  } else if (avatarBones.rightForearm?.bind) {
    applyDirectionToBone(avatarBones.rightForearm.bone, avatarBones.rightForearm.bind, null, {
      active: false,
    });
  }
}

function retargetTorso(regions, up, avatarBones, aim) {
  const spineUp = regions.torso ? aim(up) : null;

  if (avatarBones.spine?.bind) {
    applyDirectionToBone(avatarBones.spine.bone, avatarBones.spine.bind, spineUp, {
      active: !!spineUp,
    });
  }
}

function freezeArms(avatarBones) {
  for (const slot of ['leftUpperArm', 'leftForearm', 'rightUpperArm', 'rightForearm']) {
    if (avatarBones[slot]?.bind) {
      applyDirectionToBone(avatarBones[slot].bone, avatarBones[slot].bind, null, { active: false });
    }
  }
}

export function retargetPoseToAvatar(keypoints, avatarBones, videoSize) {
  const emptyDebug = {
    mode: null,
    active: { head: false, torso: false, leftArm: false, rightArm: false },
  };

  if (!keypoints?.length || !avatarBones?.skinnedMeshes?.length) return emptyDebug;

  const frameH = videoSize?.height || 480;
  const regions = assessRegions(keypoints);
  const mode = determineTrackingMode(regions);

  if (!mode) return emptyDebug;

  const torso = buildTorsoFrame(keypoints, frameH);
  if (!torso) return emptyDebug;

  const { up, scale } = torso;
  const aim = (dir) => toAvatarSpace(dir, avatarBones);

  const active = {
    head: regions.head,
    torso: false,
    leftArm: false,
    rightArm: false,
  };

  switch (mode) {
    case TRACKING_MODES.FULL_BODY:
    case TRACKING_MODES.UPPER_BODY:
      active.torso = regions.torso;
      active.leftArm = regions.leftArm;
      active.rightArm = regions.rightArm;
      retargetTorso(regions, up, avatarBones, aim);
      applyHeadTracking(keypoints, torso, avatarBones, {
        active: regions.head,
        neckActive: regions.torso,
      });
      retargetArms(regions, keypoints, avatarBones, aim, scale);
      break;

    case TRACKING_MODES.HEAD_ONLY:
      if (avatarBones.spine?.bind) {
        applyDirectionToBone(avatarBones.spine.bone, avatarBones.spine.bind, null, { active: false });
      }
      applyHeadTracking(keypoints, torso, avatarBones, { active: regions.head, neckActive: true });
      freezeArms(avatarBones);
      break;

    case TRACKING_MODES.PARTIAL:
      if (regions.torso) {
        active.torso = true;
        retargetTorso({ torso: true }, up, avatarBones, aim);
      } else if (avatarBones.spine?.bind) {
        applyDirectionToBone(avatarBones.spine.bone, avatarBones.spine.bind, null, { active: false });
      }

      applyHeadTracking(keypoints, torso, avatarBones, {
        active: regions.head,
        neckActive: regions.torso,
      });

      active.leftArm = regions.leftArm;
      active.rightArm = regions.rightArm;
      retargetArms(regions, keypoints, avatarBones, aim, scale);
      break;

    default:
      break;
  }

  logMissingLandmarks(collectMissingLandmarks(keypoints, regions));
  updateSkeletons(avatarBones);

  return { mode, active };
}

export function poseLandmarksTo3D(keypoints, videoSize) {
  const frameH = videoSize?.height || 480;
  const torso = buildTorsoFrame(keypoints, frameH);
  if (!torso) return [];

  const origin = torso.shoulderMid;
  const markers = [];

  for (const kp of keypoints) {
    if (!scoreOk(kp)) continue;
    const pos = posePoint(kp, origin, torso.scale);
    pos.z = 0.15;
    markers.push({ name: kp.name, position: pos, score: kp.score });
  }

  return markers;
}

import { Quaternion, Vector3 } from 'three';
import { getKeypoint, midpoint } from './poseMapping';
import {
  computeHeadNeckAngles,
  derivedLandmarksForDebug,
  extractHeadNeckLandmarks,
  hasHeadNeckLandmarks,
} from './headNeckLandmarks';
import { LANDMARK_CONFIDENCE_THRESHOLD } from './poseConstants';

export { LANDMARK_CONFIDENCE_THRESHOLD } from './poseConstants';

export const TRACKING_MODES = {
  FULL_BODY: 'FULL_BODY',
  UPPER_BODY: 'UPPER_BODY',
  HEAD_ONLY: 'HEAD_ONLY',
  PARTIAL: 'PARTIAL',
};

const MIN_CONFIDENCE = LANDMARK_CONFIDENCE_THRESHOLD;
const SMOOTH_ALPHA = 0.35;
const HEAD_ALPHA = 0.42;
const NECK_ALPHA = 0.38;
const NECK_HEAD_BLEND = 0.68;
const ANGLE_SMOOTH = 0.38;
const YAW_GAIN = 3.8;
const PITCH_GAIN = 4.5;
const PITCH_NEUTRAL = 0.12;
const ROTATION_DEADZONE = 0.025;
const LOG_INTERVAL_MS = 3000;
// When head tracking is fully lost (no facial landmarks at all, not just a
// brief dip), ease the head/neck back toward their rest pose instead of
// freezing mid-rotation, so a sustained occlusion settles into a neutral
// look rather than getting stuck staring sideways.
const LOST_HEAD_EASE = 0.05;
const LOST_NECK_EASE = 0.04;

const ROTATION_LIMITS = {
  head: { yaw: 0.55, pitch: 0.45, roll: 0.4 },
  spine: Math.PI * 0.35,
  neck: Math.PI * 0.45,
  upperArm: Math.PI * 0.75,
  forearm: Math.PI * 0.85,
  upperLeg: Math.PI * 0.75,
  lowerLeg: Math.PI * 0.85,
};

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
const _qYaw = new Quaternion();
const _qPitch = new Quaternion();
const _qRoll = new Quaternion();
const _qPose = new Quaternion();
const _axisX = new Vector3(1, 0, 0);
const _axisY = new Vector3(0, 1, 0);
const _axisZ = new Vector3(0, 0, 1);

const boneRuntime = new Map();
let lastLogTime = 0;

function scoreOk(kp) {
  return kp && kp.score >= MIN_CONFIDENCE;
}

function poseDirection(from, to, scale = 1) {
  if (!from || !to || !scoreOk(from) || !scoreOk(to)) return null;
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
    state = { lastDir: null, lastQuat: bone.quaternion.clone(), headAngles: { yaw: 0, pitch: 0, roll: 0 } };
    boneRuntime.set(bone.uuid, state);
  }
  return state;
}

function smoothHeadAngles(bone, target, factor = ANGLE_SMOOTH) {
  const state = getBoneState(bone);
  const out = state.headAngles;
  out.yaw += (target.yaw - out.yaw) * factor;
  out.pitch += (target.pitch - out.pitch) * factor;
  out.roll += (target.roll - out.roll) * factor;
  return out;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function clampHeadAngles(angles) {
  if (!angles) return angles;
  const lim = ROTATION_LIMITS.head;
  return {
    yaw: clamp(angles.yaw, -lim.yaw, lim.yaw),
    pitch: clamp(angles.pitch, -lim.pitch, lim.pitch),
    roll: clamp(angles.roll, -lim.roll, lim.roll),
    neckYaw: angles.neckYaw,
    neckPitch: angles.neckPitch,
  };
}

function clampTargetRotation(bind, targetQuat, limitKey = 'upperArm') {
  const maxAngle = ROTATION_LIMITS[limitKey] ?? ROTATION_LIMITS.upperArm;
  const angle = bind.restQuaternion.angleTo(targetQuat);
  if (angle <= maxAngle) return targetQuat;
  _clamped.copy(bind.restQuaternion).slerp(targetQuat, maxAngle / angle);
  return _clamped;
}

function holdBoneRotation(bone) {
  if (!bone) return;
  const state = getBoneState(bone);
  if (state?.lastQuat) {
    bone.quaternion.copy(state.lastQuat);
  }
}

function easeBoneToRest(bone, bind, alpha) {
  if (!bone || !bind) return;
  bone.quaternion.slerp(bind.restQuaternion, alpha);
  getBoneState(bone).lastQuat.copy(bone.quaternion);
}

function easeHeadToNeutral(avatarBones) {
  easeBoneToRest(avatarBones.neck?.bone, avatarBones.neck?.bind, LOST_NECK_EASE);
  easeBoneToRest(avatarBones.head?.bone, avatarBones.head?.bind, LOST_HEAD_EASE);
}

function applyDirectionToBone(
  bone,
  bind,
  targetWorldDir,
  { active = true, alpha = SMOOTH_ALPHA, limitKey = 'upperArm' } = {}
) {
  if (!bone || !bind) return false;

  const state = getBoneState(bone);

  if (!active || !targetWorldDir) {
    holdBoneRotation(bone);
    return false;
  }

  if (state.lastDir && state.lastDir.angleTo(targetWorldDir) < ROTATION_DEADZONE) {
    return true;
  }

  bone.parent.updateWorldMatrix(true, false);
  bone.parent.getWorldQuaternion(_parentQuat);
  _parentInv.copy(_parentQuat).invert();

  _vA.copy(targetWorldDir).applyQuaternion(_parentInv).normalize();
  if (_vA.lengthSq() < 1e-6) {
    holdBoneRotation(bone);
    return false;
  }

  _delta.setFromUnitVectors(bind.restLocalDir, _vA);
  _target.copy(bind.restQuaternion).multiply(_delta);
  clampTargetRotation(bind, _target, limitKey);

  bone.quaternion.slerp(_target, alpha);
  state.lastDir = targetWorldDir.clone();
  state.lastQuat.copy(bone.quaternion);
  return true;
}

function blendAvatarDirections(a, b, blendB) {
  if (!a && !b) return null;
  if (!a) return b?.clone() ?? null;
  if (!b) return a.clone();
  return a.clone().multiplyScalar(1 - blendB).add(b.clone().multiplyScalar(blendB)).normalize();
}

function getHeadNeckFrame(keypoints) {
  return extractHeadNeckLandmarks(keypoints, {
    swapHands: SWAP_HANDS,
    minConfidence: MIN_CONFIDENCE,
  });
}

function buildTorsoFrame(keypoints, frameH) {
  const ls = getKeypoint(keypoints, 'left_shoulder');
  const rs = getKeypoint(keypoints, 'right_shoulder');
  const lh = getKeypoint(keypoints, 'left_hip');
  const rh = getKeypoint(keypoints, 'right_hip');

  const scale = 2.2 / frameH;
  const lsOk = scoreOk(ls);
  const rsOk = scoreOk(rs);
  const shouldersOk = lsOk && rsOk;
  const oneShoulderOk = lsOk || rsOk;
  const hipsOk = scoreOk(lh) && scoreOk(rh);
  const headOk = hasHeadNeckLandmarks(keypoints, MIN_CONFIDENCE);
  const hipMid = hipsOk ? midpoint(lh, rh) : null;

  if (!oneShoulderOk && !headOk) return null;

  let shoulderMid = null;
  let up = null;

  if (shouldersOk) {
    shoulderMid = midpoint(ls, rs);
  } else if (oneShoulderOk) {
    // Only one shoulder is visible (e.g. occluded by an arm or out of
    // frame). Using the visible shoulder still gives a usable lean
    // direction once paired with the hips — far better than dropping all
    // torso/lean info, which previously starved neck/head tracking of body
    // lean compensation whenever a single shoulder dipped below threshold.
    shoulderMid = lsOk ? ls : rs;
  }

  if (shoulderMid && hipMid) {
    up = poseDirection(hipMid, shoulderMid, scale);
  } else if (!shoulderMid && headOk) {
    const headFrame = getHeadNeckFrame(keypoints);
    shoulderMid = headFrame.faceCenter ?? headFrame.eyeMid;
    if (!shoulderMid) return null;
  }

  if (!up) up = _defaultUp.clone();

  return { shoulderMid, hipMid, up, scale, shouldersOk, hipsOk, headOk };
}

function toAvatarSpace(poseDir, avatarBones) {
  if (!poseDir) return null;
  if (!avatarBones?.bindFrame?.poseToAvatar) return poseDir;
  return poseDir.clone().applyQuaternion(avatarBones.bindFrame.poseToAvatar).normalize();
}

function computeFaceAngles(keypoints, videoSize) {
  const landmarks = getHeadNeckFrame(keypoints);
  return computeHeadNeckAngles(landmarks, videoSize, {
    mirrorX: MIRROR_POSE_X,
    yawGain: YAW_GAIN,
    pitchGain: PITCH_GAIN,
    pitchNeutral: PITCH_NEUTRAL,
  });
}

function computeNeckTargetDir(landmarks, torso, avatarBones) {
  if (!landmarks?.neckBase || !landmarks?.neckTop) return null;
  const neckDir = poseDirection(landmarks.neckBase, landmarks.neckTop, torso?.scale ?? 1);
  if (!neckDir) return null;
  return toAvatarSpace(neckDir, avatarBones);
}

function applyEulerToBone(bone, bind, angles, alpha) {
  if (!bone || !bind || !angles) {
    holdBoneRotation(bone);
    return false;
  }

  const limited = clampHeadAngles(angles);

  _qYaw.setFromAxisAngle(_axisY, limited.yaw);
  _qPitch.setFromAxisAngle(_axisX, limited.pitch);
  _qRoll.setFromAxisAngle(_axisZ, limited.roll);
  _qPose.copy(_qYaw).multiply(_qPitch).multiply(_qRoll);

  _target.copy(bind.restQuaternion).multiply(_qPose);
  clampTargetRotation(bind, _target, 'head');
  bone.quaternion.slerp(_target, alpha);
  getBoneState(bone).lastQuat.copy(bone.quaternion);
  return true;
}

function applyHeadTracking(
  keypoints,
  torso,
  avatarBones,
  videoSize,
  { active = true, neckActive = true } = {}
) {
  if (!active) {
    easeHeadToNeutral(avatarBones);
    return false;
  }

  const landmarks = getHeadNeckFrame(keypoints);
  const angles = computeFaceAngles(keypoints, videoSize);
  if (!angles || !landmarks.valid) {
    easeHeadToNeutral(avatarBones);
    return false;
  }

  if (avatarBones.neck?.bind) {
    const spineUp = neckActive ? toAvatarSpace(torso.up, avatarBones) : null;
    const neckHeadDir = neckActive ? computeNeckTargetDir(landmarks, torso, avatarBones) : null;
    const neckTarget = neckActive
      ? blendAvatarDirections(spineUp, neckHeadDir, NECK_HEAD_BLEND)
      : null;
    applyDirectionToBone(avatarBones.neck.bone, avatarBones.neck.bind, neckTarget, {
      active: neckActive && !!neckTarget,
      alpha: NECK_ALPHA,
      limitKey: 'neck',
    });
  }

  if (avatarBones.head?.bind) {
    const headAngles = smoothHeadAngles(avatarBones.head.bone, {
      yaw: (angles.yaw - angles.neckYaw * 0.35) * 0.75,
      pitch: (angles.pitch - angles.neckPitch * 0.35) * 0.7,
      roll: angles.roll,
    });
    applyEulerToBone(avatarBones.head.bone, avatarBones.head.bind, headAngles, HEAD_ALPHA);
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
  const lh = getKeypoint(keypoints, SWAP_HANDS ? 'right_hip' : 'left_hip');
  const rh = getKeypoint(keypoints, SWAP_HANDS ? 'left_hip' : 'right_hip');
  const lk = getKeypoint(keypoints, SWAP_HANDS ? 'right_knee' : 'left_knee');
  const rk = getKeypoint(keypoints, SWAP_HANDS ? 'left_knee' : 'right_knee');
  const la = getKeypoint(keypoints, SWAP_HANDS ? 'right_ankle' : 'left_ankle');
  const ra = getKeypoint(keypoints, SWAP_HANDS ? 'left_ankle' : 'right_ankle');

  const shoulders = scoreOk(ls) && scoreOk(rs);
  const hips = scoreOk(lh) && scoreOk(rh);
  const head = hasHeadNeckLandmarks(keypoints, MIN_CONFIDENCE);
  const leftArm = shoulders && scoreOk(ls) && scoreOk(le) && scoreOk(lw);
  const rightArm = shoulders && scoreOk(rs) && scoreOk(re) && scoreOk(rw);
  const leftLeg = scoreOk(lh) && scoreOk(lk) && scoreOk(la);
  const rightLeg = scoreOk(rh) && scoreOk(rk) && scoreOk(ra);
  const torso = shoulders;

  return { head, torso, leftArm, rightArm, leftLeg, rightLeg, shoulders, hips };
}

function determineTrackingMode(regions) {
  const armCount = (regions.leftArm ? 1 : 0) + (regions.rightArm ? 1 : 0);

  if (regions.shoulders && regions.hips && armCount >= 1) {
    return TRACKING_MODES.FULL_BODY;
  }
  if (regions.shoulders && armCount >= 1) {
    return TRACKING_MODES.UPPER_BODY;
  }
  if (regions.head && !regions.shoulders) {
    return TRACKING_MODES.HEAD_ONLY;
  }
  if (armCount === 1) {
    return TRACKING_MODES.PARTIAL;
  }
  if (regions.head || armCount > 0 || regions.shoulders) {
    return TRACKING_MODES.PARTIAL;
  }
  return null;
}

function collectActiveLandmarks(keypoints) {
  if (!keypoints?.length) return [];
  return keypoints.filter(scoreOk).map((kp) => kp.name);
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
    ['left_eye', regions.head],
    ['right_eye', regions.head],
    ['left_ear', regions.head],
    ['right_ear', regions.head],
    ['left_shoulder', regions.shoulders],
    ['right_shoulder', regions.shoulders],
    ['left_hip', regions.hips],
    ['right_hip', regions.hips],
    ['left_knee', regions.leftLeg],
    ['right_knee', regions.rightLeg],
    ['left_ankle', regions.leftLeg],
    ['right_ankle', regions.rightLeg],
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
      limitKey: 'upperArm',
    });
  } else if (avatarBones.leftUpperArm?.bind) {
    applyDirectionToBone(avatarBones.leftUpperArm.bone, avatarBones.leftUpperArm.bind, null, {
      active: false,
      limitKey: 'upperArm',
    });
  }

  if (regions.leftArm && avatarBones.leftForearm?.bind) {
    const dir = aim(poseDirection(le, lw, scale));
    applyDirectionToBone(avatarBones.leftForearm.bone, avatarBones.leftForearm.bind, dir, {
      active: !!dir,
      limitKey: 'forearm',
    });
  } else if (avatarBones.leftForearm?.bind) {
    applyDirectionToBone(avatarBones.leftForearm.bone, avatarBones.leftForearm.bind, null, {
      active: false,
      limitKey: 'forearm',
    });
  }

  if (regions.rightArm && avatarBones.rightUpperArm?.bind) {
    const dir = aim(poseDirection(rs, re, scale));
    applyDirectionToBone(avatarBones.rightUpperArm.bone, avatarBones.rightUpperArm.bind, dir, {
      active: !!dir,
      limitKey: 'upperArm',
    });
  } else if (avatarBones.rightUpperArm?.bind) {
    applyDirectionToBone(avatarBones.rightUpperArm.bone, avatarBones.rightUpperArm.bind, null, {
      active: false,
      limitKey: 'upperArm',
    });
  }

  if (regions.rightArm && avatarBones.rightForearm?.bind) {
    const dir = aim(poseDirection(re, rw, scale));
    applyDirectionToBone(avatarBones.rightForearm.bone, avatarBones.rightForearm.bind, dir, {
      active: !!dir,
      limitKey: 'forearm',
    });
  } else if (avatarBones.rightForearm?.bind) {
    applyDirectionToBone(avatarBones.rightForearm.bone, avatarBones.rightForearm.bind, null, {
      active: false,
      limitKey: 'forearm',
    });
  }
}

function retargetTorso(regions, up, avatarBones, aim) {
  const spineUp = regions.torso ? aim(up) : null;

  if (avatarBones.spine?.bind) {
    applyDirectionToBone(avatarBones.spine.bone, avatarBones.spine.bind, spineUp, {
      active: !!spineUp,
      limitKey: 'spine',
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

function retargetLegs(regions, keypoints, avatarBones, aim, scale) {
  const lh = getKeypoint(keypoints, SWAP_HANDS ? 'right_hip' : 'left_hip');
  const rh = getKeypoint(keypoints, SWAP_HANDS ? 'left_hip' : 'right_hip');
  const lk = getKeypoint(keypoints, SWAP_HANDS ? 'right_knee' : 'left_knee');
  const rk = getKeypoint(keypoints, SWAP_HANDS ? 'left_knee' : 'right_knee');
  const la = getKeypoint(keypoints, SWAP_HANDS ? 'right_ankle' : 'left_ankle');
  const ra = getKeypoint(keypoints, SWAP_HANDS ? 'left_ankle' : 'right_ankle');

  if (regions.leftLeg && avatarBones.leftUpperLeg?.bind) {
    const dir = aim(poseDirection(lh, lk, scale));
    applyDirectionToBone(avatarBones.leftUpperLeg.bone, avatarBones.leftUpperLeg.bind, dir, {
      active: !!dir,
      limitKey: 'upperLeg',
    });
  } else if (avatarBones.leftUpperLeg?.bind) {
    applyDirectionToBone(avatarBones.leftUpperLeg.bone, avatarBones.leftUpperLeg.bind, null, {
      active: false,
      limitKey: 'upperLeg',
    });
  }

  if (regions.leftLeg && avatarBones.leftLowerLeg?.bind) {
    const dir = aim(poseDirection(lk, la, scale));
    applyDirectionToBone(avatarBones.leftLowerLeg.bone, avatarBones.leftLowerLeg.bind, dir, {
      active: !!dir,
      limitKey: 'lowerLeg',
    });
  } else if (avatarBones.leftLowerLeg?.bind) {
    applyDirectionToBone(avatarBones.leftLowerLeg.bone, avatarBones.leftLowerLeg.bind, null, {
      active: false,
      limitKey: 'lowerLeg',
    });
  }

  if (regions.rightLeg && avatarBones.rightUpperLeg?.bind) {
    const dir = aim(poseDirection(rh, rk, scale));
    applyDirectionToBone(avatarBones.rightUpperLeg.bone, avatarBones.rightUpperLeg.bind, dir, {
      active: !!dir,
      limitKey: 'upperLeg',
    });
  } else if (avatarBones.rightUpperLeg?.bind) {
    applyDirectionToBone(avatarBones.rightUpperLeg.bone, avatarBones.rightUpperLeg.bind, null, {
      active: false,
      limitKey: 'upperLeg',
    });
  }

  if (regions.rightLeg && avatarBones.rightLowerLeg?.bind) {
    const dir = aim(poseDirection(rk, ra, scale));
    applyDirectionToBone(avatarBones.rightLowerLeg.bone, avatarBones.rightLowerLeg.bind, dir, {
      active: !!dir,
      limitKey: 'lowerLeg',
    });
  } else if (avatarBones.rightLowerLeg?.bind) {
    applyDirectionToBone(avatarBones.rightLowerLeg.bone, avatarBones.rightLowerLeg.bind, null, {
      active: false,
      limitKey: 'lowerLeg',
    });
  }
}

function freezeLegs(avatarBones) {
  for (const slot of ['leftUpperLeg', 'leftLowerLeg', 'rightUpperLeg', 'rightLowerLeg']) {
    if (avatarBones[slot]?.bind) {
      applyDirectionToBone(avatarBones[slot].bone, avatarBones[slot].bind, null, { active: false });
    }
  }
}

export function retargetPoseToAvatar(keypoints, avatarBones, videoSize) {
  const emptyDebug = {
    mode: null,
    active: {
      head: false,
      torso: false,
      leftArm: false,
      rightArm: false,
      leftLeg: false,
      rightLeg: false,
    },
    activeLandmarks: [],
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
    leftLeg: false,
    rightLeg: false,
  };

  switch (mode) {
    case TRACKING_MODES.FULL_BODY:
      active.torso = regions.torso;
      active.leftArm = regions.leftArm;
      active.rightArm = regions.rightArm;
      active.leftLeg = regions.leftLeg;
      active.rightLeg = regions.rightLeg;
      retargetTorso(regions, up, avatarBones, aim);
      applyHeadTracking(keypoints, torso, avatarBones, videoSize, {
        active: regions.head,
        neckActive: regions.torso,
      });
      retargetArms(regions, keypoints, avatarBones, aim, scale);
      retargetLegs(regions, keypoints, avatarBones, aim, scale);
      break;

    case TRACKING_MODES.UPPER_BODY:
      active.torso = regions.torso;
      active.leftArm = regions.leftArm;
      active.rightArm = regions.rightArm;
      retargetTorso(regions, up, avatarBones, aim);
      applyHeadTracking(keypoints, torso, avatarBones, videoSize, {
        active: regions.head,
        neckActive: regions.torso,
      });
      retargetArms(regions, keypoints, avatarBones, aim, scale);
      freezeLegs(avatarBones);
      break;

    case TRACKING_MODES.HEAD_ONLY:
      if (avatarBones.spine?.bind) {
        applyDirectionToBone(avatarBones.spine.bone, avatarBones.spine.bind, null, { active: false });
      }
      applyHeadTracking(keypoints, torso, avatarBones, videoSize, {
        active: regions.head,
        neckActive: true,
      });
      freezeArms(avatarBones);
      freezeLegs(avatarBones);
      break;

    case TRACKING_MODES.PARTIAL:
      active.head = regions.head;
      if (regions.torso) {
        active.torso = true;
        retargetTorso({ torso: true }, up, avatarBones, aim);
      } else if (avatarBones.spine?.bind) {
        applyDirectionToBone(avatarBones.spine.bone, avatarBones.spine.bind, null, {
          active: false,
          limitKey: 'spine',
        });
      }

      applyHeadTracking(keypoints, torso, avatarBones, videoSize, {
        active: regions.head,
        neckActive: regions.torso,
      });
      active.leftArm = regions.leftArm;
      active.rightArm = regions.rightArm;
      active.leftLeg = regions.leftLeg;
      active.rightLeg = regions.rightLeg;
      retargetArms(regions, keypoints, avatarBones, aim, scale);
      retargetLegs(regions, keypoints, avatarBones, aim, scale);
      break;

    default:
      break;
  }

  logMissingLandmarks(collectMissingLandmarks(keypoints, regions));
  updateSkeletons(avatarBones);

  return { mode, active, activeLandmarks: collectActiveLandmarks(keypoints) };
}

export function poseLandmarksTo3D(keypoints, videoSize) {
  const frameH = videoSize?.height || 480;
  const torso = buildTorsoFrame(keypoints, frameH);
  if (!torso) return [];

  const origin = torso.shoulderMid;
  const markers = [];
  const landmarks = getHeadNeckFrame(keypoints);

  for (const kp of keypoints) {
    if (!scoreOk(kp)) continue;
    const pos = posePoint(kp, origin, torso.scale);
    pos.z = 0.15;
    markers.push({ name: kp.name, position: pos, score: kp.score });
  }

  for (const derived of derivedLandmarksForDebug(landmarks)) {
    const pos = posePoint(derived, origin, torso.scale);
    pos.z = 0.16;
    markers.push({ name: derived.name, position: pos, score: derived.score, derived: true });
  }

  return markers;
}

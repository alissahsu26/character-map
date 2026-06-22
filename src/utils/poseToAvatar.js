import { Quaternion, Vector3 } from 'three';
import { getKeypoint, midpoint } from './poseMapping';

const MIN_SCORE = 0.3;
const SMOOTH_ALPHA = 0.4;
// Negate pose X to match the CSS-mirrored stage.
const MIRROR_POSE_X = true;
// Mirror puppet: user's left drives avatar's right (and vice versa).
const SWAP_HANDS = true;

const _vA = new Vector3();
const _offset = new Vector3();
const _parentQuat = new Quaternion();
const _parentInv = new Quaternion();
const _delta = new Quaternion();
const _target = new Quaternion();

function scoreOk(kp) {
  return kp && kp.score >= MIN_SCORE;
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

function applyDirectionToBone(bone, bind, targetWorldDir, alpha = SMOOTH_ALPHA) {
  if (!bone || !bind || !targetWorldDir) return;

  bone.parent.updateWorldMatrix(true, false);
  bone.parent.getWorldQuaternion(_parentQuat);
  _parentInv.copy(_parentQuat).invert();

  _vA.copy(targetWorldDir).applyQuaternion(_parentInv).normalize();
  if (_vA.lengthSq() < 1e-6) return;

  _delta.setFromUnitVectors(bind.restLocalDir, _vA);
  _target.copy(bind.restQuaternion).multiply(_delta);
  bone.quaternion.slerp(_target, alpha);
}

function buildTorsoFrame(keypoints, frameH) {
  const ls = getKeypoint(keypoints, 'left_shoulder');
  const rs = getKeypoint(keypoints, 'right_shoulder');
  const lh = getKeypoint(keypoints, 'left_hip');
  const rh = getKeypoint(keypoints, 'right_hip');

  if (!scoreOk(ls) || !scoreOk(rs) || !scoreOk(lh) || !scoreOk(rh)) return null;

  const shoulderMid = midpoint(ls, rs);
  const hipMid = midpoint(lh, rh);
  const scale = 2.2 / frameH;

  const up = poseDirection(hipMid, shoulderMid, scale);
  if (!up) return null;

  return { shoulderMid, hipMid, up, scale };
}

function toAvatarSpace(poseDir, avatarBones) {
  if (!poseDir) return null;
  if (!avatarBones?.bindFrame?.poseToAvatar) return poseDir;
  return poseDir.clone().applyQuaternion(avatarBones.bindFrame.poseToAvatar).normalize();
}

/** Head aim: start from bind forward (jaw), add subtle pitch/yaw from face landmarks. */
function buildHeadDirection(keypoints, torso, avatarBones) {
  const headBind = avatarBones.head?.bind;
  const headForward = avatarBones.bindFrame?.headForward;
  if (!headBind || !headForward) return null;

  const base = headForward.clone();
  const nose = getKeypoint(keypoints, 'nose');
  const leftEar = getKeypoint(keypoints, 'left_ear');
  const rightEar = getKeypoint(keypoints, 'right_ear');

  if (!scoreOk(nose) || !scoreOk(leftEar) || !scoreOk(rightEar)) {
    return base;
  }

  const earMid = midpoint(leftEar, rightEar);
  const { scale } = torso;

  const dx = (nose.x - earMid.x) * scale * (MIRROR_POSE_X ? -1 : 1);
  const dy = -(nose.y - earMid.y) * scale;

  _offset.set(dx * 2.5, dy * 2.0, 0);
  const posed = toAvatarSpace(_offset, avatarBones) ?? _offset;

  return base.clone().add(posed).normalize();
}

function updateSkeletons(avatarBones) {
  for (const mesh of avatarBones.skinnedMeshes ?? []) {
    mesh.skeleton.update();
  }
}

export function retargetPoseToAvatar(keypoints, avatarBones, videoSize) {
  if (!keypoints?.length || !avatarBones?.skinnedMeshes?.length) return;

  const frameH = videoSize?.height || 480;
  const torso = buildTorsoFrame(keypoints, frameH);
  if (!torso) return;

  const { up, scale } = torso;

  const ls = getKeypoint(keypoints, SWAP_HANDS ? 'right_shoulder' : 'left_shoulder');
  const rs = getKeypoint(keypoints, SWAP_HANDS ? 'left_shoulder' : 'right_shoulder');
  const le = getKeypoint(keypoints, SWAP_HANDS ? 'right_elbow' : 'left_elbow');
  const re = getKeypoint(keypoints, SWAP_HANDS ? 'left_elbow' : 'right_elbow');
  const lw = getKeypoint(keypoints, SWAP_HANDS ? 'right_wrist' : 'left_wrist');
  const rw = getKeypoint(keypoints, SWAP_HANDS ? 'left_wrist' : 'right_wrist');

  const aim = (dir) => toAvatarSpace(dir, avatarBones);

  const spineUp = aim(up);
  if (avatarBones.spine?.bind && spineUp) {
    applyDirectionToBone(avatarBones.spine.bone, avatarBones.spine.bind, spineUp);
  }

  if (avatarBones.neck?.bind && spineUp) {
    applyDirectionToBone(avatarBones.neck.bone, avatarBones.neck.bind, spineUp);
  }

  const headDir = buildHeadDirection(keypoints, torso, avatarBones);
  if (headDir && avatarBones.head?.bind) {
    applyDirectionToBone(avatarBones.head.bone, avatarBones.head.bind, headDir);
  }

  if (scoreOk(ls) && scoreOk(le) && avatarBones.leftUpperArm?.bind) {
    const dir = aim(poseDirection(ls, le, scale));
    if (dir) applyDirectionToBone(avatarBones.leftUpperArm.bone, avatarBones.leftUpperArm.bind, dir);
  }
  if (scoreOk(le) && scoreOk(lw) && avatarBones.leftForearm?.bind) {
    const dir = aim(poseDirection(le, lw, scale));
    if (dir) applyDirectionToBone(avatarBones.leftForearm.bone, avatarBones.leftForearm.bind, dir);
  }

  if (scoreOk(rs) && scoreOk(re) && avatarBones.rightUpperArm?.bind) {
    const dir = aim(poseDirection(rs, re, scale));
    if (dir) applyDirectionToBone(avatarBones.rightUpperArm.bone, avatarBones.rightUpperArm.bind, dir);
  }
  if (scoreOk(re) && scoreOk(rw) && avatarBones.rightForearm?.bind) {
    const dir = aim(poseDirection(re, rw, scale));
    if (dir) applyDirectionToBone(avatarBones.rightForearm.bone, avatarBones.rightForearm.bind, dir);
  }

  updateSkeletons(avatarBones);
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

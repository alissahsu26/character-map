function getKeypoint(keypoints, name) {
  return keypoints.find((kp) => kp.name === name);
}

export { getKeypoint };

export function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function angleBetween(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Stable in-plane tilt from two points (handles mirrored / flipped left-right). */
export function planarTiltAngle(left, right) {
  if (!left || !right) return 0;
  let dx = right.x - left.x;
  let dy = right.y - left.y;
  if (Math.abs(dx) < 1e-4) return 0;
  if (dx < 0) {
    dx = -dx;
    dy = -dy;
  }
  return Math.atan2(dy, dx);
}

function scalePoint(point, srcW, srcH, dstW, dstH) {
  return {
    x: (point.x / srcW) * dstW,
    y: (point.y / srcH) * dstH,
  };
}

function scaleSegment(seg, srcW, srcH, dstW, dstH) {
  const p1 = scalePoint({ x: seg.x1, y: seg.y1 }, srcW, srcH, dstW, dstH);
  const p2 = scalePoint({ x: seg.x2, y: seg.y2 }, srcW, srcH, dstW, dstH);
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}

function fallbackSegment() {
  return { x1: 0, y1: 0, x2: 0, y2: 0 };
}

function armSegment(shoulder, elbow, wrist) {
  if (!shoulder || !elbow) return { upper: fallbackSegment(), lower: fallbackSegment() };
  const upper = { x1: shoulder.x, y1: shoulder.y, x2: elbow.x, y2: elbow.y };
  const lower = wrist
    ? { x1: elbow.x, y1: elbow.y, x2: wrist.x, y2: wrist.y }
    : { x1: elbow.x, y1: elbow.y, x2: elbow.x, y2: elbow.y };
  return { upper, lower };
}

export function mapPoseToPuppet(keypoints, srcW, srcH, dstW, dstH) {
  if (!keypoints?.length) return null;

  const nose = getKeypoint(keypoints, 'nose');
  const leftEye = getKeypoint(keypoints, 'left_eye');
  const rightEye = getKeypoint(keypoints, 'right_eye');
  const leftShoulder = getKeypoint(keypoints, 'left_shoulder');
  const rightShoulder = getKeypoint(keypoints, 'right_shoulder');
  const leftElbow = getKeypoint(keypoints, 'left_elbow');
  const rightElbow = getKeypoint(keypoints, 'right_elbow');
  const leftWrist = getKeypoint(keypoints, 'left_wrist');
  const rightWrist = getKeypoint(keypoints, 'right_wrist');
  const leftHip = getKeypoint(keypoints, 'left_hip');
  const rightHip = getKeypoint(keypoints, 'right_hip');

  const eyeMid =
    leftEye && rightEye ? midpoint(leftEye, rightEye) : nose || { x: srcW / 2, y: srcH / 4 };
  const headPos = nose || eyeMid;
  const headAngle =
    leftEye && rightEye ? planarTiltAngle(leftEye, rightEye) : 0;

  const shoulderMid =
    leftShoulder && rightShoulder
      ? midpoint(leftShoulder, rightShoulder)
      : { x: srcW / 2, y: srcH / 3 };
  const hipMid =
    leftHip && rightHip ? midpoint(leftHip, rightHip) : { x: srcW / 2, y: srcH / 2 };
  const torsoCenter = midpoint(shoulderMid, hipMid);
  const shoulderWidth =
    leftShoulder && rightShoulder ? distance(leftShoulder, rightShoulder) : srcW * 0.25;
  const torsoHeight = distance(shoulderMid, hipMid) || srcH * 0.2;
  const torsoAngle =
    leftShoulder && rightShoulder
      ? planarTiltAngle(leftShoulder, rightShoulder)
      : 0;

  const leftArm = armSegment(leftShoulder, leftElbow, leftWrist);
  const rightArm = armSegment(rightShoulder, rightElbow, rightWrist);

  const puppet = {
    head: {
      cx: headPos.x,
      cy: headPos.y,
      angle: headAngle,
      radius: shoulderWidth * 0.35,
    },
    torso: {
      cx: torsoCenter.x,
      cy: torsoCenter.y,
      width: shoulderWidth * 0.9,
      height: torsoHeight * 1.1,
      angle: torsoAngle,
    },
    leftUpperArm: leftArm.upper,
    leftLowerArm: leftArm.lower,
    rightUpperArm: rightArm.upper,
    rightLowerArm: rightArm.lower,
    leftHand: leftWrist ? { cx: leftWrist.x, cy: leftWrist.y } : null,
    rightHand: rightWrist ? { cx: rightWrist.x, cy: rightWrist.y } : null,
    joints: {
      leftShoulder: leftShoulder ? { x: leftShoulder.x, y: leftShoulder.y } : null,
      rightShoulder: rightShoulder ? { x: rightShoulder.x, y: rightShoulder.y } : null,
      leftElbow: leftElbow ? { x: leftElbow.x, y: leftElbow.y } : null,
      rightElbow: rightElbow ? { x: rightElbow.x, y: rightElbow.y } : null,
    },
  };

  const scale = (p) => scalePoint(p, srcW, srcH, dstW, dstH);
  const scaledHead = scale({ x: puppet.head.cx, y: puppet.head.cy });
  const scaledTorso = scale({ x: puppet.torso.cx, y: puppet.torso.cy });

  return {
    head: {
      cx: scaledHead.x,
      cy: scaledHead.y,
      angle: puppet.head.angle,
      radius: (puppet.head.radius / srcW) * dstW,
    },
    torso: {
      cx: scaledTorso.x,
      cy: scaledTorso.y,
      width: (puppet.torso.width / srcW) * dstW,
      height: (puppet.torso.height / srcH) * dstH,
      angle: puppet.torso.angle,
    },
    leftUpperArm: scaleSegment(puppet.leftUpperArm, srcW, srcH, dstW, dstH),
    leftLowerArm: scaleSegment(puppet.leftLowerArm, srcW, srcH, dstW, dstH),
    rightUpperArm: scaleSegment(puppet.rightUpperArm, srcW, srcH, dstW, dstH),
    rightLowerArm: scaleSegment(puppet.rightLowerArm, srcW, srcH, dstW, dstH),
    leftHand: puppet.leftHand
      ? (() => {
          const p = scale({ x: puppet.leftHand.cx, y: puppet.leftHand.cy });
          return { cx: p.x, cy: p.y };
        })()
      : null,
    rightHand: puppet.rightHand
      ? (() => {
          const p = scale({ x: puppet.rightHand.cx, y: puppet.rightHand.cy });
          return { cx: p.x, cy: p.y };
        })()
      : null,
    joints: {
      leftShoulder: puppet.joints.leftShoulder ? scale(puppet.joints.leftShoulder) : null,
      rightShoulder: puppet.joints.rightShoulder ? scale(puppet.joints.rightShoulder) : null,
      leftElbow: puppet.joints.leftElbow ? scale(puppet.joints.leftElbow) : null,
      rightElbow: puppet.joints.rightElbow ? scale(puppet.joints.rightElbow) : null,
    },
  };
}

export const MOVENET_CONNECTIONS = [
  ['nose', 'left_eye'],
  ['nose', 'right_eye'],
  ['left_eye', 'left_ear'],
  ['right_eye', 'right_ear'],
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
];

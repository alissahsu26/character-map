import { useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { KeypointSmoother } from '../utils/poseSmoothing';
import { mediapipePoseToMoveNet, fuseHandWristsIntoKeypoints } from '../utils/mediapipePoseToMoveNet';

const POSE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task';
const HAND_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const VISION_WASM =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';

function isInterruptedPlayError(err) {
  return (
    err?.name === 'AbortError' ||
    (typeof err?.message === 'string' &&
      err.message.includes('interrupted by a new load'))
  );
}

export function usePoseTracking(externalFpsRef) {
  const videoRef = useRef(null);
  const poseLandmarkerRef = useRef(null);
  const handLandmarkerRef = useRef(null);
  const handTimestampRef = useRef(0);
  const streamRef = useRef(null);
  const prevKeypointsRef = useRef(null);
  const smootherRef = useRef(null);
  const rafRef = useRef(null);
  const mountedRef = useRef(true);
  const initSessionRef = useRef(0);
  const internalFpsRef = useRef(0);
  const fpsRef = externalFpsRef ?? internalFpsRef;
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(performance.now());

  const [poses, setPoses] = useState([]);
  const [hands, setHands] = useState([]);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState(null);
  const [videoSize, setVideoSize] = useState({ width: 640, height: 480 });

  useEffect(() => {
    const session = ++initSessionRef.current;
    mountedRef.current = true;

    async function init() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 1280, min: 640 },
            height: { ideal: 720, min: 480 },
            frameRate: { ideal: 30, min: 24 },
          },
          audio: false,
        });

        if (!mountedRef.current || session !== initSessionRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        video.srcObject = stream;
        try {
          await video.play();
        } catch (playErr) {
          if (!mountedRef.current || session !== initSessionRef.current || isInterruptedPlayError(playErr)) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          throw playErr;
        }

        const width = video.videoWidth || 640;
        const height = video.videoHeight || 480;
        setVideoSize({ width, height });

        const vision = await FilesetResolver.forVisionTasks(VISION_WASM);

        const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: POSE_MODEL,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.55,
          minPosePresenceConfidence: 0.55,
          minTrackingConfidence: 0.65,
          outputSegmentationMasks: false,
        });

        const handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: HAND_MODEL,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.45,
          minHandPresenceConfidence: 0.45,
          minTrackingConfidence: 0.5,
        });

        if (!mountedRef.current || session !== initSessionRef.current) {
          poseLandmarker.close();
          handLandmarker.close();
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        poseLandmarkerRef.current = poseLandmarker;
        handLandmarkerRef.current = handLandmarker;
        smootherRef.current = new KeypointSmoother(17, { minCutoff: 0.95, beta: 0.035 });

        const detect = () => {
          if (!mountedRef.current || !videoRef.current || !poseLandmarkerRef.current) return;

          const video = videoRef.current;
          const frameW = video.videoWidth || 640;
          const frameH = video.videoHeight || 480;

          if (video.readyState >= 2) {
            const timestamp = performance.now();

            try {
              const poseResult = poseLandmarkerRef.current.detectForVideo(video, timestamp);
              let detectedHands = [];

              try {
                handTimestampRef.current = timestamp;
                const handResult = handLandmarkerRef.current.detectForVideo(
                  video,
                  handTimestampRef.current
                );
                if (handResult.landmarks?.length) {
                  detectedHands = handResult.landmarks.map((landmarks, i) => ({
                    id: i,
                    handedness:
                      handResult.handednesses?.[i]?.[0]?.categoryName ?? `hand_${i}`,
                    landmarks: landmarks.map((lm) => ({
                      x: (1 - lm.x) * frameW,
                      y: lm.y * frameH,
                      z: lm.z,
                    })),
                  }));
                }
                setHands(detectedHands);
              } catch (handErr) {
                console.error('Hand detection error:', handErr);
                setHands([]);
              }

              if (poseResult.landmarks?.length) {
                const raw = mediapipePoseToMoveNet(
                  poseResult.landmarks[0],
                  frameW,
                  frameH,
                  { mirrorX: true }
                );
                const withHands = fuseHandWristsIntoKeypoints(raw, detectedHands);
                const smoothed = smootherRef.current.smooth(
                  withHands,
                  prevKeypointsRef.current,
                  frameW,
                  frameH
                );
                prevKeypointsRef.current = smoothed;
                setPoses([{ keypoints: smoothed }]);
              } else {
                prevKeypointsRef.current = null;
                setPoses([]);
              }
            } catch (err) {
              console.error('Pose detection error:', err);
            }
          }

          if (mountedRef.current) {
            frameCountRef.current += 1;
            const fpsNow = performance.now();
            if (fpsNow - lastFpsTimeRef.current >= 1000) {
              fpsRef.current = frameCountRef.current;
              frameCountRef.current = 0;
              lastFpsTimeRef.current = fpsNow;
            }
            rafRef.current = requestAnimationFrame(detect);
          }
        };

        setIsReady(true);
        rafRef.current = requestAnimationFrame(detect);
      } catch (err) {
        if (!mountedRef.current || session !== initSessionRef.current || isInterruptedPlayError(err)) {
          return;
        }
        const message =
          err.name === 'NotAllowedError'
            ? 'Camera permission denied. Please allow webcam access and retry.'
            : err.message || 'Failed to start webcam or pose detection.';
        setError(message);
      }
    }

    init();

    return () => {
      mountedRef.current = false;
      initSessionRef.current += 1;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (poseLandmarkerRef.current) {
        poseLandmarkerRef.current.close();
        poseLandmarkerRef.current = null;
      }
      if (handLandmarkerRef.current) {
        handLandmarkerRef.current.close();
        handLandmarkerRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.srcObject = null;
      }
    };
  }, []);

  return { videoRef, poses, hands, isReady, error, videoSize, fpsRef };
}

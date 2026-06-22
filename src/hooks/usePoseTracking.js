import { useEffect, useRef, useState } from 'react';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import * as poseDetection from '@tensorflow-models/pose-detection';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { KeypointSmoother } from '../utils/poseSmoothing';

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
  const detectorRef = useRef(null);
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
            width: { ideal: 1280 },
            height: { ideal: 720 },
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

        try {
          await tf.setBackend('webgl');
        } catch {
          await tf.setBackend('cpu');
          console.warn('WebGL backend unavailable, falling back to CPU');
        }
        await tf.ready();

        const detector = await poseDetection.createDetector(
          poseDetection.SupportedModels.MoveNet,
          { modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER }
        );

        if (!mountedRef.current || session !== initSessionRef.current) {
          detector.dispose();
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        detectorRef.current = detector;
        smootherRef.current = new KeypointSmoother(17, { minCutoff: 1.1, beta: 0.025 });

        const vision = await FilesetResolver.forVisionTasks(VISION_WASM);
        const handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: HAND_MODEL,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
        });

        if (!mountedRef.current || session !== initSessionRef.current) {
          detector.dispose();
          handLandmarker.close();
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        handLandmarkerRef.current = handLandmarker;

        const detect = async () => {
          if (!mountedRef.current || !videoRef.current || !detectorRef.current) return;

          const video = videoRef.current;
          const frameW = video.videoWidth || 640;
          const frameH = video.videoHeight || 480;

          try {
            const estimated = await detectorRef.current.estimatePoses(video, {
              maxPoses: 1,
              flipHorizontal: true,
            });
            if (estimated.length > 0) {
              const raw = estimated[0].keypoints;
              const smoothed = smootherRef.current.smooth(
                raw,
                prevKeypointsRef.current,
                frameW,
                frameH
              );
              prevKeypointsRef.current = smoothed;
              setPoses([{ keypoints: smoothed }]);
            }
          } catch (err) {
            console.error('Pose detection error:', err);
          }

          if (handLandmarkerRef.current && video.readyState >= 2) {
            try {
              handTimestampRef.current = performance.now();
              const result = handLandmarkerRef.current.detectForVideo(
                video,
                handTimestampRef.current
              );
              if (result.landmarks?.length) {
                const detectedHands = result.landmarks.map((landmarks, i) => ({
                  id: i,
                  handedness: result.handednesses?.[i]?.[0]?.categoryName ?? `hand_${i}`,
                  landmarks: landmarks.map((lm) => ({
                    x: lm.x * frameW,
                    y: lm.y * frameH,
                    z: lm.z,
                  })),
                }));
                setHands(detectedHands);
              } else {
                setHands([]);
              }
            } catch (err) {
              console.error('Hand detection error:', err);
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
      if (detectorRef.current) {
        detectorRef.current.dispose();
        detectorRef.current = null;
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

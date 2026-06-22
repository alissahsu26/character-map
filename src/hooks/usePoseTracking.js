import { useEffect, useRef, useState } from 'react';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import * as poseDetection from '@tensorflow-models/pose-detection';

const SMOOTHING_ALPHA = 0.35;
const MIN_SCORE = 0.3;

function smoothKeypoints(raw, previous, alpha) {
  if (!previous) return raw;

  return raw.map((kp, i) => {
    const prev = previous[i];
    if (!prev || kp.score < MIN_SCORE) return kp;
    if (prev.score < MIN_SCORE) return kp;

    return {
      ...kp,
      x: alpha * kp.x + (1 - alpha) * prev.x,
      y: alpha * kp.y + (1 - alpha) * prev.y,
    };
  });
}

export function usePoseTracking() {
  const videoRef = useRef(null);
  const detectorRef = useRef(null);
  const streamRef = useRef(null);
  const prevKeypointsRef = useRef(null);
  const rafRef = useRef(null);
  const mountedRef = useRef(true);

  const [poses, setPoses] = useState([]);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState(null);
  const [videoSize, setVideoSize] = useState({ width: 640, height: 480 });

  useEffect(() => {
    mountedRef.current = true;

    async function init() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 640, height: 480 },
          audio: false,
        });

        if (!mountedRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) return;

        video.srcObject = stream;
        await video.play();

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
          { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
        );

        if (!mountedRef.current) {
          detector.dispose();
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        detectorRef.current = detector;

        const detect = async () => {
          if (!mountedRef.current || !videoRef.current || !detectorRef.current) return;

          try {
            const estimated = await detectorRef.current.estimatePoses(videoRef.current);
            if (estimated.length > 0) {
              const raw = estimated[0].keypoints;
              const smoothed = smoothKeypoints(raw, prevKeypointsRef.current, SMOOTHING_ALPHA);
              prevKeypointsRef.current = smoothed;
              setPoses([{ keypoints: smoothed }]);
            }
          } catch (err) {
            console.error('Pose detection error:', err);
          }

          rafRef.current = requestAnimationFrame(detect);
        };

        setIsReady(true);
        rafRef.current = requestAnimationFrame(detect);
      } catch (err) {
        if (!mountedRef.current) return;
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
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (detectorRef.current) {
        detectorRef.current.dispose();
        detectorRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };
  }, []);

  return { videoRef, poses, isReady, error, videoSize };
}

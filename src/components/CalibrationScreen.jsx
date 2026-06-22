import { useEffect, useRef, useState } from 'react';
import { checkRaisedHands, createCalibrationGate } from '../utils/calibrationCheck';

export default function CalibrationScreen({ keypointsRef, videoSizeRef, onComplete }) {
  const gateRef = useRef(createCalibrationGate());
  const [raised, setRaised] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let rafId = 0;

    const tick = () => {
      const keypoints = keypointsRef.current;
      const videoSize = videoSizeRef.current;
      const isRaised = checkRaisedHands(keypoints, videoSize);

      setRaised(isRaised);
      setProgress(gateRef.current.getHoldProgress());

      if (gateRef.current.update(keypoints, videoSize)) {
        onComplete();
        return;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [keypointsRef, videoSizeRef, onComplete]);

  return (
    <div className="calibration-overlay">
      <div className="calibration-card">
        <h2>Camera setup</h2>
        <ul className="calibration-tips">
          <li>Stand or sit <strong>3–6 feet</strong> from the camera</li>
          <li>Use <strong>front lighting</strong> on your face and upper body</li>
          <li>Choose a <strong>plain, high-contrast background</strong></li>
          <li>The preview is <strong>mirrored</strong> like a selfie</li>
        </ul>

        <div className={`calibration-prompt ${raised ? 'calibration-prompt--active' : ''}`}>
          <p className="calibration-action">Raise both hands above your shoulders</p>
          <div className="calibration-progress-track">
            <div
              className="calibration-progress-fill"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <p className="calibration-hint">
            {raised
              ? 'Hold steady…'
              : 'We need both arms visible with confident tracking'}
          </p>
        </div>

        <button type="button" className="calibration-skip" onClick={onComplete}>
          Skip calibration
        </button>
      </div>
    </div>
  );
}

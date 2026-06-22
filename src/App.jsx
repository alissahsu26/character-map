import { useCallback, useRef, useState } from 'react';
import ThreeScene from './components/ThreeScene';
import KeypointsOverlay from './components/KeypointsOverlay';
import HandOverlay from './components/HandOverlay';
import TrackingDebugPanel from './components/TrackingDebugPanel';
import PoseTracker, { STAGE_WIDTH, STAGE_HEIGHT } from './components/PoseTracker';
import './App.css';

export default function App() {
  const keypointsRef = useRef([]);
  const handsRef = useRef([]);
  const videoSizeRef = useRef({ width: 640, height: 480 });
  const trackingStateRef = useRef(null);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [showHands, setShowHands] = useState(true);
  const [showBoneHelpers, setShowBoneHelpers] = useState(false);
  const [showLandmarks, setShowLandmarks] = useState(false);
  const [status, setStatus] = useState({ isReady: false, error: null });

  const handlePoseUpdate = useCallback((_puppet, keypoints, size) => {
    keypointsRef.current = keypoints;
    videoSizeRef.current = size;
  }, []);

  const handleHandUpdate = useCallback((hands, size) => {
    handsRef.current = hands;
    videoSizeRef.current = size;
  }, []);

  const handleStatusChange = useCallback((next) => {
    setStatus(next);
  }, []);

  const handleRetry = () => {
    window.location.reload();
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Character Puppet</h1>
        <div className="debug-toggles">
          <label className="skeleton-toggle">
            <input
              type="checkbox"
              checked={showSkeleton}
              onChange={(e) => setShowSkeleton(e.target.checked)}
            />
            Pose skeleton
          </label>
          <label className="skeleton-toggle">
            <input
              type="checkbox"
              checked={showHands}
              onChange={(e) => setShowHands(e.target.checked)}
            />
            Hand joints
          </label>
          <label className="skeleton-toggle">
            <input
              type="checkbox"
              checked={showBoneHelpers}
              onChange={(e) => setShowBoneHelpers(e.target.checked)}
            />
            Avatar bones
          </label>
          <label className="skeleton-toggle">
            <input
              type="checkbox"
              checked={showLandmarks}
              onChange={(e) => setShowLandmarks(e.target.checked)}
            />
            Landmarks
          </label>
        </div>
      </header>

      <main className="stage-container">
        <div className="stage mirror">
          <ThreeScene
            keypointsRef={keypointsRef}
            videoSizeRef={videoSizeRef}
            trackingStateRef={trackingStateRef}
            showBoneHelpers={showBoneHelpers}
            showLandmarks={showLandmarks}
          />
          <TrackingDebugPanel stateRef={trackingStateRef} />
          <KeypointsOverlay
            keypointsRef={keypointsRef}
            videoSizeRef={videoSizeRef}
            visible={showSkeleton}
            dstW={STAGE_WIDTH}
            dstH={STAGE_HEIGHT}
          />
          <HandOverlay
            handsRef={handsRef}
            videoSizeRef={videoSizeRef}
            visible={showHands}
            dstW={STAGE_WIDTH}
            dstH={STAGE_HEIGHT}
          />
        </div>

        {!status.isReady && !status.error && (
          <div className="loading-overlay">
            <div className="spinner" />
            <p>Starting webcam and loading pose &amp; hand models...</p>
          </div>
        )}

        {status.error && (
          <div className="loading-overlay">
            <p className="error-text">{status.error}</p>
            <button type="button" onClick={handleRetry}>
              Retry
            </button>
          </div>
        )}
      </main>

      <PoseTracker
        onPoseUpdate={handlePoseUpdate}
        onHandUpdate={handleHandUpdate}
        onStatusChange={handleStatusChange}
        showSkeleton={showSkeleton}
        showHands={showHands}
      />
    </div>
  );
}

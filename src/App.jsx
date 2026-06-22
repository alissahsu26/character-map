import { useCallback, useRef, useState } from 'react';
import ThreeScene from './components/ThreeScene';
import PuppetStage from './components/PuppetStage';
import KeypointsOverlay from './components/KeypointsOverlay';
import HandOverlay from './components/HandOverlay';
import TrackingDebugPanel from './components/TrackingDebugPanel';
import PoseTracker, { STAGE_WIDTH, STAGE_HEIGHT } from './components/PoseTracker';
import './App.css';

export const VIEW_MODES = {
  AVATAR: 'avatar',
  PUPPET: 'puppet',
};

export default function App() {
  const keypointsRef = useRef([]);
  const handsRef = useRef([]);
  const videoSizeRef = useRef({ width: 640, height: 480 });
  const trackingStateRef = useRef(null);
  const fpsRef = useRef(0);
  const [viewMode, setViewMode] = useState(VIEW_MODES.AVATAR);
  const [showCameraSkeleton, setShowCameraSkeleton] = useState(true);
  const [showBoneHelpers, setShowBoneHelpers] = useState(false);
  const [showLandmarks, setShowLandmarks] = useState(false);
  const [status, setStatus] = useState({ isReady: false, error: null });

  const isAvatarMode = viewMode === VIEW_MODES.AVATAR;

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
        <div className="view-mode-switch" role="group" aria-label="View mode">
          <button
            type="button"
            className={`view-mode-btn ${viewMode === VIEW_MODES.PUPPET ? 'active' : ''}`}
            onClick={() => setViewMode(VIEW_MODES.PUPPET)}
          >
            Puppet
          </button>
          <button
            type="button"
            className={`view-mode-btn ${viewMode === VIEW_MODES.AVATAR ? 'active' : ''}`}
            onClick={() => setViewMode(VIEW_MODES.AVATAR)}
          >
            Charlie
          </button>
        </div>
        <div className="debug-toggles">
          <label className="skeleton-toggle">
            <input
              type="checkbox"
              checked={showCameraSkeleton}
              onChange={(e) => setShowCameraSkeleton(e.target.checked)}
            />
            Camera skeleton
          </label>
          {isAvatarMode && (
            <>
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
            </>
          )}
        </div>
      </header>

      <main className="stage-container">
        <div className={`stage${isAvatarMode ? ' mirror' : ''}`}>
          {isAvatarMode ? (
            <ThreeScene
              keypointsRef={keypointsRef}
              videoSizeRef={videoSizeRef}
              trackingStateRef={trackingStateRef}
              showBoneHelpers={showBoneHelpers}
              showLandmarks={showLandmarks}
            />
          ) : (
            <PuppetStage
              keypointsRef={keypointsRef}
              videoSizeRef={videoSizeRef}
              width={STAGE_WIDTH}
              height={STAGE_HEIGHT}
            />
          )}
          {isAvatarMode && <TrackingDebugPanel stateRef={trackingStateRef} fpsRef={fpsRef} />}
          <KeypointsOverlay
            keypointsRef={keypointsRef}
            videoSizeRef={videoSizeRef}
            visible={showCameraSkeleton}
            dstW={STAGE_WIDTH}
            dstH={STAGE_HEIGHT}
          />
          <HandOverlay
            handsRef={handsRef}
            videoSizeRef={videoSizeRef}
            visible={showCameraSkeleton}
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
        fpsRef={fpsRef}
        showCameraSkeleton={showCameraSkeleton}
      />
    </div>
  );
}

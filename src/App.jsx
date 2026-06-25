import { useCallback, useRef, useState } from 'react';
import PuppetStage from './components/PuppetStage';
import headImg from './character_puppet_assets/assets/character/head.png';
import torsoImg from './character_puppet_assets/assets/character/torso.png';
import upperArmLImg from './character_puppet_assets/assets/character/upperArmL.png';
import upperArmRImg from './character_puppet_assets/assets/character/upperArmR.png';
import lowerArmLImg from './character_puppet_assets/assets/character/lowerArmL.png';
import lowerArmRImg from './character_puppet_assets/assets/character/lowerArmR.png';
import neckImg from './character_puppet_assets/assets/character/neck.png';
import KeypointsOverlay from './components/KeypointsOverlay';
import HandOverlay from './components/HandOverlay';
import PoseTracker, { STAGE_WIDTH, STAGE_HEIGHT } from './components/PoseTracker';
import './App.css';

export const VIEW_MODES = {
  BASE: 'base',
  CHARACTER: 'character',
};

export default function App() {
  const keypointsRef = useRef([]);
  const handsRef = useRef([]);
  const videoSizeRef = useRef({ width: 640, height: 480 });
  const fpsRef = useRef(0);
  const [viewMode, setViewMode] = useState(VIEW_MODES.BASE);
  const [showCameraSkeleton, setShowCameraSkeleton] = useState(true);
  const [showPuppetDebug, setShowPuppetDebug] = useState(false);
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
        <div className="view-mode-switch" role="group" aria-label="View mode">
          <button
            type="button"
            className={`view-mode-btn ${viewMode === VIEW_MODES.BASE ? 'active' : ''}`}
            onClick={() => setViewMode(VIEW_MODES.BASE)}
          >
            Base
          </button>
          <button
            type="button"
            className={`view-mode-btn ${viewMode === VIEW_MODES.CHARACTER ? 'active' : ''}`}
            onClick={() => setViewMode(VIEW_MODES.CHARACTER)}
          >
            Character
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
          <label className="skeleton-toggle">
            <input
              type="checkbox"
              checked={showPuppetDebug}
              onChange={(e) => setShowPuppetDebug(e.target.checked)}
            />
            Show data
          </label>
        </div>
      </header>

      <main className="stage-container">
        <div className="stage">
          {viewMode === VIEW_MODES.BASE && (
            <PuppetStage
              keypointsRef={keypointsRef}
              videoSizeRef={videoSizeRef}
              width={STAGE_WIDTH}
              height={STAGE_HEIGHT}
              showDebug={showPuppetDebug}
            />
          )}
          {viewMode === VIEW_MODES.CHARACTER && (
            <PuppetStage
              keypointsRef={keypointsRef}
              videoSizeRef={videoSizeRef}
              width={STAGE_WIDTH}
              height={STAGE_HEIGHT}
              showDebug={showPuppetDebug}
              headImage={headImg}
              torsoImage={torsoImg}
              upperArmLImage={upperArmLImg}
              upperArmRImage={upperArmRImg}
              lowerArmLImage={lowerArmLImg}
              lowerArmRImage={lowerArmRImg}
              neckImage={neckImg}
            />
          )}
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

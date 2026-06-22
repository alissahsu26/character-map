import { useCallback, useState } from 'react';
import CharacterPuppet from './components/CharacterPuppet';
import SkeletonDebug from './components/SkeletonDebug';
import PoseTracker, { STAGE_WIDTH, STAGE_HEIGHT } from './components/PoseTracker';
import './App.css';

export default function App() {
  const [puppetState, setPuppetState] = useState(null);
  const [rawKeypoints, setRawKeypoints] = useState([]);
  const [videoSize, setVideoSize] = useState({ width: 640, height: 480 });
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [status, setStatus] = useState({ isReady: false, error: null });

  const handlePoseUpdate = useCallback((puppet, keypoints, size) => {
    setPuppetState(puppet);
    setRawKeypoints(keypoints);
    setVideoSize(size);
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
        <label className="skeleton-toggle">
          <input
            type="checkbox"
            checked={showSkeleton}
            onChange={(e) => setShowSkeleton(e.target.checked)}
          />
          Show skeleton
        </label>
      </header>

      <main className="stage-container">
        <div className="stage mirror">
          <CharacterPuppet puppet={puppetState} width={STAGE_WIDTH} height={STAGE_HEIGHT} />
          <SkeletonDebug
            keypoints={rawKeypoints}
            visible={showSkeleton}
            srcW={videoSize.width}
            srcH={videoSize.height}
            dstW={STAGE_WIDTH}
            dstH={STAGE_HEIGHT}
          />
        </div>

        {!status.isReady && !status.error && (
          <div className="loading-overlay">
            <div className="spinner" />
            <p>Starting webcam and loading pose model...</p>
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

      <PoseTracker onPoseUpdate={handlePoseUpdate} onStatusChange={handleStatusChange} />
    </div>
  );
}

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import CharacterPuppet from '../render/CharacterPuppet';
import DebugOverlay from '../render/DebugOverlay';
import { BodyStateEstimator } from '../body/BodyStateEstimator';
import { bodyStateToControls } from '../mapping/bodyToControls';
import { buildPuppetRig } from '../character/puppetRig';
import { PuppetRigSmoother } from '../character/puppetRigSmoothing';
import { PUPPET_IMAGE_NUDGES, logPuppetImageNudges } from '../character/puppetImageConfig';

function clampScale(v) {
  return Math.max(0.3, Math.min(3, v));
}

const PANEL_STYLE = {
  position: 'absolute',
  top: 0,
  right: 0,
  background: 'rgba(10,10,20,0.82)',
  color: '#dde',
  padding: '8px 10px',
  fontSize: 11,
  fontFamily: 'monospace',
  borderRadius: '0 0 0 6px',
  userSelect: 'none',
  minWidth: 170,
  lineHeight: 1.5,
  zIndex: 2,
};

const CALIBRATE_PARTS = [
  { key: 'torso',     label: 'Torso' },
  { key: 'neck',      label: 'Neck' },
  { key: 'head',      label: 'Head' },
  { key: 'upperArmL', label: 'Upper Arm L' },
  { key: 'upperArmR', label: 'Upper Arm R' },
  { key: 'lowerArmL', label: 'Lower Arm L' },
  { key: 'lowerArmR', label: 'Lower Arm R' },
];

/**
 * Data flow:
 *   keypoints (MoveNet)
 *   → BodyStateEstimator     → stable BodyState + debug
 *   → bodyStateToControls()  → CharacterControls  (artistic)
 *   → buildPuppetRig()       → PuppetRig   (display pixels)
 *   → CharacterPuppet        → SVG
 */
export default function PuppetStage({ keypointsRef, videoSizeRef, width, height, showDebug, headImage, torsoImage, upperArmLImage, upperArmRImage, lowerArmLImage, lowerArmRImage, neckImage }) {
  const [, tick] = useReducer((n) => n + 1, 0);
  const estimatorRef = useRef(null);
  const rigSmootherRef = useRef(null);
  const hasImages = !!(headImage || torsoImage || neckImage || upperArmLImage || upperArmRImage || lowerArmLImage || lowerArmRImage);
  const [isCalibrate, setIsCalibrate] = useState(false);
  const [calibratePart, setCalibratePart] = useState('torso');
  const [calibrateMode, setCalibrateMode] = useState('move');
  const [imageNudges, setImageNudges] = useState(() => structuredClone(PUPPET_IMAGE_NUDGES));

  if (!estimatorRef.current) {
    estimatorRef.current = new BodyStateEstimator();
  }
  if (!rigSmootherRef.current) {
    rigSmootherRef.current = new PuppetRigSmoother();
  }

  const onPartAdjust = useCallback((partKey, delta) => {
    setImageNudges((prev) => ({
      ...prev,
      [partKey]: {
        nudgeX: (prev[partKey]?.nudgeX ?? 0) + (delta.dx ?? 0),
        nudgeY: (prev[partKey]?.nudgeY ?? 0) + (delta.dy ?? 0),
        nudgeRot: (prev[partKey]?.nudgeRot ?? 0) + (delta.dRot ?? 0),
        nudgeScale: clampScale((prev[partKey]?.nudgeScale ?? 1) + (delta.dScale ?? 0)),
      },
    }));
  }, []);

  const resetNudges = useCallback(() => {
    setImageNudges(structuredClone(PUPPET_IMAGE_NUDGES));
  }, []);

  const logNudges = useCallback(() => {
    logPuppetImageNudges(imageNudges);
  }, [imageNudges]);

  useEffect(() => {
    let frame;
    const loop = () => {
      tick();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  const keypoints = keypointsRef.current;
  const videoSize = videoSizeRef.current;

  const { bodyState, debug: estimatorDebug } = estimatorRef.current.estimate(
    keypoints?.length && videoSize?.width ? keypoints : null,
    videoSize
  );
  const controls = bodyStateToControls(bodyState);
  const rawPuppet = buildPuppetRig(bodyState, controls, width, height);
  const puppet = rigSmootherRef.current.smooth(rawPuppet, {
    motionEnergy: bodyState?.motionEnergy ?? 0,
  });

  return (
    <div style={{ position: 'relative', width, height }}>
      <CharacterPuppet
        puppet={puppet}
        width={width}
        height={height}
        headImage={headImage}
        torsoImage={torsoImage}
        upperArmLImage={upperArmLImage}
        upperArmRImage={upperArmRImage}
        lowerArmLImage={lowerArmLImage}
        lowerArmRImage={lowerArmRImage}
        neckImage={neckImage}
        imageNudges={imageNudges}
        calibratePart={isCalibrate && hasImages ? calibratePart : null}
        calibrateMode={isCalibrate ? calibrateMode : null}
        onPartAdjust={onPartAdjust}
      />
      {hasImages && (
        <div style={PANEL_STYLE}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', marginBottom: 4 }}>
            <input
              type="checkbox"
              checked={isCalibrate}
              onChange={(e) => setIsCalibrate(e.target.checked)}
            />
            Calibrate images
          </label>
          {isCalibrate && (
            <>
              <select
                value={calibratePart}
                onChange={(e) => setCalibratePart(e.target.value)}
                style={{ width: '100%', marginBottom: 4, background: '#223', color: '#dde', border: '1px solid #556' }}
              >
                {CALIBRATE_PARTS.map(({ key, label }) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                {['move', 'rotate', 'scale'].map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setCalibrateMode(mode)}
                    style={{
                      flex: 1,
                      padding: '3px 0',
                      cursor: 'pointer',
                      background: calibrateMode === mode ? '#335' : '#223',
                      color: calibrateMode === mode ? '#8ff' : '#aac',
                      border: `1px solid ${calibrateMode === mode ? '#58a' : '#556'}`,
                      borderRadius: 3,
                      textTransform: 'capitalize',
                    }}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 10, color: '#8aa', marginBottom: 4, lineHeight: 1.4 }}>
                {calibrateMode === 'move'
                  ? 'Drag to slide the PNG. Puppet still follows your pose.'
                  : calibrateMode === 'rotate'
                    ? 'Drag around the yellow dot to rotate the PNG.'
                    : 'Drag up/down to scale the PNG. Use buttons for fine steps.'}
              </div>
              <div style={{ fontSize: 10, color: '#8ff', marginBottom: 4 }}>
                {calibratePart}: x={Math.round(imageNudges[calibratePart]?.nudgeX ?? 0)} y={Math.round(imageNudges[calibratePart]?.nudgeY ?? 0)} rot={(imageNudges[calibratePart]?.nudgeRot ?? 0).toFixed(1)}° scale={(imageNudges[calibratePart]?.nudgeScale ?? 1).toFixed(2)}
              </div>
              {calibrateMode === 'scale' && (
                <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  <button
                    type="button"
                    onClick={() => onPartAdjust(calibratePart, { dScale: -0.05 })}
                    style={{
                      flex: 1,
                      padding: '3px 0',
                      cursor: 'pointer',
                      background: '#334',
                      color: '#aae',
                      border: '1px solid #556',
                      borderRadius: 3,
                    }}
                  >
                    − Smaller
                  </button>
                  <button
                    type="button"
                    onClick={() => onPartAdjust(calibratePart, { dScale: 0.05 })}
                    style={{
                      flex: 1,
                      padding: '3px 0',
                      cursor: 'pointer',
                      background: '#334',
                      color: '#aae',
                      border: '1px solid #556',
                      borderRadius: 3,
                    }}
                  >
                    + Larger
                  </button>
                </div>
              )}
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  onClick={logNudges}
                  style={{
                    flex: 1,
                    padding: '3px 0',
                    cursor: 'pointer',
                    background: '#254',
                    color: '#8f8',
                    border: '1px solid #486',
                    borderRadius: 3,
                  }}
                >
                  Log config
                </button>
                <button
                  type="button"
                  onClick={resetNudges}
                  style={{
                    flex: 1,
                    padding: '3px 0',
                    cursor: 'pointer',
                    background: '#334',
                    color: '#aae',
                    border: '1px solid #556',
                    borderRadius: 3,
                  }}
                >
                  Reset
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {showDebug && (
        <DebugOverlay
          bodyState={bodyState}
          controls={controls}
          estimatorDebug={estimatorDebug}
        />
      )}
    </div>
  );
}

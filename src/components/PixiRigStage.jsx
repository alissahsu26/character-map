import { useEffect, useReducer, useRef, useState } from 'react';
import { CharacterRig } from '../character/CharacterRig.ts';
import { BodyStateEstimator } from '../body/BodyStateEstimator';
import { bodyStateToControls } from '../mapping/bodyToControls';
import DebugOverlay from '../render/DebugOverlay';

// ── Slider configuration ───────────────────────────────────────────────────
const SLIDER_DEFS = [
  { key: 'head',      label: 'Head',         min: -0.35, max:  0.35, step: 0.01 },
  { key: 'upperArmL', label: 'Upper Arm  L',  min: -1.8,  max:  0.5,  step: 0.01 },
  { key: 'lowerArmL', label: 'Lower Arm  L',  min: -1.5,  max:  1.5,  step: 0.01 },
  { key: 'upperArmR', label: 'Upper Arm  R',  min: -0.5,  max:  1.8,  step: 0.01 },
  { key: 'lowerArmR', label: 'Lower Arm  R',  min: -1.5,  max:  1.5,  step: 0.01 },
];

const DEFAULT_POSE = {
  head: 0, torso: 0,
  upperArmL: 0, lowerArmL: 0,
  upperArmR: 0, lowerArmR: 0,
};

const CALIBRATE_BONES = [
  { key: 'lowerArmL', label: 'Lower Arm L' },
  { key: 'lowerArmR', label: 'Lower Arm R' },
];

const CALIBRATE_MODES = [
  { key: 'anchor',   label: 'Anchor (drag image)' },
  { key: 'position', label: 'Position (drag joint)' },
];

// ── Styles ────────────────────────────────────────────────────────────────
const PANEL_STYLE = {
  position:   'absolute',
  top:        0,
  right:      0,
  background: 'rgba(10,10,20,0.82)',
  color:      '#dde',
  padding:    '8px 10px',
  fontSize:   11,
  fontFamily: 'monospace',
  borderRadius: '0 0 0 6px',
  userSelect: 'none',
  minWidth:   170,
  lineHeight: 1.5,
};

const LABEL_STYLE = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  cursor: 'pointer',
};

/**
 * Data flow:
 *
 *  MediaPipe mode:
 *    keypointsRef → BodyStateEstimator → bodyStateToControls
 *    → rig.update(controls)
 *
 *  Manual mode:
 *    HTML sliders → pose object → rig.applyPose(pose)
 *
 * CharacterRig never reads landmarks directly.
 */
export default function PixiRigStage({ width, height, keypointsRef, videoSizeRef, showDebug }) {
  const canvasRef   = useRef(null);
  const rigRef      = useRef(null);
  const estimatorRef = useRef(new BodyStateEstimator());
  const estimateRef = useRef({ bodyState: null, debug: {} });
  const dragRef     = useRef(null);
  const [, tick] = useReducer((n) => n + 1, 0);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [isManual,   setIsManual]   = useState(true);   // start in manual so user can tune first
  const [showPivots, setShowPivots] = useState(false);
  const [manualPose, setManualPose] = useState(DEFAULT_POSE);
  const [isCalibrate, setIsCalibrate] = useState(false);
  const [calibrateBone, setCalibrateBone] = useState('lowerArmL');
  const [calibrateMode, setCalibrateMode] = useState('anchor');
  const [isDragging, setIsDragging] = useState(false);

  // Refs mirror state so the rAF loop never reads stale closures
  const isManualRef   = useRef(isManual);
  const manualPoseRef = useRef(manualPose);
  useEffect(() => { isManualRef.current = isManual; },   [isManual]);
  useEffect(() => { manualPoseRef.current = manualPose; }, [manualPose]);

  useEffect(() => {
    if (!showDebug) return undefined;
    let frame;
    const loop = () => {
      tick();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [showDebug]);

  // ── Mount Pixi app once ───────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let rig = null;
    CharacterRig.create(canvas).then((r) => {
      rig = r;
      rigRef.current = r;
      r.setDebug(showPivots);       // honour current toggle at load time
    });

    return () => {
      rig?.destroy();
      rigRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync pivot dots when toggle changes ───────────────────────────────────
  useEffect(() => {
    rigRef.current?.setDebug(showPivots || isCalibrate);
  }, [showPivots, isCalibrate]);

  // ── Sync calibration target ───────────────────────────────────────────────
  useEffect(() => {
    if (isCalibrate) {
      rigRef.current?.setCalibration(calibrateBone, calibrateMode);
      rigRef.current?.setDebug(true);
    } else {
      rigRef.current?.setCalibration(null);
    }
  }, [isCalibrate, calibrateBone, calibrateMode]);

  useEffect(() => {
    rigRef.current?.setCalibrationMode(calibrateMode);
  }, [calibrateMode]);

  // ── Animation loop ────────────────────────────────────────────────────────
  useEffect(() => {
    let frameId;

    const loop = () => {
      const rig = rigRef.current;
      if (rig) {
        if (isManualRef.current) {
          // Manual: sliders drive applyPose() directly
          rig.applyPose(manualPoseRef.current);
        } else {
          // MediaPipe: estimate stable controls → rig.update()
          const keypoints = keypointsRef?.current;
          const videoSize  = videoSizeRef?.current;
          const { bodyState, debug } = estimatorRef.current.estimate(
            keypoints?.length && videoSize?.width ? keypoints : null,
            videoSize
          );
          estimateRef.current = { bodyState, debug };
          const controls = bodyStateToControls(bodyState);
          rig.update(controls);
        }
      }
      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [keypointsRef, videoSizeRef]);

  // ── Slider change handler ─────────────────────────────────────────────────
  const onSlider = (key, value) =>
    setManualPose(prev => ({ ...prev, [key]: value }));

  const resetPose = () => setManualPose(DEFAULT_POSE);

  const onCalibratePointerDown = (e) => {
    if (!isCalibrate || !rigRef.current) return;
    e.preventDefault();
    dragRef.current = { x: e.clientX, y: e.clientY };
    setIsDragging(true);
    canvasRef.current?.setPointerCapture(e.pointerId);
  };

  const onCalibratePointerMove = (e) => {
    if (!dragRef.current || !rigRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    if (dx !== 0 || dy !== 0) {
      rigRef.current.nudgeCalibration(dx, dy);
      dragRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const onCalibratePointerUp = (e) => {
    dragRef.current = null;
    setIsDragging(false);
    canvasRef.current?.releasePointerCapture(e.pointerId);
  };

  const logCalibration = () => rigRef.current?.logCalibrationConfig();
  const resetCalibration = () => rigRef.current?.resetCalibration();

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        display: 'inline-block',
      }}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          display: 'block',
          cursor: isCalibrate ? (isDragging ? 'grabbing' : 'grab') : undefined,
          touchAction: isCalibrate ? 'none' : undefined,
        }}
        onPointerDown={isCalibrate ? onCalibratePointerDown : undefined}
        onPointerMove={isCalibrate ? onCalibratePointerMove : undefined}
        onPointerUp={isCalibrate ? onCalibratePointerUp : undefined}
        onPointerLeave={isCalibrate ? onCalibratePointerUp : undefined}
      />

      {showDebug && (
        <DebugOverlay
          bodyState={estimateRef.current.bodyState}
          controls={bodyStateToControls(estimateRef.current.bodyState)}
          estimatorDebug={estimateRef.current.debug}
        />
      )}

      {/* ── Control panel overlay ── */}
      <div style={PANEL_STYLE}>
        {/* Mode + debug toggles */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
          <label style={LABEL_STYLE}>
            <input
              type="checkbox"
              checked={isManual}
              onChange={e => setIsManual(e.target.checked)}
            />
            Manual
          </label>
          <label style={LABEL_STYLE}>
            <input
              type="checkbox"
              checked={showPivots}
              disabled={isCalibrate}
              onChange={e => setShowPivots(e.target.checked)}
            />
            Pivots
          </label>
        </div>

        {/* Calibration — drag lower arm onto elbow joint, then log */}
        <div style={{ borderTop: '1px solid #334', paddingTop: 6, marginBottom: 6 }}>
          <label style={{ ...LABEL_STYLE, marginBottom: 4 }}>
            <input
              type="checkbox"
              checked={isCalibrate}
              onChange={e => setIsCalibrate(e.target.checked)}
            />
            Calibrate
          </label>

          {isCalibrate && (
            <div style={{ marginTop: 4 }}>
              <div style={{ marginBottom: 4 }}>
                <select
                  value={calibrateBone}
                  onChange={e => setCalibrateBone(e.target.value)}
                  style={{ width: '100%', background: '#223', color: '#dde', border: '1px solid #556' }}
                >
                  {CALIBRATE_BONES.map(({ key, label }) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div style={{ marginBottom: 4 }}>
                <select
                  value={calibrateMode}
                  onChange={e => setCalibrateMode(e.target.value)}
                  style={{ width: '100%', background: '#223', color: '#dde', border: '1px solid #556' }}
                >
                  {CALIBRATE_MODES.map(({ key, label }) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div style={{ fontSize: 10, color: '#8aa', marginBottom: 4, lineHeight: 1.4 }}>
                Drag on the character. Pink dot = elbow pivot.
                Use Anchor to slide the PNG; Position to move the joint.
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  onClick={logCalibration}
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
                  onClick={resetCalibration}
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
            </div>
          )}
        </div>

        {/* Sliders — only in manual mode, hidden while calibrating */}
        {isManual && !isCalibrate && (
          <div>
            {SLIDER_DEFS.map(({ key, label, min, max, step }) => (
              <div key={key} style={{ marginBottom: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{label}</span>
                  <span style={{ color: '#8ff' }}>{(manualPose[key] ?? 0).toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={manualPose[key] ?? 0}
                  style={{ width: '100%', accentColor: '#55f' }}
                  onChange={e => onSlider(key, parseFloat(e.target.value))}
                />
              </div>
            ))}
            <button
              onClick={resetPose}
              style={{
                width: '100%', marginTop: 2,
                padding: '3px 0', cursor: 'pointer',
                background: '#334', color: '#aae',
                border: '1px solid #556', borderRadius: 3,
              }}
            >
              Reset
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

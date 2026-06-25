const S = {
  panel: {
    position: 'absolute',
    top: 8,
    right: 8,
    background: 'rgba(10,10,20,0.82)',
    color: '#e2e8f0',
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 1.55,
    padding: '8px 10px',
    borderRadius: 6,
    pointerEvents: 'none',
    userSelect: 'none',
    minWidth: 200,
    zIndex: 10,
  },
  section: { color: '#94a3b8', marginTop: 6, marginBottom: 2 },
  row: { display: 'flex', justifyContent: 'space-between', gap: 12 },
  label: { color: '#94a3b8' },
  val: { color: '#f8fafc' },
  bar: {
    display: 'inline-block',
    background: '#6d28d9',
    height: 6,
    borderRadius: 3,
    verticalAlign: 'middle',
    marginLeft: 4,
  },
};

function fmt(v) {
  if (v == null) return '—';
  return v.toFixed(2);
}

function Row({ label, value, bar = false }) {
  return (
    <div style={S.row}>
      <span style={S.label}>{label}</span>
      <span style={S.val}>
        {fmt(value)}
        {bar && value != null && (
          <span
            style={{ ...S.bar, width: Math.round(Math.max(0, Math.min(1, value)) * 48) }}
          />
        )}
      </span>
    </div>
  );
}

function fmtConf(c) {
  if (!c) return '—';
  return `S${(c.shoulder ?? 0).toFixed(2)} E${(c.elbow ?? 0).toFixed(2)} W${(c.wrist ?? 0).toFixed(2)}`;
}

export default function DebugOverlay({ bodyState, controls, estimatorDebug }) {
  if (!bodyState && !controls && !estimatorDebug) return null;

  return (
    <div style={S.panel}>
      <div style={{ fontWeight: 'bold', marginBottom: 4 }}>Debug</div>

      {estimatorDebug && (
        <>
          <div style={S.section}>Estimator</div>
          <Row label="raw leftArmAngle"      value={estimatorDebug.rawLeftArmAngle} />
          <Row label="smoothed leftArmAngle" value={estimatorDebug.smoothedLeftArmAngle} />
          <Row label="raw torsoLean"         value={estimatorDebug.rawTorsoLean} />
          <Row label="smoothed torsoLean"    value={estimatorDebug.smoothedTorsoLean} />
          <div style={S.row}>
            <span style={S.label}>L conf</span>
            <span style={S.val}>{fmtConf(estimatorDebug.leftConfidence)}</span>
          </div>
          <div style={S.row}>
            <span style={S.label}>R conf</span>
            <span style={S.val}>{fmtConf(estimatorDebug.rightConfidence)}</span>
          </div>
        </>
      )}

      <div style={S.section}>BodyState</div>
      <Row label="confidence"    value={bodyState?.confidence}    bar />
      <Row label="motionEnergy"  value={bodyState?.motionEnergy}  bar />
      <Row label="headTilt"      value={bodyState?.headTilt} />
      <Row label="torsoLean"     value={bodyState?.torsoLean} />
      <Row label="leftArmRaise"  value={bodyState?.leftArmRaise}  bar />
      <Row label="rightArmRaise" value={bodyState?.rightArmRaise} bar />
      <Row label="scale"         value={bodyState?.scale} />

      <div style={{ ...S.section, marginTop: 10 }}>CharacterControls</div>
      <Row label="headTilt"      value={controls?.headTilt} />
      <Row label="torsoLean"     value={controls?.torsoLean} />
      <Row label="leftArmRaise"  value={controls?.leftArmRaise}  bar />
      <Row label="rightArmRaise" value={controls?.rightArmRaise} bar />
      <Row label="leftArmReach"  value={controls?.leftArmReach}  bar />
      <Row label="rightArmReach" value={controls?.rightArmReach} bar />
      <Row label="bodyBounce"    value={controls?.bodyBounce}    bar />
      <Row label="auraIntensity" value={controls?.auraIntensity} bar />
    </div>
  );
}

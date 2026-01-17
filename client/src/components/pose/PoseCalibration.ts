export type Point = { x: number; y: number; z?: number };
export type Baseline = { angleDeg: number; leftY: number; rightY: number }; // neutral reference
type Sample = { angle: number; leftY: number; rightY: number };

export type CalibrationState = {
  buf: Sample[]; // buffer of samples
  baseline: Baseline | null; // computed baseline
  calibrating: boolean;
  startedAt: number | null;
  extra: Record<string, Record<number, number | null>>;
};

// ---- Helpers ----
const MIN_SAMPLES = 20; // needs ~45 stable frames (~1.5s at 30 FPS)
const MAX_DANGLE = 7; // between-frame angle change must be < ~1° to count as “stable”.
const MAX_DY = 7; // shoulder y-change must be < 2 px to count as “stable”
const MAX_WAIT = 2500; // ms

const median = (arr: number[]) => {
  if (!arr.length) return NaN;
  const a = arr.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

export const getShoulderAngleDeg = (L: Point, R: Point) =>
  // angle (in degrees) of the line from left to right shoulder: 0° ≈ level
  // a positive angle means the right shoulder is lower on screen
  (Math.atan2(R.y - L.y, R.x - L.x) * 180) / Math.PI; 

// ---- API ----
export const createCalibrationState = (): CalibrationState => ({
  buf: [],
  baseline: null,
  calibrating: true,
  startedAt: null,
  extra: {} as Record<string, Record<number, number | null>>,
});

export const resetCalibration = (s: CalibrationState) => {
  s.buf = [];
  s.baseline = null;
  s.calibrating = true;
  s.startedAt = null;
  s.extra = {} as CalibrationState["extra"]; 
};

// feed one frame during calibration; sets baseline when ready
export const feedCalibration = (s: CalibrationState, L: Point | null, R: Point | null) => {
  if (!s.calibrating || !L || !R) return;

  if (s.startedAt == null) s.startedAt = performance.now();

  const angle = getShoulderAngleDeg(L, R);
  if (!Number.isFinite(angle)) return;

  const sample: Sample = { angle, leftY: L.y, rightY: R.y };
  const last = s.buf[s.buf.length - 1];

  const stable =
    !last ||
    (Math.abs(sample.angle - last.angle) < MAX_DANGLE &&
     Math.abs(sample.leftY - last.leftY) < MAX_DY &&
     Math.abs(sample.rightY - last.rightY) < MAX_DY);

  if (stable) s.buf.push(sample);

  const enoughStrict = s.buf.length >= MIN_SAMPLES;
  const elapsed = s.startedAt ? (performance.now() - s.startedAt) : 0;
  const enoughFallback = s.buf.length >= 10 && elapsed >= 2500;

  // finalise if success
  if (enoughStrict || enoughFallback) {
    let angle = median(s.buf.map(f => f.angle));

    // clamp baseline to max ±10°
    if (angle > 10) angle = 10;
    if (angle < -10) angle = -10;

    s.baseline = {
      angleDeg: angle,
      leftY:    median(s.buf.map(f => f.leftY)),
      rightY:   median(s.buf.map(f => f.rightY)),
    };
    s.calibrating = false;
    s.buf = [];
    s.startedAt = null;
    return true;
  }

  // retry calibration if it's too long and there is no baseline yet
  if (!s.baseline && elapsed >= MAX_WAIT) {
    // reset buffer + restart timer
    s.buf = [];
    s.startedAt = performance.now();
    console.warn("Calibration retrying...");
  }
};

export const isCalibrating = (s: CalibrationState) => s.calibrating;
export const getBaseline = (s: CalibrationState) => s.baseline;

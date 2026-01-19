export type Vec2 = { x: number; y: number };

/**
 * TonyPi (Hiwonder) mapping as provided by user:
 *
 * LEFT LEG:
 *  1 ankle_roll
 *  2 ankle_pitch
 *  3 knee
 *  4 hip_pitch
 *  5 hip_roll
 *
 * LEFT ARM:
 *  6 elbow
 *  7 shoulder_roll
 *  8 shoulder_pitch
 *
 * RIGHT LEG:
 *  9  ankle_roll
 *  10 ankle_pitch
 *  11 knee
 *  12 hip_pitch
 *  13 hip_roll
 *
 * RIGHT ARM:
 *  14 elbow
 *  15 shoulder_roll
 *  16 shoulder_pitch
 *
 * HEAD (not IDs): p1=head_pitch, p2=head_yaw
 */

export type TonyPiServoName =
  | "leftAnkleRoll"
  | "leftAnklePitch"
  | "leftKneePitch"
  | "leftHipPitch"
  | "leftHipRoll"
  | "leftElbowPitch"
  | "leftShoulderRoll"
  | "leftShoulderPitch"
  | "rightAnkleRoll"
  | "rightAnklePitch"
  | "rightKneePitch"
  | "rightHipPitch"
  | "rightHipRoll"
  | "rightElbowPitch"
  | "rightShoulderRoll"
  | "rightShoulderPitch";

/**
 * Servo name list in TonyPi ID order (index 0 => ID1, ..., index 15 => ID16).
 */
export const HUMANOID16_SERVO_NAMES: readonly TonyPiServoName[] = [
  // LEFT LEG (ID1..ID5)
  "leftAnkleRoll", // ID1
  "leftAnklePitch", // ID2
  "leftKneePitch", // ID3
  "leftHipPitch", // ID4
  "leftHipRoll", // ID5

  // LEFT ARM (ID6..ID8)
  "leftElbowPitch", // ID6
  "leftShoulderRoll", // ID7
  "leftShoulderPitch", // ID8

  // RIGHT LEG (ID9..ID13)
  "rightAnkleRoll", // ID9
  "rightAnklePitch", // ID10
  "rightKneePitch", // ID11
  "rightHipPitch", // ID12
  "rightHipRoll", // ID13

  // RIGHT ARM (ID14..ID16)
  "rightElbowPitch", // ID14
  "rightShoulderRoll", // ID15
  "rightShoulderPitch", // ID16
] as const;

export type Humanoid16ServoId = number; // 0..15 in the order above

export function tonyPiIdForIndex(i: number): number {
  return i + 1; // 1..16
}

export type ServoSpec = {
  // servo output units (bus: 0..1000, pwm: 500..2500)
  min: number;
  max: number;
  center: number;
  // mapping from human angle delta (deg) to servo delta (pulse units)
  scale: number;
  direction: 1 | -1;
};

export type Humanoid16Config = Record<TonyPiServoName, ServoSpec>;

export type HeadConfig = {
  p1_headPitch: ServoSpec;
  p2_headYaw: ServoSpec;
};

export type HumanAngles = Partial<
  Record<
    | "headYaw"
    | "headPitch"
    | "leftShoulderPitch"
    | "leftShoulderRoll"
    | "leftElbowFlex"
    | "rightShoulderPitch"
    | "rightShoulderRoll"
    | "rightElbowFlex"
    | "leftHipPitch"
    | "leftHipRoll"
    | "leftKneeFlex"
    | "leftAnklePitch"
    | "leftAnkleRoll"
    | "rightHipPitch"
    | "rightHipRoll"
    | "rightKneeFlex"
    | "rightAnklePitch"
    | "rightAnkleRoll",
    number
  >
>;

export type HumanBaseline = HumanAngles;

export type ServoFrame = {
  // bus servo pulses indexed 0..15 corresponding to HUMANOID16_SERVO_NAMES
  pulses: number[];
  head?: { p1: number; p2: number };
  human: HumanAngles;
};

export type Landmark2D = { x: number; y: number; visibility?: number };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
const norm = (v: Vec2) => Math.hypot(v.x, v.y);

const angleBetweenDeg = (a: Vec2, b: Vec2) => {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return NaN;
  const c = clamp(dot(a, b) / (na * nb), -1, 1);
  return (Math.acos(c) * 180) / Math.PI; // 0..180
};

const signedAngleDeg = (from: Vec2, to: Vec2) => {
  const na = norm(from);
  const nb = norm(to);
  if (na === 0 || nb === 0) return NaN;
  const a = { x: from.x / na, y: from.y / na };
  const b = { x: to.x / nb, y: to.y / nb };
  return (Math.atan2(cross(a, b), dot(a, b)) * 180) / Math.PI; // -180..180
};

const angleAtDeg = (a: Vec2, b: Vec2, c: Vec2) => {
  // angle ABC
  return angleBetweenDeg(sub(a, b), sub(c, b));
};

const pick = (
  lms: Landmark2D[],
  idx: number,
  minVis = 0.4
): Vec2 | null => {
  const lm = lms[idx];
  if (!lm) return null;
  if (lm.visibility != null && lm.visibility < minVis) return null;
  return { x: lm.x, y: lm.y };
};

const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

const DEFAULT_PULSE_SCALE = 4.0; // pulse units per human degree (conservative)
const BUS_PULSE_MIN = 300;
const BUS_PULSE_MAX = 700;
const BUS_PULSE_CENTER = 500;

export const defaultHumanoid16Config = (): Humanoid16Config => ({
  // Note: ankle roll is not reliably inferable from 2D pose; keep it near center by default.
  leftAnkleRoll: { min: BUS_PULSE_MIN, max: BUS_PULSE_MAX, center: 610, scale: 1.2, direction: 1 },
  leftAnklePitch: { min: BUS_PULSE_MIN, max: BUS_PULSE_MAX, center: BUS_PULSE_CENTER, scale: DEFAULT_PULSE_SCALE, direction: 1 },
  leftKneePitch: { min: BUS_PULSE_MIN, max: BUS_PULSE_MAX, center: BUS_PULSE_CENTER, scale: DEFAULT_PULSE_SCALE, direction: -1 },
  leftHipPitch: { min: BUS_PULSE_MIN, max: BUS_PULSE_MAX, center: 500, scale: DEFAULT_PULSE_SCALE, direction: 1 },
  leftHipRoll: { min: BUS_PULSE_MIN, max: BUS_PULSE_MAX, center: 400, scale: DEFAULT_PULSE_SCALE, direction: 1 },

  leftElbowPitch: { min: BUS_PULSE_MIN, max: BUS_PULSE_MAX, center: 575, scale: DEFAULT_PULSE_SCALE, direction: -1 },
  leftShoulderRoll: { min: BUS_PULSE_MIN, max: BUS_PULSE_MAX, center: 725, scale: DEFAULT_PULSE_SCALE, direction: 1 },
  leftShoulderPitch: { min: BUS_PULSE_MIN, max: BUS_PULSE_MAX, center: 800, scale: DEFAULT_PULSE_SCALE, direction: 1 },

  rightAnkleRoll: { min: BUS_PULSE_MIN, max: BUS_PULSE_MAX, center: 390, scale: 1.2, direction: 1 },
  rightAnklePitch: { min: BUS_PULSE_MIN, max: BUS_PULSE_MAX, center: BUS_PULSE_CENTER, scale: DEFAULT_PULSE_SCALE, direction: 1 },
  rightKneePitch: { min: BUS_PULSE_MIN, max: BUS_PULSE_MAX, center: BUS_PULSE_CENTER, scale: DEFAULT_PULSE_SCALE, direction: -1 },
  rightHipPitch: { min: BUS_PULSE_MIN, max: BUS_PULSE_MAX, center: 500, scale: DEFAULT_PULSE_SCALE, direction: 1 },
  rightHipRoll: { min: BUS_PULSE_MIN, max: BUS_PULSE_MAX, center: 600, scale: DEFAULT_PULSE_SCALE, direction: -1 },

  rightElbowPitch: { min: BUS_PULSE_MIN, max: BUS_PULSE_MAX, center: 425, scale: DEFAULT_PULSE_SCALE, direction: 1 },
  rightShoulderRoll: { min: BUS_PULSE_MIN, max: BUS_PULSE_MAX, center: 275, scale: DEFAULT_PULSE_SCALE, direction: -1 },
  rightShoulderPitch: { min: BUS_PULSE_MIN, max: BUS_PULSE_MAX, center: 200, scale: DEFAULT_PULSE_SCALE, direction: 1 },
});

export const defaultTonyPiHeadConfig = (): HeadConfig => ({
  // User-provided: p1=head_pitch, p2=head_yaw (PWM microseconds)
  p1_headPitch: { min: 500, max: 2500, center: 500, scale: 11.1, direction: 1 },
  p2_headYaw: { min: 500, max: 2500, center: 500, scale: 11.1, direction: 1 },
});

export function estimateHumanAngles2D(lms: Landmark2D[]): HumanAngles {
  // MediaPipe Pose indices used below:
  // 0 nose, 7 leftEar, 8 rightEar
  // 11 leftShoulder, 12 rightShoulder
  // 13 leftElbow, 14 rightElbow
  // 15 leftWrist, 16 rightWrist
  // 23 leftHip, 24 rightHip
  // 25 leftKnee, 26 rightKnee
  // 27 leftAnkle, 28 rightAnkle
  // 31 leftFootIndex, 32 rightFootIndex
  const nose = pick(lms, 0);
  const lEar = pick(lms, 7);
  const rEar = pick(lms, 8);

  const lSh = pick(lms, 11);
  const rSh = pick(lms, 12);
  const lEl = pick(lms, 13);
  const rEl = pick(lms, 14);
  const lWr = pick(lms, 15);
  const rWr = pick(lms, 16);

  const lHp = pick(lms, 23);
  const rHp = pick(lms, 24);
  const lKn = pick(lms, 25);
  const rKn = pick(lms, 26);
  const lAn = pick(lms, 27);
  const rAn = pick(lms, 28);
  const lFt = pick(lms, 31);
  const rFt = pick(lms, 32);

  const out: HumanAngles = {};
  const up: Vec2 = { x: 0, y: -1 };
  const right: Vec2 = { x: 1, y: 0 };

  // Head yaw: ear-to-ear line vs horizontal (approx)
  if (lEar && rEar) {
    const earLine = sub(rEar, lEar);
    out.headYaw = signedAngleDeg(right, earLine); // -180..180
  }
  // Head pitch: nose relative to shoulder mid (approx)
  if (nose && lSh && rSh) {
    const shMid = mid(lSh, rSh);
    const v = sub(nose, shMid);
    out.headPitch = signedAngleDeg(up, v);
  }

  // Shoulders: upper arm direction relative to up/right.
  // Pitch: arm vs vertical (up), Roll: arm vs horizontal (right)
  if (lSh && lEl) {
    const arm = sub(lEl, lSh);
    out.leftShoulderPitch = signedAngleDeg(up, arm);
    out.leftShoulderRoll = signedAngleDeg(right, arm);
  }
  if (rSh && rEl) {
    const arm = sub(rEl, rSh);
    out.rightShoulderPitch = signedAngleDeg(up, arm);
    out.rightShoulderRoll = signedAngleDeg(right, arm);
  }

  // Elbows: flexion (0..180), convert to "bend amount" around ~90 neutral
  if (lSh && lEl && lWr) out.leftElbowFlex = angleAtDeg(lSh, lEl, lWr);
  if (rSh && rEl && rWr) out.rightElbowFlex = angleAtDeg(rSh, rEl, rWr);

  // Hips: thigh direction
  if (lHp && lKn) {
    const thigh = sub(lKn, lHp);
    out.leftHipPitch = signedAngleDeg(up, thigh);
    out.leftHipRoll = signedAngleDeg(right, thigh);
  }
  if (rHp && rKn) {
    const thigh = sub(rKn, rHp);
    out.rightHipPitch = signedAngleDeg(up, thigh);
    out.rightHipRoll = signedAngleDeg(right, thigh);
  }

  // Knees: flexion 0..180
  if (lHp && lKn && lAn) out.leftKneeFlex = angleAtDeg(lHp, lKn, lAn);
  if (rHp && rKn && rAn) out.rightKneeFlex = angleAtDeg(rHp, rKn, rAn);

  // Ankles: foot pitch (ankle->foot index vs up)
  if (lAn && lFt) {
    const foot = sub(lFt, lAn);
    out.leftAnklePitch = signedAngleDeg(up, foot);
    out.leftAnkleRoll = signedAngleDeg(right, foot);
  }
  if (rAn && rFt) {
    const foot = sub(rFt, rAn);
    out.rightAnklePitch = signedAngleDeg(up, foot);
    out.rightAnkleRoll = signedAngleDeg(right, foot);
  }

  return out;
}

function mapOne(
  cfg: ServoSpec,
  humanAngle: number | undefined,
  baselineAngle: number | undefined
): number {
  const ha = humanAngle;
  if (ha == null || !Number.isFinite(ha)) return cfg.center;
  const base = baselineAngle;
  const delta = base != null && Number.isFinite(base) ? ha - base : ha;
  const servo = cfg.center + cfg.direction * cfg.scale * delta;
  return clamp(servo, cfg.min, cfg.max);
}

export function poseToHumanoid16Frame(
  lms: Landmark2D[],
  cfg: Humanoid16Config,
  baseline?: HumanBaseline,
  headCfg?: HeadConfig
): ServoFrame {
  const human = estimateHumanAngles2D(lms);
  const base = baseline ?? {};

  const pulses = HUMANOID16_SERVO_NAMES.map((name) => {
    const spec = cfg[name];
    switch (name) {
      case "leftElbowPitch":
        return mapOne(spec, human.leftElbowFlex, base.leftElbowFlex);
      case "rightElbowPitch":
        return mapOne(spec, human.rightElbowFlex, base.rightElbowFlex);
      case "leftKneePitch":
        return mapOne(spec, human.leftKneeFlex, base.leftKneeFlex);
      case "rightKneePitch":
        return mapOne(spec, human.rightKneeFlex, base.rightKneeFlex);
      default:
        // servo name keys match human angle keys for the rest
        return mapOne(
          spec,
          (human as Record<string, number | undefined>)[name],
          (base as Record<string, number | undefined>)[name]
        );
    }
  });

  let head: ServoFrame["head"] | undefined;
  if (headCfg) {
    head = {
      p1: mapOne(
        headCfg.p1_headPitch,
        human.headPitch,
        base.headPitch
      ),
      p2: mapOne(headCfg.p2_headYaw, human.headYaw, base.headYaw),
    };
  }

  return { pulses, head, human };
}

export function smoothServoPulses(
  prev: number[] | null,
  next: number[],
  alpha: number
): number[] {
  const a = clamp(alpha, 0, 1);
  if (!prev || prev.length !== next.length) return next.slice();
  return next.map((v, i) => prev[i] + a * (v - prev[i]));
}


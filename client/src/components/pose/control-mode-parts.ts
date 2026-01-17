export const ALL_JOINTS = [
  "head", "trunk",
  "leftShoulder", "rightShoulder",
  "leftElbow", "rightElbow",
  "leftWrist", "rightWrist",
  "leftPalm", "rightPalm",
  "leftHip", "rightHip",
  "leftKnee", "rightKnee",
  "leftAnkle", "rightAnkle",
  "leftHeel", "rightHeel",
  "leftFoot", "rightFoot",
  // "leftLeg", "rightLeg"
] as const;

export type Joint = typeof ALL_JOINTS[number];

export type ControlMode =
  | "shoulders" | "elbows" | "wrists" | "palms"
  | "hips" | "knees" | "ankles" | "heels" | "feet"
  | Joint;

// Pretty labels for settings dropdowns
export const ControlModeLabels: Record<ControlMode, string> = {
  palms: "Palms (both)",
  leftPalm: "Left Palm",
  rightPalm: "Right Palm",
  elbows: "Elbows (both)",
  leftElbow: "Left Elbow",
  rightElbow: "Right Elbow",
  head: "Head",
  shoulders: "Shoulders (both)",
  wrists: "Wrists (both)",
  hips: "Hips (both)",
  knees: "Knees (both)",
  ankles: "Ankles (both)",
  heels: "Heels (both)",
  feet: "Feet (both)",
  trunk: "Trunk",
  leftShoulder: "Left Shoulder",
  rightShoulder: "Right Shoulder",
  leftWrist: "Left Wrist",
  rightWrist: "Right Wrist",
  leftHip: "Left Hip",
  rightHip: "Right Hip",
  leftKnee: "Left Knee",
  rightKnee: "Right Knee",
  leftAnkle: "Left Ankle",
  rightAnkle: "Right Ankle",
  leftHeel: "Left Heel",
  rightHeel: "Right Heel",
  leftFoot: "Left Foot",
  rightFoot: "Right Foot",
} as const;

// Return the relevant part keys for a given control mode
export function getActiveParts(mode: ControlMode): Joint[] {
  if (mode === "shoulders") return ["leftShoulder", "rightShoulder"];
  if (mode === "elbows")    return ["leftElbow", "rightElbow"];
  if (mode === "wrists")    return ["leftWrist", "rightWrist"];
  if (mode === "palms")     return ["leftPalm", "rightPalm"];
  if (mode === "hips")      return ["leftHip", "rightHip"];
  if (mode === "knees")     return ["leftKnee", "rightKnee"];
  if (mode === "ankles")    return ["leftAnkle", "rightAnkle"];
  if (mode === "heels")     return ["leftHeel", "rightHeel"];
  if (mode === "feet")      return ["leftFoot", "rightFoot"];
  return [mode]; // head, leftPalm, rightPalm, leftElbow, rightElbow
}

export type LandmarkDef = { indices: number[]; min_vis: number };

export const LANDMARKS: Record<Joint, LandmarkDef> = {
  // head/upper
  head: { indices: [0, 2, 5, 9, 10], min_vis: 0.7 }, // [0],
  trunk: { indices: [11, 12, 23, 24], min_vis: 0.7 },
  // hands
  leftShoulder: { indices: [11], min_vis: 0.5 },
  rightShoulder: { indices: [12], min_vis: 0.5 },
  leftElbow: { indices: [13], min_vis: 0.25 },
  rightElbow: { indices: [14], min_vis: 0.25 },
  leftWrist: { indices: [15], min_vis: 0.5 },
  rightWrist: { indices: [16], min_vis: 0.5 },
  // palm
  leftPalm: { indices: [17, 19], min_vis: 0.5 }, //[15, 17, 19, 21],
  rightPalm: { indices: [18, 20], min_vis: 0.5 }, //[16, 18, 20, 22],
  // lower body
  leftHip: { indices: [23], min_vis: 0.5 },
  rightHip: { indices: [24], min_vis: 0.5 },
  leftKnee: { indices: [25], min_vis: 0.5 },
  rightKnee: { indices: [26], min_vis: 0.5 },
  leftAnkle: { indices: [27], min_vis: 0.5 },
  rightAnkle: { indices: [28], min_vis: 0.5 },
  leftHeel: { indices: [29], min_vis: 0.5 },
  rightHeel: { indices: [30], min_vis: 0.5 },
  leftFoot: { indices: [31], min_vis: 0.5 },
  rightFoot: { indices: [32], min_vis: 0.5 },
  // legs
  // leftLeg:        { indices: [27, 29, 31], min_vis: 0.5 },  
  // rightLeg:       { indices: [28, 30, 32], min_vis: 0.5 },
};

export interface ControlProfileDef {
  emoji: string;
  size: number;
  requiresFullBody?: boolean;
  colours: string[];
};

export const ControlProfile: Record<Joint, ControlProfileDef> = {
  // head/upper
  head: {
    emoji: "☺️",
    size: 100,
    requiresFullBody: false,
    colours: ["#FE6100", "#009E73", "#CC79A7", "#F0E442", "#FF0500"],
  }, // ☺️ or ☺
  trunk: {
    emoji: "",
    size: 50,
    requiresFullBody: false,
    colours: ["#FE6100", "#009E73", "#CC79A7", "#F0E442", "#FF0500"],
  },
  // hands
  leftShoulder: {
    emoji: "",
    size: 70,
    requiresFullBody: false,
    colours: ["#FE6100", "#9700C5", "#CC79A7", "#F0E442", "#FF0500"],
  },
  rightShoulder: {
    emoji: "",
    size: 70,
    requiresFullBody: false,
    colours: ["#FFB000", "#009E73", "#56B4E9", "#A2EACC", "#FFFFFF"],
  },
  leftElbow: {
    emoji: "",
    size: 75,
    requiresFullBody: false,
    colours: ["#FE6100", "#9700C5", "#CC79A7", "#F0E442", "#FF0500"],
  },
  rightElbow: {
    emoji: "",
    size: 75,
    requiresFullBody: false,
    colours: ["#FFB000", "#009E73", "#56B4E9", "#A2EACC", "#FFFFFF"],
  },
  leftWrist: {
    emoji: "",
    size: 70,
    requiresFullBody: false,
    colours: ["#FE6100", "#9700C5", "#CC79A7", "#F0E442", "#FF0500"],
  },
  rightWrist: {
    emoji: "",
    size: 70,
    requiresFullBody: false,
    colours: ["#FFB000", "#009E73", "#56B4E9", "#A2EACC", "#FFFFFF"],
  },
  // palm
  leftPalm: {
    emoji: "✋🏻",
    size: 70,
    requiresFullBody: false,
    colours: ["#FE6100", "#9700C5", "#CC79A7", "#F0E442", "#FF0500"],
  },
  rightPalm: {
    emoji: "🤚🏻",
    size: 70,
    requiresFullBody: false,
    colours: ["#FFB000", "#009E73", "#56B4E9", "#A2EACC", "#FFFFFF"],
  },
  // lower body
  leftHip: {
    emoji: "",
    size: 70,
    requiresFullBody: true,
    colours: ["#FE6100", "#9700C5", "#CC79A7", "#F0E442", "#FF0500"],
  },
  rightHip: {
    emoji: "",
    size: 70,
    requiresFullBody: true,
    colours: ["#FFB000", "#009E73", "#56B4E9", "#A2EACC", "#FFFFFF"],
  },
  leftKnee: {
    emoji: "",
    size: 70,
    requiresFullBody: true,
    colours: ["#FE6100", "#9700C5", "#CC79A7", "#F0E442", "#FF0500"],
  },
  rightKnee: {
    emoji: "",
    size: 70,
    requiresFullBody: true,
    colours: ["#FFB000", "#009E73", "#56B4E9", "#A2EACC", "#FFFFFF"],
  },
  leftAnkle: {
    emoji: "",
    size: 70,
    requiresFullBody: true,
    colours: ["#FE6100", "#9700C5", "#CC79A7", "#F0E442", "#FF0500"],
  },
  rightAnkle: {
    emoji: "",
    size: 70,
    requiresFullBody: true,
    colours: ["#FFB000", "#009E73", "#56B4E9", "#A2EACC", "#FFFFFF"],
  },
  leftHeel: {
    emoji: "",
    size: 70,
    requiresFullBody: true,
    colours: ["#FE6100", "#9700C5", "#CC79A7", "#F0E442", "#FF0500"],
  },
  rightHeel: {
    emoji: "",
    size: 70,
    requiresFullBody: true,
    colours: ["#FFB000", "#009E73", "#56B4E9", "#A2EACC", "#FFFFFF"],
  },
  leftFoot: {
    emoji: "",
    size: 60,
    requiresFullBody: true,
    colours: ["#FE6100", "#9700C5", "#CC79A7", "#F0E442", "#FF0500"],
  },
  rightFoot: {
    emoji: "",
    size: 60,
    requiresFullBody: true,
    colours: ["#FFB000", "#009E73", "#56B4E9", "#A2EACC", "#FFFFFF"],
  },
};

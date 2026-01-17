"use client";

import { createContext, useContext, useMemo } from "react";
import {
  type Joint,
  type ControlMode,
  getActiveParts,
  ALL_JOINTS,
} from "@/components/pose/control-mode-parts";
import { useSettings } from "@/components/settings/SettingsContext";
import { toCSV } from "@/utils/exportToCSV";
import { idb } from "@/lib/idb-sessions";

// ----- Types -----
type JointMap = Partial<Record<Joint, PosePoint | null>>;

export interface HitEvent {
  jointName: Joint;
  pixelX: number;
  pixelY: number;
  level: number;
  scoreBeforeHit: number;
  objectId?: string;
}

// Pose types
export interface PosePoint {
  x: number;
  y: number;
  z?: number;
}

export type PoseData = Partial<Record<Joint, PosePoint | null>> & {
  id: number;
  // any extra per-frame metrics here:
  leftElbowAngleDeg?: number | null;
  rightElbowAngleDeg?: number | null;
  leftElbowAngle3D?: number | null;
  rightElbowAngle3D?: number | null;
  trunkTiltDeg?: number | null;
  compensating?: boolean;
};

// Session storage
export interface Frame {
  // absoluteTimestamp: string; // ISO time
  elapsedMs: number; // since session start
  poses: PoseData[];
  hit?: {
    // present only if this frame contained a hit
    timestamp: number; // same as elapsedMs at moment of save
    jointName: HitEvent["jointName"];
    pixelX: number;
    pixelY: number;
    // asteroidId?: string;
    level: number;
    scoreBeforeHit: number;
  };
}

export interface SessionMeta {
  player: string;
  game: string;
  sessionDate: string; // YYYY-MM-DD
  startedAt: string; // ISO
  version: 1;
}

// ----- Pose Context -----
// Context and access hooks
const JOINTS: readonly Joint[] = ALL_JOINTS; // keeps iteration strongly typed
export const PoseContext = createContext<PoseData[]>([]);
export const useAllPoses = () => useContext(PoseContext);

// Get the first (center-most) player
export const useCenterPlayer = () => {
  const poses = useAllPoses();
  return poses.length > 0 ? poses[0] : null;
};

/**
 * Returns the first available active joint (based on controlMode) for a player.
 * Memoized for stability across renders when inputs don’t change.
 */
export const useActivePose = (playerIndex = 0) => {
  const poses = useAllPoses();
  const { controlMode } = useSettings();

  return useMemo(() => {
    const player = poses?.[playerIndex];
    if (!player) return null;

    const p = player as JointMap;
    const candidates = getActiveParts(controlMode as ControlMode);
    if (!candidates.length) return null;

    for (const j of candidates) {
      const pt = p[j];
      if (pt) return pt;
    }
    return p[candidates[0]] ?? null;
  }, [poses, playerIndex, controlMode]);
};

// ----- Session Recording -----
let sessionFrames: Frame[] = []; // plain array that accumulates frames
let sessionMeta: SessionMeta | null = null;
let perfStart = 0; // at session start to compute relative time

// Start a new session
export function beginSession(
  player: string,
  sessionDate: string,
  game: string
) {
  sessionFrames = []; // Clears any previous data
  sessionMeta = {
    player,
    game,
    sessionDate,
    startedAt: new Date().toISOString(),
    version: 1,
  };
  perfStart =
    typeof performance !== "undefined" ? performance.now() : Date.now();
}

// Backward-compatible - add a frame to current session
export function saveSessionFrame(
  input:
    | PoseData[]
    | { timestamp: number; poses: PoseData[]; ev?: Omit<HitEvent, "timestamp"> }
) {
  if (!sessionMeta) return;

  const now =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const poses = Array.isArray(input) ? input : input.poses;
  const elapsed = Array.isArray(input)
    ? now - perfStart
    : input.timestamp - perfStart;

  // Round + shape stability: avoid mutating original pose objects
  const safe = poses.map((p) => {
    const src = p as JointMap; // ✅ index with Joint keys
    const cloned: PoseData = { id: p.id };

    for (const j of JOINTS) {
      const val = src[j];
      cloned[j] = val
        ? {
            x: Math.round(val.x),
            y: Math.round(val.y),
            ...(val.z != null ? { z: Math.round(val.z) } : {}),
          }
        : null;
    }

    // keep any computed angles if present
    cloned.leftElbowAngleDeg = p.leftElbowAngleDeg ?? null;
    cloned.rightElbowAngleDeg = p.rightElbowAngleDeg ?? null;
    cloned.leftElbowAngle3D = p.leftElbowAngle3D ?? null;
    cloned.rightElbowAngle3D = p.rightElbowAngle3D ?? null;
    cloned.trunkTiltDeg = p.trunkTiltDeg ?? null;
    cloned.compensating = !!p.compensating;

    return cloned;
  });

  const hit =
    !Array.isArray(input) && input.ev
      ? { timestamp: elapsed, ...input.ev }
      : undefined;

  // Always store the frame
  sessionFrames.push({
    elapsedMs: elapsed,
    poses: safe,
    ...(hit ? { hit } : {}),
  });
}

export async function saveSessionIfAny(): Promise<string | null> {
  if (!sessionMeta || sessionFrames.length === 0) {
    resetSession();
    return null;
  }

  const baseKey = `poseSession_${sanitize(sessionMeta.player)}_${
    sessionMeta.sessionDate
  }_${sanitize(sessionMeta.game)}`;
  const key = `${baseKey}(${Date.now()})`;

  const session = {
    ...sessionMeta,
    // keep property name your exporter already expects:
    sessionData: sessionFrames,
  };

  try {
    await idb.set(key, session);
    console.log(`[SAVE] Session saved in IndexedDB as ${key}`);
    resetSession();
    return key;
  } catch (e) {
    // fall through to upload
    console.error("[SAVE] indexeddb write failed:", e);
  }

  try {
    const csv = toCSV(session);
    await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: `${key}.csv`, csv, json: session }),
    });
    resetSession();
    return key;
  } catch (err) {
    console.error("[SAVE] Upload failed:", err);
    resetSession();
    return null;
  }
}

// ----- Helpers -----
function sanitize(s: string) {
  // removes weird characters from names in the key
  return s.replace(/[^\w-]/g, "_");
}

function resetSession() {
  sessionMeta = null;
  sessionFrames = [];
  perfStart = 0;
}

import type { PoseData } from "@/hooks/usePose";
import type { Joint, ControlMode } from "@/components/pose/control-mode-parts";
import { getActiveParts } from "@/components/pose/control-mode-parts";

// for one player
export function getControlPointsForPose(
  pose: PoseData,
  mode: ControlMode
): { name: Joint; x: number; y: number }[] {
  const parts = getActiveParts(mode);
  const out: { name: Joint; x: number; y: number }[] = [];
  type IndexedPose = Partial<Record<Joint, { x: number; y: number } | null>>;
  const indexed = pose as IndexedPose;

  for (const name of parts) {
    const p = indexed[name];
    if (p) out.push({ name, x: p.x, y: p.y });
  }
  return out;
}

// for all players (handy in games with multi-player poseData)
export function getControlPointsForAll(
  poses: PoseData[] | undefined,
  mode: ControlMode
): Array<{
  poseIndex: number;
  pointIndex: number;
  name: Joint;
  x: number;
  y: number;
}> {
  if (!poses) return [];
  const rows: Array<{
    poseIndex: number;
    pointIndex: number;
    name: Joint;
    x: number;
    y: number;
  }> = [];
  poses.forEach((pose, poseIndex) => {
    const pts = getControlPointsForPose(pose, mode);
    pts.forEach((p, pointIndex) => rows.push({ poseIndex, pointIndex, ...p }));
  });
  return rows;
}

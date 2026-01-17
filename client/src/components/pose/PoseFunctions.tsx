"use client";

import React from "react";
import { PoseLandmarker, DrawingUtils } from "@mediapipe/tasks-vision";

// ----- Types -----
export type Landmark = {
  x: number;
  y: number;
  z: number;
  visibility?: number;
};

export interface MPMaskLike {
  width?: number;
  height?: number;
  getAsUint8Array?: () => Uint8Array | Uint8ClampedArray;
  getAsFloat32Array?: () => Float32Array;
  close?: () => void;
}

// ----- Compute the average landmark position -----
export const getAverageLandmarkPosition = (
  landmarks: Landmark[],
  indices: number[],
  minVisibility = 0.5, // The likelihood of the landmark being visible within the image
  opts: { flipX?: boolean } = {}
): Landmark | null => {
  const { flipX = false } = opts;

  const points = indices
    .map((i) => landmarks[i])
    .filter(
      (lm): lm is Landmark =>
        !!lm && (lm.visibility === undefined || lm.visibility > minVisibility)
    );

  // Handle single landmark case too
  if (points.length === 0) return null;

  if (points.length === 1) {
    const { x, y, z } = points[0];
    return {
      x: flipX ? 1 - x : x,
      y: y,
      z,
    };
  }

  const avg = points.reduce(
    (acc, lm) => {
      acc.x += flipX ? 1 - lm.x : lm.x;
      acc.y += lm.y;
      acc.z += lm.z;
      return acc;
    },
    { x: 0, y: 0, z: 0 }
  );

  return {
    x: avg.x / points.length,
    y: avg.y / points.length,
    z: avg.z / points.length,
  };
};

// ----- Helpers for Body Part Out of Frame -----
export function isOut(
  pt: { x: number; y: number } | null | undefined,
  cw: number,
  ch: number,
  m = 10
): boolean {
  return !pt || pt.x < m || pt.x > cw - m || pt.y < m || pt.y > ch - m;
}

export function coverRect(
  video: HTMLVideoElement | null | undefined,
  host: HTMLElement | null | undefined
): {
  cw: number;
  ch: number;
  dispW: number;
  dispH: number;
  offX: number;
  offY: number;
} {
  if (!video || !host) {
    return { cw: 0, ch: 0, dispW: 0, dispH: 0, offX: 0, offY: 0 };
  }

  const cw = host.clientWidth;
  const ch = host.clientHeight;

  const vw = video.videoWidth || cw;
  const vh = video.videoHeight || ch;

  // avoid NaN if widths are 0
  const s = Math.max(cw && vw ? cw / vw : 1, ch && vh ? ch / vh : 1);
  const dispW = vw * s;
  const dispH = vh * s;
  const offX = (cw - dispW) / 2;
  const offY = (ch - dispH) / 2;

  return { cw, ch, dispW, dispH, offX, offY };
}

// ----- Helpers for Silhouette -----
export function drawMaskToCanvas(
  mpMask: MPMaskLike,
  fallbackW: number,
  fallbackH: number,
  maskCanvas: HTMLCanvasElement,
  maskCtx: CanvasRenderingContext2D
): void {
  // MPMask exposes getAsUint8Array()/getAsFloat32Array() + width/height
  let u8: Uint8ClampedArray;

  if (typeof mpMask.getAsUint8Array === "function") {
    const raw = mpMask.getAsUint8Array();
    u8 = raw instanceof Uint8ClampedArray ? raw : new Uint8ClampedArray(raw);
  } else if (typeof mpMask.getAsFloat32Array === "function") {
    const f = mpMask.getAsFloat32Array();
    u8 = new Uint8ClampedArray(f.length);
    for (let i = 0; i < f.length; i++) u8[i] = Math.round(f[i] * 255);
  } else {
    // Fallback: nothing to draw
    return;
  }

  maskCanvas.width = mpMask.width || fallbackW;
  maskCanvas.height = mpMask.height || fallbackH;
  const img = maskCtx.createImageData(maskCanvas.width, maskCanvas.height);

  // alpha-only image
  for (let p = 0, i = 0; p < u8.length; p++, i += 4) img.data[i + 3] = u8[p];
  maskCtx.putImageData(img, 0, 0);
}

// ----- Marker rendering (emojis, elbows, head, etc.) -----
export const renderIcons = (
  container: HTMLElement | null,
  x: number,
  y: number,
  bgColor: "#000000ff",
  label = "",
  size = 48
) => {
  if (!container) return;

  const icon = document.createElement("div");
  Object.assign(icon.style, {
    position: "absolute",
    left: `${x}px`,
    top: `${y}px`,
    transform: "translate(-50%, -50%)",
    fontSize: `clamp(${size * 0.5}px, ${size * 0.1}cqmin, ${size * 1.5}px)`,
    backgroundColor: bgColor,
    borderRadius: "50%",
    width: "calc(1em + 0.26em)", // circle size tied to font-size (1em) with a little ring
    height: "calc(1em + 0.26em)", // circle size tied to font-size (1em) with a little ring
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
    zIndex: "98",
  } as CSSStyleDeclaration);
  icon.innerText = label;
  container.appendChild(icon);
};

// ----- Warning banner -----
export const showWarning = (
  markerContainerRef: React.RefObject<HTMLDivElement>,
  active: boolean,
  message = "⚠ Move back into frame",
  id = "pose-warning",
  styleOverrides: Partial<CSSStyleDeclaration> = {}
) => {
  let el = document.getElementById(id) as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    Object.assign(el.style, {
      position: "absolute",
      top: "15px", // default placement (can be overridden)
      left: "50%",
      transform: "translateX(-50%)",
      background: "rgba(0, 0, 0, 0.7)",
      color: "#fff",
      padding: "6px 10px",
      borderRadius: "6px",
      fontSize: "clamp(12.5px, 2vw, 20px)",
      zIndex: "98",
      pointerEvents: "none",
      display: "none",
    } as CSSStyleDeclaration);
    (markerContainerRef.current?.parentElement || document.body).appendChild(
      el
    );
  }
  Object.assign(el.style, styleOverrides);
  el.textContent = message;
  el.style.display = active ? "block" : "none";
};

// ----- Debug overlay -----
export const DebugOverlay = ({ numPlayers }: { numPlayers: number }) => (
  <div
    style={{
      position: "absolute",
      top: 40,
      left: 10,
      backgroundColor: "rgba(0,0,0,0.5)",
      color: "white",
      padding: "4px 8px",
      zIndex: 999,
      fontSize: "14px",
    }}
  >
    Debug mode: Tracking up to {numPlayers} player{numPlayers > 1 ? "s" : ""}
  </div>
);

// ----- Debug canvas drawing -----
export const drawDebugSkeleton = (
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[], //any[],
  leftPalm: { x: number; y: number; z: number } | null | undefined,
  rightPalm: { x: number; y: number; z: number } | null | undefined,
  personIndex: number,
  originalIndex: number,
  video: HTMLVideoElement,
  _sw: number,
  _sh: number,
  world?: Array<{ x: number; y: number; z: number }>
): void => {
  const drawingUtils = new DrawingUtils(ctx);

  // const flipped = landmarks.map((lm) => ({ ...lm, x: 1 - lm.x }));
  const flipped = landmarks.map((lm) => ({
    x: 1 - lm.x,
    y: lm.y,
    z: lm.z,
    visibility: lm.visibility ?? 0.5,
  }));
  const screenWidth = video.videoWidth;
  const screenHeight = video.videoHeight;

  // Skeleton
  drawingUtils.drawConnectors(flipped, PoseLandmarker.POSE_CONNECTIONS, {
    color: "#00FF00",
    lineWidth: 3,
  });

  drawingUtils.drawLandmarks(flipped, {
    color: "#FF0000",
    lineWidth: 2,
  });

  // Landmark index labels
  flipped.forEach((lm, i) => {
    const x = lm.x * screenWidth;
    const y = lm.y * screenHeight;
    ctx.font = "10px Arial";
    ctx.fillStyle = "cyan";
    ctx.fillText(i.toString(), x + 4, y + 4);

    // If world coordinates are available, show them under the index
    const w = world?.[i];
    if (
      w &&
      Number.isFinite(w.x) &&
      Number.isFinite(w.y) &&
      Number.isFinite(w.z)
    ) {
      ctx.fillStyle = "black";
      ctx.font = "15px Arial";
      ctx.fillText(
        `World (${w.x.toFixed(2)}, ${w.y.toFixed(2)}, ${w.z.toFixed(2)})`,
        x + 4,
        y + 16
      );
    }
  });

  // Left palm debug
  if (leftPalm) {
    const x = leftPalm.x;
    const y = leftPalm.y;
    const z = leftPalm.z;
    ctx.fillStyle = "blue";
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, 2 * Math.PI);
    ctx.fill();
    ctx.font = "bold 20px Arial";
    ctx.fillStyle = "black";
    ctx.fillText(
      `Left (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(2) ?? "?"})`,
      x + 10,
      y - 10
    );
  }

  // Right palm debug
  if (rightPalm) {
    const x = rightPalm.x;
    const y = rightPalm.y;
    const z = rightPalm.z;
    ctx.fillStyle = "yellow";
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, 2 * Math.PI);
    ctx.fill();
    ctx.font = "bold 20px Arial";
    ctx.fillStyle = "black";
    ctx.fillText(
      `Right (${x.toFixed(0)}, ${y.toFixed(0)}, ${z.toFixed(2) ?? "?"})`,
      x + 10,
      y - 10
    );
  }

  // Centre person index label
  if (flipped[0]) {
    const x =
      ((flipped[0].x + flipped[11].x + flipped[12].x) / 3) * screenWidth;
    const y =
      ((flipped[0].y + flipped[11].y + flipped[12].y) / 3) * screenHeight;
    ctx.font = "bold 16px Arial";
    ctx.fillStyle = "white";
    ctx.fillText(`Person ${personIndex} (was ${originalIndex})`, x, y);
  }
};

// ----- Reusable debug code -----
export const showDebugPanel = (
  rootRef: React.RefObject<HTMLDivElement>,
  id: string,
  lines: Array<string | number>,
  active: boolean,
  styleOverrides: Partial<CSSStyleDeclaration> = {}
) => {
  let el = document.getElementById(id) as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    Object.assign(el.style, {
      position: "absolute",
      left: "10px",
      bottom: "10px",
      background: "rgba(0,0,0,0.55)",
      color: "#0ff",
      padding: "6px 8px",
      borderRadius: "6px",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: "12px",
      lineHeight: "1.3",
      whiteSpace: "pre",
      zIndex: "1200",
      pointerEvents: "none",
      display: "none",
    } as CSSStyleDeclaration);
    (rootRef.current?.parentElement || document.body).appendChild(el);
  }
  Object.assign(el.style, styleOverrides);
  el.textContent = lines.join("\n");
  el.style.display = active ? "block" : "none";
};

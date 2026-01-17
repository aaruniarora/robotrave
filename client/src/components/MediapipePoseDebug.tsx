import { useEffect, useMemo, useRef, useState } from "react";
import Webcam from "react-webcam";
import {
  DrawingUtils,
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";

type Status = "idle" | "loading" | "running" | "error";
type SourceMode = "webcam" | "video";

export default function MediapipePoseDebug() {
  const webcamRef = useRef<Webcam | null>(null);
  const fileVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const [sourceMode, setSourceMode] = useState<SourceMode>("webcam");
  const [mirror, setMirror] = useState(true);

  // Public URL (served from client/public). Example: /videos/demo.mp4
  const [videoUrlInput, setVideoUrlInput] = useState("/videos/demo.mp4");
  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null);
  const [videoLoadError, setVideoLoadError] = useState<string | null>(null);

  const videoConstraints = useMemo(
    () => ({
      facingMode: "user" as const,
    }),
    []
  );

  useEffect(() => {
    let disposed = false;
    let rafId: number | null = null;
    let landmarker: PoseLandmarker | null = null;
    let lastProcessedTime = -1;

    const stop = () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = null;
      try {
        landmarker?.close?.();
      } catch {
        // ignore
      }
      landmarker = null;
    };

    const createLandmarker = async (): Promise<PoseLandmarker> => {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
      );

      const baseOptions = {
        modelAssetPath: "/models/pose_landmarker_full.task",
      } as const;

      // GPU is preferred, but fall back to CPU if unavailable.
      try {
        return await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { ...baseOptions, delegate: "GPU" },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.6,
          minPosePresenceConfidence: 0.6,
          minTrackingConfidence: 0.6,
        });
      } catch {
        return await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { ...baseOptions, delegate: "CPU" },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.6,
          minPosePresenceConfidence: 0.6,
          minTrackingConfidence: 0.6,
        });
      }
    };

    const getActiveVideoEl = (): HTMLVideoElement | null => {
      if (sourceMode === "webcam") return webcamRef.current?.video ?? null;
      return fileVideoRef.current;
    };

    const draw = (ctx: CanvasRenderingContext2D, res: PoseLandmarkerResult) => {
      const drawingUtils = new DrawingUtils(ctx);
      const poses = res.landmarks ?? [];

      for (const lm of poses) {
        drawingUtils.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, {
          color: "#FFFFFF",
          lineWidth: 4,
        });
        drawingUtils.drawLandmarks(lm, {
          color: "#00E5FF",
          lineWidth: 2,
        });
      }
    };

    const loop = async () => {
      if (disposed) return;

      const video = getActiveVideoEl();
      const canvas = canvasRef.current;
      if (!video || !canvas) {
        rafId = requestAnimationFrame(loop);
        return;
      }

      if (
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        video.videoWidth === 0 ||
        video.videoHeight === 0
      ) {
        rafId = requestAnimationFrame(loop);
        return;
      }

      // For file videos, avoid re-processing the exact same frame repeatedly.
      if (sourceMode === "video") {
        const t = video.currentTime;
        if (t === lastProcessedTime) {
          rafId = requestAnimationFrame(loop);
          return;
        }
        lastProcessedTime = t;
      }

      const w = video.videoWidth;
      const h = video.videoHeight;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;

      const ctx = canvas.getContext("2d");
      if (!ctx || !landmarker) {
        rafId = requestAnimationFrame(loop);
        return;
      }

      ctx.save();
      ctx.clearRect(0, 0, w, h);

      try {
        const res = landmarker.detectForVideo(video, performance.now());
        draw(ctx, res);
      } catch {
        // ignore transient frame errors
      } finally {
        ctx.restore();
      }

      rafId = requestAnimationFrame(loop);
    };

    const start = async () => {
      setStatus("loading");
      setError(null);

      try {
        landmarker = await createLandmarker();
        if (disposed) return;
        setStatus("running");
        rafId = requestAnimationFrame(loop);
      } catch (e) {
        if (disposed) return;
        setStatus("error");
        setError(e instanceof Error ? e.message : String(e));
        stop();
      }
    };

    start();
    return () => {
      disposed = true;
      stop();
    };
  }, [sourceMode]);

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "#0b0b0b",
      }}
    >
      {sourceMode === "webcam" ? (
        <Webcam
          ref={webcamRef}
          audio={false}
          videoConstraints={videoConstraints}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: mirror ? "scaleX(-1)" : undefined,
          }}
        />
      ) : (
        <video
          ref={fileVideoRef}
          src={activeVideoUrl ?? undefined}
          controls
          autoPlay
          loop
          muted
          playsInline
          onError={() => {
            setVideoLoadError(
              `Failed to load video at ${activeVideoUrl ?? "(none)"}`
            );
          }}
          onLoadedData={() => {
            setVideoLoadError(null);
          }}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: mirror ? "scaleX(-1)" : undefined,
          }}
        />
      )}

      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          transform: mirror ? "scaleX(-1)" : undefined, // match video
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 12,
          top: 12,
          padding: "6px 10px",
          borderRadius: 8,
          background: "rgba(0,0,0,0.55)",
          color: "#fff",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 12,
          lineHeight: 1.3,
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <strong style={{ fontWeight: 700 }}>Pose debug</strong>
          <span style={{ opacity: 0.85 }}>Status: {status}</span>
        </div>
        {error ? (
          <div style={{ color: "#ff9b9b", marginTop: 6 }}>Error: {error}</div>
        ) : null}
        {videoLoadError ? (
          <div style={{ color: "#ffcf8b", marginTop: 6 }}>
            Video: {videoLoadError}
          </div>
        ) : null}
        <div style={{ opacity: 0.85 }}>
          Model: <code>/models/pose_landmarker_full.task</code>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 62, opacity: 0.9 }}>Source</span>
            <select
              value={sourceMode}
              onChange={(e) => {
                const next = e.target.value as SourceMode;
                setSourceMode(next);
                // Default mirroring: webcam on, file video off (can be toggled).
                setMirror(next === "webcam");
              }}
            >
              <option value="webcam">Webcam</option>
              <option value="video">Public video URL</option>
            </select>
          </label>

          {sourceMode === "video" ? (
            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ width: 62, opacity: 0.9 }}>URL</span>
                <input
                  value={videoUrlInput}
                  onChange={(e) => setVideoUrlInput(e.target.value)}
                  placeholder="/videos/demo.mp4"
                  style={{ width: 260 }}
                />
                <button
                  onClick={() => {
                    setActiveVideoUrl(videoUrlInput.trim() || null);
                    setVideoLoadError(null);
                  }}
                >
                  Load
                </button>
              </label>

              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ width: 62, opacity: 0.9 }}>Local</span>
                <input
                  type="file"
                  accept="video/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    if (!f) return;
                    const url = URL.createObjectURL(f);
                    setActiveVideoUrl(url);
                    setVideoLoadError(null);
                  }}
                />
              </label>
            </div>
          ) : null}

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 62, opacity: 0.9 }}>Mirror</span>
            <input
              type="checkbox"
              checked={mirror}
              onChange={(e) => setMirror(e.target.checked)}
            />
          </label>
        </div>
      </div>
    </div>
  );
}


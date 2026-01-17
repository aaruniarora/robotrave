import { useEffect, useMemo, useRef, useState } from "react";
import Webcam from "react-webcam";
import {
  DrawingUtils,
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import {
  defaultHumanoid16Config,
  defaultTonyPiHeadConfig,
  HUMANOID16_SERVO_NAMES,
  poseToHumanoid16Frame,
  smoothServoDegrees,
  tonyPiIdForIndex,
  type HumanBaseline,
} from "../robot/humanoid16";

type Status = "idle" | "loading" | "running" | "error";
type SourceMode = "webcam" | "video";

const degreesToPulse = (deg: number) => {
  const clamped = Math.max(0, Math.min(180, deg));
  return Math.round((clamped / 180) * 1000);
};

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

  // --- Robot mapping + terminal output ---
  const [robotEnabled, setRobotEnabled] = useState(false);
  const [sendToRobot, setSendToRobot] = useState(false);
  const [wsUrl, setWsUrl] = useState("ws://192.168.0.104:8766");
  const [wsState, setWsState] = useState<
    "disconnected" | "connecting" | "open" | "error"
  >("disconnected");
  const wsRef = useRef<WebSocket | null>(null);

  const cfgRef = useRef(defaultHumanoid16Config());
  const headCfgRef = useRef(defaultTonyPiHeadConfig());
  const [baseline, setBaseline] = useState<HumanBaseline | null>(null);
  const [servoDegrees, setServoDegrees] = useState<number[] | null>(null);
  const [headOut, setHeadOut] = useState<{ p1: number; p2: number } | null>(
    null
  );
  const [humanDebug, setHumanDebug] = useState<Record<string, number> | null>(
    null
  );
  const [smoothing, setSmoothing] = useState(0.35); // EMA alpha
  const [terminalFps, setTerminalFps] = useState(10);

  const baselineRef = useRef<HumanBaseline | null>(null);
  const robotEnabledRef = useRef(false);
  const smoothingRef = useRef(0.35);
  const terminalFpsRef = useRef(10);
  const servoRef = useRef<number[] | null>(null);
  const lastTerminalSendAtRef = useRef(0);

  useEffect(() => {
    baselineRef.current = baseline;
  }, [baseline]);
  useEffect(() => {
    robotEnabledRef.current = robotEnabled;
  }, [robotEnabled]);
  useEffect(() => {
    smoothingRef.current = smoothing;
  }, [smoothing]);
  useEffect(() => {
    terminalFpsRef.current = terminalFps;
  }, [terminalFps]);
  useEffect(() => {
    servoRef.current = servoDegrees;
  }, [servoDegrees]);

  const sendToRobotRef = useRef(false);
  useEffect(() => {
    sendToRobotRef.current = sendToRobot && wsState === "open";
  }, [sendToRobot, wsState]);

  const connectWs = () => {
    if (wsRef.current || wsState === "connecting") return;
    setWsState("connecting");
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => setWsState("open");
      ws.onclose = () => {
        wsRef.current = null;
        setWsState("disconnected");
      };
      ws.onerror = () => {
        wsRef.current = null;
        setWsState("error");
      };
    } catch {
      wsRef.current = null;
      setWsState("error");
    }
  };

  const disconnectWs = () => {
    wsRef.current?.close();
    wsRef.current = null;
    setWsState("disconnected");
  };

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

        // --- Robot mapping: use the first detected person ---
        const first = res.landmarks?.[0];
        if (first?.length) {
          const frame = poseToHumanoid16Frame(
            first,
            cfgRef.current,
            baselineRef.current ?? undefined,
            headCfgRef.current
          );

          const next = frame.degrees;
          const smoothed = smoothServoDegrees(
            servoRef.current,
            next,
            smoothingRef.current
          );
          setServoDegrees(smoothed);
          setHeadOut(frame.head ?? null);

          // Keep a small human-angle debug snapshot
          const hd: Record<string, number> = {};
          for (const [k, v] of Object.entries(frame.human)) {
            if (v != null && Number.isFinite(v)) hd[k] = Number(v);
          }
          setHumanDebug(hd);

          // Dev server terminal output (no websocket): POST throttled frames to Vite middleware.
          if (robotEnabledRef.current) {
            const now = performance.now();
            const minMs = 1000 / Math.max(1, terminalFpsRef.current);
            if (now - lastTerminalSendAtRef.current >= minMs) {
              lastTerminalSendAtRef.current = now;
              const payload = {
                t: Date.now(),
                kind: "humanoid16",
                degrees: smoothed,
                head: frame.head ?? null,
              };

              // Always print locally to the Vite terminal (dev-only).
              void fetch("/__servo", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              }).catch(() => {});

              // Send to the robot over WebSocket (if connected).
              // Use TonyPi's native servo receiver format:
              // { type:"servos", servos: { "1": pulse, ..., "16": pulse } }
              if (sendToRobotRef.current && wsRef.current) {
                const servos: Record<string, number> = {};
                smoothed.forEach((deg, idx) => {
                  servos[String(idx + 1)] = degreesToPulse(deg);
                });
                wsRef.current.send(
                  JSON.stringify({
                    type: "servos",
                    servos,
                  })
                );
              }
            }
          }
        }
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
          width: 420,
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

        <div
          style={{
            marginTop: 12,
            borderTop: "1px solid rgba(255,255,255,0.12)",
            paddingTop: 10,
            display: "grid",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <strong style={{ fontWeight: 700 }}>Robot output</strong>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={robotEnabled}
                onChange={(e) => setRobotEnabled(e.target.checked)}
              />
              <span style={{ opacity: 0.9 }}>print to terminal</span>
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={sendToRobot}
                onChange={(e) => setSendToRobot(e.target.checked)}
              />
              <span style={{ opacity: 0.9 }}>send to robot</span>
            </label>
            <button
              onClick={() => {
                // Capture baseline from current human debug snapshot
                // (baseline is interpreted as "neutral pose" for delta mapping)
                setBaseline(
                  (humanDebug ?? null) as unknown as HumanBaseline | null
                );
              }}
              disabled={!humanDebug}
              title="Capture current pose as neutral baseline"
            >
              Calibrate neutral
            </button>
            <button onClick={() => setBaseline(null)} title="Clear baseline">
              Clear
            </button>
          </div>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 62, opacity: 0.9 }}>Smooth</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={smoothing}
              onChange={(e) => setSmoothing(Number(e.target.value))}
              style={{ width: 240 }}
            />
            <span style={{ opacity: 0.85 }}>{smoothing.toFixed(2)}</span>
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 62, opacity: 0.9 }}>FPS</span>
            <input
              type="range"
              min={1}
              max={30}
              step={1}
              value={terminalFps}
              onChange={(e) => setTerminalFps(Number(e.target.value))}
              style={{ width: 240 }}
            />
            <span style={{ opacity: 0.85 }}>{terminalFps}</span>
          </label>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ width: 62, opacity: 0.9 }}>Robot</span>
            <input
              value={wsUrl}
              onChange={(e) => setWsUrl(e.target.value)}
              style={{ width: 200 }}
              placeholder="ws://192.168.0.104:8766"
              disabled={wsState === "connecting" || wsState === "open"}
            />
            {wsState === "open" ? (
              <button onClick={disconnectWs}>Disconnect</button>
            ) : (
              <button onClick={connectWs} disabled={wsState === "connecting"}>
                {wsState === "connecting" ? "Connecting…" : "Connect"}
              </button>
            )}
            <span
              style={{
                opacity: 0.85,
                color:
                  wsState === "open"
                    ? "#6f6"
                    : wsState === "error"
                    ? "#f66"
                    : undefined,
              }}
            >
              {wsState}
            </span>
          </div>

          <div style={{ opacity: 0.85 }}>
            Servos:
            <div
              style={{
                marginTop: 6,
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: "4px 12px",
              }}
            >
              {HUMANOID16_SERVO_NAMES.map((name, i) => {
                const v = servoDegrees?.[i];
                return (
                  <div
                    key={`${tonyPiIdForIndex(i)}-${name}`}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: "2px 6px",
                      borderRadius: 6,
                      background: "rgba(255,255,255,0.06)",
                    }}
                  >
                    <code style={{ opacity: 0.95 }}>
                      ID{tonyPiIdForIndex(i)} {name}
                    </code>
                    <code style={{ opacity: 0.95 }}>
                      {v != null ? `${Math.round(v)}°` : "—"}
                    </code>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ opacity: 0.85 }}>
            Head (PWM):
            <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "2px 6px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.06)",
                }}
              >
                <code style={{ opacity: 0.95 }}>p1 head_pitch</code>
                <code style={{ opacity: 0.95 }}>
                  {headOut ? `${Math.round(headOut.p1)}°` : "—"}
                </code>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "2px 6px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.06)",
                }}
              >
                <code style={{ opacity: 0.95 }}>p2 head_yaw</code>
                <code style={{ opacity: 0.95 }}>
                  {headOut ? `${Math.round(headOut.p2)}°` : "—"}
                </code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


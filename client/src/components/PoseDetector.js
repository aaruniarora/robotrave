"use client";

import React, { useEffect, useRef } from "react";
import Webcam from "react-webcam";
import {
  FilesetResolver,
  PoseLandmarker,
  DrawingUtils,
} from "@mediapipe/tasks-vision";
import { useSettings } from "@/components/settings/SettingsContext";
import {
  DebugOverlay,
  renderIcons,
  showWarning,
  drawDebugSkeleton,
  showDebugPanel,
  getAverageLandmarkPosition,
  isOut,
  coverRect,
  drawMaskToCanvas,
} from "@/components/pose/PoseFunctions";
import {
  isCalibrating,
  getBaseline,
  feedCalibration,
  createCalibrationState,
} from "@/components/pose/PoseCalibration";
import { angleAt3D, angleAt } from "@/utils/analytics";
import {
  getActiveParts,
  LANDMARKS,
  ControlProfile,
} from "@/components/pose/control-mode-parts";

const DEBUG = false;
const useWebcam = true;

// ----- Main Body -----
const PoseDetector = ({ setPoseData, silhouette = false }) => {
  const settings = useSettings();

  const poseDataRef = useRef(null); // for sending to GameScreen
  const webcamRef = useRef(null); // Ref for video element (could be webcam or uploaded video)
  const canvasRef = useRef(null); // Ref for drawing canvas
  const markerContainerRef = useRef(null);
  const calib = useRef(createCalibrationState());
  const baselineShownRef = useRef(false);
  const readyRef = React.useRef(false); // calibration to send to GameScreen

  // ----- Calibrator -----
  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() === "c") {
        baselineShownRef.current = false;
        // reset your single calibration state
        calib.current = createCalibrationState();

        showWarning(
          markerContainerRef,
          true,
          "✅ Baseline Reset",
          "pose-baseline-reset",
          {
            right: "15px",
            bottom: "15px",
            left: "auto",
            top: "auto", //override default centered to move to bottom-right
          }
        );
        // Hide it again after 2s
        setTimeout(() => {
          showWarning(markerContainerRef, false, "", "pose-baseline-reset");
        }, 2000);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onReset = () => {
      calib.current = createCalibrationState();
      calib.current.ankleBaseY = [];
      baselineShownRef.current = false;
    };
    window.addEventListener("pose:resetCalibration", onReset);
    return () => window.removeEventListener("pose:resetCalibration", onReset);
  }, []);

  // ----- Pose Detection -----
  useEffect(() => {
    poseDataRef.current = setPoseData;
    let active = true; // Used to stop detection when component (user) unmounts
    let poseLandmarker; // Holds the Mediapipe pose detector instance
    let rafId = null;

    const init = async () => {
      // Load the Mediapipe WASM files (WebAssembly)
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
      );

      // Create pose detection instance with options
      poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "/models/pose_landmarker_full.task", // local file: 'lite', 'full', 'heavy'
          delegate: "GPU", // 'GPU' (faster), 'CPU'
        },

        // Settings
        runningMode: "VIDEO",
        numPoses: Math.min(Math.max(settings.numPlayers, 0), 5), // Detect up to 5 people max
        modelComplexity: 1, // REVIEW: 0 = lite, 1 = full, 2 = heavy
        minPoseDetectionConfidence: 0.7, // recommended ≥ 0.5
        minPosePresenceConfidence: 0.5, // recommended ≥ 0.5
        minTrackingConfidence: 0.6, // recommended ≥ 0.5
        outputSegmentationMasks: silhouette, // enable segmentation mask output
      });

      // Wait until the video element is ready
      await new Promise((resolve) => {
        const check = () => {
          const video = useWebcam
            ? webcamRef.current?.video
            : webcamRef.current; // Webcam component wraps its video element in .video
          if (video && video.readyState === 4) resolve();
          else requestAnimationFrame(check);
        };
        check();
      });

      detectionLoop();
    };

    const detectionLoop = async () => {
      // Drawing the canvas
      const ctx =
        silhouette && canvasRef.current
          ? canvasRef.current.getContext("2d")
          : null;
      const drawingUtils =
        silhouette && canvasRef.current ? new DrawingUtils(ctx) : null;

      // --- Silhouette scratch canvas for MPMask ---
      const maskCanvas = document.createElement("canvas");
      const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });

      // Run detection on every animation frame
      const loop = async () => {
        if (!active) return; // stop immediately if unmounted

        const video = useWebcam ? webcamRef.current?.video : webcamRef.current;
        const markerContainer = markerContainerRef.current;

        // only proceed when a real frame exists
        const hasData =
          video &&
          markerContainer &&
          video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.srcObject &&
          video.videoWidth > 0 &&
          video.videoHeight > 0;

        if (!hasData) {
          rafId = requestAnimationFrame(loop);
          return;
        }

        const {
          cw: screenWidth,
          ch: screenHeight,
          dispW,
          dispH,
          offX,
          offY,
        } = coverRect(video, markerContainer);

        // draw video frame to canvas DEBUG
        if (silhouette && ctx) {
          canvasRef.current.width = video.videoWidth;
          canvasRef.current.height = video.videoHeight;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, video.videoWidth, video.videoHeight);
        }

        let results;
        try {
          results = await poseLandmarker.detectForVideo(
            video,
            performance.now()
          );
        } catch (err) {
          // ignore ROI errors during shutdown / zero-sized frames
          rafId = requestAnimationFrame(loop);
          return;
        }

        // --- silhouette ---
        if (silhouette && ctx && results.segmentationMasks?.length) {
          const m = results.segmentationMasks[0]; // single person for now
          drawMaskToCanvas(
            m,
            video.videoWidth,
            video.videoHeight,
            maskCanvas,
            maskCtx
          );
          m.close && m.close(); // free resources

          ctx.save();
          ctx.scale(-1, 1);
          ctx.translate(-video.videoWidth, 0);
          ctx.drawImage(maskCanvas, 0, 0, video.videoWidth, video.videoHeight);
          if (false) {
            // 1) keep only your body (clip)
            ctx.globalCompositeOperation = "destination-in";
          } else {
            // 2) tint the silhouette
            ctx.globalCompositeOperation = "source-in";
            ctx.imageSmoothingEnabled = true; // crisper edge
            ctx.globalAlpha = 0.7; // alpha
            ctx.fillStyle = "rgba(0, 0, 0, 1)"; // tint
            ctx.fillRect(0, 0, video.videoWidth, video.videoHeight);
          }
          ctx.restore();
        }

        // --- Main loop ---
        if (results.landmarks?.length) {
          const allPoses = [];
          const centreIdx = [0, 11, 12];

          const sorted = results.landmarks
            .map((landmarks, originalIndex) => {
              // 1) center-x using head + shoulders 
              const cx =
                centreIdx.reduce((sum, i) => sum + landmarks[i].x, 0) /
                centreIdx.length;

              // 2) average depth (prefer worldLandmarks if available)
              const world = results.worldLandmarks?.[originalIndex];
              const depthVals =
                world ?? landmarks
                  ? centreIdx
                      .map((i) => (world ? world[i].z : landmarks[i].z))
                      .filter((z) => z != null && Number.isFinite(z))
                  : [];
              // NOTE: Mediapipe: more negative z is closer to camera.
              const avgZ = depthVals.length
                ? depthVals.reduce((a, b) => a + b, 0) / depthVals.length
                : Infinity;

              return {
                landmarks,
                originalIndex,
                centerDist: Math.abs(cx - 0.5),
                avgZ,
              };
            })
            .sort((a, b) => {
              // primary: most centered
              if (a.centerDist !== b.centerDist)
                return a.centerDist - b.centerDist;
              // secondary: closest to camera (more negative z)
              return a.avgZ - b.avgZ;
            })
            .slice(0, settings.numPlayers); // Only keep as many as selected no. of players

          sorted.forEach(({ landmarks, originalIndex }, personIndex) => {
            const pose = { id: personIndex };
            const normalisedPose = { id: personIndex };

            // Build all tracked parts dynamically
            const outputParts = new Set(getActiveParts(settings.controlMode));

            Object.entries(LANDMARKS).forEach(([part, info]) => {
              const raw = getAverageLandmarkPosition(
                landmarks,
                info.indices,
                info.min_vis,
                { flipX: true }
              );
              // Keep full normalized pose internally for derived metrics
              normalisedPose[part] = raw
                ? { x: raw.x, y: raw.y, z: raw.z }
                : null;

              // Only EMIT requested parts
              if (outputParts.has(part)) {
                pose[part] = raw
                  ? {
                      x: offX + raw.x * dispW,
                      y: offY + raw.y * dispH,
                      z: raw.z,
                    }
                  : null;
              }
            });

            // --- Elbow angles (shoulder–elbow–wrist) in degrees ---
            if (outputParts.has("leftElbow") || outputParts.has("rightElbow")) {
              // 2D
              pose.leftElbowAngleDeg = angleAt(
                normalisedPose.leftShoulder,
                normalisedPose.leftElbow,
                normalisedPose.leftWrist ?? normalisedPose.leftPalm
              );
              pose.rightElbowAngleDeg = angleAt(
                normalisedPose.rightShoulder,
                normalisedPose.rightElbow,
                normalisedPose.rightWrist ?? normalisedPose.rightPalm
              );

              // 3D
              const world = results.worldLandmarks?.[originalIndex];
              const pick = (i) =>
                world ? { x: world[i].x, y: world[i].y, z: world[i].z } : null;
              pose.leftElbowAngle3D = angleAt3D(pick(11), pick(13), pick(15));
              pose.rightElbowAngle3D = angleAt3D(pick(12), pick(14), pick(16));
            }

            // cache shoulders in screen space for compensation (even if not emitted)
            const nL = normalisedPose.leftShoulder;
            const nR = normalisedPose.rightShoulder;
            pose._calibShoulders = {
              L: nL ? { x: offX + nL.x * dispW, y: offY + nL.y * dispH } : null,
              R: nR ? { x: offX + nR.x * dispW, y: offY + nR.y * dispH } : null,
            };

            allPoses.push(pose);

            // Debug skeleton
            if (DEBUG && ctx && drawingUtils) {
              drawDebugSkeleton(
                ctx,
                landmarks,
                pose.leftPalm,
                pose.rightPalm,
                personIndex,
                originalIndex,
                video,
                screenWidth,
                screenHeight
                // world,
              );
            }
          });

          const mainPose = allPoses[0];
          const activeParts = getActiveParts(settings.controlMode);
          const activeSet = new Set(activeParts);

          // ----- Full body calibration -----
          const requiresFullBody = activeParts.some(
            (p) => ControlProfile[p]?.requiresFullBody
          );

          const bodyOK =
            !requiresFullBody ||
            (mainPose &&
              activeParts.every(
                (p) =>
                  mainPose[p] && !isOut(mainPose[p], screenWidth, screenHeight)
              ));

          const calibrating = isCalibrating(calib.current);
          const baseline = getBaseline(calib.current);
          const ready = !!baseline && !calibrating && bodyOK;

          // poseDataRef.current?.(ready ? allPoses : []);
          poseDataRef.current?.(allPoses);

          // Send to Games: announce the first time we become ready
          const status = ready
            ? "ready"
            : calibrating
            ? "calibrating"
            : requiresFullBody && !bodyOK
            ? "body_not_in_frame"
            : "waiting";

          window.dispatchEvent(
            new CustomEvent("pose:calibrationStatus", { detail: status })
          );
          readyRef.current = ready;

          // ----- Draw icons -----
          if (markerContainer) markerContainer.innerHTML = "";
          let anyOut = false;

          allPoses.forEach((pose) => {
            Object.entries(ControlProfile).forEach(([part, cfg]) => {
              if (!pose[part]) return;

              if (activeSet.has(part)) {
                renderIcons(
                  markerContainer,
                  pose[part].x,
                  pose[part].y,
                  cfg.colours[pose.id] ?? "#000000ff",
                  cfg.emoji ?? "",
                  cfg.size ?? 50
                );
              }
            });

            // update out-of-frame for this pose using the same active parts
            anyOut ||= activeParts.some((part) =>
              isOut(pose[part], screenWidth, screenHeight)
            );

            const { L, R } = pose._calibShoulders ?? { L: null, R: null };
            const set_base = feedCalibration(calib.current, L, R);

            if (settings.compensation) {
              // Feed calibration from shoulders (safe if nulls)
              const calibrating = isCalibrating(calib.current);
              const baseline = getBaseline(calib.current);

              if (set_base && baseline && !baselineShownRef.current) {
                baselineShownRef.current = true;

                showWarning(
                  markerContainerRef,
                  true,
                  "Baseline calibration done ✅",
                  "pose-baseline-set",
                  {
                    left: "50%",
                    bottom: "15px",
                    top: "auto", //override default centered to move to bottom-right
                  }
                );

                // Hide it again after 2s
                setTimeout(() => {
                  showWarning(
                    markerContainerRef,
                    false,
                    "",
                    "pose-baseline-set"
                  );
                }, 2000);
              }

              // Compute live shoulder angle (0° ≈ level)
              let angleDeg = null,
                deltaDeg = null;
              if (L && R) {
                angleDeg = (Math.atan2(R.y - L.y, R.x - L.x) * 180) / Math.PI;
                if (baseline) deltaDeg = angleDeg - baseline.angleDeg;
              }

              // Debug panel
              showDebugPanel(
                markerContainerRef,
                `pose-debug-${pose.id}`,
                [
                  `P${pose.id + 1} debug`,
                  `calibrating: ${calibrating}`,
                  angleDeg != null
                    ? `angle: ${angleDeg.toFixed(1)}°`
                    : "angle: -",
                  baseline
                    ? `base:  ${baseline.angleDeg.toFixed(1)}°`
                    : "base:  -",
                  deltaDeg != null
                    ? `Δ:     ${deltaDeg.toFixed(1)}°`
                    : "Δ:     -",
                  pose.leftElbowAngleDeg != null
                    ? `L-elbow 2D: ${pose.leftElbowAngleDeg.toFixed(1)}°`
                    : "L-elbow 2D: -",
                  pose.rightElbowAngleDeg != null
                    ? `R-elbow 2D: ${pose.rightElbowAngleDeg.toFixed(1)}°`
                    : "R-elbow 2D: -",
                  pose.leftElbowAngle3D != null
                    ? `L-elbow 3D: ${pose.leftElbowAngle3D.toFixed(1)}°`
                    : "L-elbow 3D: -",
                  pose.rightElbowAngle3D != null
                    ? `R-elbow 3D: ${pose.rightElbowAngle3D.toFixed(1)}°`
                    : "R-elbow 3D: -",
                ],
                DEBUG,
                // stack per player so panels don't overlap
                { left: "10px", bottom: `${10 + pose.id * 80}px` }
              );

              // Calibration banner
              const tilt_thresh = 20; // TODO: degrees; tune 15-25?

              const tiltExceeded =
                !calibrating &&
                baseline &&
                angleDeg != null &&
                Math.abs(deltaDeg) >= tilt_thresh;

              pose.trunkTiltDeg = deltaDeg ?? null; // signed tilt vs baseline
              pose.compensating = !!tiltExceeded; // boolean per frame

              // Per-player compensation banner
              showWarning(
                markerContainerRef,
                tiltExceeded,
                DEBUG
                  ? `P${pose.id + 1}: ⚠ Compensatory trunk movement detected (${
                      deltaDeg != null ? deltaDeg.toFixed(1) : "?"
                    }°)`
                  : "⚠ Compensatory trunk movement detected",
                `pose-warning-comp-${pose.id}`,
                { top: `${55 + pose.id * 40}px` }
              );
            }
          });

          showWarning(
            markerContainerRef,
            anyOut,
            "⚠ Move back into frame",
            "pose-warning-out",
            { top: "15px" }
          );

          if (DEBUG) {
            console.log(
              "[PoseDetector] Sending poseData to GameScreen:",
              setPoseData
            );
          }
        } else {
          // No landmarks detected
          poseDataRef.current?.([]);
        }

        rafId = requestAnimationFrame(loop); // keep looping
      };

      rafId = requestAnimationFrame(loop); // starts loop
    };

    init();

    return () => {
      active = false; // stop loop
      if (rafId) cancelAnimationFrame(rafId);
      try {
        poseLandmarker?.close?.();
      } catch {}
    };
  }, [setPoseData, settings.numPlayers, settings.controlMode, silhouette]);

  return (
    <>
      {DEBUG && <DebugOverlay numPlayers={settings.numPlayers} />}

      {/* Webcam/Video + Canvas layered layout */}
      <div className="relative w-full h-full">
        {useWebcam ? (
          <Webcam
            ref={webcamRef}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: "scaleX(-1)",
              opacity: 0,
              zIndex: 1,
            }}
            videoConstraints={{
              facingMode: "user",
            }}
          />
        ) : (
          <video
            ref={webcamRef}
            src="/people.mov"
            controls
            autoPlay
            loop
            muted
            playsInline
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: "scaleX(-1)",
              zIndex: 1,
            }}
          />
        )}

        {/* Canvas for hand positions */}
        <div
          ref={markerContainerRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            zIndex: 50, // above canvas, below other UI
            pointerEvents: "none",
            containerType: "size", // enables container query units
          }}
        />

        {/* Drawing canvas overlays the video */}
        {silhouette && (
          <canvas
            ref={canvasRef}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              zIndex: 96,
              pointerEvents: "none",
            }}
          />
        )}
      </div>
    </>
  );
};

export default PoseDetector;

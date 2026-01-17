#!/usr/bin/env python3
"""
TonyPi servo HTTP server (dev bridge)

Browser -> HTTP -> TonyPi (this script) -> bus servos (IDs 1..16) + head PWM (p1/p2)

Client sends:
{
  "kind": "humanoid16",
  "degrees": [16 numbers, 0..180],
  "head": { "p1": 0..180, "p2": 0..180 }
}

This script tries to auto-detect common Hiwonder SDK layouts:
- HiwonderSDK.Board with setBusServoPulse / setPWMServoPulse
- hiwonder.ros_robot_controller_sdk + hiwonder.Controller (ctl.set_bus_servo_pulse / ctl.set_pwm_servo_pulse)

Run on the TonyPi:
  python3 tonypi_servo_server.py --host 0.0.0.0 --port 8080
"""

from __future__ import annotations

import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Optional, Tuple


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def deg_to_bus_pos(deg: float) -> int:
    # TonyPi bus servo positions are commonly 0..1000 with 500 as center
    d = clamp(float(deg), 0.0, 180.0)
    return int(round(d / 180.0 * 1000.0))


def deg_to_pwm_us(deg: float) -> int:
    # PWM servo pulse commonly 500..2500us with 1500us as center
    d = clamp(float(deg), 0.0, 180.0)
    return int(round(500 + (d / 180.0) * 2000))


class TonyPiController:
    def __init__(self) -> None:
        self.mode = "unknown"
        self.board = None
        self.ctl = None

        # Attempt 1: HiwonderSDK.Board (common on older images)
        try:
            from HiwonderSDK import Board  # type: ignore

            self.board = Board
            self.mode = "HiwonderSDK.Board"
            return
        except Exception:
            pass

        # Attempt 2: hiwonder controller stack (common on newer images)
        try:
            from hiwonder.ros_robot_controller_sdk import Board as RosBoard  # type: ignore
            from hiwonder.Controller import Controller  # type: ignore

            board = RosBoard()
            self.ctl = Controller(board)
            self.mode = "hiwonder.Controller"
            return
        except Exception:
            pass

        raise RuntimeError(
            "Could not import a TonyPi servo SDK. "
            "On the TonyPi, try locating HiwonderSDK or hiwonder modules."
        )

    def set_bus_servo(self, servo_id: int, pos: int, duration_ms: int) -> None:
        sid = int(servo_id)
        p = int(clamp(pos, 0, 1000))
        t = int(max(0, duration_ms))

        if self.mode == "HiwonderSDK.Board":
            # Board.setBusServoPulse(id, pulse, time)
            self.board.setBusServoPulse(sid, p, t)  # type: ignore[attr-defined]
            return
        if self.mode == "hiwonder.Controller":
            self.ctl.set_bus_servo_pulse(sid, p, t)  # type: ignore[attr-defined]
            return
        raise RuntimeError("Unsupported controller mode")

    def set_pwm_servo(self, channel: int, us: int, duration_ms: int) -> None:
        ch = int(channel)
        pulse = int(clamp(us, 500, 2500))
        t = int(max(0, duration_ms))

        if self.mode == "HiwonderSDK.Board":
            self.board.setPWMServoPulse(ch, pulse, t)  # type: ignore[attr-defined]
            return
        if self.mode == "hiwonder.Controller":
            self.ctl.set_pwm_servo_pulse(ch, pulse, t)  # type: ignore[attr-defined]
            return
        raise RuntimeError("Unsupported controller mode")


def parse_payload(body: bytes) -> Tuple[list[float], Optional[dict[str, float]]]:
    msg = json.loads(body.decode("utf-8") or "{}")
    if msg.get("kind") != "humanoid16":
        raise ValueError("wrong kind")
    deg = msg.get("degrees")
    if not isinstance(deg, list) or len(deg) != 16:
        raise ValueError("degrees must be length 16")
    degrees = [float(x) for x in deg]
    head = msg.get("head")
    if isinstance(head, dict) and "p1" in head and "p2" in head:
        return degrees, {"p1": float(head["p1"]), "p2": float(head["p2"])}
    return degrees, None


class Handler(BaseHTTPRequestHandler):
    controller: TonyPiController
    move_ms: int
    last_at: float
    min_interval_s: float

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/servo":
            self.send_response(404)
            self._cors()
            self.end_headers()
            return

        # simple rate limit
        now = time.time()
        if now - self.last_at < self.min_interval_s:
            self.send_response(204)
            self._cors()
            self.end_headers()
            return
        self.last_at = now

        try:
            n = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(n) if n > 0 else b"{}"
            degrees, head = parse_payload(body)

            # IDs 1..16
            for i, d in enumerate(degrees, start=1):
                pos = deg_to_bus_pos(d)
                self.controller.set_bus_servo(i, pos, self.move_ms)

            # Head: p1=head_pitch, p2=head_yaw (PWM channels 1 and 2)
            if head:
                self.controller.set_pwm_servo(1, deg_to_pwm_us(head["p1"]), self.move_ms)
                self.controller.set_pwm_servo(2, deg_to_pwm_us(head["p2"]), self.move_ms)

            self.send_response(204)
            self._cors()
            self.end_headers()
        except Exception as e:
            self.send_response(400)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--move-ms", type=int, default=80, help="motion time per command")
    ap.add_argument("--max-fps", type=float, default=10.0, help="server-side rate limit")
    args = ap.parse_args()

    ctrl = TonyPiController()
    print(f"[tonypi] controller backend: {ctrl.mode}")
    print(f"[tonypi] listening on http://{args.host}:{args.port}/servo")
    print(f"[tonypi] move_ms={args.move_ms} max_fps={args.max_fps}")

    def handler_factory(*_a: Any, **_kw: Any):
        h = Handler(*_a, **_kw)
        h.controller = ctrl
        h.move_ms = args.move_ms
        h.last_at = 0.0
        h.min_interval_s = 1.0 / max(1.0, float(args.max_fps))
        return h

    httpd = HTTPServer((args.host, args.port), handler_factory)
    httpd.serve_forever()


if __name__ == "__main__":
    main()


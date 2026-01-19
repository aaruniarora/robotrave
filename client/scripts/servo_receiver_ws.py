#!/usr/bin/env python3
"""
WebSocket Servo Receiver - Runs on TonyPi.

Receives JSON frames from the web UI:
{
  "kind": "humanoid16",
  "degrees": [16 numbers],
  "head": { "p1": deg, "p2": deg }
}

Usage on Pi:
  python3 servo_receiver_ws.py --port 8766
"""

import argparse
import asyncio
import json
import sys

# Import robot SDK
sys.path.insert(0, "/home/pi/TonyPi/HiwonderSDK")
ROBOT_AVAILABLE = False
controller = None

try:
    import hiwonder.ros_robot_controller_sdk as rrc
    from hiwonder.Controller import Controller
    board = rrc.Board()
    controller = Controller(board)
    ROBOT_AVAILABLE = True
    print("[servo] Robot SDK loaded: hiwonder.Controller")
except ImportError:
    try:
        from HiwonderSDK import Board
        controller = Board
        ROBOT_AVAILABLE = True
        print("[servo] Robot SDK loaded: HiwonderSDK.Board")
    except ImportError:
        print("[servo] WARNING: No robot SDK found, running in test mode (print only)")


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def degrees_to_pulse(deg):
    deg = clamp(float(deg), 0, 180)
    return int(round(deg / 180.0 * 1000))


def degrees_to_pwm_us(deg):
    deg = clamp(float(deg), 0, 180)
    return int(round(500 + (deg / 180.0) * 2000))


def set_bus_servo(servo_id, pulse, time_ms=80):
    servo_id = int(servo_id)
    pulse = int(clamp(pulse, 0, 1000))
    time_ms = int(max(0, time_ms))
    if not ROBOT_AVAILABLE:
        return
    if hasattr(controller, "set_bus_servo_pulse"):
        controller.set_bus_servo_pulse(servo_id, pulse, time_ms)
    elif hasattr(controller, "setBusServoPulse"):
        controller.setBusServoPulse(servo_id, pulse, time_ms)


def set_pwm_servo(channel, pulse_us, time_ms=80):
    channel = int(channel)
    pulse_us = int(clamp(pulse_us, 500, 2500))
    time_ms = int(max(0, time_ms))
    if not ROBOT_AVAILABLE:
        return
    if hasattr(controller, "set_pwm_servo_pulse"):
        controller.set_pwm_servo_pulse(channel, pulse_us, time_ms)
    elif hasattr(controller, "setPWMServoPulse"):
        controller.setPWMServoPulse(channel, pulse_us, time_ms)


async def handler(websocket):
    print("[servo] client connected")
    try:
        async for message in websocket:
            data = json.loads(message)
            msg_type = data.get("type")

            if msg_type == "servos":
                servos = data.get("servos")
                if isinstance(servos, dict):
                    for sid, pulse in servos.items():
                        set_bus_servo(int(sid), int(pulse), 80)
                head = data.get("head")
                if isinstance(head, dict):
                    if "p1" in head:
                        set_pwm_servo(1, int(head["p1"]), 80)
                    if "p2" in head:
                        set_pwm_servo(2, int(head["p2"]), 80)
                continue

            if data.get("kind") != "humanoid16":
                continue
            degrees = data.get("degrees")
            if not isinstance(degrees, list) or len(degrees) != 16:
                continue
            for i, deg in enumerate(degrees):
                set_bus_servo(i + 1, degrees_to_pulse(deg), 80)
            head = data.get("head")
            if isinstance(head, dict):
                if "p1" in head:
                    set_pwm_servo(1, degrees_to_pwm_us(head["p1"]), 80)
                if "p2" in head:
                    set_pwm_servo(2, degrees_to_pwm_us(head["p2"]), 80)
    except Exception as e:
        print("[servo] error:", e)
    print("[servo] client disconnected")


async def main(port: int):
    try:
        import websockets
    except ImportError:
        print("Missing websockets lib. Install with: pip3 install websockets")
        return

    print(f"[servo] Listening on ws://0.0.0.0:{port}")
    async with websockets.serve(lambda ws, _path: handler(ws), "0.0.0.0", port):
        await asyncio.Future()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="TonyPi WebSocket Servo Receiver")
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    asyncio.run(main(args.port))

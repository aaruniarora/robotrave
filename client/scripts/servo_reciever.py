#!/usr/bin/env python3
"""
Servo Receiver - Runs on the TonyPi robot.
Receives servo commands from the web UI and executes them.

Usage on Pi:
    python3 servo_receiver.py --port 8080

The web UI sends HTTP POST to http://<PI_IP>:8080/servo with JSON:
{
    "kind": "humanoid16",
    "degrees": [deg1, deg2, ..., deg16],  // 16 values, index 0 = ID1, index 15 = ID16
    "head": { "p1": deg, "p2": deg }       // optional PWM head servos
}
"""

import json
import argparse
import signal
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

# Import robot SDK
sys.path.insert(0, '/home/pi/TonyPi/HiwonderSDK')
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


# Servo name mapping for debug output
SERVO_NAMES = {
    1: "L_ankle_roll",    2: "L_ankle_pitch",  3: "L_knee",
    4: "L_hip_pitch",     5: "L_hip_roll",     6: "L_elbow",
    7: "L_shoulder_roll", 8: "L_shoulder_pitch",
    9: "R_ankle_roll",   10: "R_ankle_pitch", 11: "R_knee",
   12: "R_hip_pitch",    13: "R_hip_roll",    14: "R_elbow",
   15: "R_shoulder_roll",16: "R_shoulder_pitch",
}


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def degrees_to_pulse(deg):
    """Convert degrees (0-180) to bus servo pulse (0-1000)."""
    deg = clamp(float(deg), 0, 180)
    return int(round(deg / 180.0 * 1000))


def degrees_to_pwm_us(deg):
    """Convert degrees (0-180) to PWM microseconds (500-2500)."""
    deg = clamp(float(deg), 0, 180)
    return int(round(500 + (deg / 180.0) * 2000))


def set_bus_servo(servo_id, pulse, time_ms=80):
    """Set a bus servo position."""
    servo_id = int(servo_id)
    pulse = int(clamp(pulse, 0, 1000))
    time_ms = int(max(0, time_ms))
    
    if not ROBOT_AVAILABLE:
        return
    
    try:
        if hasattr(controller, 'set_bus_servo_pulse'):
            # hiwonder.Controller style
            controller.set_bus_servo_pulse(servo_id, pulse, time_ms)
        elif hasattr(controller, 'setBusServoPulse'):
            # HiwonderSDK.Board style
            controller.setBusServoPulse(servo_id, pulse, time_ms)
    except Exception as e:
        print(f"[servo] Error setting servo {servo_id}: {e}")


def set_pwm_servo(channel, pulse_us, time_ms=80):
    """Set a PWM servo position."""
    channel = int(channel)
    pulse_us = int(clamp(pulse_us, 500, 2500))
    time_ms = int(max(0, time_ms))
    
    if not ROBOT_AVAILABLE:
        return
    
    try:
        if hasattr(controller, 'set_pwm_servo_pulse'):
            controller.set_pwm_servo_pulse(channel, pulse_us, time_ms)
        elif hasattr(controller, 'setPWMServoPulse'):
            controller.setPWMServoPulse(channel, pulse_us, time_ms)
    except Exception as e:
        print(f"[servo] Error setting PWM {channel}: {e}")


def reset_to_neutral(time_ms=1000):
    """Reset all servos to neutral (90 degrees = 500 pulse)."""
    print("[servo] Resetting all servos to neutral...")
    for servo_id in range(1, 17):
        set_bus_servo(servo_id, 500, time_ms)
    # Head PWM
    set_pwm_servo(1, 1500, time_ms)
    set_pwm_servo(2, 1500, time_ms)
    print("[servo] Reset complete.")


class ServoHandler(BaseHTTPRequestHandler):
    """HTTP handler for servo commands."""
    
    last_log_time = 0
    
    def log_message(self, format, *args):
        pass  # Suppress default logging
    
    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
    
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()
    
    def do_POST(self):
        if self.path != "/servo":
            self.send_response(404)
            self.send_cors_headers()
            self.end_headers()
            return
        
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8") if content_length else "{}"
            msg = json.loads(body)
            
            # Check message format
            if msg.get("kind") != "humanoid16":
                raise ValueError("Expected kind: humanoid16")
            
            degrees = msg.get("degrees", [])
            if not isinstance(degrees, list) or len(degrees) != 16:
                raise ValueError("degrees must be array of 16 values")
            
            # Apply servo positions (index 0 = ID1, index 15 = ID16)
            for i, deg in enumerate(degrees):
                servo_id = i + 1
                pulse = degrees_to_pulse(deg)
                set_bus_servo(servo_id, pulse, 80)
            
            # Apply head PWM if present
            head = msg.get("head")
            if isinstance(head, dict):
                if "p1" in head:
                    set_pwm_servo(1, degrees_to_pwm_us(head["p1"]), 80)
                if "p2" in head:
                    set_pwm_servo(2, degrees_to_pwm_us(head["p2"]), 80)
            
            # Occasional debug output (every ~1s)
            import time
            now = time.time()
            if now - ServoHandler.last_log_time > 1.0:
                ServoHandler.last_log_time = now
                sample = [int(round(d)) for d in degrees[:4]]
                print(f"[servo] Received: ID1-4={sample}... head={head}")
            
            self.send_response(204)
            self.send_cors_headers()
            self.end_headers()
            
        except Exception as e:
            print(f"[servo] Error: {e}")
            self.send_response(400)
            self.send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))


def main():
    parser = argparse.ArgumentParser(description="TonyPi Servo Receiver")
    parser.add_argument("--port", type=int, default=8080, help="HTTP port (default: 8080)")
    parser.add_argument("--no-reset", action="store_true", help="Skip initial servo reset")
    args = parser.parse_args()
    
    print("=" * 50)
    print("  TonyPi Servo Receiver")
    print("=" * 50)
    print(f"  Robot SDK: {'Available' if ROBOT_AVAILABLE else 'NOT FOUND (test mode)'}")
    print(f"  Port: {args.port}")
    print("=" * 50)
    
    # Reset servos on startup
    if not args.no_reset and ROBOT_AVAILABLE:
        reset_to_neutral(time_ms=1000)
        import time
        time.sleep(1.5)
    
    # Handle shutdown gracefully
    def shutdown_handler(signum, frame):
        print("\n[servo] Shutting down...")
        if ROBOT_AVAILABLE:
            reset_to_neutral(time_ms=500)
        sys.exit(0)
    
    signal.signal(signal.SIGINT, shutdown_handler)
    signal.signal(signal.SIGTERM, shutdown_handler)
    
    # Start server
    server = HTTPServer(("0.0.0.0", args.port), ServoHandler)
    print(f"\n[servo] Listening on http://0.0.0.0:{args.port}/servo")
    print("[servo] Press Ctrl+C to stop (will reset servos)")
    print()
    
    server.serve_forever()


if __name__ == "__main__":
    main()

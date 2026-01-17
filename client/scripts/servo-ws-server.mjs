import { WebSocketServer } from "ws";

// Minimal bridge: receives { kind:"humanoid16", degrees:[...16] } frames
// and prints them. Replace console.log with Serial/UDP/etc for your robot.

const port = Number(process.env.PORT || 8080);
const wss = new WebSocketServer({ port });

console.log(`[servo-ws-server] listening on ws://localhost:${port}`);

wss.on("connection", (ws) => {
  console.log("[servo-ws-server] client connected");

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(String(data));
      if (msg?.kind !== "humanoid16" || !Array.isArray(msg?.degrees)) return;
      if (msg.degrees.length !== 16) return;

      // TODO: Send to robot here (serial, CAN, UDP, etc).
      console.log(
        `[frame] ${new Date(msg.t ?? Date.now()).toISOString()} ::`,
        msg.degrees.map((d) => Math.round(Number(d))).join(", ")
      );
    } catch {
      // ignore
    }
  });

  ws.on("close", () => console.log("[servo-ws-server] client disconnected"));
});


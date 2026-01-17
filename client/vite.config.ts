import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

function servoTerminalLogPlugin() {
  return {
    name: "servo-terminal-log",
    configureServer(server: any) {
      server.middlewares.use("/__servo", (req: any, res: any, next: any) => {
        if (req.method !== "POST") return next();

        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf-8");
        });

        req.on("end", () => {
          try {
            const msg = JSON.parse(body || "{}");
            if (msg?.kind === "humanoid16" && Array.isArray(msg?.degrees)) {
              const arr = msg.degrees
                .slice(0, 16)
                .map((n: unknown) => Math.round(Number(n)));
              if (arr.length === 16 && arr.every((n: number) => Number.isFinite(n))) {
                const pretty = arr
                  .map((v: number, i: number) => `ID${i + 1}=${v}`)
                  .join(" ");
                const head = msg?.head;
                const headPretty =
                  head && typeof head === "object"
                    ? ` p1=${Math.round(Number((head as any).p1))} p2=${Math.round(
                        Number((head as any).p2)
                      )}`
                    : "";
                console.log(`[servo] ${pretty}${headPretty}`);
              }
            }
          } catch {
            // ignore
          }
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), servoTerminalLogPlugin()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});

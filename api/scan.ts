import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHmac, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";

function authorized(request: VercelRequest): boolean {
  const expected = process.env.BOT_TRIGGER_SECRET;
  const supplied = request.headers["x-bot-trigger-secret"];
  if (!expected || typeof supplied !== "string") return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(supplied, "utf8");
  // Compare fixed-size digests so timingSafeEqual never receives unequal lengths.
  return timingSafeEqual(createHmac("sha256", "bot-trigger").update(a).digest(), createHmac("sha256", "bot-trigger").update(b).digest())
    && a.length > 0 && b.length > 0;
}

export default function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.BOT_TRIGGER_SECRET) {
    return response.status(503).json({ error: "Manual scan is not configured. Set BOT_TRIGGER_SECRET in Vercel." });
  }
  if (!authorized(request)) {
    return response.status(401).json({ error: "Unauthorized" });
  }

  const child = spawn(process.execPath, ["--experimental-strip-types", "src/scan-once.ts"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  const maxOutput = 12_000;
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout = (stdout + chunk).slice(-maxOutput);
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-maxOutput);
  });

  child.on("error", () => {
    if (!response.headersSent) response.status(500).json({ error: "Unable to start scan process." });
  });
  child.on("close", (code) => {
    if (response.headersSent) return;
    if (code !== 0) {
      return response.status(502).json({ status: "failed", exitCode: code, output: stdout, error: stderr.slice(-3000) });
    }
    return response.status(200).json({ status: "completed", mode: "read-only", tradesSubmitted: 0, output: stdout });
  });
}

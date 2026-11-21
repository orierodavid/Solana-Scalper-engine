import { createHmac, timingSafeEqual } from "node:crypto";
import { runReadOnlyScan } from "../src/scan-once.ts";

type ScanRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
};
type ScanResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): ScanResponse;
  json(body: unknown): void;
};

function authorized(request: ScanRequest): boolean {
  const expected = process.env.BOT_TRIGGER_SECRET;
  const supplied = request.headers["x-bot-trigger-secret"];
  if (!expected || typeof supplied !== "string") return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(supplied, "utf8");
  const digestA = createHmac("sha256", "bot-trigger").update(a).digest();
  const digestB = createHmac("sha256", "bot-trigger").update(b).digest();
  return a.length > 0 && b.length > 0 && timingSafeEqual(digestA, digestB);
}

export default async function handler(request: ScanRequest, response: ScanResponse): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!process.env.BOT_TRIGGER_SECRET) {
    response.status(503).json({ error: "Manual scan is not configured. Set BOT_TRIGGER_SECRET in Vercel." });
    return;
  }
  if (!authorized(request)) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const summary = await runReadOnlyScan();
    response.status(200).json({ status: "completed", mode: "read-only", tradesSubmitted: 0, summary });
  } catch {
    response.status(502).json({ status: "failed", tradesSubmitted: 0, error: "Read-only scan failed. No trades were submitted." });
  }
}

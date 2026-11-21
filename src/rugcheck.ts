export type RugCheckResult = {
  mint: string;
  status: "screen_passed" | "rejected" | "inconclusive";
  normalizedScore: number | null;
  lpLockedPercent: number | null;
  highRiskFindings: number;
  reasons: string[];
};

type RugCheckRisk = {
  level?: unknown;
  name?: unknown;
  description?: unknown;
};

type RugCheckSummary = {
  score_normalised?: unknown;
  lpLockedPct?: unknown;
  risks?: unknown;
  error?: unknown;
};

function percentage(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}

/** Pure evaluator for the documented RugCheck report-summary fields. */
export function evaluateRugCheckSummary(mint: string, raw: unknown): RugCheckResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      mint, status: "inconclusive", normalizedScore: null, lpLockedPercent: null,
      highRiskFindings: 0, reasons: ["RugCheck returned no usable report."],
    };
  }

  const report = raw as RugCheckSummary;
  const normalizedScore = percentage(report.score_normalised);
  const lpLockedPercent = percentage(report.lpLockedPct);
  const risks = Array.isArray(report.risks) ? report.risks as RugCheckRisk[] : null;

  if (typeof report.error === "string" || normalizedScore === null || lpLockedPercent === null || risks === null) {
    return {
      mint, status: "inconclusive", normalizedScore, lpLockedPercent,
      highRiskFindings: 0, reasons: ["RugCheck report is incomplete or contains an error; quote evaluation is blocked."],
    };
  }

  const highRisk = risks.filter((risk) => {
    const level = typeof risk?.level === "string" ? risk.level.toLowerCase() : "";
    return level === "danger" || level === "critical" || level === "high";
  });
  const reasons: string[] = [];
  if (normalizedScore > 40) reasons.push("RugCheck normalized risk score is above 40.");
  if (highRisk.length > 0) reasons.push(`RugCheck reports ${highRisk.length} high-severity risk finding(s).`);
  if (lpLockedPercent < 50) reasons.push("Less than 50% of reported liquidity is locked.");
  else if (lpLockedPercent < 80) reasons.push("Reported locked liquidity is below the 80% screening threshold.");

  const rejected = normalizedScore > 40 || highRisk.length > 0 || lpLockedPercent < 50;
  const inconclusive = !rejected && lpLockedPercent < 80;

  return {
    mint,
    status: rejected ? "rejected" : inconclusive ? "inconclusive" : "screen_passed",
    normalizedScore,
    lpLockedPercent,
    highRiskFindings: highRisk.length,
    reasons: reasons.length ? reasons : ["RugCheck summary met the configured screening thresholds."],
  };
}

/**
 * Uses RugCheck's public, read-only report summary endpoint. Missing, stale,
 * malformed, or unavailable third-party evidence must block quote evaluation.
 */
export async function screenWithRugCheck(mint: string): Promise<RugCheckResult> {
  const response = await fetch(
    `https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report/summary`,
    {
      headers: { accept: "application/json", "user-agent": "solana-scalper-engine/0.1" },
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok) {
    return {
      mint, status: "inconclusive", normalizedScore: null, lpLockedPercent: null,
      highRiskFindings: 0, reasons: [`RugCheck report unavailable (HTTP ${response.status}).`],
    };
  }
  const report: unknown = await response.json();
  return evaluateRugCheckSummary(mint, report);
}

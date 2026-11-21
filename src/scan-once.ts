import "dotenv/config";
import { loadConfig } from "./config.ts";
import { discoverSolanaCandidates } from "./discovery.ts";
import { evaluateJupiterRoundTrip } from "./jupiter.ts";
import { screenSolanaToken } from "./token-security.ts";
import { screenWithRugCheck } from "./rugcheck.ts";

const MAX_CANDIDATES_PER_RUN = 5;
const JUPITER_KEYLESS_INTERVAL_MS = 2_100;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type ReadOnlyScanSummary = {
  discoveredCandidates: number;
  maxCandidatesPerRun: number;
  quotePassed: number;
  quoteRejected: number;
  quoteErrors: number;
  securityRejected: number;
  securityInconclusive: number;
  rugCheckRejected: number;
  rugCheckInconclusive: number;
  tradeSizeUsd: number;
  maxPriceImpactBps: number;
  maxRoundTripCostPercent: number;
  execution: "disabled";
  walletSigning: "disabled";
  transactionSubmission: "disabled";
  observedAt: string;
};

export async function runReadOnlyScan(): Promise<ReadOnlyScanSummary> {
  const config = loadConfig();
  const candidates = (await discoverSolanaCandidates()).slice(0, MAX_CANDIDATES_PER_RUN);

  let passed = 0;
  let rejected = 0;
  let errors = 0;
  let securityRejected = 0;
  let securityInconclusive = 0;
  let rugCheckRejected = 0;
  let rugCheckInconclusive = 0;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    try {
      const security = await screenSolanaToken(candidate.mint, config.SOLANA_RPC_URL);
      if (security.status !== "screen_passed") {
        if (security.status === "rejected") securityRejected += 1;
        else securityInconclusive += 1;
        continue;
      }

      const rugCheck = await screenWithRugCheck(candidate.mint);
      if (rugCheck.status !== "screen_passed") {
        if (rugCheck.status === "rejected") rugCheckRejected += 1;
        else rugCheckInconclusive += 1;
        continue;
      }

      const result = await evaluateJupiterRoundTrip({
        mint: candidate.mint,
        tradeSizeUsd: config.TRADE_SIZE_USD,
        maxPriceImpactBps: config.MAX_PRICE_IMPACT_BPS,
        maxRoundTripCostPercent: config.MAX_ROUND_TRIP_COST_PERCENT,
        apiKey: process.env.JUPITER_API_KEY?.trim() || undefined,
      });

      if (result.status === "quote_passed") passed += 1;
      else rejected += 1;
    } catch {
      errors += 1;
    }

    if (index < candidates.length - 1) await wait(JUPITER_KEYLESS_INTERVAL_MS);
  }

  const summary: ReadOnlyScanSummary = {
    discoveredCandidates: candidates.length,
    maxCandidatesPerRun: MAX_CANDIDATES_PER_RUN,
    quotePassed: passed,
    quoteRejected: rejected,
    quoteErrors: errors,
    securityRejected,
    securityInconclusive,
    rugCheckRejected,
    rugCheckInconclusive,
    tradeSizeUsd: config.TRADE_SIZE_USD,
    maxPriceImpactBps: config.MAX_PRICE_IMPACT_BPS,
    maxRoundTripCostPercent: config.MAX_ROUND_TRIP_COST_PERCENT,
    execution: "disabled",
    walletSigning: "disabled",
    transactionSubmission: "disabled",
    observedAt: new Date().toISOString(),
  };
  console.info("Read-only discovery and quote scan completed.", summary);
  console.info("Security screening combines Solana RPC checks with RugCheck report summaries. Largest-account concentration is not unique-wallet concentration; provider reports are heuristic and may be incomplete.");
  console.info("A quote pass is not authorization to trade.");
  return summary;
}

runReadOnlyScan().catch(() => {
  console.error("Read-only discovery and quote scan failed. No trades were submitted.");
  process.exitCode = 1;
});

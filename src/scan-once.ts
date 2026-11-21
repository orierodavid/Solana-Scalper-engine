import "dotenv/config";
import { loadConfig } from "./config.ts";
import { discoverSolanaCandidates } from "./discovery.ts";
import { evaluateJupiterRoundTrip } from "./jupiter.ts";

const MAX_CANDIDATES_PER_RUN = 5;
const JUPITER_KEYLESS_INTERVAL_MS = 2_100;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const config = loadConfig();
  const candidates = (await discoverSolanaCandidates()).slice(0, MAX_CANDIDATES_PER_RUN);

  let passed = 0;
  let rejected = 0;
  let errors = 0;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    try {
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

    // Stay below the documented keyless Jupiter request rate between candidates.
    if (index < candidates.length - 1) await wait(JUPITER_KEYLESS_INTERVAL_MS);
  }

  console.info("Read-only discovery and quote scan completed.", {
    discoveredCandidates: candidates.length,
    maxCandidatesPerRun: MAX_CANDIDATES_PER_RUN,
    quotePassed: passed,
    quoteRejected: rejected,
    quoteErrors: errors,
    tradeSizeUsd: config.TRADE_SIZE_USD,
    maxPriceImpactBps: config.MAX_PRICE_IMPACT_BPS,
    maxRoundTripCostPercent: config.MAX_ROUND_TRIP_COST_PERCENT,
    execution: "disabled",
    walletSigning: "disabled",
    transactionSubmission: "disabled",
    observedAt: new Date().toISOString(),
  });
  console.info("A quote pass is not token-security clearance or authorization to trade.");
}

main().catch(() => {
  console.error("Read-only discovery and quote scan failed. No trades were submitted.");
  process.exitCode = 1;
});

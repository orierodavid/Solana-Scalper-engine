import { discoverSolanaCandidates } from "./discovery.ts";

async function main(): Promise<void> {
  try {
    const candidates = await discoverSolanaCandidates();
    // Keep public-repository Actions logs free of token identifiers and wallet data.
    console.info("Solana market discovery completed.", {
      qualifyingCandidateCount: candidates.length,
      marketDataSource: "DexScreener",
      minLiquidityUsd: 5_000,
      minVolume24hUsd: 5_000,
      minTransactions24h: 20,
      execution: "disabled",
      observedAt: new Date().toISOString(),
    });
    console.info("These are activity/liquidity prefilters only, not security or rug-risk clearance.");
  } catch {
    console.error("Market discovery failed. No trades were submitted.");
    process.exitCode = 1;
  }
}

main().catch(() => {
  console.error("Market discovery could not start.");
  process.exitCode = 1;
});

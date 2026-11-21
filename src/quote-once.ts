import "dotenv/config";
import { loadConfig } from "./config.ts";
import { evaluateJupiterRoundTrip } from "./jupiter.ts";

async function main(): Promise<void> {
  const mint = process.argv[2];
  if (!mint) {
    throw new Error("Usage: npm run quote:once -- <SOLANA_TOKEN_MINT>");
  }

  const config = loadConfig();
  const result = await evaluateJupiterRoundTrip({
    mint,
    tradeSizeUsd: config.TRADE_SIZE_USD,
    maxPriceImpactBps: config.MAX_PRICE_IMPACT_BPS,
    apiKey: process.env.JUPITER_API_KEY?.trim() || undefined,
  });

  console.info("Jupiter quote-only evaluation", result);
  console.info("No wallet signer was provided. No transaction was built, signed, or submitted.");
  if (result.status !== "quote_passed") process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error("Quote evaluation failed; no transaction was submitted.", error);
  process.exitCode = 1;
});

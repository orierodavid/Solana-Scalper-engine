import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  console.info("Solana Scalper Engine worker starting", {
    mode: config.TRADING_MODE,
    liveExecution: false,
    pollIntervalMs: config.POLL_INTERVAL_MS,
  });

  console.info(
    "Safe scaffold only: wallet reconciliation and swap execution are not enabled yet.",
  );

  // The production worker loop will be added only after on-chain position
  // reconstruction and transaction safety checks are implemented and tested.
}

main().catch((error: unknown) => {
  console.error("Worker startup failed:", error);
  process.exitCode = 1;
});

import "dotenv/config";
import { loadConfig } from "./config.ts";
import { readWalletSnapshot } from "./wallet.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const config = loadConfig();
  console.info("Solana Scalper Engine worker starting", {
    mode: config.TRADING_MODE,
    liveExecution: false,
    pollIntervalMs: config.POLL_INTERVAL_MS,
  });

  if (!config.WALLET_PUBLIC_ADDRESS) {
    console.info("Read-only monitoring is ready. Set WALLET_PUBLIC_ADDRESS to begin.");
    return;
  }

  let stopping = false;
  process.once("SIGINT", () => { stopping = true; });
  process.once("SIGTERM", () => { stopping = true; });

  while (!stopping) {
    try {
      const snapshot = await readWalletSnapshot(
        config.SOLANA_RPC_URL,
        config.WALLET_PUBLIC_ADDRESS,
      );
      console.info("Wallet snapshot", {
        address: snapshot.address,
        solBalance: snapshot.solBalance,
        tokenCount: snapshot.tokens.length,
        recentSignatureCount: snapshot.recentSignatures.length,
        observedAt: snapshot.observedAt,
      });
      for (const token of snapshot.tokens) {
        console.info("Token holding", {
          mint: token.mint,
          uiAmount: token.uiAmount,
          decimals: token.decimals,
          tokenAccounts: token.tokenAccounts,
        });
      }
    } catch (error) {
      console.error("Wallet read failed; no transactions were submitted.", error);
    }

    await sleep(config.POLL_INTERVAL_MS);
  }

  console.info("Worker stopped cleanly.");
}

main().catch((error: unknown) => {
  console.error("Worker startup failed:", error);
  process.exitCode = 1;
});

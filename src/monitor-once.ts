import "dotenv/config";
import { loadConfig } from "./config.ts";
import { readWalletSnapshot } from "./wallet.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.WALLET_PUBLIC_ADDRESS) {
    throw new Error("WALLET_PUBLIC_ADDRESS is not configured.");
  }

  try {
    const snapshot = await readWalletSnapshot(
      config.SOLANA_RPC_URL,
      config.WALLET_PUBLIC_ADDRESS,
    );
    // This repository is public: never print the wallet address, balances,
    // token mints, or transaction signatures into public Actions logs.
    console.info("Read-only wallet check completed.", {
      tokenAccountCount: snapshot.tokens.length,
      recentSignatureCount: snapshot.recentSignatures.length,
      observedAt: snapshot.observedAt,
      tradingMode: config.TRADING_MODE,
      transactionsSubmitted: 0,
    });
  } catch {
    // Avoid leaking RPC request details or wallet information in public logs.
    console.error("Read-only wallet check failed. No transactions were submitted.");
    process.exitCode = 1;
  }
}

main().catch(() => {
  console.error("Wallet monitor could not start. Check Actions configuration.");
  process.exitCode = 1;
});

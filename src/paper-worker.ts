import "dotenv/config";
import { loadConfig } from "./config.ts";
import { discoverSolanaCandidates, hasMomentumEntrySignal } from "./discovery.ts";
import { evaluateJupiterRoundTrip, quoteTokenToSol } from "./jupiter.ts";
import { PaperPositionBook } from "./paper-position.ts";
import { screenSolanaToken } from "./token-security.ts";
import { screenWithRugCheck } from "./rugcheck.ts";

const MAX_CANDIDATES_PER_SCAN = 5;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const config = loadConfig();
  const apiKey = process.env.JUPITER_API_KEY?.trim() || undefined;
  const positions = new PaperPositionBook(config.MAX_OPEN_POSITIONS);
  let stopping = false;
  let lastScanAt = 0;

  process.once("SIGINT", () => { stopping = true; });
  process.once("SIGTERM", () => { stopping = true; });

  console.info("Paper scalping worker started.", {
    tradeSizeUsd: config.TRADE_SIZE_USD,
    takeProfitPercent: config.TAKE_PROFIT_PERCENT,
    stopLossPercent: config.STOP_LOSS_PERCENT,
    maxOpenPositions: config.MAX_OPEN_POSITIONS,
    positionState: "in-memory only; resets on worker restart",
    liveExecution: false,
    walletSigning: false,
    transactionSubmission: false,
  });

  while (!stopping) {
    // Manage open paper positions first; an unavailable exit quote never closes a position.
    for (const position of positions.listOpenPositions()) {
      try {
        const exitQuote = await quoteTokenToSol({
          mint: position.mint,
          tokenAmount: position.tokenAmount,
          maxPriceImpactBps: config.MAX_PRICE_IMPACT_BPS,
          apiKey,
        });
        const evaluation = positions.evaluateExit(
          position.mint,
          exitQuote.outputLamports,
          config.TAKE_PROFIT_PERCENT,
          config.STOP_LOSS_PERCENT,
        );
        console.info("Paper position valuation.", {
          mint: position.mint,
          estimatedReturnPercent: Number(evaluation.netReturnPercent.toFixed(3)),
          exitQuotePriceImpactBps: exitQuote.priceImpactBps,
          decision: evaluation.decision,
          reentryCount: position.reentryCount,
          note: "Quote estimate only; network fees, priority fees and execution slippage are not fully included.",
        });
        if (evaluation.decision !== "hold") {
          const closed = positions.close(position.mint);
          console.info("Paper position closed.", {
            mint: closed.mint,
            reason: evaluation.decision,
            reentryEligible: true,
            nextEntryRequiresFreshMomentumAndQuotes: true,
            liveExecution: false,
          });
        }
      } catch {
        console.warn("Paper exit valuation unavailable; position remains open and no transaction was submitted.");
      }
    }

    const now = Date.now();
    if (now - lastScanAt >= config.PAPER_SCAN_INTERVAL_MS && positions.listOpenPositions().length < config.MAX_OPEN_POSITIONS) {
      lastScanAt = now;
      try {
        const candidates = (await discoverSolanaCandidates()).slice(0, MAX_CANDIDATES_PER_SCAN);
        for (const candidate of candidates) {
          if (!positions.canEnter(candidate.mint) || !hasMomentumEntrySignal(candidate)) continue;
          try {
            const tokenSecurity = await screenSolanaToken(candidate.mint, config.SOLANA_RPC_URL);
            if (tokenSecurity.status !== "screen_passed") continue;

            const rugCheck = await screenWithRugCheck(candidate.mint);
            if (rugCheck.status !== "screen_passed") continue;

            const quote = await evaluateJupiterRoundTrip({
              mint: candidate.mint,
              tradeSizeUsd: config.TRADE_SIZE_USD,
              maxPriceImpactBps: config.MAX_PRICE_IMPACT_BPS,
              maxRoundTripCostPercent: config.MAX_ROUND_TRIP_COST_PERCENT,
              apiKey,
            });
            if (quote.status !== "quote_passed") continue;

            const opened = positions.open({
              mint: candidate.mint,
              entryLamports: quote.inputLamports,
              tokenAmount: quote.buy.outputAmount,
            });
            console.info("Paper entry opened.", {
              mint: opened.mint,
              tradeSizeUsd: config.TRADE_SIZE_USD,
              shortTermPriceChangePercent: candidate.priceChange5mPercent,
              buys5m: candidate.buys5m,
              sells5m: candidate.sells5m,
              estimatedRoundTripQuoteReturnPercent: quote.roundTripReturnPercent,
              reentryCount: opened.reentryCount,
              liveExecution: false,
            });
            break;
          } catch {
            // One malformed or unavailable candidate must not stop the scan.
          }
        }
      } catch {
        console.warn("Paper market scan failed; existing paper positions remain unchanged.");
      }
    }

    await wait(config.POLL_INTERVAL_MS);
  }

  console.info("Paper scalping worker stopped. In-memory paper positions will not survive restart.");
}

main().catch(() => {
  console.error("Paper scalping worker failed to start. No trades were submitted.");
  process.exitCode = 1;
});

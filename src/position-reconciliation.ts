export interface VerifiedWalletSwapFill {
  signature: string;
  slot: number;
  side: "buy" | "sell";
  tokenAmountBaseUnits: string;
  solAmountLamports: string;
  networkFeeLamports: string;
}

export interface PositionReconciliationInput {
  mint: string;
  initialTokenAmountBaseUnits: string;
  currentTokenAmountBaseUnits: string;
  fullHistoryScanned: boolean;
  allFillsVerified: boolean;
  fills: VerifiedWalletSwapFill[];
}

export interface PositionReconciliationResult {
  status: "managed" | "closed" | "unmanaged";
  mint: string;
  openTokenAmountBaseUnits: string;
  openCostLamports: string | null;
  realizedPnlLamports: string | null;
  reason: string;
}

interface Lot {
  remainingTokens: bigint;
  remainingCostLamports: bigint;
}

/**
 * Deterministic FIFO accounting for independently verified swap fills.
 *
 * This function deliberately does not classify transactions or establish
 * bot attribution. Callers must supply fills decoded from confirmed swaps,
 * mark all fills verified, and prove the history scan is complete. If any
 * prerequisite is absent, the position is unmanaged and must not be sold
 * automatically on the basis of this result.
 */
export function reconcilePosition(input: PositionReconciliationInput): PositionReconciliationResult {
  const unmanaged = (reason: string): PositionReconciliationResult => ({
    status: "unmanaged",
    mint: input.mint,
    openTokenAmountBaseUnits: "0",
    openCostLamports: null,
    realizedPnlLamports: null,
    reason,
  });
  const validInteger = (value: string) => /^\d+$/.test(value);
  if (!input.mint.trim() || !validInteger(input.initialTokenAmountBaseUnits) ||
      !validInteger(input.currentTokenAmountBaseUnits)) {
    return unmanaged("Mint or token balance input is invalid.");
  }
  if (BigInt(input.initialTokenAmountBaseUnits) !== 0n) {
    return unmanaged("Wallet already held this token at the start of the scanned history; its cost basis is unknown.");
  }
  if (!input.fullHistoryScanned) return unmanaged("Wallet history is incomplete; earlier fills may be missing.");
  if (!input.allFillsVerified) return unmanaged("At least one transaction has not been verified as an attributable swap.");

  const signatures = new Set<string>();
  const fills = [...input.fills].sort((a, b) => a.slot - b.slot || a.signature.localeCompare(b.signature));
  const lots: Lot[] = [];
  let realizedPnl = 0n;

  for (const fill of fills) {
    if (!fill.signature || signatures.has(fill.signature) || !Number.isSafeInteger(fill.slot) || fill.slot < 0 ||
        !validInteger(fill.tokenAmountBaseUnits) || !validInteger(fill.solAmountLamports) ||
        !validInteger(fill.networkFeeLamports)) {
      return unmanaged("A fill contains duplicate identity or invalid amount data.");
    }
    signatures.add(fill.signature);
    const tokenAmount = BigInt(fill.tokenAmountBaseUnits);
    const solAmount = BigInt(fill.solAmountLamports);
    const networkFee = BigInt(fill.networkFeeLamports);
    if (tokenAmount <= 0n || solAmount <= 0n) return unmanaged("A swap fill has a zero amount.");
    if (fill.side === "buy") {
      lots.push({ remainingTokens: tokenAmount, remainingCostLamports: solAmount + networkFee });
      continue;
    }

    const available = lots.reduce((sum, lot) => sum + lot.remainingTokens, 0n);
    if (tokenAmount > available || solAmount <= networkFee) {
      return unmanaged("A sell exceeds reconstructed inventory or has no positive fee-adjusted proceeds.");
    }

    let tokensToConsume = tokenAmount;
    let costBasis = 0n;
    for (const lot of lots) {
      if (tokensToConsume === 0n) break;
      if (lot.remainingTokens === 0n) continue;
      const consumed = tokensToConsume < lot.remainingTokens ? tokensToConsume : lot.remainingTokens;
      const allocatedCost = consumed === lot.remainingTokens
        ? lot.remainingCostLamports
        : (lot.remainingCostLamports * consumed) / lot.remainingTokens;
      lot.remainingTokens -= consumed;
      lot.remainingCostLamports -= allocatedCost;
      tokensToConsume -= consumed;
      costBasis += allocatedCost;
    }
    realizedPnl += (solAmount - networkFee) - costBasis;
  }

  const openTokens = lots.reduce((sum, lot) => sum + lot.remainingTokens, 0n);
  const openCost = lots.reduce((sum, lot) => sum + lot.remainingCostLamports, 0n);
  const currentTokens = BigInt(input.currentTokenAmountBaseUnits);
  if (openTokens !== currentTokens) {
    return unmanaged("Reconstructed token quantity does not match the current on-chain wallet balance.");
  }
  return {
    status: openTokens > 0n ? "managed" : "closed",
    mint: input.mint,
    openTokenAmountBaseUnits: openTokens.toString(),
    openCostLamports: openTokens > 0n ? openCost.toString() : "0",
    realizedPnlLamports: realizedPnl.toString(),
    reason: openTokens > 0n
      ? "Complete verified swap history reconciles to the current token balance using FIFO lots."
      : "Complete verified swap history reconciles to a zero token balance.",
  };
}

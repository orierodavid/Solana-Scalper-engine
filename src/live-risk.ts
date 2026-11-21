export type LiveEntryGuardInput = {
  emergencyStop: boolean;
  tokenScreenPassed: boolean;
  quotePassed: boolean;
  orderInFlight: boolean;
  tradeSizeLamports: string;
  maxTradeSizeLamports: string;
  realizedDailyLossLamports: string;
  maxDailyLossLamports: string;
  openPositions: number;
  maxOpenPositions: number;
};

export type LiveEntryGuardResult =
  | { allowed: true }
  | { allowed: false; reason: string };

function positiveLamports(value: string, field: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`${field} must be an integer lamport string.`);
  const amount = BigInt(value);
  if (amount <= 0n) throw new Error(`${field} must be greater than zero.`);
  return amount;
}

function nonNegativeLamports(value: string, field: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`${field} must be an integer lamport string.`);
  return BigInt(value);
}

/**
 * Fail-closed pre-entry circuit breaker. The caller must supply independently
 * reconciled daily loss and open-position counts; this function stores no state.
 */
export function evaluateLiveEntryGuard(input: LiveEntryGuardInput): LiveEntryGuardResult {
  if (input.emergencyStop) return { allowed: false, reason: "Emergency stop is active." };
  if (!input.tokenScreenPassed) return { allowed: false, reason: "Token screening has not passed." };
  if (!input.quotePassed) return { allowed: false, reason: "Live buy/sell quote checks have not passed." };
  if (input.orderInFlight) return { allowed: false, reason: "Another order is already in flight." };

  const tradeSize = positiveLamports(input.tradeSizeLamports, "tradeSizeLamports");
  const maxTradeSize = positiveLamports(input.maxTradeSizeLamports, "maxTradeSizeLamports");
  const dailyLoss = nonNegativeLamports(input.realizedDailyLossLamports, "realizedDailyLossLamports");
  const maxDailyLoss = positiveLamports(input.maxDailyLossLamports, "maxDailyLossLamports");

  if (!Number.isSafeInteger(input.openPositions) || input.openPositions < 0) {
    throw new Error("openPositions must be a non-negative safe integer.");
  }
  if (!Number.isSafeInteger(input.maxOpenPositions) || input.maxOpenPositions < 1) {
    throw new Error("maxOpenPositions must be a positive safe integer.");
  }

  if (tradeSize > maxTradeSize) return { allowed: false, reason: "Trade size exceeds the configured maximum." };
  if (dailyLoss >= maxDailyLoss) return { allowed: false, reason: "Daily loss limit has been reached." };
  if (input.openPositions >= input.maxOpenPositions) {
    return { allowed: false, reason: "Maximum concurrent positions reached." };
  }

  return { allowed: true };
}

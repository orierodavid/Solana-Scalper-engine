export type ExitDecision = "take_profit" | "stop_loss" | "hold";

export interface ReturnEstimate {
  entryValueSol: number;
  estimatedExitValueSol: number;
  estimatedFeesSol: number;
}

export function estimateNetReturnPercent(input: ReturnEstimate): number {
  const { entryValueSol, estimatedExitValueSol, estimatedFeesSol } = input;
  if (
    !Number.isFinite(entryValueSol) ||
    !Number.isFinite(estimatedExitValueSol) ||
    !Number.isFinite(estimatedFeesSol) ||
    entryValueSol <= 0 ||
    estimatedExitValueSol < 0 ||
    estimatedFeesSol < 0
  ) {
    throw new Error("Invalid return estimate.");
  }

  const netExitValue = Math.max(0, estimatedExitValueSol - estimatedFeesSol);
  return ((netExitValue - entryValueSol) / entryValueSol) * 100;
}

export function decideExit(
  netReturnPercent: number,
  takeProfitPercent = 20,
  stopLossPercent = 5,
): ExitDecision {
  if (
    !Number.isFinite(netReturnPercent) ||
    !Number.isFinite(takeProfitPercent) ||
    !Number.isFinite(stopLossPercent) ||
    takeProfitPercent <= 0 ||
    stopLossPercent <= 0
  ) {
    throw new Error("Exit thresholds and return must be valid finite numbers.");
  }

  if (netReturnPercent >= takeProfitPercent) return "take_profit";
  if (netReturnPercent <= -stopLossPercent) return "stop_loss";
  return "hold";
}

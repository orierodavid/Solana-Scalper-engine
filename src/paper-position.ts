import { decideExit } from "./risk.ts";

export type PaperExitReason = "take_profit" | "stop_loss";

export interface PaperPosition {
  mint: string;
  entryLamports: string;
  tokenAmount: string;
  openedAt: number;
  reentryCount: number;
}

export interface PaperExitEvaluation {
  decision: "hold" | PaperExitReason;
  netReturnPercent: number;
}

/**
 * In-memory paper position state only. It is deliberately not persisted and
 * never signs or submits a Solana transaction.
 */
export class PaperPositionBook {
  private readonly openPositions = new Map<string, PaperPosition>();
  private readonly completedCycles = new Map<string, number>();

  constructor(private readonly maxOpenPositions = 1) {
    if (!Number.isInteger(maxOpenPositions) || maxOpenPositions < 1) {
      throw new Error("Maximum open positions must be a positive integer.");
    }
  }

  getOpenPosition(mint: string): PaperPosition | undefined {
    const position = this.openPositions.get(mint);
    return position ? { ...position } : undefined;
  }

  listOpenPositions(): PaperPosition[] {
    return [...this.openPositions.values()].map((position) => ({ ...position }));
  }

  canEnter(mint: string): boolean {
    return !this.openPositions.has(mint) && this.openPositions.size < this.maxOpenPositions;
  }

  open(input: {
    mint: string;
    entryLamports: string;
    tokenAmount: string;
    openedAt?: number;
  }): PaperPosition {
    if (!this.canEnter(input.mint)) {
      throw new Error("A position is already open for this mint or the open-position limit was reached.");
    }
    if (!/^\d+$/.test(input.entryLamports) || BigInt(input.entryLamports) <= 0n) {
      throw new Error("Paper entry amount must be a positive integer lamport value.");
    }
    if (!/^\d+$/.test(input.tokenAmount) || BigInt(input.tokenAmount) <= 0n) {
      throw new Error("Paper token amount must be a positive integer base-unit value.");
    }
    const position: PaperPosition = {
      mint: input.mint,
      entryLamports: input.entryLamports,
      tokenAmount: input.tokenAmount,
      openedAt: input.openedAt ?? Date.now(),
      reentryCount: this.completedCycles.get(input.mint) ?? 0,
    };
    this.openPositions.set(input.mint, position);
    return { ...position };
  }

  evaluateExit(
    mint: string,
    estimatedExitLamports: string,
    takeProfitPercent = 20,
    stopLossPercent = 5,
  ): PaperExitEvaluation {
    const position = this.openPositions.get(mint);
    if (!position) throw new Error("Cannot evaluate an exit without an open paper position.");
    if (!/^\d+$/.test(estimatedExitLamports)) {
      throw new Error("Estimated exit amount must be a non-negative integer lamport value.");
    }
    const entry = BigInt(position.entryLamports);
    const exit = BigInt(estimatedExitLamports);
    const netReturnPercent = (Number(exit - entry) / Number(entry)) * 100;
    return {
      decision: decideExit(netReturnPercent, takeProfitPercent, stopLossPercent),
      netReturnPercent,
    };
  }

  close(mint: string): PaperPosition {
    const position = this.openPositions.get(mint);
    if (!position) throw new Error("Cannot close a paper position that is not open.");
    this.openPositions.delete(mint);
    this.completedCycles.set(mint, position.reentryCount + 1);
    return { ...position };
  }

  getReentryCount(mint: string): number {
    return this.completedCycles.get(mint) ?? 0;
  }
}

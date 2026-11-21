import assert from "node:assert/strict";
import test from "node:test";
import { reconcilePosition, type PositionReconciliationInput } from "../src/position-reconciliation.ts";

const mint = "Mint1111111111111111111111111111111111111";
const buy = (overrides: Partial<PositionReconciliationInput["fills"][number]> = {}) => ({
  signature: "buy-signature", slot: 10, side: "buy" as const,
  tokenAmountBaseUnits: "1000", solAmountLamports: "100000", networkFeeLamports: "5000",
  ...overrides,
});
function input(overrides: Partial<PositionReconciliationInput> = {}): PositionReconciliationInput {
  return {
    mint,
    initialTokenAmountBaseUnits: "0",
    currentTokenAmountBaseUnits: "1000",
    fullHistoryScanned: true,
    allFillsVerified: true,
    fills: [buy()],
    ...overrides,
  };
}

test("reconstructs an open position and includes buy network fee in FIFO cost", () => {
  const result = reconcilePosition(input());
  assert.equal(result.status, "managed");
  assert.equal(result.openTokenAmountBaseUnits, "1000");
  assert.equal(result.openCostLamports, "105000");
  assert.equal(result.realizedPnlLamports, "0");
});

test("allocates cost basis proportionally for a partial sell and includes sell fee", () => {
  const result = reconcilePosition(input({
    currentTokenAmountBaseUnits: "500",
    fills: [
      buy(),
      { signature: "sell-signature", slot: 20, side: "sell", tokenAmountBaseUnits: "500", solAmountLamports: "80000", networkFeeLamports: "5000" },
    ],
  }));
  assert.equal(result.status, "managed");
  assert.equal(result.openTokenAmountBaseUnits, "500");
  assert.equal(result.openCostLamports, "52500");
  assert.equal(result.realizedPnlLamports, "22500");
});

test("closes a position when full sell history reconciles to zero", () => {
  const result = reconcilePosition(input({
    currentTokenAmountBaseUnits: "0",
    fills: [
      buy(),
      { signature: "sell-signature", slot: 20, side: "sell", tokenAmountBaseUnits: "1000", solAmountLamports: "150000", networkFeeLamports: "5000" },
    ],
  }));
  assert.equal(result.status, "closed");
  assert.equal(result.openCostLamports, "0");
  assert.equal(result.realizedPnlLamports, "40000");
});

test("does not manage a token that was already held before scanned history", () => {
  assert.equal(reconcilePosition(input({ initialTokenAmountBaseUnits: "1" })).status, "unmanaged");
});

test("does not manage incomplete or unattributed history", () => {
  assert.equal(reconcilePosition(input({ fullHistoryScanned: false })).status, "unmanaged");
  assert.equal(reconcilePosition(input({ allFillsVerified: false })).status, "unmanaged");
});

test("does not manage a balance mismatch or oversold inventory", () => {
  assert.equal(reconcilePosition(input({ currentTokenAmountBaseUnits: "999" })).status, "unmanaged");
  const result = reconcilePosition(input({
    currentTokenAmountBaseUnits: "0",
    fills: [{ signature: "sell", slot: 20, side: "sell", tokenAmountBaseUnits: "1", solAmountLamports: "100", networkFeeLamports: "1" }],
  }));
  assert.equal(result.status, "unmanaged");
});

test("rejects duplicate signatures and malformed amounts", () => {
  assert.equal(reconcilePosition(input({ fills: [buy(), buy()] })).status, "unmanaged");
  assert.equal(reconcilePosition(input({ fills: [buy({ tokenAmountBaseUnits: "-1" })] })).status, "unmanaged");
});

import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLiveEntryGuard } from "../src/live-risk.ts";

function deniedReason(result: ReturnType<typeof evaluateLiveEntryGuard>): string {
  if (!result.allowed) return result.reason;
  throw new Error("Expected the live entry guard to deny this input.");
}

const safeInput = {
  emergencyStop: false,
  tokenScreenPassed: true,
  quotePassed: true,
  orderInFlight: false,
  tradeSizeLamports: "10000000",
  maxTradeSizeLamports: "20000000",
  realizedDailyLossLamports: "0",
  maxDailyLossLamports: "50000000",
  openPositions: 0,
  maxOpenPositions: 1,
};

test("allows an entry only when all independent gates pass", () => {
  assert.deepEqual(evaluateLiveEntryGuard(safeInput), { allowed: true });
});

test("emergency stop, token screening, quote and in-flight order gates fail closed", () => {
  assert.match(deniedReason(evaluateLiveEntryGuard({ ...safeInput, emergencyStop: true })), /Emergency stop/);
  assert.match(deniedReason(evaluateLiveEntryGuard({ ...safeInput, tokenScreenPassed: false })), /screening/);
  assert.match(deniedReason(evaluateLiveEntryGuard({ ...safeInput, quotePassed: false })), /quote/);
  assert.match(deniedReason(evaluateLiveEntryGuard({ ...safeInput, orderInFlight: true })), /in flight/);
});

test("blocks oversized trades, daily loss limit, and concurrent position overflow", () => {
  assert.match(deniedReason(evaluateLiveEntryGuard({ ...safeInput, tradeSizeLamports: "20000001" })), /exceeds/);
  assert.match(deniedReason(evaluateLiveEntryGuard({ ...safeInput, realizedDailyLossLamports: "50000000" })), /Daily loss/);
  assert.match(deniedReason(evaluateLiveEntryGuard({ ...safeInput, openPositions: 1 })), /Maximum concurrent/);
});

test("rejects missing or malformed financial limits instead of assuming safe defaults", () => {
  assert.throws(() => evaluateLiveEntryGuard({ ...safeInput, maxDailyLossLamports: "" }), /integer lamport/);
  assert.throws(() => evaluateLiveEntryGuard({ ...safeInput, tradeSizeLamports: "0" }), /greater than zero/);
  assert.throws(() => evaluateLiveEntryGuard({ ...safeInput, realizedDailyLossLamports: "-1" }), /integer lamport/);
  assert.throws(() => evaluateLiveEntryGuard({ ...safeInput, maxOpenPositions: 0 }), /positive safe integer/);
});

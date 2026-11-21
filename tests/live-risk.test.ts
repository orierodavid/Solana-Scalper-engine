import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLiveEntryGuard } from "../src/live-risk.ts";

function deniedReason(result: ReturnType<typeof evaluateLiveEntryGuard>): string {\n  if (!result.allowed) return result.reason;\n  throw new Error("Expected the live entry guard to deny this input.");\n}\n\nconst safeInput = {
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
  assert.match(evaluateLiveEntryGuard({ ...safeInput, emergencyStop: true }).reason!, /Emergency stop/);
  assert.match(evaluateLiveEntryGuard({ ...safeInput, tokenScreenPassed: false }).reason!, /screening/);
  assert.match(evaluateLiveEntryGuard({ ...safeInput, quotePassed: false }).reason!, /quote/);
  assert.match(evaluateLiveEntryGuard({ ...safeInput, orderInFlight: true }).reason!, /in flight/);
});

test("blocks oversized trades, daily loss limit, and concurrent position overflow", () => {
  assert.match(evaluateLiveEntryGuard({ ...safeInput, tradeSizeLamports: "20000001" }).reason!, /exceeds/);
  assert.match(evaluateLiveEntryGuard({ ...safeInput, realizedDailyLossLamports: "50000000" }).reason!, /Daily loss/);
  assert.match(evaluateLiveEntryGuard({ ...safeInput, openPositions: 1 }).reason!, /Maximum concurrent/);
});

test("rejects missing or malformed financial limits instead of assuming safe defaults", () => {
  assert.throws(() => evaluateLiveEntryGuard({ ...safeInput, maxDailyLossLamports: "" }), /integer lamport/);
  assert.throws(() => evaluateLiveEntryGuard({ ...safeInput, tradeSizeLamports: "0" }), /greater than zero/);
  assert.throws(() => evaluateLiveEntryGuard({ ...safeInput, realizedDailyLossLamports: "-1" }), /integer lamport/);
  assert.throws(() => evaluateLiveEntryGuard({ ...safeInput, maxOpenPositions: 0 }), /positive safe integer/);
});

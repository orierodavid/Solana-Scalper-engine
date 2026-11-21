import test from "node:test";
import assert from "node:assert/strict";
import { decideExit, estimateNetReturnPercent } from "../src/risk.ts";

test("calculates net return after estimated fees", () => {
  const result = estimateNetReturnPercent({
    entryValueSol: 1,
    estimatedExitValueSol: 1.25,
    estimatedFeesSol: 0.05,
  });
  assert.equal(result, 20);
});

test("triggers take profit at configured threshold", () => {
  assert.equal(decideExit(20), "take_profit");
});

test("triggers stop loss at configured threshold", () => {
  assert.equal(decideExit(-5), "stop_loss");
});

test("holds between thresholds", () => {
  assert.equal(decideExit(4.5), "hold");
});

test("rejects invalid entry values", () => {
  assert.throws(() =>
    estimateNetReturnPercent({
      entryValueSol: 0,
      estimatedExitValueSol: 1,
      estimatedFeesSol: 0,
    }),
  );
});

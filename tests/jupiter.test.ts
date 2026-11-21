import test from "node:test";
import assert from "node:assert/strict";
import { priceImpactToBps, usdToSolLamports } from "../src/jupiter.ts";

test("converts a one-dollar notional into SOL lamports", () => {
  assert.equal(usdToSolLamports(1, 100), 10_000_000n);
});

test("rejects invalid USD or SOL prices", () => {
  assert.throws(() => usdToSolLamports(0, 100));
  assert.throws(() => usdToSolLamports(1, 0));
});

test("converts Jupiter V2 percentage-point price impact to basis points", () => {
  assert.equal(priceImpactToBps({ priceImpact: 0.1 }), 10);
});

test("supports deprecated decimal-ratio price impact field", () => {
  assert.equal(priceImpactToBps({ priceImpactPct: "0.001" }), 10);
});

test("uses absolute value for signed price impact", () => {
  assert.equal(priceImpactToBps({ priceImpact: -0.1 }), 10);
});

test("rejects missing price impact data", () => {
  assert.equal(priceImpactToBps({}), null);
  assert.equal(priceImpactToBps({ priceImpact: null }), null);
  assert.equal(priceImpactToBps({ priceImpact: "" }), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";

test("defaults to a one USD trade size in paper mode", () => {
  const config = loadConfig({});
  assert.equal(config.TRADE_SIZE_USD, 1);
  assert.equal(config.TAKE_PROFIT_PERCENT, 20);
  assert.equal(config.STOP_LOSS_PERCENT, 5);
  assert.equal(config.TRADING_MODE, "paper");
});

test("accepts a configured USD trade size", () => {
  const config = loadConfig({ TRADE_SIZE_USD: "1" });
  assert.equal(config.TRADE_SIZE_USD, 1);
});

test("rejects zero or negative USD trade sizes", () => {
  assert.throws(() => loadConfig({ TRADE_SIZE_USD: "0" }));
  assert.throws(() => loadConfig({ TRADE_SIZE_USD: "-1" }));
});

test("keeps live execution locked", () => {
  assert.throws(
    () => loadConfig({ TRADING_MODE: "live", LIVE_TRADING_ENABLED: "true" }),
    /Live execution is not implemented yet/,
  );
});

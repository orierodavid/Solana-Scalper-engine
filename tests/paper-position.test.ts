import test from "node:test";
import assert from "node:assert/strict";
import { PaperPositionBook } from "../src/paper-position.ts";

test("opens one paper position and blocks duplicate entry for the same mint", () => {
  const book = new PaperPositionBook(2);
  const opened = book.open({ mint: "token-a", entryLamports: "1000000000", tokenAmount: "5000", openedAt: 100 });
  assert.equal(opened.entryLamports, "1000000000");
  assert.equal(book.canEnter("token-a"), false);
  assert.throws(() => book.open({ mint: "token-a", entryLamports: "1000000000", tokenAmount: "5000" }));
});

test("enforces the configured maximum number of open positions", () => {
  const book = new PaperPositionBook(1);
  book.open({ mint: "token-a", entryLamports: "100", tokenAmount: "10" });
  assert.equal(book.canEnter("token-b"), false);
});

test("holds until net quote return reaches the take-profit threshold", () => {
  const book = new PaperPositionBook();
  book.open({ mint: "token-a", entryLamports: "1000000000", tokenAmount: "10" });
  assert.equal(book.evaluateExit("token-a", "1190000000").decision, "hold");
  assert.equal(book.evaluateExit("token-a", "1200000000").decision, "take_profit");
});

test("triggers stop loss at the configured threshold", () => {
  const book = new PaperPositionBook();
  book.open({ mint: "token-a", entryLamports: "1000000000", tokenAmount: "10" });
  assert.equal(book.evaluateExit("token-a", "950000000").decision, "stop_loss");
});

test("allows re-entry after the full paper position is closed", () => {
  const book = new PaperPositionBook();
  book.open({ mint: "token-a", entryLamports: "100", tokenAmount: "10" });
  book.close("token-a");
  assert.equal(book.canEnter("token-a"), true);
  assert.equal(book.getReentryCount("token-a"), 1);
  const reopened = book.open({ mint: "token-a", entryLamports: "110", tokenAmount: "9" });
  assert.equal(reopened.reentryCount, 1);
});

test("rejects invalid amounts and exit evaluation without an open position", () => {
  const book = new PaperPositionBook();
  assert.throws(() => book.open({ mint: "token-a", entryLamports: "0", tokenAmount: "10" }));
  assert.throws(() => book.evaluateExit("token-a", "100"));
});

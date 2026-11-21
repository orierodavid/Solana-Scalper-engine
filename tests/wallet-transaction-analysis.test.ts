import assert from "node:assert/strict";
import test from "node:test";
import { analyzeWalletTransactionBalances, type ParsedWalletTransactionBalances } from "../src/wallet-transaction-analysis.ts";

const wallet = "Wallet111111111111111111111111111111111111";
const mint = "Mint1111111111111111111111111111111111111";

function tx(overrides: Partial<ParsedWalletTransactionBalances> = {}) {
  return {
    accountKeys: [wallet, "Other11111111111111111111111111111111111"],
    preBalances: [2_000_000_000, 1_000_000],
    postBalances: [1_900_000_000, 1_000_000],
    fee: 5_000,
    preTokenBalances: [],
    postTokenBalances: [{
      accountIndex: 1, mint, owner: wallet,
      uiTokenAmount: { amount: "1000", decimals: 6 },
    }],
    ...overrides,
  };
}

test("identifies a possible native SOL buy after excluding fee", () => {
  const result = analyzeWalletTransactionBalances(wallet, tx());
  assert.equal(result.classification, "possible_native_buy");
  assert.equal(result.nativeChangeExcludingFeeLamports, "-99995000");
  assert.equal(result.tokenDeltas[0]?.deltaBaseUnits, "1000");
});

test("identifies a possible native SOL sell", () => {
  const result = analyzeWalletTransactionBalances(wallet, tx({
    preBalances: [1_900_000_000, 1_000_000],
    postBalances: [2_000_000_000, 1_000_000],
    preTokenBalances: [{
      accountIndex: 1, mint, owner: wallet,
      uiTokenAmount: { amount: "1000", decimals: 6 },
    }],
    postTokenBalances: [],
  }));
  assert.equal(result.classification, "possible_native_sell");
  assert.equal(result.tokenDeltas[0]?.deltaBaseUnits, "-1000");
});

test("does not classify a token transfer with fee-only SOL loss as a swap", () => {
  const result = analyzeWalletTransactionBalances(wallet, tx({
    preBalances: [2_000_000_000, 1_000_000],
    postBalances: [1_999_995_000, 1_000_000],
  }));
  assert.equal(result.classification, "ambiguous");
  assert.equal(result.nativeChangeExcludingFeeLamports, "0");
});

test("marks token-to-token and multi-token changes ambiguous", () => {
  const result = analyzeWalletTransactionBalances(wallet, tx({
    preTokenBalances: [{
      accountIndex: 1, mint: "Mint2222222222222222222222222222222222222", owner: wallet,
      uiTokenAmount: { amount: "200", decimals: 6 },
    }],
    postTokenBalances: [{
      accountIndex: 1, mint, owner: wallet,
      uiTokenAmount: { amount: "1000", decimals: 6 },
    }],
  }));
  assert.equal(result.classification, "ambiguous");
});

test("ignores token accounts owned by other wallets", () => {
  const result = analyzeWalletTransactionBalances(wallet, tx({
    postTokenBalances: [{
      accountIndex: 1, mint, owner: "SomeoneElse111111111111111111111111111111",
      uiTokenAmount: { amount: "1000", decimals: 6 },
    }],
  }));
  assert.equal(result.classification, "not_swap");
});

test("returns incomplete when wallet or metadata is missing", () => {
  assert.equal(analyzeWalletTransactionBalances("Missing", tx()).classification, "incomplete");
  assert.equal(analyzeWalletTransactionBalances(wallet, tx({ postTokenBalances: null })).classification, "incomplete");
});

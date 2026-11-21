import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRugCheckSummary } from "../src/rugcheck.ts";

const clearReport = {
  score_normalised: 10,
  lpLockedPct: 95,
  risks: [],
};

test("passes a complete low-risk RugCheck summary with strong LP lock coverage", () => {
  const result = evaluateRugCheckSummary("Mint111", clearReport);
  assert.equal(result.status, "screen_passed");
  assert.equal(result.normalizedScore, 10);
  assert.equal(result.lpLockedPercent, 95);
});

test("rejects a high normalized risk score", () => {
  const result = evaluateRugCheckSummary("Mint111", {
    ...clearReport,
    score_normalised: 41,
  });
  assert.equal(result.status, "rejected");
});

test("rejects high-severity RugCheck findings", () => {
  const result = evaluateRugCheckSummary("Mint111", {
    ...clearReport,
    risks: [{ level: "danger", name: "Suspicious activity" }],
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.highRiskFindings, 1);
});

test("rejects very low reported LP lock coverage", () => {
  const result = evaluateRugCheckSummary("Mint111", {
    ...clearReport,
    lpLockedPct: 20,
  });
  assert.equal(result.status, "rejected");
});

test("marks moderate LP lock coverage inconclusive", () => {
  const result = evaluateRugCheckSummary("Mint111", {
    ...clearReport,
    lpLockedPct: 65,
  });
  assert.equal(result.status, "inconclusive");
});

test("fails closed when required RugCheck fields are missing", () => {
  assert.equal(evaluateRugCheckSummary("Mint111", { score_normalised: 2, risks: [] }).status, "inconclusive");
  assert.equal(evaluateRugCheckSummary("Mint111", null).status, "inconclusive");
  assert.equal(evaluateRugCheckSummary("Mint111", { error: "not found" }).status, "inconclusive");
});

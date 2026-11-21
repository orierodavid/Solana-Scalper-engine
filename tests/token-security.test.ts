import test from "node:test";
import assert from "node:assert/strict";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assessTokenSecuritySnapshot } from "../src/token-security.ts";

const base = {
  ownerProgram: TOKEN_PROGRAM_ID.toBase58(),
  mintInfo: {
    mintAuthority: null,
    freezeAuthority: null,
    isInitialized: true,
    decimals: 6,
  },
  supplyAmount: "1000000",
  largestAccountAmounts: ["10000", "9000", "8000", "7000", "6000", "5000", "4000", "3000", "2000", "1000"],
};

test("passes only when deterministic token security evidence is complete and clear", () => {
  const result = assessTokenSecuritySnapshot("Mint111111111111111111111111111111111111", base);
  assert.equal(result.status, "screen_passed");
  assert.equal(result.top10TokenAccountSharePercent, 5.5);
});

test("rejects an active mint authority", () => {
  const result = assessTokenSecuritySnapshot("Mint111111111111111111111111111111111111", {
    ...base,
    mintInfo: { ...base.mintInfo, mintAuthority: "Authority111111111111111111111111111111" },
  });
  assert.equal(result.status, "rejected");
  assert.ok(result.reasons.some((reason) => reason.includes("Mint authority")));
});

test("rejects an active freeze authority", () => {
  const result = assessTokenSecuritySnapshot("Mint111111111111111111111111111111111111", {
    ...base,
    mintInfo: { ...base.mintInfo, freezeAuthority: "Authority111111111111111111111111111111" },
  });
  assert.equal(result.status, "rejected");
});

test("rejects top-ten token-account concentration above fifty percent", () => {
  const result = assessTokenSecuritySnapshot("Mint111111111111111111111111111111111111", {
    ...base,
    largestAccountAmounts: ["600000", "1000"],
  });
  assert.equal(result.status, "rejected");
});

test("does not pass when authority evidence is missing", () => {
  const result = assessTokenSecuritySnapshot("Mint111111111111111111111111111111111111", {
    ...base,
    mintInfo: { isInitialized: true },
  });
  assert.equal(result.status, "inconclusive");
});

test("rejects selected high-risk Token-2022 extensions", () => {
  const result = assessTokenSecuritySnapshot("Mint111111111111111111111111111111111111", {
    ...base,
    ownerProgram: TOKEN_2022_PROGRAM_ID.toBase58(),
    mintInfo: {
      ...base.mintInfo,
      extensions: [{ extension: "permanentDelegate", state: {} }],
    },
  });
  assert.equal(result.status, "rejected");
});

test("does not pass unsupported token programs", () => {
  const result = assessTokenSecuritySnapshot("Mint111111111111111111111111111111111111", {
    ...base,
    ownerProgram: "11111111111111111111111111111111",
  });
  assert.equal(result.status, "inconclusive");
});

test("does not pass unknown Token-2022 extensions", () => {
  const result = assessTokenSecuritySnapshot("Mint111111111111111111111111111111111111", {
    ...base,
    ownerProgram: TOKEN_2022_PROGRAM_ID.toBase58(),
    mintInfo: {
      ...base.mintInfo,
      extensions: [{ extension: "futureUnknownExtension", state: {} }],
    },
  });
  assert.equal(result.status, "inconclusive");
});

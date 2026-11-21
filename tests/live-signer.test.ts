import test from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { createLiveSigner } from "../src/live-signer.ts";

function environment(keypair: Keypair) {
  return {
    TRADING_MODE: "live",
    LIVE_TRADING_ENABLED: "true",
    WALLET_PUBLIC_ADDRESS: keypair.publicKey.toBase58(),
    LIVE_WALLET_SECRET_KEY_JSON: JSON.stringify(Array.from(keypair.secretKey)),
  };
}

test("live signer stays locked unless both explicit switches are enabled", () => {
  const keypair = Keypair.generate();
  assert.throws(() => createLiveSigner({ ...environment(keypair), TRADING_MODE: "paper" }), /locked/);
  assert.throws(() => createLiveSigner({ ...environment(keypair), LIVE_TRADING_ENABLED: "false" }), /locked/);
});

test("loads a signer only when its public key matches the configured wallet", () => {
  const keypair = Keypair.generate();
  const signer = createLiveSigner(environment(keypair));
  assert.equal(signer.publicKey.toBase58(), keypair.publicKey.toBase58());
});

test("rejects a signer whose public key differs from the configured wallet", () => {
  const keypair = Keypair.generate();
  assert.throws(
    () => createLiveSigner({ ...environment(keypair), WALLET_PUBLIC_ADDRESS: Keypair.generate().publicKey.toBase58() }),
    /does not match/,
  );
});

test("rejects missing and malformed secret material without echoing it", () => {
  const keypair = Keypair.generate();
  assert.throws(
    () => createLiveSigner({ ...environment(keypair), LIVE_WALLET_SECRET_KEY_JSON: undefined }),
    /not configured/,
  );
  assert.throws(
    () => createLiveSigner({ ...environment(keypair), LIVE_WALLET_SECRET_KEY_JSON: "[1,2,3]" }),
    /exactly 64 integer bytes/,
  );
  assert.throws(
    () => createLiveSigner({ ...environment(keypair), LIVE_WALLET_SECRET_KEY_JSON: "not-json" }),
    /valid JSON byte array/,
  );
});

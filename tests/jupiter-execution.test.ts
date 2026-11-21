import test from "node:test";
import assert from "node:assert/strict";
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { executeJupiterSwap } from "../src/jupiter-execution.ts";

const INPUT_MINT = "So11111111111111111111111111111111111111112";
const OUTPUT_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function unsignedTransaction(signer: Keypair): string {
  const message = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1,
      }),
    ],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
}

function input(signer: Keypair, fetcher: typeof fetch) {
  return {
    signer,
    inputMint: INPUT_MINT,
    outputMint: OUTPUT_MINT,
    inputAmount: "100000000",
    maxSlippageBps: 100,
    apiKey: "test-key",
    fetcher,
  };
}

test("requests a fresh order, signs it, and accepts only Jupiter-confirmed execution", async () => {
  const signer = Keypair.generate();
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls += 1;
    if (calls === 1) {
      const parsed = new URL(String(url));
      assert.equal(parsed.pathname, "/swap/v2/order");
      assert.equal(parsed.searchParams.get("taker"), signer.publicKey.toBase58());
      assert.equal(parsed.searchParams.get("slippageBps"), "100");
      return new Response(JSON.stringify({
        inputMint: INPUT_MINT,
        outputMint: OUTPUT_MINT,
        inAmount: "100000000",
        outAmount: "250000",
        requestId: "request-1",
        router: "metis",
        transaction: unsignedTransaction(signer),
      }), { status: 200 });
    }
    assert.equal(new URL(String(url)).pathname, "/swap/v2/execute");
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body)) as { signedTransaction: string; requestId: string };
    assert.equal(body.requestId, "request-1");
    const signed = VersionedTransaction.deserialize(Buffer.from(body.signedTransaction, "base64"));
    assert.ok(signed.signatures.some((signature) => signature.some((byte) => byte !== 0)));
    return new Response(JSON.stringify({
      status: "Success",
      code: 0,
      signature: "confirmed-signature",
      totalInputAmount: "100000000",
      totalOutputAmount: "250000",
    }), { status: 200 });
  };

  const result = await executeJupiterSwap(input(signer, fetcher));
  assert.equal(calls, 2);
  assert.equal(result.signature, "confirmed-signature");
  assert.equal(result.outputAmount, "250000");
});

test("refuses to sign when Jupiter returns a mismatched order", async () => {
  const signer = Keypair.generate();
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({
    inputMint: INPUT_MINT,
    outputMint: OUTPUT_MINT,
    inAmount: "1",
    outAmount: "250000",
    requestId: "request-1",
    transaction: unsignedTransaction(signer),
  }), { status: 200 });
  await assert.rejects(() => executeJupiterSwap(input(signer, fetcher)), /incomplete or mismatched/);
});

test("does not execute when the returned transaction does not require this wallet", async () => {
  const signer = Keypair.generate();
  const otherSigner = Keypair.generate();
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({
    inputMint: INPUT_MINT,
    outputMint: OUTPUT_MINT,
    inAmount: "100000000",
    outAmount: "250000",
    requestId: "request-1",
    transaction: unsignedTransaction(otherSigner),
  }), { status: 200 });
  await assert.rejects(() => executeJupiterSwap(input(signer, fetcher)), /not a required signer/);
});

test("refuses unsuccessful or ambiguous execute results and never retries", async () => {
  const signer = Keypair.generate();
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({
        inputMint: INPUT_MINT,
        outputMint: OUTPUT_MINT,
        inAmount: "100000000",
        outAmount: "250000",
        requestId: "request-1",
        transaction: unsignedTransaction(signer),
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      status: "Failed",
      code: -1000,
      signature: "",
    }), { status: 200 });
  };
  await assert.rejects(() => executeJupiterSwap(input(signer, fetcher)), /did not confirm a successful swap/);
  assert.equal(calls, 2);
});

test("rejects unsafe slippage and missing API key before requesting an order", async () => {
  const signer = Keypair.generate();
  const neverFetch: typeof fetch = async () => {
    throw new Error("fetch must not be called");
  };
  await assert.rejects(() => executeJupiterSwap({ ...input(signer, neverFetch), maxSlippageBps: 101 }), /between 1 and 100/);
  await assert.rejects(() => executeJupiterSwap({ ...input(signer, neverFetch), apiKey: "" }), /JUPITER_API_KEY is required/);
});

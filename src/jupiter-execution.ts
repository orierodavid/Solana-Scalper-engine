import { Keypair, VersionedTransaction } from "@solana/web3.js";

const JUPITER_BASE_URL = "https://api.jup.ag/swap/v2";

type OrderResponse = {
  inputMint?: unknown;
  outputMint?: unknown;
  inAmount?: unknown;
  outAmount?: unknown;
  transaction?: unknown;
  requestId?: unknown;
  router?: unknown;
  lastValidBlockHeight?: unknown;
};

type ExecuteResponse = {
  status?: unknown;
  signature?: unknown;
  code?: unknown;
  totalInputAmount?: unknown;
  totalOutputAmount?: unknown;
  inputAmountResult?: unknown;
  outputAmountResult?: unknown;
  error?: unknown;
};

export type ExecutedSwap = {
  signature: string;
  router: string;
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  outputAmount: string;
};

/**
 * Executes exactly one fresh Jupiter Swap API V2 order.
 * This function is deliberately not called by either existing worker.
 * Callers must complete token/risk checks and enforce their own order lock.
 */
export async function executeJupiterSwap(input: {
  signer: Keypair;
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  maxSlippageBps: number;
  apiKey: string;
  fetcher?: typeof fetch;
}): Promise<ExecutedSwap> {
  if (!input.apiKey.trim()) throw new Error("JUPITER_API_KEY is required for live execution.");
  if (!/^\d+$/.test(input.inputAmount) || BigInt(input.inputAmount) <= 0n) {
    throw new Error("Live swap input amount must be a positive integer base-unit value.");
  }
  if (!Number.isInteger(input.maxSlippageBps) || input.maxSlippageBps < 1 || input.maxSlippageBps > 100) {
    throw new Error("Live swap slippage must be between 1 and 100 basis points.");
  }
  if (input.inputMint === input.outputMint) throw new Error("Live swap input and output mints must differ.");

  const fetcher = input.fetcher ?? fetch;
  const orderUrl = new URL(`${JUPITER_BASE_URL}/order`);
  orderUrl.search = new URLSearchParams({
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    amount: input.inputAmount,
    taker: input.signer.publicKey.toBase58(),
    slippageBps: String(input.maxSlippageBps),
  }).toString();

  const orderResponse = await fetcher(orderUrl, {
    headers: { accept: "application/json", "x-api-key": input.apiKey },
    signal: AbortSignal.timeout(12_000),
  });
  if (!orderResponse.ok) {
    throw new Error(`Jupiter order request failed with HTTP ${orderResponse.status}; no transaction was signed.`);
  }

  const order = await orderResponse.json() as OrderResponse;
  if (
    order.inputMint !== input.inputMint ||
    order.outputMint !== input.outputMint ||
    order.inAmount !== input.inputAmount ||
    typeof order.outAmount !== "string" ||
    !/^\d+$/.test(order.outAmount) ||
    BigInt(order.outAmount) <= 0n ||
    typeof order.requestId !== "string" ||
    order.requestId.length === 0 ||
    typeof order.transaction !== "string" ||
    order.transaction.length === 0
  ) {
    throw new Error("Jupiter returned an incomplete or mismatched live order; refusing to sign.");
  }

  let transaction: VersionedTransaction;
  try {
    transaction = VersionedTransaction.deserialize(Buffer.from(order.transaction, "base64"));
  } catch {
    throw new Error("Jupiter returned an invalid versioned transaction; refusing to sign.");
  }

  const requiredSignerCount = transaction.message.header.numRequiredSignatures;
  const requiredSigners = transaction.message.staticAccountKeys.slice(0, requiredSignerCount);
  if (!requiredSigners.some((key) => key.equals(input.signer.publicKey))) {
    throw new Error("The live wallet is not a required signer for this Jupiter transaction.");
  }

  // JupiterZ RFQ orders may need an additional market-maker signature later.
  // VersionedTransaction.sign adds this wallet's signature without replacing other signer slots.
  transaction.sign([input.signer]);
  const signedTransaction = Buffer.from(transaction.serialize()).toString("base64");

  let executeResponse: Response;
  try {
    executeResponse = await fetcher(`${JUPITER_BASE_URL}/execute`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": input.apiKey,
      },
      body: JSON.stringify({ signedTransaction, requestId: order.requestId }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // A timeout after submission is ambiguous. Never automatically retry this swap.
    throw new Error("Jupiter execute request outcome is unknown; reconcile the wallet and transaction before any retry.");
  }

  if (!executeResponse.ok) {
    throw new Error(`Jupiter execute returned HTTP ${executeResponse.status}; reconcile wallet state before any retry.`);
  }

  const result = await executeResponse.json() as ExecuteResponse;
  if (
    result.status !== "Success" ||
    result.code !== 0 ||
    typeof result.signature !== "string" ||
    result.signature.length === 0 ||
    typeof result.totalInputAmount !== "string" ||
    !/^\d+$/.test(result.totalInputAmount) ||
    typeof result.totalOutputAmount !== "string" ||
    !/^\d+$/.test(result.totalOutputAmount)
  ) {
    throw new Error("Jupiter did not confirm a successful swap; reconcile wallet state before any retry.");
  }

  return {
    signature: result.signature,
    router: typeof order.router === "string" ? order.router : "unknown",
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    inputAmount: result.totalInputAmount,
    outputAmount: result.totalOutputAmount,
  };
}

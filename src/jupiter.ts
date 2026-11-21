import { PublicKey } from "@solana/web3.js";

export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const STABLE_MINTS = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);
const DEXSCREENER_TOKEN_URL = "https://api.dexscreener.com/latest/dex/tokens";
const JUPITER_ORDER_URL = "https://api.jup.ag/swap/v2/order";

type DexPair = {
  chainId?: unknown;
  baseToken?: { address?: unknown };
  quoteToken?: { address?: unknown };
  priceUsd?: unknown;
  liquidity?: { usd?: unknown };
};

type DexTokenResponse = { pairs?: DexPair[] | null };

type JupiterOrder = {
  inputMint?: unknown;
  outputMint?: unknown;
  inAmount?: unknown;
  outAmount?: unknown;
  otherAmountThreshold?: unknown;
  priceImpact?: unknown;
  priceImpactPct?: unknown;
  feeBps?: unknown;
  router?: unknown;
  transaction?: unknown;
  signatureFeeLamports?: unknown;
  prioritizationFeeLamports?: unknown;
  rentFeeLamports?: unknown;
};

export type QuoteEvaluation = {
  mint: string;
  tradeSizeUsd: number;
  solUsd: number;
  inputLamports: string;
  buy: { outputAmount: string; router: string; priceImpactBps: number; feeBps: number | null };
  sell: { outputLamports: string; router: string; priceImpactBps: number; feeBps: number | null };
  roundTripReturnPercent: number;
  status: "quote_passed" | "rejected";
  reasons: string[];
  execution: "disabled";
  networkAndWalletCosts: "not fully included in quote-only evaluation";
};

function positiveNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function usdToSolLamports(usd: number, solUsd: number): bigint {
  if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(solUsd) || solUsd <= 0) {
    throw new Error("USD notional and SOL/USD price must be positive finite numbers.");
  }
  const lamports = BigInt(Math.floor((usd / solUsd) * 1_000_000_000));
  if (lamports <= 0n) throw new Error("USD trade size is below one lamport.");
  return lamports;
}

export function priceImpactToBps(order: Pick<JupiterOrder, "priceImpact" | "priceImpactPct">): number | null {
  const impactPoints = typeof order.priceImpact === "number" ? order.priceImpact : Number(order.priceImpact);
  if (Number.isFinite(impactPoints)) return Math.abs(impactPoints) * 100;
  const legacyRatio = typeof order.priceImpactPct === "number"
    ? order.priceImpactPct
    : Number(order.priceImpactPct);
  if (Number.isFinite(legacyRatio)) return Math.abs(legacyRatio) * 10_000;
  return null;
}

async function fetchJson<T>(url: string, apiKey?: string): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Quote data request failed: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export async function getSolUsdPrice(): Promise<number> {
  const data = await fetchJson<DexTokenResponse>(`${DEXSCREENER_TOKEN_URL}/${WRAPPED_SOL_MINT}`);
  const eligible = (data.pairs ?? [])
    .filter((pair) =>
      pair.chainId === "solana" &&
      pair.baseToken?.address === WRAPPED_SOL_MINT &&
      typeof pair.quoteToken?.address === "string" &&
      STABLE_MINTS.has(pair.quoteToken.address),
    )
    .map((pair) => ({
      price: positiveNumber(pair.priceUsd),
      liquidity: nonNegativeNumber(pair.liquidity?.usd) ?? 0,
    }))
    .filter((pair): pair is { price: number; liquidity: number } => pair.price !== null)
    .sort((a, b) => b.liquidity - a.liquidity);

  const best = eligible[0];
  if (!best) throw new Error("No reliable SOL/USD stablecoin market price was returned.");
  return best.price;
}

async function getQuote(
  inputMint: string,
  outputMint: string,
  amount: string,
  apiKey?: string,
): Promise<JupiterOrder> {
  const url = new URL(JUPITER_ORDER_URL);
  url.search = new URLSearchParams({ inputMint, outputMint, amount }).toString();
  const order = await fetchJson<JupiterOrder>(url.toString(), apiKey);

  // No taker is ever supplied. A transaction response would violate quote-only mode.
  if (order.transaction !== null) {
    throw new Error("Jupiter did not return a quote-only response; refusing to continue.");
  }
  if (order.inputMint !== inputMint || order.outputMint !== outputMint) {
    throw new Error("Jupiter quote token pair did not match the requested pair.");
  }
  if (typeof order.inAmount !== "string" || order.inAmount !== amount) {
    throw new Error("Jupiter quote input amount did not match the requested amount.");
  }
  if (typeof order.outAmount !== "string" || !/^\d+$/.test(order.outAmount) || BigInt(order.outAmount) <= 0n) {
    throw new Error("Jupiter returned an invalid or empty output amount.");
  }
  return order;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function evaluateJupiterRoundTrip(input: {
  mint: string;
  tradeSizeUsd: number;
  maxPriceImpactBps: number;
  apiKey?: string;
}): Promise<QuoteEvaluation> {
  const mint = new PublicKey(input.mint).toBase58();
  if (mint === WRAPPED_SOL_MINT) throw new Error("Candidate mint cannot be wrapped SOL.");
  if (!Number.isFinite(input.maxPriceImpactBps) || input.maxPriceImpactBps <= 0) {
    throw new Error("Maximum price impact must be a positive finite number.");
  }

  const solUsd = await getSolUsdPrice();
  const inputLamports = usdToSolLamports(input.tradeSizeUsd, solUsd);
  const buyOrder = await getQuote(WRAPPED_SOL_MINT, mint, inputLamports.toString(), input.apiKey);
  // Jupiter keyless access is rate-limited to 0.5 requests/second.
  await delay(2_100);
  const sellOrder = await getQuote(mint, WRAPPED_SOL_MINT, buyOrder.outAmount as string, input.apiKey);

  const buyImpactBps = priceImpactToBps(buyOrder);
  const sellImpactBps = priceImpactToBps(sellOrder);
  if (buyImpactBps === null || sellImpactBps === null) {
    throw new Error("Jupiter omitted price-impact data; quote cannot pass safety evaluation.");
  }

  const sellLamports = BigInt(sellOrder.outAmount as string);
  const roundTripReturnPercent = (Number(sellLamports - inputLamports) / Number(inputLamports)) * 100;
  const reasons: string[] = [];
  if (buyImpactBps > input.maxPriceImpactBps) reasons.push("Buy quote exceeds maximum price impact.");
  if (sellImpactBps > input.maxPriceImpactBps) reasons.push("Sell quote exceeds maximum price impact.");
  if (!Number.isFinite(roundTripReturnPercent)) reasons.push("Round-trip return estimate is invalid.");

  return {
    mint,
    tradeSizeUsd: input.tradeSizeUsd,
    solUsd,
    inputLamports: inputLamports.toString(),
    buy: {
      outputAmount: buyOrder.outAmount as string,
      router: typeof buyOrder.router === "string" ? buyOrder.router : "unknown",
      priceImpactBps: buyImpactBps,
      feeBps: nonNegativeNumber(buyOrder.feeBps),
    },
    sell: {
      outputLamports: sellLamports.toString(),
      router: typeof sellOrder.router === "string" ? sellOrder.router : "unknown",
      priceImpactBps: sellImpactBps,
      feeBps: nonNegativeNumber(sellOrder.feeBps),
    },
    roundTripReturnPercent,
    status: reasons.length === 0 ? "quote_passed" : "rejected",
    reasons,
    execution: "disabled",
    networkAndWalletCosts: "not fully included in quote-only evaluation",
  };
}

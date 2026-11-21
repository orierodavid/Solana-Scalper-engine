type DiscoveryItem = {
  chainId?: unknown;
  tokenAddress?: unknown;
};

type DexPair = {
  chainId?: unknown;
  pairAddress?: unknown;
  baseToken?: { address?: unknown; symbol?: unknown; name?: unknown };
  quoteToken?: { symbol?: unknown };
  priceUsd?: unknown;
  liquidity?: { usd?: unknown };
  volume?: Record<string, unknown>;
  txns?: Record<string, unknown>;
  pairCreatedAt?: unknown;
};

export type Candidate = {
  mint: string;
  symbol: string;
  name: string;
  priceUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  transactions24h: number;
  pairCreatedAt: number | null;
};

const API = "https://api.dexscreener.com";
const MIN_LIQUIDITY_USD = 25_000;
const MIN_VOLUME_24H_USD = 50_000;
const MIN_TXNS_24H = 100;

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "solana-scalper-engine/0.1" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Market data request failed: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/**
 * Discovery is only a market-activity prefilter. It is NOT a token safety,
 * mint-authority, holder-distribution, liquidity-lock, or rug-pull audit.
 */
export async function discoverSolanaCandidates(): Promise<Candidate[]> {
  const [profiles, boosts] = await Promise.all([
    getJson<DiscoveryItem[]>(`${API}/token-profiles/latest/v1`),
    getJson<DiscoveryItem[]>(`${API}/token-boosts/latest/v1`),
  ]);

  const mints = [...new Set([...profiles, ...boosts]
    .filter((item) => item?.chainId === "solana" && typeof item.tokenAddress === "string")
    .map((item) => item.tokenAddress as string)
    .filter((mint) => mint.length >= 32 && mint.length <= 44))].slice(0, 30);

  if (mints.length === 0) return [];

  const pairs = await getJson<DexPair[]>(
    `${API}/tokens/v1/solana/${mints.map(encodeURIComponent).join(",")}`,
  );

  const bestByMint = new Map<string, Candidate>();
  for (const pair of pairs) {
    if (pair?.chainId !== "solana" || !pair.baseToken || typeof pair.baseToken.address !== "string") continue;

    const mint = pair.baseToken.address;
    const priceUsd = finiteNumber(pair.priceUsd);
    const liquidityUsd = finiteNumber(pair.liquidity?.usd);
    const volume24hUsd = finiteNumber(pair.volume?.h24);
    const buys = finiteNumber((pair.txns?.h24 as Record<string, unknown> | undefined)?.buys);
    const sells = finiteNumber((pair.txns?.h24 as Record<string, unknown> | undefined)?.sells);
    if (priceUsd === null || liquidityUsd === null || volume24hUsd === null || buys === null || sells === null) continue;

    const transactions24h = buys + sells;
    if (
      liquidityUsd < MIN_LIQUIDITY_USD ||
      volume24hUsd < MIN_VOLUME_24H_USD ||
      transactions24h < MIN_TXNS_24H
    ) continue;

    const candidate: Candidate = {
      mint,
      symbol: typeof pair.baseToken.symbol === "string" ? pair.baseToken.symbol : "UNKNOWN",
      name: typeof pair.baseToken.name === "string" ? pair.baseToken.name : "Unknown token",
      priceUsd,
      liquidityUsd,
      volume24hUsd,
      transactions24h,
      pairCreatedAt: typeof pair.pairCreatedAt === "number" ? pair.pairCreatedAt : null,
    };

    const previous = bestByMint.get(mint);
    if (!previous || candidate.liquidityUsd > previous.liquidityUsd) bestByMint.set(mint, candidate);
  }

  return [...bestByMint.values()].sort(
    (a, b) => b.volume24hUsd - a.volume24hUsd,
  );
}

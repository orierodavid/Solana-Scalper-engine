export type WalletTransactionClassification =
  | "possible_native_buy"
  | "possible_native_sell"
  | "not_swap"
  | "ambiguous"
  | "incomplete";

export interface ParsedTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount?: { amount?: string; decimals?: number };
}

export interface ParsedWalletTransactionBalances {
  accountKeys: Array<string | { pubkey?: string | { toBase58?: () => string } }>;
  preBalances: number[];
  postBalances: number[];
  fee: number;
  preTokenBalances?: ParsedTokenBalance[] | null;
  postTokenBalances?: ParsedTokenBalance[] | null;
}

export interface WalletTransactionBalanceAnalysis {
  classification: WalletTransactionClassification;
  walletIndex: number | null;
  nativeChangeExcludingFeeLamports: string | null;
  tokenDeltas: Array<{ mint: string; deltaBaseUnits: string; decimals: number }>;
  reason: string;
}

function keyString(value: string | { toBase58?: () => string } | undefined): string {
  if (typeof value === "string") return value;
  if (value && typeof value.toBase58 === "function") return value.toBase58();
  return "";
}

/**
 * Conservative balance-delta heuristic only. It does not prove a transaction
 * was routed by Jupiter or initiated by this bot, and must not be used alone
 * to restore live positions or cost basis.
 */
export function analyzeWalletTransactionBalances(
  walletAddress: string,
  transaction: ParsedWalletTransactionBalances,
): WalletTransactionBalanceAnalysis {
  const keys = transaction.accountKeys.map((entry) => {
    if (typeof entry === "string") return entry;
    return keyString(entry.pubkey as string | { toBase58?: () => string } | undefined);
  });
  const walletIndex = keys.indexOf(walletAddress);
  const incomplete = (reason: string): WalletTransactionBalanceAnalysis => ({
    classification: "incomplete",
    walletIndex: walletIndex >= 0 ? walletIndex : null,
    nativeChangeExcludingFeeLamports: null,
    tokenDeltas: [],
    reason,
  });

  if (walletIndex < 0) return incomplete("Wallet is not present in the transaction account keys.");
  if (!Number.isSafeInteger(transaction.fee) || transaction.fee < 0 ||
      !Number.isSafeInteger(transaction.preBalances[walletIndex]) ||
      !Number.isSafeInteger(transaction.postBalances[walletIndex])) {
    return incomplete("Native balance or fee data is missing or invalid.");
  }
  if (!Array.isArray(transaction.preTokenBalances) || !Array.isArray(transaction.postTokenBalances)) {
    return incomplete("Token balance metadata is unavailable.");
  }

  const totals = new Map<string, { before: bigint; after: bigint; decimals: number; invalid: boolean }>();
  const add = (entries: ParsedTokenBalance[], side: "before" | "after") => {
    for (const item of entries) {
      if (item.owner !== walletAddress) continue;
      if (!item.mint || !Number.isInteger(item.accountIndex) ||
          !item.uiTokenAmount || !/^\d+$/.test(String(item.uiTokenAmount.amount ?? "")) ||
          !Number.isInteger(item.uiTokenAmount.decimals) || (item.uiTokenAmount.decimals ?? -1) < 0) {
        continue;
      }
      const current = totals.get(item.mint) ?? {
        before: 0n, after: 0n, decimals: item.uiTokenAmount.decimals!, invalid: false,
      };
      if (current.decimals !== item.uiTokenAmount.decimals) current.invalid = true;
      current[side] += BigInt(item.uiTokenAmount.amount!);
      totals.set(item.mint, current);
    }
  };
  add(transaction.preTokenBalances, "before");
  add(transaction.postTokenBalances, "after");

  const tokenDeltas = [...totals.entries()].map(([mint, value]) => ({
    mint,
    deltaBaseUnits: (value.after - value.before).toString(),
    decimals: value.decimals,
    invalid: value.invalid,
  })).filter((item) => item.deltaBaseUnits !== "0");

  if (tokenDeltas.some((item) => item.invalid)) {
    return { ...incomplete("Conflicting token decimal metadata was returned."), tokenDeltas: tokenDeltas.map(({mint,deltaBaseUnits,decimals})=>({mint,deltaBaseUnits,decimals})) };
  }

  const nativeChange = BigInt(transaction.postBalances[walletIndex]) -
    BigInt(transaction.preBalances[walletIndex]) + BigInt(transaction.fee);
  const positives = tokenDeltas.filter((item) => BigInt(item.deltaBaseUnits) > 0n);
  const negatives = tokenDeltas.filter((item) => BigInt(item.deltaBaseUnits) < 0n);
  let classification: WalletTransactionClassification = "ambiguous";
  let reason = "Balance changes do not match a single-token/native swap pattern.";

  if (tokenDeltas.length === 0) {
    classification = "not_swap";
    reason = "No owned token balance changed.";
  } else if (tokenDeltas.length === 1 && positives.length === 1 && nativeChange < 0n) {
    classification = "possible_native_buy";
    reason = "One owned token increased while native SOL decreased, excluding the transaction fee.";
  } else if (tokenDeltas.length === 1 && negatives.length === 1 && nativeChange > 0n) {
    classification = "possible_native_sell";
    reason = "One owned token decreased while native SOL increased, excluding the transaction fee.";
  }

  return {
    classification,
    walletIndex,
    nativeChangeExcludingFeeLamports: nativeChange.toString(),
    tokenDeltas: tokenDeltas.map(({ mint, deltaBaseUnits, decimals }) => ({ mint, deltaBaseUnits, decimals })),
    reason,
  };
}

import { Connection, PublicKey, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/web3.js";

export interface WalletTokenBalance {
  mint: string;
  amount: string;
  decimals: number;
  uiAmount: number | null;
  tokenAccounts: number;
}

export interface WalletSnapshot {
  address: string;
  solBalance: number;
  tokens: WalletTokenBalance[];
  recentSignatures: Array<{
    signature: string;
    slot: number;
    blockTime: number | null;
    err: unknown;
  }>;
  observedAt: string;
}

function readTokenAmount(value: unknown): {
  amount: string;
  decimals: number;
  uiAmount: number | null;
} {
  if (!value || typeof value !== "object") {
    throw new Error("RPC returned an invalid token amount.");
  }
  const item = value as Record<string, unknown>;
  const amount = String(item.amount ?? "");
  const decimals = Number(item.decimals);
  const uiAmount = item.uiAmount === null || item.uiAmount === undefined
    ? null
    : Number(item.uiAmount);

  if (!/^\d+$/.test(amount) || !Number.isInteger(decimals) || decimals < 0) {
    throw new Error("RPC returned malformed token account data.");
  }

  return {
    amount,
    decimals,
    uiAmount: uiAmount !== null && Number.isFinite(uiAmount) ? uiAmount : null,
  };
}

/** Read-only wallet inspection. This function never signs or submits transactions. */
export async function readWalletSnapshot(
  rpcUrl: string,
  walletAddress: string,
): Promise<WalletSnapshot> {
  let owner: PublicKey;
  try {
    owner = new PublicKey(walletAddress);
  } catch {
    throw new Error("WALLET_PUBLIC_ADDRESS is not a valid Solana public address.");
  }

  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 30_000,
  });

  const [lamports, legacyAccounts, token2022Accounts, signatures] = await Promise.all([
    connection.getBalance(owner, "confirmed"),
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, "confirmed"),
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed"),
    connection.getSignaturesForAddress(owner, { limit: 10 }, "confirmed"),
  ]);

  const totals = new Map<string, WalletTokenBalance>();
  for (const account of [...legacyAccounts.value, ...token2022Accounts.value]) {
    const parsed = account.account.data;
    if (!("parsed" in parsed)) continue;
    const info = parsed.parsed.info as Record<string, unknown>;
    const mint = String(info.mint ?? "");
    if (!mint) continue;

    const tokenAmount = readTokenAmount(info.tokenAmount);
    const previous = totals.get(mint);
    if (!previous) {
      totals.set(mint, {
        mint,
        amount: tokenAmount.amount,
        decimals: tokenAmount.decimals,
        uiAmount: tokenAmount.uiAmount,
        tokenAccounts: 1,
      });
      continue;
    }

    const combined = BigInt(previous.amount) + BigInt(tokenAmount.amount);
    previous.amount = combined.toString();
    previous.uiAmount =
      previous.uiAmount !== null && tokenAmount.uiAmount !== null
        ? previous.uiAmount + tokenAmount.uiAmount
        : null;
    previous.tokenAccounts += 1;
  }

  return {
    address: owner.toBase58(),
    solBalance: lamports / 1_000_000_000,
    tokens: [...totals.values()].filter((token) => BigInt(token.amount) > 0n),
    recentSignatures: signatures.map((item) => ({
      signature: item.signature,
      slot: item.slot,
      blockTime: item.blockTime ?? null,
      err: item.err,
    })),
    observedAt: new Date().toISOString(),
  };
}

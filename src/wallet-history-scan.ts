import { Connection, PublicKey } from "@solana/web3.js";
import {
  analyzeWalletTransactionBalances,
  type ParsedWalletTransactionBalances,
  type WalletTransactionBalanceAnalysis,
} from "./wallet-transaction-analysis.ts";

export interface WalletTransactionCandidate {
  signature: string;
  slot: number;
  blockTime: number | null;
  analysis: WalletTransactionBalanceAnalysis;
}

export interface WalletTransactionScan {
  scannedSignatures: number;
  parsedTransactions: number;
  failedTransactions: number;
  unavailableTransactions: number;
  candidates: WalletTransactionCandidate[];
  nextBefore: string | null;
}

/**
 * Read-only, bounded history scan. Candidates are balance-delta heuristics,
 * not verified bot trades. No signing, submission, storage, or auto-recovery.
 */
export async function scanWalletTransactionCandidates(input: {
  rpcUrl: string;
  walletAddress: string;
  maxSignatures?: number;
  pageSize?: number;
  before?: string;
}): Promise<WalletTransactionScan> {
  let owner: PublicKey;
  try {
    owner = new PublicKey(input.walletAddress);
  } catch {
    throw new Error("WALLET_PUBLIC_ADDRESS is not a valid Solana public address.");
  }

  const maxSignatures = input.maxSignatures ?? 200;
  const pageSize = input.pageSize ?? 100;
  if (!Number.isInteger(maxSignatures) || maxSignatures < 1 || maxSignatures > 5_000) {
    throw new Error("maxSignatures must be an integer from 1 to 5000.");
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new Error("pageSize must be an integer from 1 to 1000.");
  }

  const connection = new Connection(input.rpcUrl, { commitment: "confirmed" });
  const signatures: Array<{ signature: string; slot: number; blockTime: number | null; err: unknown }> = [];
  let before: string | undefined = input.before;

  while (signatures.length < maxSignatures) {
    const limit = Math.min(pageSize, maxSignatures - signatures.length);
    const page = await connection.getSignaturesForAddress(owner, { limit, ...(before ? { before } : {}) }, "confirmed");
    if (page.length === 0) break;
    signatures.push(...page.map((item) => ({
      signature: item.signature,
      slot: item.slot,
      blockTime: item.blockTime ?? null,
      err: item.err,
    })));
    before = page[page.length - 1]?.signature;
    if (page.length < limit) break;
  }

  const candidates: WalletTransactionCandidate[] = [];
  let parsedTransactions = 0;
  let failedTransactions = 0;
  let unavailableTransactions = 0;

  for (let offset = 0; offset < signatures.length; offset += 50) {
    const batch = signatures.slice(offset, offset + 50);
    const parsed = await connection.getParsedTransactions(
      batch.map((item) => item.signature),
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    );

    for (let index = 0; index < batch.length; index += 1) {
      const signature = batch[index]!;
      if (signature.err !== null) {
        failedTransactions += 1;
        continue;
      }
      const transaction = parsed[index];
      if (!transaction?.meta) {
        unavailableTransactions += 1;
        continue;
      }
      parsedTransactions += 1;
      const balanceData: ParsedWalletTransactionBalances = {
        accountKeys: transaction.transaction.message.accountKeys.map((key) => ({
          pubkey: key.pubkey,
        })),
        preBalances: transaction.meta.preBalances,
        postBalances: transaction.meta.postBalances,
        fee: transaction.meta.fee,
        preTokenBalances: transaction.meta.preTokenBalances?.map((item) => ({
          accountIndex: item.accountIndex,
          mint: item.mint,
          owner: item.owner,
          uiTokenAmount: {
            amount: item.uiTokenAmount.amount,
            decimals: item.uiTokenAmount.decimals,
          },
        })) ?? null,
        postTokenBalances: transaction.meta.postTokenBalances?.map((item) => ({
          accountIndex: item.accountIndex,
          mint: item.mint,
          owner: item.owner,
          uiTokenAmount: {
            amount: item.uiTokenAmount.amount,
            decimals: item.uiTokenAmount.decimals,
          },
        })) ?? null,
      };
      const analysis = analyzeWalletTransactionBalances(owner.toBase58(), balanceData);
      if (analysis.classification === "possible_native_buy" || analysis.classification === "possible_native_sell" ||
          analysis.classification === "ambiguous" || analysis.classification === "incomplete") {
        candidates.push({ signature: signature.signature, slot: signature.slot, blockTime: signature.blockTime, analysis });
      }
    }
  }

  return {
    scannedSignatures: signatures.length,
    parsedTransactions,
    failedTransactions,
    unavailableTransactions,
    candidates,
    nextBefore: signatures.length === maxSignatures ? signatures[signatures.length - 1]?.signature ?? null : null,
  };
}

import {
  Connection,
  PublicKey,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

type ParsedMintInfo = {
  mintAuthority?: unknown;
  freezeAuthority?: unknown;
  supply?: unknown;
  decimals?: unknown;
  isInitialized?: unknown;
  extensions?: Array<{ extension?: unknown; state?: unknown }>;
};

export type TokenSecurityResult = {
  mint: string;
  status: "screen_passed" | "rejected" | "inconclusive";
  reasons: string[];
  mintAuthorityActive: boolean | null;
  freezeAuthorityActive: boolean | null;
  top10TokenAccountSharePercent: number | null;
  tokenProgram: "legacy" | "token-2022" | "unsupported";
  extensions: string[];
};

export type TokenSecuritySnapshot = {
  ownerProgram: string;
  mintInfo: ParsedMintInfo;
  supplyAmount: string;
  largestAccountAmounts: string[];
};

const KNOWN_TOKEN_2022_EXTENSIONS = new Set([
  "transferFeeConfig", "transferFeeAmount", "mintCloseAuthority", "confidentialTransferMint",
  "confidentialTransferAccount", "defaultAccountState", "immutableOwner", "memoTransfer",
  "nonTransferable", "interestBearingConfig", "cpiGuard", "permanentDelegate",
  "transferHook", "metadataPointer", "tokenMetadata", "groupPointer", "groupMemberPointer",
  "scaledUiAmountConfig", "pausableConfig", "confidentialTransferFeeConfig",
]);

const HIGH_RISK_EXTENSIONS = new Set([
  "transferFeeConfig",
  "permanentDelegate",
  "transferHook",
  "nonTransferable",
  "confidentialTransferMint",
  "confidentialTransferFeeConfig",
  "pausableConfig",
]);

function validAmount(value: string): bigint | null {
  if (!/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/**
 * Deterministic RPC-based checks. Largest-account share is an account-level
 * concentration proxy, not unique-wallet ownership: pool and escrow accounts
 * can materially affect it. Unknown/incomplete evidence never passes.
 */
export function assessTokenSecuritySnapshot(
  mint: string,
  snapshot: TokenSecuritySnapshot,
): TokenSecurityResult {
  const reasons: string[] = [];
  const isLegacy = snapshot.ownerProgram === TOKEN_PROGRAM_ID.toBase58();
  const is2022 = snapshot.ownerProgram === TOKEN_2022_PROGRAM_ID.toBase58();
  const tokenProgram = isLegacy ? "legacy" : is2022 ? "token-2022" : "unsupported";

  if (tokenProgram === "unsupported") {
    reasons.push("Mint is not owned by a supported SPL Token program.");
  }

  const authorityState = (value: unknown): boolean | null =>
    value === null ? false : typeof value === "string" ? value.length > 0 : null;
  const mintAuthorityActive = authorityState(snapshot.mintInfo.mintAuthority);
  const freezeAuthorityActive = authorityState(snapshot.mintInfo.freezeAuthority);

  if (snapshot.mintInfo.isInitialized !== true) reasons.push("Mint initialization is missing or false.");
  if (mintAuthorityActive === true) reasons.push("Mint authority is still active.");
  else if (mintAuthorityActive === null) reasons.push("Mint authority status is unavailable.");
  if (freezeAuthorityActive === true) reasons.push("Freeze authority is still active.");
  else if (freezeAuthorityActive === null) reasons.push("Freeze authority status is unavailable.");

  const supply = validAmount(snapshot.supplyAmount);
  if (supply === null || supply === 0n) {
    reasons.push("Token supply is missing, invalid, or zero.");
  }

  const extensions = Array.isArray(snapshot.mintInfo.extensions)
    ? snapshot.mintInfo.extensions.map((item) => String(item.extension ?? "unknown"))
    : [];

  let unknownExtension = false;
  for (const extension of extensions) {
    if (!KNOWN_TOKEN_2022_EXTENSIONS.has(extension)) {
      unknownExtension = true;
      reasons.push(`Unrecognized Token-2022 extension requires manual review: ${extension}.`);
    }
    if (HIGH_RISK_EXTENSIONS.has(extension)) {
      reasons.push(`Token-2022 extension requires rejection: ${extension}.`);
    }
    const state = snapshot.mintInfo.extensions?.find((item) => item.extension === extension)?.state;
    if (extension === "defaultAccountState" && state && JSON.stringify(state).toLowerCase().includes("frozen")) {
      reasons.push("Token-2022 default account state is frozen.");
    }
  }

  let top10TokenAccountSharePercent: number | null = null;
  if (supply !== null && supply > 0n && snapshot.largestAccountAmounts.length > 0) {
    const amounts = snapshot.largestAccountAmounts.map(validAmount);
    if (amounts.every((amount): amount is bigint => amount !== null)) {
      const top10 = amounts.slice(0, 10).reduce((sum, amount) => sum + amount, 0n);
      top10TokenAccountSharePercent = Number((top10 * 10_000n) / supply) / 100;
      if (top10TokenAccountSharePercent > 50) {
        reasons.push("Top-ten token accounts hold more than 50% of supply; concentration requires rejection.");
      }
    }
  }

  const evidenceIncomplete =
    tokenProgram === "unsupported" ||
    snapshot.mintInfo.isInitialized !== true ||
    mintAuthorityActive === null ||
    freezeAuthorityActive === null ||
    supply === null ||
    top10TokenAccountSharePercent === null ||
    (is2022 && !Array.isArray(snapshot.mintInfo.extensions)) ||
    unknownExtension;

  const hardReject = reasons.some((reason) =>
    reason.includes("authority is still active") ||
    reason.includes("requires rejection") ||
    reason.includes("default account state is frozen") ||
    reason.includes("more than 50%"),
  );

  return {
    mint,
    status: hardReject ? "rejected" : evidenceIncomplete || reasons.length > 0 ? "inconclusive" : "screen_passed",
    reasons: reasons.length ? reasons : ["No configured deterministic red flags found."],
    mintAuthorityActive,
    freezeAuthorityActive,
    top10TokenAccountSharePercent,
    tokenProgram,
    extensions,
  };
}

export async function screenSolanaToken(
  mintAddress: string,
  rpcUrl: string,
): Promise<TokenSecurityResult> {
  const mint = new PublicKey(mintAddress);
  const connection = new Connection(rpcUrl, "confirmed");
  const [mintAccount, supplyResponse, largestResponse] = await Promise.all([
    connection.getParsedAccountInfo(mint, "confirmed"),
    connection.getTokenSupply(mint, "confirmed"),
    connection.getTokenLargestAccounts(mint, "confirmed"),
  ]);

  if (!mintAccount.value || !("parsed" in mintAccount.value.data)) {
    return {
      mint: mint.toBase58(),
      status: "inconclusive",
      reasons: ["RPC did not return parsed mint account data."],
      mintAuthorityActive: null,
      freezeAuthorityActive: null,
      top10TokenAccountSharePercent: null,
      tokenProgram: "unsupported",
      extensions: [],
    };
  }

  const parsed = mintAccount.value.data.parsed as { info?: ParsedMintInfo };
  if (!parsed.info) {
    return {
      mint: mint.toBase58(),
      status: "inconclusive",
      reasons: ["RPC mint account response omitted parsed mint information."],
      mintAuthorityActive: null,
      freezeAuthorityActive: null,
      top10TokenAccountSharePercent: null,
      tokenProgram: "unsupported",
      extensions: [],
    };
  }

  return assessTokenSecuritySnapshot(mint.toBase58(), {
    ownerProgram: mintAccount.value.owner.toBase58(),
    mintInfo: parsed.info,
    supplyAmount: supplyResponse.value.amount,
    largestAccountAmounts: largestResponse.value.map((account) => account.amount),
  });
}

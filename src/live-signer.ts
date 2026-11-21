import { Keypair } from "@solana/web3.js";

export type LiveSignerEnvironment = {
  TRADING_MODE?: string;
  LIVE_TRADING_ENABLED?: string;
  WALLET_PUBLIC_ADDRESS?: string;
  LIVE_WALLET_SECRET_KEY_JSON?: string;
};

/**
 * Creates a signer only when both live-mode switches are explicitly enabled.
 * The secret is supplied as a JSON byte array (Solana CLI keypair format)
 * through a server-side environment secret. It is never logged or persisted.
 */
export function createLiveSigner(source: LiveSignerEnvironment): Keypair {
  if (source.TRADING_MODE !== "live" || source.LIVE_TRADING_ENABLED !== "true") {
    throw new Error("Live signer is locked; both live-mode switches must be explicitly enabled.");
  }

  const expectedAddress = source.WALLET_PUBLIC_ADDRESS?.trim();
  if (!expectedAddress) {
    throw new Error("WALLET_PUBLIC_ADDRESS is required before a live signer can be loaded.");
  }

  const secretJson = source.LIVE_WALLET_SECRET_KEY_JSON;
  if (!secretJson) {
    throw new Error("LIVE_WALLET_SECRET_KEY_JSON is not configured.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(secretJson);
  } catch {
    throw new Error("LIVE_WALLET_SECRET_KEY_JSON must be a valid JSON byte array.");
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length !== 64 ||
    parsed.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    throw new Error("LIVE_WALLET_SECRET_KEY_JSON must contain exactly 64 integer bytes.");
  }

  let signer: Keypair;
  try {
    signer = Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
  } catch {
    throw new Error("The configured live wallet secret key is invalid.");
  }

  if (signer.publicKey.toBase58() !== expectedAddress) {
    throw new Error("The live signer public key does not match WALLET_PUBLIC_ADDRESS.");
  }

  return signer;
}

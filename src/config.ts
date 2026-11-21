import { z } from "zod";

const booleanFromEnv = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .default("false");

const positiveNumber = z.string().trim().min(1).transform(Number).pipe(
  z.number().finite().positive(),
);

const envSchema = z.object({
  SOLANA_RPC_URL: z.string().url(),
  TRADING_MODE: z.enum(["paper", "live"]).default("paper"),
  LIVE_TRADING_ENABLED: booleanFromEnv,
  TAKE_PROFIT_PERCENT: positiveNumber.default("20"),
  STOP_LOSS_PERCENT: positiveNumber.default("5"),
  MAX_TRADE_SIZE_SOL: z.string().trim().default(""),
  MAX_DAILY_LOSS_SOL: z.string().trim().default(""),
  MAX_OPEN_POSITIONS: z.coerce.number().int().positive().default(1),
  MAX_SLIPPAGE_BPS: z.coerce.number().int().min(1).max(500).default(100),
  POLL_INTERVAL_MS: z.coerce.number().int().min(1000).default(3000),
});

export type BotConfig = z.infer<typeof envSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): BotConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid bot configuration: ${details}`);
  }

  const config = parsed.data;
  if (config.TRADING_MODE === "live" && !config.LIVE_TRADING_ENABLED) {
    throw new Error("Live mode is locked: LIVE_TRADING_ENABLED must be explicitly true.");
  }

  if (config.TRADING_MODE === "live") {
    throw new Error("Live execution is not implemented yet. Keep TRADING_MODE=paper.");
  }

  return config;
}

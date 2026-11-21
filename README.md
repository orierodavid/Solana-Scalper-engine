# Solana Scalper Engine

A deliberately simple Solana wallet-based scalping bot. It monitors on-chain wallet activity, evaluates configured risk rules, and is being developed toward guarded swap execution.

## Current operating defaults

- Trade size: **$1 USD per trade**, converted to SOL using a live SOL/USD market price (not 1 SOL)
- Take-profit target: **+20%** (not guaranteed)
- Stop-loss threshold: **-5%**
- Live execution: **disabled**
- Trade database and trade-history dashboard: **not included**. The Solana wallet is the source of truth.

## Architecture

- Trading worker: a persistent Node.js process; a scheduled GitHub Actions run is not suitable for reliable live scalping exits.
- Wallet/on-chain state: read-only monitoring of SOL and SPL Token/Token-2022 balances.
- Quote evaluation: Jupiter Swap API V2 `/order` without a `taker`, so the API returns quote data only and no transaction.
- Swap execution: not implemented. Future execution must use fresh quotes, simulation, bounded slippage, and confirmation checks.

There is no database dependency in this project.

## Automated discovery and quote scan

Run a single read-only discovery/quote cycle with:

\`\`\`bash
npm run scan:once
\`\`\`

The scan applies the existing $5,000 liquidity, $5,000 24-hour volume, and 20 transaction filters, then evaluates at most five candidates per run. It requests buy and reverse-sell quotes sequentially, checks each leg against \`MAX_PRICE_IMPACT_BPS\`, and rejects a route when the estimated round-trip swap loss exceeds \`MAX_ROUND_TRIP_COST_PERCENT\` (default 3%). Public CI logs contain aggregate counts only, not wallet data or token identifiers. A passing quote is only a quote-quality result; it is not a signal to buy and does not establish token safety or include every wallet/network cost.

## Token security prefilter

Before requesting Jupiter quotes, the scheduled scanner now checks each candidate through Solana RPC: supported SPL Token program ownership, parsed mint initialization, revoked mint/freeze authorities, non-zero supply, selected high-risk Token-2022 extensions, and the combined share held by the ten largest token accounts. Active mint/freeze authorities, selected risky extensions, and top-ten token-account concentration above 50% are rejected. Missing or incomplete RPC evidence is inconclusive and is never sent to quote evaluation.

The top-ten figure is a token-account concentration proxy, not unique-wallet ownership. Pool, escrow, burn and other program-controlled accounts can distort it; this conservative prefilter is not a complete holder/insider analysis, liquidity-lock verification, honeypot test, or rug-pull audit. No token is declared safe.

## Quote-only test

With Node.js 22.6+ installed, copy `.env.example` to `.env` and run:

```bash
npm install
npm run quote:once -- <SOLANA_TOKEN_MINT>
```

The command converts the configured USD notional to SOL lamports using the most liquid SOL/stablecoin pair returned by DexScreener, requests a Jupiter buy quote, then requests a reverse sell quote for the quoted token output. It reports price impact and the estimated round-trip return. It never supplies a wallet signer or submits a transaction.

Jupiter keyless quote requests are rate-limited; set `JUPITER_API_KEY` privately in your local environment for higher production limits. Never commit `.env` or API keys.

A quote passing the configured price-impact ceiling is **not** trade approval. The round-trip estimate does not fully include wallet-specific rent, signature/priority fees, token safety, execution slippage after the quote, or transaction simulation. Those checks are still required before any live trading.

## Safety

A +20% target is an exit rule, not a promised return. Actual proceeds can be lower because of price movement, liquidity, slippage, priority fees, and swap fees. A stop-loss is also not guaranteed to execute at the threshold.

A $1 order must be checked for minimum route size, token decimals, price impact, all-in fees, and transaction simulation. If a route is uneconomical, unavailable, or fails simulation, the bot must skip it. A small notional does not make a thin or unsafe token safe.

Never put a seed phrase or private key in source code, GitHub, browser code, or a client-side variable. Use a dedicated low-balance trading wallet and server-side signing only. Live trading remains locked until token screening, wallet signing, simulation, transaction confirmation, restart recovery, position sizing, loss limits, and emergency-stop behavior have been tested.

See docs/architecture.md for the operating model.

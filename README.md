# Solana Scalper Engine

A deliberately simple Solana wallet-based scalping bot. It monitors on-chain wallet activity and token balances, evaluates configured risk rules, and can submit swaps through a supported Solana swap route.

## Current operating defaults

- Take-profit target: **+20%** (not guaranteed)
- Stop-loss threshold: **-5%**
- Trade sizing: configured by the operator; no assumed amount
- Token universe: liquid established tokens and carefully screened new/meme tokens
- Live execution: **disabled until explicitly configured and safety checks pass**
- Trade database: **none**. The wallet and Solana chain are the source of truth.
- Trade-history dashboard: **not included**. Review confirmed activity in your Solana wallet/explorer.

## Architecture

- **Web control panel/API:** deployed on Vercel.
- **Trading worker:** a persistent Node.js process that monitors positions and evaluates exits. It must run on an always-on worker host; Vercel serverless functions are not a substitute for a continuously running process.
- **Wallet/on-chain state:** read-only monitoring of SOL balance, SPL Token/Token-2022 holdings, and recent signatures. No wallet private key is needed for this stage.
- **Swap execution:** Jupiter routes with transaction simulation, slippage limits, and confirmation checks.

There is no database dependency in this project. The worker may keep temporary in-memory caches, but they are disposable and must be rebuildable from on-chain data.

## Safety

A +20% target is an exit rule, not a promised return. Actual proceeds can be lower because of price movement, liquidity, slippage, priority fees, and swap fees. A stop-loss is also not guaranteed to execute at the threshold, especially in thin or rapidly moving markets.

Never put a seed phrase or private key in source code, GitHub, browser code, or a Vercel client-side variable. Use a dedicated low-balance trading wallet and a server-side secret manager. Do not fund it with money you cannot afford to lose.

Live trading remains locked until wallet signing, token screening, swap simulation, transaction confirmation, restart recovery, position sizing, daily loss limits, and emergency-stop behavior have been tested.

## Getting started

1. Copy `.env.example` to `.env` for local development.
2. Configure a trusted Solana RPC endpoint and your public wallet address in `WALLET_PUBLIC_ADDRESS`.
3. Start in paper/simulation mode.
4. Run the tests before enabling any live execution.

See [docs/architecture.md](docs/architecture.md) for the initial design.

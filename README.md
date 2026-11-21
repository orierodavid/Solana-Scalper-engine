# Solana Scalper Engine

A deliberately simple Solana wallet-based scalping bot. It monitors on-chain wallet activity, evaluates configured risk rules, and is being developed toward guarded swap execution.

## Current operating defaults

- Trade size: **$1 USD per trade**, converted from a live USD-denominated quote (not 1 SOL)
- Take-profit target: **+20%** (not guaranteed)
- Stop-loss threshold: **-5%**
- Live execution: **disabled**
- Trade database and trade-history dashboard: **not included**. The Solana wallet is the source of truth.

## Architecture

- Trading worker: a persistent Node.js process; a scheduled GitHub Actions run is not suitable for reliable live scalping exits.
- Wallet/on-chain state: read-only monitoring of SOL and SPL Token/Token-2022 balances.
- Swap execution: not implemented. Future execution must use fresh quotes, simulation, bounded slippage, and confirmation checks.

There is no database dependency in this project.

## Safety

A +20% target is an exit rule, not a promised return. Actual proceeds can be lower because of price movement, liquidity, slippage, priority fees, and swap fees. A stop-loss is also not guaranteed to execute at the threshold.

A $1 order must be checked for minimum route size, token decimals, price impact, all-in fees, and transaction simulation. If a route is uneconomical, unavailable, or fails simulation, the bot must skip it. A small notional does not make a thin or unsafe token safe.

Never put a seed phrase or private key in source code, GitHub, browser code, or a client-side variable. Use a dedicated low-balance trading wallet and server-side signing only. Live trading remains locked until token screening, wallet signing, simulation, transaction confirmation, restart recovery, position sizing, loss limits, and emergency-stop behavior have been tested.

## Getting started

1. Copy the environment example file to .env for local development.
2. Configure a trusted Solana RPC endpoint and your public wallet address.
3. Keep TRADE_SIZE_USD=1 and run in paper mode.
4. Run typechecking and tests before any live-execution work.

See docs/architecture.md for the initial design.

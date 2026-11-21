# Architecture and operating model

## No database

The Solana wallet is the durable record of confirmed swaps and token balances. This project intentionally does not add Supabase, PostgreSQL, Redis, or a trade-history database.

The worker must reconstruct its view after every restart by:
1. Reading the configured wallet's SOL and token balances.
2. Reading recent confirmed wallet signatures and transaction details.
3. Rebuilding token lots/entry-cost estimates from attributable swap transactions.
4. Reconciling those estimates against current balances before managing exits.

If an entry cost cannot be reliably reconstructed, the worker must mark that asset as **unmanaged** and must not invent an entry price or submit an automatic sell. The operator can inspect the wallet transaction in a Solana explorer.

## Components

- Control panel/API: status, configuration validation, pause/resume, and emergency stop. No stored trade-history feature.
- Persistent worker: polls/reconciles wallet state, screens assets, evaluates exits, and submits swaps only after all required safeguards are implemented.
- Solana RPC: wallet balances, signatures, transaction details, and confirmation.
- Swap router: obtains quotes and, in a future stage, builds swap transactions. Every transaction must be simulated and checked before signing where supported.

## Quote-only Jupiter integration

- Uses Jupiter Swap API V2 `GET /order` without the `taker` parameter. Jupiter documents that this returns quote data with `transaction: null`.
- Converts the configured USD notional into SOL lamports using the most liquid wrapped-SOL/stablecoin pair from DexScreener.
- Requests a buy quote and a reverse sell quote for the exact quoted token output. Both requests are read-only.
- Rejects missing/mismatched quote amounts, missing price-impact data, and price impact above `MAX_PRICE_IMPACT_BPS`.
- Does not sign, build, or submit transactions. Quote evaluation is not token-security clearance or live-trade authorization.
- The round-trip quote includes route pricing/quoted swap charges, but does not fully establish wallet-specific rent, signature/priority fees, or execution-time slippage. Those must be checked separately before live trading.
- Keyless Jupiter requests are rate-limited; an optional API key can be supplied privately as `JUPITER_API_KEY`.

## Exit rules

- Take profit: trigger an exit when estimated net return reaches +20%.
- Stop loss: trigger an exit when estimated net return reaches -5%.
- Net return must account for estimated swap fees, priority fees, and slippage. A displayed or quoted +20% gross price move is not sufficient.
- Exit triggers are best-effort. There is no guarantee of execution at the threshold.

## Required safeguards before live trading

- Dedicated wallet with limited funds.
- Server-side signing only; no private key exposed to browser or logs.
- Explicit live-trading enable flag and startup validation.
- Maximum trade size, maximum daily loss, and maximum concurrent positions.
- Token mint and liquidity screening; reject frozen/unsupported token accounts and suspicious assets.
- Quote freshness, price impact, slippage cap, transaction simulation, and confirmation checks.
- Duplicate-order/idempotency protection.
- Emergency stop that prevents new entries and permits safe position management.
- Restart reconciliation and safe behavior when RPC/provider data is incomplete.

## Hosting

Vercel is suitable for the web control panel and short API requests. The trading worker requires a persistent process host. A Vercel Cron schedule is not equivalent to an always-running process and should not be used as the sole mechanism for tight scalping exits.

## Implemented read-only monitoring

The initial worker reads the public wallet's SOL balance, SPL Token and Token-2022 account balances, and the latest 10 confirmed signatures. It does not sign, buy, sell, or store a trade ledger. RPC data is treated as untrusted and incomplete data must never trigger an order.

This first monitoring stage does not yet calculate realized/unrealized P&L or infer cost basis. Those require correctly decoding attributable swap transactions and handling transfers, partial fills, fees, token account changes, and unknown prior holdings.

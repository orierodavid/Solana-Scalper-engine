# Architecture and operating model

## No database

The Solana wallet is the durable record of confirmed swaps and token balances. This project intentionally does not add Supabase, PostgreSQL, Redis, or a trade-history database.

The worker must reconstruct its view after every restart by:
1. Reading the configured wallet's SOL and token balances.
2. Reading recent confirmed wallet signatures and transaction details.
3. Rebuilding token lots/entry-cost estimates from attributable swap transactions.
4. Reconciling those estimates against current balances before managing exits.

If an entry cost cannot be reliably reconstructed, the worker must mark that asset as **unmanaged** and must not invent an entry price or submit an automatic sell. The operator can inspect the wallet transaction in a Solana explorer.

## Paper strategy loop

The `paper:worker` process runs continuously without signing or submitting transactions. It uses a basic momentum entry condition: positive five-minute price change and five-minute buys greater than sells. A candidate must also pass the current Solana token-screening and RugCheck gates, then pass the buy/reverse-sell quote checks at the configured USD notional.

Paper positions are held only in memory. The worker polls an open position with a fresh token-to-SOL quote, then simulates a full exit at the configured +20% take-profit or -5% stop-loss. Once closed, a mint is eligible for another paper entry only after a later scan observes a fresh valid momentum signal and all entry checks pass. The current default is one open position, a 3-second position poll and a 30-second candidate scan.

This is not live execution. It does not spend SOL, sign, build, or broadcast transactions. Simulated positions are lost on restart; no database or trade-history store is introduced. Quote estimates do not fully account for priority/network fees or execution-time slippage. The scheduled GitHub Actions scan remains a ten-minute read-only job and cannot manage fast exits. A persistent host is needed even for the continuous paper loop.

## Components

- Control panel/API: status, configuration validation, pause/resume, and emergency stop. No stored trade-history feature.
- Persistent worker: polls/reconciles wallet state, screens assets, evaluates exits, and submits swaps only after all required safeguards are implemented.
- Solana RPC: wallet balances, signatures, transaction details, and confirmation.
- Swap router: obtains quotes and, in a future stage, builds swap transactions. Every transaction must be simulated and checked before signing where supported.

## Token security prefilter

Before quote evaluation, the scanner reads parsed mint state, token supply and the ten largest token accounts from the configured Solana RPC endpoint. It requires a supported legacy SPL Token or Token-2022 program, initialized mint, explicit revoked mint and freeze authorities, valid non-zero supply, and complete largest-account data. It rejects active mint/freeze authorities, selected high-risk Token-2022 extensions (transfer-fee config, permanent delegate, transfer hook, non-transferable and confidential-transfer extensions), frozen default account state, and top-ten token-account concentration above 50%. Incomplete evidence is inconclusive and blocks quote evaluation.

Largest token accounts are not the same as beneficial owners: pools, escrows and program-controlled accounts can distort the concentration proxy. This is a fail-closed prefilter, not a full RugCheck/insider analysis, LP-lock audit, honeypot simulation, or guarantee against malicious behavior. No aggregate score or claim of safety is inferred.

The scanner also calls RugCheck's public read-only report-summary endpoint. It requires a normalized score, risk list and LP locked percentage. It rejects scores above 40, high/critical/danger findings and LP lock coverage below 50%; 50–79.99% is inconclusive, and 80% or higher is required to proceed. Provider errors and missing fields block quote evaluation. These configured thresholds are heuristics, not proof of safety or permanent liquidity lock.

## Quote-only Jupiter integration

- Uses Jupiter Swap API V2 `GET /order` without the `taker` parameter. Jupiter documents that this returns quote data with `transaction: null`.
- Converts the configured USD notional into SOL lamports using the most liquid wrapped-SOL/stablecoin pair from DexScreener.
- Requests a buy quote and a reverse sell quote for the exact quoted token output. Both requests are read-only.
- Rejects missing/mismatched quote amounts, missing price-impact data, and price impact above `MAX_PRICE_IMPACT_BPS`.
- The quote-only scanner does not sign or submit transactions. A separate guarded Jupiter V2 execution primitive now obtains an order with the configured wallet as taker, checks the requested mints and amount, deserializes the returned versioned transaction, requires the configured wallet to be one of its required signers, partially signs it, and posts it with the request ID to `/execute`. It accepts only an explicit successful response with code `0` and actual input/output amounts. Ambiguous network outcomes are not retried automatically. This primitive is not yet wired into a worker and does not constitute live readiness.
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
- A pure fail-closed entry guard exists in `src/live-risk.ts` and has unit tests for emergency stop, token and quote gates, duplicate in-flight order, maximum trade size, daily loss and concurrent positions. It is not yet connected to a worker; callers must supply independently reconciled values. It must not be treated as an active production circuit breaker until integrated with persistent/reconstructed wallet state.
- Maximum trade size, enforced maximum daily loss, and maximum concurrent positions.
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

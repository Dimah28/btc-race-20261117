// Dip-reversal scalper for make.fun "Race a BTC trading bot live for 24 hours"
// (btc-race-24h-20261117-0603). Long-only cbBTC/USDC, 1-minute bars, $1,000 paper.
//
// Idea, tuned on this competition's published dev window (24h ending at the
// open, BTC +0.49%, range $63,874-$65,467, calm: worst 1-minute move 0.45%):
// the dev day's only durable edge was deep, hour-scale dips that reversed.
// Frequent trading bleeds out: one full-size round trip costs ~26 bps in fee,
// slippage and pool impact, and 1-minute noise is ~6 bps, so small triggers
// and tight exits lose to costs (verified offline: RSI/EMA variants lost
// $90-$127 on the dev window, mostly fees). This bot therefore waits for a
// rare, deep dip and then holds patiently for a real reversal:
//
//   Entry: close down >= 1.0% over the last 60 bars AND an uptick
//          (close above the previous bar's close), full cash, one position.
//   Exit:  +1.2% from the fill price, or -0.8%, or 120 bars held, whichever
//          comes first; sells the whole position.
//   max_slippage_bps 300 on every order.
//
// Offline replay of the same rules on the dev window (same fill model:
// next-open fills, 4 bps fee, 2 bps slippage, constant-product impact
// against the bar's open depth): net PnL +$11.01, 3 round trips, max
// drawdown 0.57%. The big winner was the day's main dip (bought ~$64,220,
// sold ~$64,996, +1.21%). No randomness, no clock, no network: the only
// state is the close history and the entry fill price, so two runs on the
// same data produce byte-identical orders.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Strategy parameters (basis points unless noted).
const LOOKBACK_BARS = 60; // dip measured over this many bars
const DIP_BPS = 100; // entry: close down at least 1.0% over LOOKBACK_BARS
const TAKE_PROFIT_BPS = 120; // exit: +1.2% from the fill price
const STOP_LOSS_BPS = 80; // exit: -0.8% from the fill price
const MAX_HOLD_BARS = 120; // exit: 120 bars after the fill, at the latest
const MAX_SLIPPAGE_BPS = 300;

const closes: bigint[] = [];
let entryPrice: bigint | null = null;
let entrySeq = -1;

function bpsChange(now: bigint, before: bigint): bigint {
  // (now - before) / before, in basis points, truncated toward zero.
  return ((now - before) * 10_000n) / before;
}

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    // Remember the fill price of any buy that landed on this batch, so the
    // exit is measured from what we actually paid, fees and impact included.
    for (const fill of batch.fills) {
      if (fill.status === 'filled' && fill.symbol === SYMBOL) {
        if (fill.side === 'buy') {
          entryPrice = BigInt(fill.price);
          entrySeq = batch.seq;
        } else {
          entryPrice = null;
          entrySeq = -1;
        }
      }
    }

    if (state.warmingUp) return [];
    const bar = state.latest.get(SYMBOL);
    if (bar === undefined) return [];
    const close = BigInt(bar.c);
    closes.push(close);

    const held = state.positions.get(SYMBOL);
    const qty = held === undefined ? 0n : held.qty;

    if (qty > 0n) {
      // Holding: take profit, stop loss, or time stop.
      if (entryPrice !== null) {
        const ret = bpsChange(close, entryPrice);
        const heldBars = batch.seq - entrySeq;
        if (ret >= TAKE_PROFIT_BPS || ret <= -STOP_LOSS_BPS || heldBars >= MAX_HOLD_BARS) {
          return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }
      return [];
    }

    // Flat: enter only on a deep 60-bar dip confirmed by an uptick.
    if (closes.length <= LOOKBACK_BARS) return [];
    const ago = closes[closes.length - 1 - LOOKBACK_BARS];
    const prev = closes[closes.length - 2];
    const drop = bpsChange(close, ago);
    if (drop <= -DIP_BPS && close > prev && state.cash > 0n) {
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  },
});

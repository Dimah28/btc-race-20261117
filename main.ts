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
//          A second, slower trigger covers deep two-hour grinds: down
//          >= 1.5% over 120 bars with an uptick.
//   Exit:  +1.2% from the fill price, or -0.8%, or 120 bars held, whichever
//          comes first (+1.5% / -1.0% / 180 bars for the slow trigger);
//          sells the whole position.
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
//
// Two entry triggers, both dip-reversals confirmed by an uptick, full cash,
// one position at a time. Trigger A is the workhorse, tuned on the dev
// window; trigger B never fired there (no 120-bar drop of 1.5% while flat),
// so adding it leaves the dev result unchanged, but it covers a case A
// misses on the unseen race day: a slow two-hour grind down with no single
// hour down 1%. Its exits are wider to match its slower scale.
const TRIGGERS = [
  { lookback: 60, dipBps: 100, tpBps: 120, slBps: 80, holdBars: 120 }, // A
  { lookback: 120, dipBps: 150, tpBps: 150, slBps: 100, holdBars: 180 }, // B
];
const MAX_SLIPPAGE_BPS = 300;

const closes: bigint[] = [];
let entryPrice: bigint | null = null;
let entrySeq = -1;
let active: (typeof TRIGGERS)[number] | null = null;

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
          active = null;
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
      // Holding: take profit, stop loss, or time stop, per the trigger
      // that opened the position.
      if (entryPrice !== null && active !== null) {
        const ret = bpsChange(close, entryPrice);
        const heldBars = batch.seq - entrySeq;
        if (ret >= active.tpBps || ret <= -active.slBps || heldBars >= active.holdBars) {
          return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }
      return [];
    }

    // Flat: enter on the first trigger whose dip + uptick both hold.
    // A is tried first: when both fire on the same bar, the faster, tighter
    // trigger owns the trade.
    if (closes.length <= 1) return [];
    const prev = closes[closes.length - 2];
    if (close <= prev) return [];
    for (const t of TRIGGERS) {
      if (closes.length <= t.lookback) continue;
      const ago = closes[closes.length - 1 - t.lookback];
      if (bpsChange(close, ago) <= -t.dipBps && state.cash > 0n) {
        active = t;
        return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    }
    return [];
  },
});

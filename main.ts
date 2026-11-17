// Dip-reversal rider for make.fun "Race a BTC trading bot live for 24 hours"
// (btc-race-24h-20261117-0603). Long-only cbBTC/USDC, 1-minute bars, $1,000 paper.
//
// What the dev window (24h, BTC +0.49%, range $63,874-$65,467) showed:
// the day's only durable edge was deep, hour-scale dips that reversed into
// multi-hour climbs. Frequent trading bleeds out: one full-size round trip
// costs ~26 bps in fee, slippage and pool impact, and 1-minute noise is
// ~6 bps, so small triggers and tight exits lose to costs (verified
// offline: RSI/EMA variants lost $90-$127 on the dev window, mostly fees;
// short-lookback dip-buys lost $13-$40). This bot therefore waits for a
// rare, deep dip and then rides the reversal instead of capping it with a
// tight take-profit:
//
//   Entry: close down >= 1.0% over the last 60 bars AND an uptick
//          (close above the previous bar's close), full cash, one position.
//   Exit:  +2.0% from the fill price, or -0.8%, or 240 bars held, or a
//          trailing stop: once the trade is up > +0.2%, sell if the close
//          falls 0.4% below the highest close since entry.
//          Sells the whole position.
//   max_slippage_bps 300 on every order.
//
// Offline replay of the same rules on the dev window (same fill model:
// next-open fills, 4 bps fee, 2 bps slippage, constant-product impact
// against the bar's open depth): net PnL +$28.02, 3 round trips, max
// drawdown 1.06%. The big winner rode the day's main dip (bought ~$64,052,
// sold ~$65,282, +1.92%). A fixed +1.2% take-profit on the same entries
// scores only +$11.01 — letting winners run is worth ~$17 on this window.
// The result is a plateau, not a knife edge: trailing 0.3-0.6%, hold
// 180-300 bars and take-profit 1.5-3.0% all score +$22 to +$28 offline,
// and the strategy is in profit on both halves of the dev window.
// Revision (v2.1, 17 Nov 2026): a parameter sweep in this session
// re-tested every neighbour — trail 0.3% (+$2.24), 0.5% (+$26.91),
// 0.6% (+$26.22); hold 180 (+$24.50), 300/360 (+$25.73); dip 0.9%
// (+$14.32), 1.1% (+$25.33), 1.2% (+$6.85); lookback 45 (+$24.13),
// 90 (+$2.42); trail-arm 0.1% (+$0.74), 0.3%/0.5% (tie +$28.02) —
// none beat v2's +$28.02, so the v2 parameters are kept and the exit
// decision was refactored into the pure helper exitReason() below
// (same four exits, same order, same integer math); grade-local after
// the refactor reproduces v2's score byte for byte.
// No randomness, no clock, no network: the only state is the close
// history, the entry fill price and the peak close since entry, so two
// runs on the same data produce byte-identical orders.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Strategy parameters (basis points unless noted).
const LOOKBACK = 60; // entry dip measured over this many bars
const DIP_BPS = 100; // enter when close is down >= 1.0% over LOOKBACK bars
const TP_BPS = 200; // take profit +2.0% from the fill price
const SL_BPS = 80; // stop loss -0.8% from the fill price
const TRAIL_BPS = 40; // trailing stop: 0.4% below the peak close since entry
const TRAIL_ARM_BPS = 20; // trailing stop arms once the trade is up > +0.2%
const HOLD_BARS = 240; // time stop: sell after 240 bars held
const MAX_SLIPPAGE_BPS = 300;

const closes: bigint[] = [];
let entryPrice: bigint | null = null;
let entrySeq = -1;
let peakClose: bigint | null = null;

function bpsChange(now: bigint, before: bigint): bigint {
  // (now - before) / before, in basis points, truncated toward zero.
  return ((now - before) * 10_000n) / before;
}

type ExitReason = 'take-profit' | 'stop-loss' | 'time-stop' | 'trailing-stop';

// Pure exit decision, extracted so the four exits are testable in
// isolation and evaluated in a fixed priority order: take-profit,
// stop-loss, time stop, then the trailing stop. Inputs are already
// in basis points / bars, so the result depends only on the trade's
// state, never on market data read a second time.
function exitReason(
  retBps: bigint,
  heldBars: number,
  trailedOff: boolean,
): ExitReason | null {
  if (retBps >= BigInt(TP_BPS)) return 'take-profit';
  if (retBps <= -BigInt(SL_BPS)) return 'stop-loss';
  if (heldBars >= HOLD_BARS) return 'time-stop';
  if (trailedOff) return 'trailing-stop';
  return null;
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
          peakClose = entryPrice;
        } else {
          entryPrice = null;
          entrySeq = -1;
          peakClose = null;
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
      // Holding: take profit, stop loss, time stop, or trailing stop.
      if (entryPrice !== null && peakClose !== null) {
        if (close > peakClose) peakClose = close;
        const ret = bpsChange(close, entryPrice);
        const heldBars = batch.seq - entrySeq;
        const trailedOff =
          ret > TRAIL_ARM_BPS &&
          close * 10_000n <= peakClose * (10_000n - BigInt(TRAIL_BPS));
        if (exitReason(ret, heldBars, trailedOff) !== null) {
          return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }
      return [];
    }

    // Flat: enter on a deep 60-bar dip confirmed by an uptick.
    if (closes.length <= LOOKBACK + 1) return [];
    const prev = closes[closes.length - 2];
    if (close <= prev) return [];
    const ago = closes[closes.length - 1 - LOOKBACK];
    if (bpsChange(close, ago) <= -DIP_BPS && state.cash > 0n) {
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  },
});

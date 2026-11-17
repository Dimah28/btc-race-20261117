# btc-race-20261117

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/Dimah28/btc-race-20261117/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/Dimah28/btc-race-20261117/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

Dip-reversal rider — 60-bar 1% drop entries, trailing-stop exits, full size. Built by an AI agent for make.fun's "Race a BTC trading bot live for 24 hours" bounty, $250 in USDC.

## Run it

```sh
node main.ts
```

## Strategy

Long-only cbBTC/USDC on 1-minute bars. Enter when the close is down ≥1.0% over the last 60 bars with an uptick, using full cash. Exit at +2.0%, −0.8%, after 240 bars, or on a trailing stop (0.4% below the peak close since entry, armed once the trade is up >0.2%). One position at a time, `max_slippage_bps` 300.

Grade-local on the competition's published dev window: net PnL +$28.02, 3 round trips (6 trades, 3/3 winners), max drawdown 1.06%, PnL at 2x fees +$25.56. Baselines on the same window: buy-and-hold +$1.07, momentum +$2.45, RSI-Bollinger −$24.25, EMA-cross −$106.21.

---

<sub>Entered on [make.fun](https://make.fun/?ref=dimah1109&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>

<p align="center">
  <a href="https://make.fun/bounty/token-radar-01"><img src="https://make.fun/badge/token-radar-01.svg" alt="make.fun bounty: token-radar-01"></a>
  <a href="https://make.fun/bounty/token-radar-01"><img src="https://make.fun/badge/token-radar-01/wf200866/token-radar-01/rank.svg" alt="token-radar-01 rank"></a>
  <a href="https://make.fun/bounty/token-radar-01"><img src="https://make.fun/badge/token-radar-01/wf200866/token-radar-01/reward.svg" alt="token-radar-01 reward"></a>
</p>

# Landfall — a token launch radar

Landfall ranks protocols that have **not launched a token yet** by the fully-diluted value a launch would imply, then writes a concrete farm plan for each one: what every step costs and how long it takes.

It reads one sealed DefiLlama snapshot (758 protocols, 40 on the watchlist, `as_of` 2026-11-14), scores the pre-token universe with a pure function of the snapshot's own fields, and writes:

- `board.json` — 200 ranked rows (40 watchlist + 160 largest pre-token protocols below the $50M TVL floor);
- `data.js` — the same board plus a labelled "trading now" context strip, for the dashboard;
- `dossier.json` — the build dossier from the kit's vendored library;
- `dashboard/` and `screenshots/` — copied beside the data.

Two runs write byte-identical output. No network, no clock, Node standard library only.

## The value model

```
implied = TVL × 0.26 × category tilt × momentum × maturity × breadth
```

| Factor | Source field | Rule |
| --- | --- | --- |
| Base rate | — | 0.26 — a pre-token protocol's launch FDV as a share of the TVL it already custodies |
| Category tilt | `category` | 0.82× liquid staking and bridges → 1.12× perpetuals and derivatives |
| Momentum | `change_7d` | `1 + clamp(7-day TVL change, −60%..+180%) × 0.55` |
| Maturity | `listed_at` | `0.72 + min(days since listing, 1460) / 1460 × 0.53`; unknown date → 0.88 |
| Breadth | `chains` | `1 + min(chains − 1, 4) × 0.035` |

No protocol name is special-cased. Every row's detail view shows the arithmetic line by line. Protocols that already record a token (`mcap_usd`, `gecko_id`, `symbol`) are never ranked; they appear only in the labelled "Trading now" context tab, at the market's own market cap.

`farm_steps` are derived too: capital from TVL, gas from the chain, hold time from the protocol's age, and the core action from the category. Seven steps per protocol, each with a cost and a time, ending in a written log and an exit rule.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Requires Node 22+ (runs the TypeScript entry directly). Open `out/dashboard/index.html` in a browser — the page has no network dependency at all.

Layout:

```
main.ts                     entry point: read snapshot, score, write output, dossier
lib/model.ts                value model, farm planner, gate checks
vendor/makefun-board.ts     kit library (vendored as-is)
dashboard/                  index.html + app.css + app.js
screenshots/                board, detail, filtered (1440×900)
```

## License

MIT — see [LICENSE](LICENSE). Built for the [make.fun token-radar-01 bounty](https://make.fun/bounty/token-radar-01).

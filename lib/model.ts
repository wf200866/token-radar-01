// The landfall value model: one sealed snapshot in, one ranked pre-token board out.
//
// Scope. The board ranks protocols whose DefiLlama record carries no token (market cap,
// CoinGecko id and symbol all null). Every watchlist slug is always on the board; on top of it
// the radar adds the largest pre-token protocols below the watchlist floor, which is the early
// signal the bounty exists to find. Protocols that already trade are never ranked: they go to
// a separately labelled "trading now" strip as context, with the market's own market cap.
//
// Value. A launch's implied fully-diluted value is built only from fields the snapshot
// carries, with every constant stated in the page and in the README:
//
//   implied = tvl_usd
//           x BASE_RATE                     the FDV a pre-token protocol plausibly prices at,
//                                           as a share of the TVL it already custodies
//           x categoryTilt(category)        a small tilt by what the protocol does
//           x momentum(change_7d)           7-day TVL growth, clamped and damped
//           x maturity(age since listed_at) the longer it has run with no token, the more
//                                           usage and expectation have accumulated
//           x breadth(chains)               marginal reach of running on several chains
//
// No protocol name is ever special-cased: the same pure function scores every row, and the
// page shows each row's factors so a reader can check the arithmetic.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'landfall-1';
export const EARLY_TARGET = 160;
export const LIVE_CONTEXT = 18;

export interface ModelConstants {
  base_rate: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_multiplier: number;
  breadth_step: number;
  breadth_cap: number;
}

export const MODEL: ModelConstants = {
  base_rate: 0.26,
  growth_weight: 0.55,
  growth_floor: -60,
  growth_cap: 180,
  maturity_floor: 0.72,
  maturity_range: 0.53,
  maturity_days: 1460,
  unknown_age_multiplier: 0.88,
  breadth_step: 0.035,
  breadth_cap: 4,
};

export interface Factors {
  category_tilt: number;
  growth_pct: number;
  momentum: number;
  maturity: number;
  breadth: number;
  age_days: number | null;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  token_status: 'pre-token';
  watchlist: boolean;
  implied_value_usd: number;
  rationale: string;
  model: { version: string; base_rate: number } & Factors;
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  factors: Factors;
  rationale: string;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  symbol: string | null;
  change_7d: number | null;
}

export interface RadarMeta {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: ModelConstants;
  watchlist_size: number;
  universe_size: number;
  board_size: number;
  early_count: number;
  live_size: number;
  categories: string[];
  chains: string[];
}

export interface RadarData {
  meta: RadarMeta;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (!isNum(o.floor_usd) || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols: SnapshotProtocol[] = o.protocols.map((value, i) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new SnapshotError(`snapshot.json protocol ${i} is not an object`);
    }
    const p = value as Record<string, unknown>;
    if (typeof p.slug !== 'string' || p.slug.length === 0 || /\s/.test(p.slug)) {
      throw new SnapshotError(`snapshot.json protocol ${i} has no plain slug`);
    }
    if (typeof p.name !== 'string' || p.name.length === 0) {
      throw new SnapshotError(`snapshot.json protocol ${i} has no name`);
    }
    if (!isNum(p.tvl_usd) || p.tvl_usd < 0) {
      throw new SnapshotError(`snapshot.json protocol ${i} has no TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains)
        ? p.chains.filter((c): c is string => typeof c === 'string')
        : [],
      tvl_usd: p.tvl_usd,
      change_7d: isNum(p.change_7d) ? p.change_7d : null,
      mcap_usd: isNum(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

const DAY = 86_400_000;

/** Whole days from the snapshot date back to the day the protocol was listed; null when unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** A protocol records no token when all three token fields are null. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/i;

/**
 * A pre-token protocol a launch radar may rank: records no token, is not a CEX, is not a
 * versioned pool of another protocol and is not a wrapped, staked or exchange-named product.
 * Bridge and liquid-staking protocols that record no token stay eligible below the floor:
 * they are independent launch candidates, and the watchlist is a floor, not a ceiling.
 */
export function isPreTokenCandidate(p: SnapshotProtocol): boolean {
  return (
    recordsNoToken(p) &&
    p.category !== 'CEX' &&
    !VERSIONED.test(p.name) &&
    !WRAPPED.test(p.name) &&
    !EXCHANGE.test(p.name)
  );
}

/**
 * The category's small value tilt. The strings are DefiLlama's category names, matched as
 * substrings; a category the snapshot does not carry falls to the default. Only the category
 * field is read, never a protocol name.
 */
export function categoryTilt(category: string | null): number {
  const c = (category ?? '').toLowerCase();
  if (/perp|derivative|option/.test(c)) return 1.12;
  if (/lending|cdp|collateral|credit/.test(c)) return 1.08;
  if (/rwa|real.?world|treasury/.test(c)) return 1.06;
  if (/prediction/.test(c)) return 1.05;
  if (/dex|exchange|amm/.test(c)) return 1.02;
  if (/insurance/.test(c)) return 1.0;
  if (/yield|vault|curator|allocator|basis/.test(c)) return 0.96;
  if (/payments/.test(c)) return 0.92;
  if (/stablecoin|wrapper/.test(c)) return 0.9;
  if (/chain|layer/.test(c)) return 0.9;
  if (/governance/.test(c)) return 0.88;
  if (/liquid staking|restak|restaked/.test(c)) return 0.82;
  if (/bridge|canonical/.test(c)) return 0.84;
  return 0.95;
}

export function factorsFor(p: SnapshotProtocol, asOf: string, m: ModelConstants = MODEL): Factors {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = p.change_7d ?? 0;
  const growthPct = Math.min(m.growth_cap, Math.max(m.growth_floor, rawGrowth));
  const momentum = 1 + (growthPct / 100) * m.growth_weight;
  const maturity =
    age === null
      ? m.unknown_age_multiplier
      : m.maturity_floor + (Math.min(age, m.maturity_days) / m.maturity_days) * m.maturity_range;
  const chains = Math.max(1, p.chains.length);
  const breadth = 1 + Math.min(chains - 1, m.breadth_cap) * m.breadth_step;
  return {
    category_tilt: categoryTilt(p.category),
    growth_pct: Math.round(growthPct * 100) / 100,
    momentum: round4(momentum),
    maturity: round4(maturity),
    breadth: round4(breadth),
    age_days: age,
  };
}

export function impliedValue(p: SnapshotProtocol, asOf: string, m: ModelConstants = MODEL): number {
  const f = factorsFor(p, asOf, m);
  const value = p.tvl_usd * m.base_rate * f.category_tilt * f.momentum * f.maturity * f.breadth;
  return Math.max(1, Math.round(value));
}

export const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A compact dollar figure for human text: $2.7B, $812.4M, $41.2M. */
export function shortUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n}`;
}

function rationaleOf(p: SnapshotProtocol, f: Factors, implied: number): string {
  const growth =
    p.change_7d === null ? 'no 7-day figure' : `${f.growth_pct >= 0 ? '+' : ''}${f.growth_pct}% over 7 days`;
  const age = f.age_days === null ? 'unknown listing date' : `${f.age_days} days without a token`;
  return `${shortUsd(p.tvl_usd)} TVL, ${growth}, ${age}; implied ${shortUsd(implied)} at a ${Math.round(
    MODEL.base_rate * 100,
  )}% base rate with a ${f.category_tilt.toFixed(2)}x category tilt.`;
}

function baseRow(p: SnapshotProtocol, asOf: string, watchlist: boolean): Omit<BoardRow, 'rank'> {
  const f = factorsFor(p, asOf);
  const implied = impliedValue(p, asOf);
  return {
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    age_days: f.age_days,
    token_status: 'pre-token',
    watchlist,
    implied_value_usd: implied,
    rationale: rationaleOf(p, f, implied),
    model: { version: MODEL_VERSION, base_rate: MODEL.base_rate, ...f },
    farm_steps: farmPlan(p, f).map(formatStep),
  };
}

export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, { p: SnapshotProtocol; watchlist: boolean }>();

  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, { p, watchlist: true });
  }

  const early = snapshot.protocols
    .filter(
      (p) => !chosen.has(p.slug) && isPreTokenCandidate(p) && p.tvl_usd < snapshot.floor_usd,
    )
    .sort((a, b) => b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug))
    .slice(0, EARLY_TARGET);
  for (const p of early) chosen.set(p.slug, { p, watchlist: false });

  const scored = [...chosen.values()].map(({ p, watchlist }) => ({
    row: baseRow(p, snapshot.as_of, watchlist),
    implied: impliedValue(p, snapshot.as_of),
  }));
  scored.sort((a, b) => b.implied - a.implied || a.row.slug.localeCompare(b.row.slug));
  return scored.map((s, i) => ({ rank: i + 1, ...s.row }));
}

/** The token-bearing protocols, by market cap, as clearly-labelled context only. */
export function liveContext(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .sort(
      (a, b) =>
        (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) ||
        b.tvl_usd - a.tvl_usd ||
        a.slug.localeCompare(b.slug),
    )
    .slice(0, LIVE_CONTEXT)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      symbol: p.symbol,
      change_7d: p.change_7d,
    }));
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveContext(snapshot);
  const categories = [...new Set(board.map((r) => r.category ?? 'Uncategorised'))].sort();
  const chains = [...new Set(board.flatMap((r) => r.chains))].sort();
  const radar: RadarData = {
    meta: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      model_version: MODEL_VERSION,
      model: MODEL,
      watchlist_size: snapshot.watchlist.length,
      universe_size: snapshot.protocols.length,
      board_size: board.length,
      early_count: board.filter((r) => !r.watchlist).length,
      live_size: live.length,
      categories,
      chains,
    },
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      watchlist: r.watchlist,
      implied_value_usd: r.implied_value_usd,
      factors: r.model,
      rationale: r.rationale,
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

// ---------------------------------------------------------------- farm plans

interface Step {
  text: string;
  cost: string;
  time: string;
}

function formatStep(s: Step): string {
  let out = `${s.text} Cost: ${s.cost}. Time: ${s.time}.`;
  if (out.length > 600) out = `${out.slice(0, 597)}...`;
  if (out.trim().length < 20) out = `${out} Keep the position open and check the protocol's page.`;
  return out.trim();
}

function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 500;
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 250_000_000) return 150;
  if (tvl >= 50_000_000) return 100;
  if (tvl >= 10_000_000) return 75;
  return 50;
}

function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return '$4-8';
  if (c.includes('solana')) return '$0.05-0.2';
  if (c.includes('base') || c.includes('arbitrum') || c.includes('optimism') || c.includes('linea')) return '$0.2-1';
  if (c.includes('bnb') || c.includes('bsc')) return '$0.2-0.6';
  return '$0.5-2';
}

function holdDays(age: number | null): number {
  if (age === null) return 45;
  if (age < 120) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

function repeatWeeks(age: number | null): number {
  if (age === null) return 8;
  if (age < 180) return 12;
  if (age < 365) return 10;
  return 8;
}

function primaryChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (/perp|derivative|option/.test(c)) {
    return `Deposit $${capital} USDC as margin on ${n} (${chain}), keep leverage at 1x and make one small round trip each week.`;
  }
  if (/lending|cdp|collateral|credit/.test(c)) {
    return `Supply $${capital} USDC to ${n} on ${chain}, borrow about 25% of it in the protocol's stable asset and keep the loan open.`;
  }
  if (/dex|exchange|amm/.test(c)) {
    return `Provide $${capital} of a 50/50 USDC pair to ${n}'s deepest pool on ${chain}, keep it in range and collect the fees.`;
  }
  if (/yield|vault|curator|allocator|basis/.test(c)) {
    return `Deposit $${capital} USDC into ${n}'s flagship vault on ${chain} and hold the receipt token in the same wallet.`;
  }
  if (/rwa|real.?world|treasury/.test(c)) {
    return `Buy $${capital} of ${n}'s yield-bearing asset on ${chain} and hold it in the wallet that will farm the protocol.`;
  }
  if (/bridge|canonical/.test(c)) {
    return `Bridge $${capital} USDC from Ethereum to ${chain} through ${n} and use the bridged funds inside its own app for one swap a week.`;
  }
  if (/liquid staking|restak|restaked|staking pool/.test(c)) {
    return `Stake $${capital} of ${chain}'s native asset through ${n}, keep the liquid receipt and restake or delegate it once a week.`;
  }
  if (/prediction/.test(c)) {
    return `Fund $${capital} USDC and place one position a week on ${n}'s most liquid market on ${chain}.`;
  }
  if (/insurance/.test(c)) {
    return `Buy $${capital} of cover from ${n} on ${chain} for an asset you already hold and keep the policy active.`;
  }
  if (/stablecoin|wrapper/.test(c)) {
    return `Mint $${capital} of ${n}'s stable asset on ${chain} against collateral and hold it in the farm wallet.`;
  }
  if (/chain|layer/.test(c)) {
    return `Bridge $${capital} USDC to ${n}'s chain, do one swap and one lend there each week and keep a gas balance topped up.`;
  }
  if (/payments/.test(c)) {
    return `Move $${capital} USDC through ${n}'s payment rail on ${chain} once a week and keep every receipt.`;
  }
  if (/governance/.test(c)) {
    return `Deposit $${capital} into ${n}'s incentivised pool on ${chain} and vote on one proposal each week.`;
  }
  return `Deposit $${capital} USDC into ${n}'s main app on ${chain} and keep the position open.`;
}

export function farmPlan(p: SnapshotProtocol, f: Factors): Step[] {
  const chain = primaryChain(p);
  const capital = capitalFor(p.tvl_usd);
  const gas = gasFor(chain);
  const hold = holdDays(f.age_days);
  const weeks = repeatWeeks(f.age_days);
  return [
    {
      text: `Use a new wallet for this farm only, write its seed phrase on paper and keep it offline; never reuse a wallet that holds savings.`,
      cost: '$0 to create',
      time: '5 minutes',
    },
    {
      text: `Fund the wallet with about $${capital} USDC on ${chain}; bridge in through the protocol's own bridge page when it publishes one, never a search result.`,
      cost: `$${capital} of capital plus about ${gas} of gas`,
      time: '10 to 20 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} stays in the position plus about ${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Repeat one qualifying action each week for ${weeks} weeks (a deposit, a borrow, a swap or a vote), varying the day and the size so it is not a single burst.`,
      cost: `about ${gas} of gas a week`,
      time: `${weeks} weeks, 10 minutes each`,
    },
    {
      text: `Keep the position open for at least ${hold} days so it is counted in several weekly snapshots, and do not withdraw after the first one.`,
      cost: `$${capital} stays locked`,
      time: `${hold} days`,
    },
    {
      text: `Watch ${p.name}'s own app and docs for a points or airdrop page, and claim only from that page; never pay a fee or sign a transfer to claim.`,
      cost: '$0 to check, no fee to claim',
      time: '10 minutes',
    },
    {
      text: `Log the wallet, dates and transaction hashes, and set an exit rule: unwind if the protocol loses more than 35% of its TVL in 30 days.`,
      cost: '$0',
      time: '5 minutes',
    },
  ];
}

// ---------------------------------------------------------------- gate checks

export function boardProblems(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows`;
  const slugs = new Set<string>();
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const ranks: number[] = [];
  for (const r of board) {
    if (!known.has(r.slug)) return `unknown slug ${r.slug}`;
    if (slugs.has(r.slug)) return `duplicate slug ${r.slug}`;
    slugs.add(r.slug);
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.implied_value_usd > 100_000_000_000_000) return `${r.slug} implied value is over the cap`;
    ranks.push(r.rank);
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `${r.slug} has ${r.farm_steps.length} farm steps`;
    }
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} chars`;
    }
  }
  const sorted = [...ranks].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i + 1) return `rank ${i + 1} is ${sorted[i]}`;
  }
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (new Set(board.map((r) => r.implied_value_usd)).size === 1) return 'every row has the same implied value';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `missing ${missing.length} watchlist slugs: ${missing.slice(0, 4).join(', ')}`;
  return null;
}

export function radarScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

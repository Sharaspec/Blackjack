// Pure analytics over recorded rounds — no DOM, no network.
//
// Input: rounds as returned by
//   supabase.from("rounds").select("*, round_hands(*), decisions(*)")
// Numbers from Postgres numeric columns may arrive as strings; num() normalizes.

const num = (v) => (v == null ? 0 : Number(v));
const isWin = (o) => o === "win" || o === "blackjack";
const isLoss = (o) => o === "lose" || o === "bust";
const pct = (a, b) => (b ? a / b : null);
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

export const UPCARDS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
export const upLabel = (v) => (v === 11 ? "A" : String(v));

export function upcardOf(code) {
  const r = code[0];
  if (r === "A") return 11;
  if ("0JQK".includes(r)) return 10;
  return Number(r);
}

export function situationLabel(total, soft, isPair) {
  if (isPair) {
    const v = soft && total === 12 ? "A" : String(total / 2);
    return `Pair ${v}s`;
  }
  return soft && total < 21 ? `Soft ${total}` : `Hard ${total}`;
}

// Row order for situation tables (matches how strategy charts are laid out).
export const SITUATION_ROWS = [
  ...Array.from({ length: 16 }, (_, i) => `Hard ${i + 5}`), // 5..20
  ...Array.from({ length: 8 }, (_, i) => `Soft ${i + 13}`), // 13..20
  ...["2", "3", "4", "5", "6", "7", "8", "9", "10", "A"].map((v) => `Pair ${v}s`),
];

export function tcBucket(tc) {
  const t = Math.round(num(tc));
  if (t <= -2) return "≤ −2";
  if (t >= 3) return "≥ +3";
  return t > 0 ? `+${t}` : t === 0 ? "0" : `−${-t}`;
}
export const TC_BUCKETS = ["≤ −2", "−1", "0", "+1", "+2", "≥ +3"];

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = sum(xs, (x) => x) / n;
  const my = sum(ys, (y) => y) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

function streaks(rounds) {
  let longestWin = 0, longestLoss = 0, run = 0, sign = 0;
  for (const r of rounds) {
    const n = num(r.net);
    const s = n > 0 ? 1 : n < 0 ? -1 : 0;
    if (s === 0) continue; // pushes don't break or extend a streak
    run = s === sign ? run + 1 : 1;
    sign = s;
    if (s > 0) longestWin = Math.max(longestWin, run);
    else longestLoss = Math.max(longestLoss, run);
  }
  return { longestWin, longestLoss, current: run * sign };
}

function groupStats(items, keyFn, init = () => ({})) {
  const map = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (k == null) continue;
    if (!map.has(k)) map.set(k, { key: k, items: [], ...init() });
    map.get(k).items.push(it);
  }
  return map;
}

function handSummary(hands) {
  const n = hands.length;
  const wins = hands.filter((h) => isWin(h.outcome)).length;
  const losses = hands.filter((h) => isLoss(h.outcome)).length;
  const net = sum(hands, (h) => num(h.net));
  const wagered = sum(hands, (h) => num(h.bet));
  return { hands: n, wins, losses, pushes: n - wins - losses, winRate: pct(wins, n), net, wagered, netPerHand: n ? net / n : null, roi: pct(net, wagered) };
}

export function computeStats(roundsIn, strategies = []) {
  const rounds = [...roundsIn].sort((a, b) => new Date(a.played_at) - new Date(b.played_at));
  const hands = rounds.flatMap((r) => (r.round_hands ?? []).map((h) => ({ ...h, round: r })));
  const decisions = rounds.flatMap((r) => (r.decisions ?? []).map((d) => ({ ...d, round: r })));
  const handKey = (roundId, idx) => `${roundId}:${idx}`;
  const handByKey = new Map(hands.map((h) => [handKey(h.round_id ?? h.round.id, h.hand_index), h]));

  // ---------- headline ----------
  const wagered = sum(rounds, (r) => num(r.total_wagered));
  const net = sum(rounds, (r) => num(r.net));
  const hs = handSummary(hands);
  const doubles = hands.filter((h) => h.doubled);
  const splitRounds = rounds.filter((r) => num(r.hand_count) > 1);
  const roundNets = rounds.map((r) => num(r.net));
  const summary = {
    rounds: rounds.length,
    hands: hands.length,
    decisions: decisions.length,
    wagered,
    net,
    roi: pct(net, wagered),
    avgBet: rounds.length ? sum(rounds, (r) => num(r.initial_bet)) / rounds.length : null,
    winRate: hs.winRate,
    lossRate: pct(hs.losses, hs.hands),
    pushRate: pct(hs.pushes, hs.hands),
    blackjackRate: pct(rounds.filter((r) => r.player_blackjack).length, rounds.length),
    bustRate: pct(hands.filter((h) => h.outcome === "bust").length, hands.length),
    dealerBustRate: pct(rounds.filter((r) => r.dealer_bust).length, rounds.length),
    doubles: { count: doubles.length, ...handSummary(doubles) },
    splits: { count: splitRounds.length, net: sum(splitRounds, (r) => num(r.net)) },
    biggestWin: roundNets.length ? Math.max(0, ...roundNets) : 0,
    biggestLoss: roundNets.length ? Math.min(0, ...roundNets) : 0,
    ...streaks(rounds),
    firstPlayed: rounds[0]?.played_at ?? null,
    lastPlayed: rounds.at(-1)?.played_at ?? null,
  };

  // ---------- bankroll curve ----------
  let running = 0;
  const curve = rounds.map((r, i) => {
    running += num(r.net);
    return { i: i + 1, net: running, bankroll: num(r.bankroll_after), at: r.played_at, roundNet: num(r.net) };
  });

  // ---------- basic strategy adherence ----------
  const matched = decisions.filter((d) => d.matches_basic);
  const deviatedHandKeys = new Set(decisions.filter((d) => !d.matches_basic).map((d) => handKey(d.round_id ?? d.round.id, d.hand_index)));
  const decidedHandKeys = new Set(decisions.map((d) => handKey(d.round_id ?? d.round.id, d.hand_index)));
  const cleanHands = [...decidedHandKeys].filter((k) => !deviatedHandKeys.has(k)).map((k) => handByKey.get(k)).filter(Boolean);
  const devHands = [...deviatedHandKeys].map((k) => handByKey.get(k)).filter(Boolean);
  const times = decisions.filter((d) => d.decision_ms != null);
  const avgMs = (arr) => (arr.length ? sum(arr, (d) => num(d.decision_ms)) / arr.length : null);
  const adherence = {
    decisions: decisions.length,
    matched: matched.length,
    rate: pct(matched.length, decisions.length),
    cleanHands: handSummary(cleanHands),
    deviatedHands: handSummary(devHands),
    avgDecisionMs: avgMs(times),
    avgMsMatched: avgMs(times.filter((d) => d.matches_basic)),
    avgMsDeviated: avgMs(times.filter((d) => !d.matches_basic)),
  };

  // Most frequent / costly deviations: situation × upcard × (did → should).
  const devGroups = groupStats(
    decisions.filter((d) => !d.matches_basic),
    (d) => `${situationLabel(d.player_total, d.soft, d.is_pair)}|${d.upcard_value}|${d.action}|${d.recommended}`,
  );
  const deviations = [...devGroups.values()]
    .map((g) => {
      const [situation, up, action, recommended] = g.key.split("|");
      const affected = [...new Set(g.items.map((d) => handKey(d.round_id ?? d.round.id, d.hand_index)))].map((k) => handByKey.get(k)).filter(Boolean);
      const s = handSummary(affected);
      return { situation, upcard: Number(up), action, recommended, count: g.items.length, net: s.net, netPerHand: s.netPerHand, winRate: s.winRate };
    })
    .sort((a, b) => b.count - a.count || a.net - b.net);

  // Heatmap: situation rows × upcard columns → decisions + adherence.
  const heat = new Map();
  for (const d of decisions) {
    const row = situationLabel(d.player_total, d.soft, d.is_pair);
    const k = `${row}|${d.upcard_value}`;
    const c = heat.get(k) ?? { row, upcard: d.upcard_value, count: 0, matched: 0 };
    c.count += 1;
    if (d.matches_basic) c.matched += 1;
    heat.set(k, c);
  }
  const heatRows = SITUATION_ROWS.filter((row) => UPCARDS.some((u) => heat.has(`${row}|${u}`)));
  const heatmap = { rows: heatRows, cell: (row, up) => heat.get(`${row}|${up}`) ?? null };

  // ---------- results by dealer upcard ----------
  const byUpcard = UPCARDS.map((u) => {
    const hsU = hands.filter((h) => upcardOf(h.round.dealer_upcard) === u);
    const rU = rounds.filter((r) => upcardOf(r.dealer_upcard) === u);
    return { upcard: u, label: upLabel(u), ...handSummary(hsU), dealerBustRate: pct(rU.filter((r) => r.dealer_bust).length, rU.length) };
  });

  // ---------- results by starting hand (original two cards, no split hands) ----------
  const startGroups = groupStats(
    hands.filter((h) => !h.from_split),
    (h) => (h.initial_total === 21 && h.initial_soft && !h.is_pair ? "Blackjack" : situationLabel(h.initial_total, h.initial_soft, h.is_pair)),
  );
  const order = [
    "Blackjack",
    ...Array.from({ length: 16 }, (_, i) => `Hard ${i + 5}`), // 5..20
    ...SITUATION_ROWS.filter((r) => !r.startsWith("Hard")),
  ];
  const byStartingHand = [...startGroups.values()]
    .map((g) => ({ label: g.key, ...handSummary(g.items) }))
    .sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));

  // ---------- true count ----------
  const byTrueCount = TC_BUCKETS.map((b) => {
    const rs = rounds.filter((r) => tcBucket(r.true_count) === b);
    const n = rs.length;
    const w = sum(rs, (r) => num(r.total_wagered));
    const nt = sum(rs, (r) => num(r.net));
    return {
      bucket: b,
      rounds: n,
      avgBet: n ? sum(rs, (r) => num(r.initial_bet)) / n : null,
      net: nt,
      netPerRound: n ? nt / n : null,
      roi: pct(nt, w),
      winRate: pct(rs.filter((r) => num(r.net) > 0).length, n),
    };
  });
  const betCountCorrelation = pearson(rounds.map((r) => num(r.true_count)), rounds.map((r) => num(r.initial_bet)));

  // ---------- strategies ----------
  const nameOf = new Map(strategies.map((s) => [s.id, s.name]));
  const byStrategy = [...groupStats(rounds, (r) => r.strategy_id ?? "none").values()]
    .map((g) => {
      const hsS = g.items.flatMap((r) => r.round_hands ?? []);
      const ds = g.items.flatMap((r) => r.decisions ?? []);
      const w = sum(g.items, (r) => num(r.total_wagered));
      const nt = sum(g.items, (r) => num(r.net));
      return {
        id: g.key,
        name: g.key === "none" ? "No strategy" : nameOf.get(g.key) ?? "Deleted strategy",
        rounds: g.items.length,
        net: nt,
        roi: pct(nt, w),
        netPerRound: nt / g.items.length,
        avgBet: sum(g.items, (r) => num(r.initial_bet)) / g.items.length,
        winRate: handSummary(hsS).winRate,
        adherence: pct(ds.filter((d) => d.matches_basic).length, ds.length),
      };
    })
    .sort((a, b) => b.rounds - a.rounds);

  // ---------- action mix ----------
  const actions = ["hit", "stand", "double", "split"].map((a) => {
    const ds = decisions.filter((d) => d.action === a);
    return { action: a, count: ds.length, share: pct(ds.length, decisions.length), matched: pct(ds.filter((d) => d.matches_basic).length, ds.length) };
  });

  const stats = { summary, curve, adherence, deviations, heatmap, byUpcard, byStartingHand, byTrueCount, betCountCorrelation, byStrategy, actions };
  stats.insights = buildInsights(stats);
  return stats;
}

const money = (n) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const p0 = (x) => `${Math.round(x * 100)}%`;

// Plain-language patterns worth looking at. Each needs enough data to say anything.
export function buildInsights(s) {
  const out = [];
  const { summary, adherence, deviations, byUpcard, byTrueCount, betCountCorrelation, byStrategy } = s;
  if (summary.rounds < 10) {
    out.push({ kind: "info", text: `Play at least 10 rounds to start seeing patterns (${summary.rounds} so far).` });
    return out;
  }
  if (adherence.decisions >= 10) {
    out.push({
      kind: adherence.rate >= 0.9 ? "good" : "warn",
      text: `You follow basic strategy on ${p0(adherence.rate)} of decisions (${adherence.matched} of ${adherence.decisions}).`,
    });
  }
  if (adherence.cleanHands.hands >= 10 && adherence.deviatedHands.hands >= 5) {
    const a = adherence.cleanHands.netPerHand, b = adherence.deviatedHands.netPerHand;
    out.push({
      kind: b < a ? "warn" : "info",
      text: `Hands where you deviated from basic strategy average ${money(b)} per hand, vs ${money(a)} when you followed it (${adherence.deviatedHands.hands} vs ${adherence.cleanHands.hands} hands).`,
    });
  }
  const top = deviations.find((d) => d.count >= 3);
  if (top) {
    out.push({
      kind: "warn",
      text: `Most common deviation: you ${top.action} on ${top.situation} vs dealer ${upLabel(top.upcard)} (${top.count}×), where basic strategy says ${top.recommended}. Those hands net ${money(top.net)}.`,
    });
  }
  if (adherence.avgMsMatched != null && adherence.avgMsDeviated != null && adherence.decisions - adherence.matched >= 5) {
    const faster = adherence.avgMsDeviated < adherence.avgMsMatched;
    out.push({
      kind: "info",
      text: `You decide ${faster ? "faster" : "slower"} when deviating (${(adherence.avgMsDeviated / 1000).toFixed(1)}s vs ${(adherence.avgMsMatched / 1000).toFixed(1)}s).${faster ? " Snap decisions may be costing you." : ""}`,
    });
  }
  const ups = byUpcard.filter((u) => u.hands >= 5);
  if (ups.length >= 3) {
    const worst = ups.reduce((a, b) => (b.netPerHand < a.netPerHand ? b : a));
    const best = ups.reduce((a, b) => (b.netPerHand > a.netPerHand ? b : a));
    out.push({ kind: "info", text: `Best dealer upcard for you: ${best.label} (${money(best.netPerHand)}/hand). Worst: ${worst.label} (${money(worst.netPerHand)}/hand).` });
  }
  if (betCountCorrelation != null && summary.rounds >= 30) {
    const r = betCountCorrelation;
    out.push({
      kind: r > 0.3 ? "good" : "info",
      text:
        r > 0.3
          ? `Your bets rise with the true count (correlation ${r.toFixed(2)}), the core of a counting bet spread.`
          : `Your bet size barely tracks the true count (correlation ${r.toFixed(2)}). Counters raise bets when the count is positive.`,
    });
  }
  const hi = byTrueCount.filter((b) => (b.bucket === "+2" || b.bucket === "≥ +3") && b.rounds > 0);
  const hiRounds = sum(hi, (b) => b.rounds);
  if (hiRounds >= 10) {
    const nt = sum(hi, (b) => b.net);
    out.push({ kind: nt >= 0 ? "good" : "info", text: `At true count +2 or higher you've played ${hiRounds} rounds, netting ${money(nt)}.` });
  }
  const strats = byStrategy.filter((x) => x.rounds >= 10);
  if (strats.length >= 2) {
    const best = strats.reduce((a, b) => (b.netPerRound > a.netPerRound ? b : a));
    out.push({ kind: "info", text: `Your best-performing strategy so far is “${best.name}” at ${money(best.netPerRound)} per round over ${best.rounds} rounds.` });
  }
  if (summary.rounds < 200) {
    out.push({ kind: "info", text: `Blackjack results swing a lot. ${summary.rounds} rounds is a small sample, so treat these patterns as hints until you have a few hundred.` });
  }
  return out;
}

// ---------- CSV export (for modeling in Python / R / Excel) ----------
const csvCell = (v) => {
  if (v == null) return "";
  const s = Array.isArray(v) ? v.join(" ") : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(rows, columns) {
  return [columns.join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(","))].join("\n");
}

export function exportTables(rounds, strategies = []) {
  const nameOf = new Map(strategies.map((s) => [s.id, s.name]));
  const roundRows = rounds.map((r) => ({ ...r, strategy: r.strategy_id ? nameOf.get(r.strategy_id) ?? "" : "", dealer_upcard_value: upcardOf(r.dealer_upcard) }));
  const handRows = rounds.flatMap((r) => (r.round_hands ?? []).map((h) => ({ ...h, played_at: r.played_at, dealer_upcard: r.dealer_upcard, dealer_total: r.dealer_total, true_count: r.true_count })));
  const decisionRows = rounds.flatMap((r) => (r.decisions ?? []).map((d) => ({ ...d, played_at: r.played_at, strategy: r.strategy_id ? nameOf.get(r.strategy_id) ?? "" : "", situation: situationLabel(d.player_total, d.soft, d.is_pair) })));
  return {
    rounds: toCsv(roundRows, ["id", "played_at", "strategy", "initial_bet", "total_wagered", "net", "bankroll_before", "bankroll_after", "hand_count", "cards_remaining", "running_count", "true_count", "dealer_upcard", "dealer_upcard_value", "dealer_cards", "dealer_total", "dealer_blackjack", "dealer_bust", "player_blackjack", "deck_id"]),
    hands: toCsv(handRows, ["round_id", "played_at", "hand_index", "cards", "initial_total", "initial_soft", "is_pair", "final_total", "final_soft", "doubled", "from_split", "outcome", "bet", "payout", "net", "dealer_upcard", "dealer_total", "true_count"]),
    decisions: toCsv(decisionRows, ["round_id", "played_at", "strategy", "hand_index", "seq", "situation", "player_cards", "player_total", "soft", "is_pair", "dealer_upcard", "upcard_value", "action", "recommended", "matches_basic", "can_double", "can_split", "running_count", "true_count", "decision_ms"]),
  };
}

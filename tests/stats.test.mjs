import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStats, exportTables, situationLabel, tcBucket, upcardOf } from "../js/stats.js";

let n = 0;
function round({ net, bet = 10, up = "0H", tc = 0, strategy = null, outcome, decisions = [], doubled = false, at }) {
  const id = `r${++n}`;
  const handBet = doubled ? bet * 2 : bet;
  return {
    id,
    played_at: at ?? new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString(),
    strategy_id: strategy,
    initial_bet: String(bet), // Postgres numeric arrives as a string
    total_wagered: String(handBet),
    net: String(net),
    bankroll_after: 1000 + net,
    hand_count: 1,
    dealer_upcard: up,
    dealer_bust: outcome === "win" && net > 0 && false,
    player_blackjack: outcome === "blackjack",
    true_count: tc,
    round_hands: [{ round_id: id, hand_index: 0, outcome, net, bet: handBet, doubled, from_split: false, initial_total: 16, initial_soft: false, is_pair: false }],
    decisions: decisions.map((d, i) => ({ round_id: id, hand_index: 0, seq: i, player_total: 16, soft: false, is_pair: false, upcard_value: upcardOf(up), decision_ms: 1000, ...d })),
  };
}

test("labels and buckets", () => {
  assert.equal(situationLabel(12, true, true), "Pair As");
  assert.equal(situationLabel(16, false, true), "Pair 8s");
  assert.equal(situationLabel(18, true, false), "Soft 18");
  assert.equal(tcBucket(-3.4), "≤ −2");
  assert.equal(tcBucket("1.2"), "+1");
  assert.equal(tcBucket(5), "≥ +3");
  assert.equal(upcardOf("QH"), 10);
  assert.equal(upcardOf("AS"), 11);
});

test("headline KPIs, streaks, adherence and strategies", () => {
  const rounds = [
    round({ net: 10, outcome: "win", strategy: "s1", decisions: [{ action: "stand", recommended: "hit", matches_basic: false, decision_ms: 400 }] }),
    round({ net: 10, outcome: "win", strategy: "s1", decisions: [{ action: "stand", recommended: "hit", matches_basic: false, decision_ms: 600 }] }),
    round({ net: 0, outcome: "push" }),
    round({ net: -10, outcome: "lose", decisions: [{ action: "hit", recommended: "hit", matches_basic: true }] }),
    round({ net: -20, outcome: "lose", doubled: true, up: "6D", decisions: [{ action: "double", recommended: "double", matches_basic: true }] }),
    round({ net: -10, outcome: "bust", decisions: [{ action: "hit", recommended: "hit", matches_basic: true }] }),
    round({ net: 15, outcome: "blackjack", tc: 3 }),
  ];
  const s = computeStats(rounds, [{ id: "s1", name: "Gut feel" }]);
  assert.equal(s.summary.rounds, 7);
  assert.equal(s.summary.net, -5);
  assert.equal(s.summary.wagered, 80);
  assert.equal(s.summary.winRate, 3 / 7);
  assert.equal(s.summary.bustRate, 1 / 7);
  assert.equal(s.summary.blackjackRate, 1 / 7);
  assert.equal(s.summary.longestWin, 2);
  assert.equal(s.summary.longestLoss, 3);
  assert.equal(s.summary.current, 1);
  assert.equal(s.summary.biggestLoss, -20);
  assert.equal(s.summary.doubles.count, 1);
  assert.equal(s.curve.at(-1).net, -5);

  assert.equal(s.adherence.decisions, 5);
  assert.equal(s.adherence.rate, 3 / 5);
  assert.equal(s.adherence.deviatedHands.net, 20);
  assert.equal(s.adherence.cleanHands.net, -40);
  assert.equal(s.adherence.avgMsDeviated, 500);
  assert.deepEqual(
    { situation: s.deviations[0].situation, action: s.deviations[0].action, count: s.deviations[0].count },
    { situation: "Hard 16", action: "stand", count: 2 },
  );
  assert.equal(s.heatmap.cell("Hard 16", 10).count, 4);

  const six = s.byUpcard.find((u) => u.upcard === 6);
  assert.equal(six.hands, 1);
  assert.equal(six.net, -20);

  const gut = s.byStrategy.find((x) => x.id === "s1");
  assert.equal(gut.name, "Gut feel");
  assert.equal(gut.net, 20);
  assert.equal(gut.adherence, 0);
  assert.equal(s.byTrueCount.find((b) => b.bucket === "≥ +3").rounds, 1);
  assert.ok(s.insights.length > 0);
});

test("CSV export escapes and flattens", () => {
  const r = round({ net: 10, outcome: "win", strategy: "s1", decisions: [{ action: "hit", recommended: "hit", matches_basic: true, player_cards: ["0S", "6D"] }] });
  r.dealer_cards = ["0H", "7C"];
  const out = exportTables([r], [{ id: "s1", name: 'My "spread", v2' }]);
  assert.match(out.rounds.split("\n")[1], /"My ""spread"", v2"/);
  assert.match(out.decisions.split("\n")[1], /0S 6D/);
  assert.equal(out.hands.split("\n").length, 2);
});

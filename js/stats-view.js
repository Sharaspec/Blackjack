// Stats tab: loads recorded rounds from Supabase and renders KPIs, charts and tables.
import { computeStats, exportTables, upLabel, UPCARDS } from "./stats.js";

const $ = (id) => document.getElementById(id);
const SVG = "http://www.w3.org/2000/svg";
const PAGE = 1000;

const fmtMoney = (n, { sign = false } = {}) => {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(Math.abs(n)) ? 0 : 2, maximumFractionDigits: 2 });
  const s = n < 0 ? "−" : sign && n > 0 ? "+" : "";
  return `${s}$${abs}`;
};
const fmtPct = (x, digits = 0) => (x == null ? "—" : `${(x * 100).toFixed(digits)}%`);
const fmtNum = (x) => (x == null ? "—" : x.toLocaleString("en-US"));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function svg(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.append(node);
  return node;
}

// ---------- tooltip ----------
const tip = document.createElement("div");
tip.className = "viz-tip";
tip.hidden = true;
document.body.append(tip);
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  const left = Math.min(Math.max(8, x + 14), window.innerWidth - r.width - 8);
  const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
const hideTip = () => (tip.hidden = true);

// Nice round tick values for an axis.
function ticks(min, max, count = 4) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

// Bar path: 4px rounded corners at the data end only, flat on the baseline.
function barPath(x, w, y0, y1) {
  const r = Math.min(4, w / 2, Math.abs(y1 - y0));
  if (y1 < y0) {
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  }
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

// ---------- charts ----------
// Charts draw at their real pixel width (so text stays legible) and redraw on resize.
const drawers = new WeakMap();
const resizer = new ResizeObserver((entries) => {
  for (const e of entries) {
    const d = drawers.get(e.target);
    if (d && Math.abs(e.contentRect.width - d.w) > 4) d.draw();
  }
});
function sized(container, draw) {
  const run = () => {
    drawers.set(container, { draw: run, w: container.clientWidth });
    draw(Math.max(280, container.clientWidth || 720));
  };
  resizer.observe(container);
  run();
}

function lineChart(container, points, opts) {
  sized(container, (w) => drawLine(container, points, opts, w));
}
function drawLine(container, points, { label }, W) {
  container.replaceChildren();
  if (points.length < 2) {
    container.innerHTML = `<p class="viz-empty">Play a few rounds to see your ${label}.</p>`;
    return;
  }
  const H = 240, m = { t: 12, r: 16, b: 28, l: 56 };
  const ys = points.map((p) => p.net);
  const yt = ticks(Math.min(0, ...ys), Math.max(0, ...ys));
  const y0 = yt[0], y1 = yt.at(-1);
  const X = (i) => m.l + ((i - 1) / (points.length - 1)) * (W - m.l - m.r);
  const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);

  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "viz", role: "img", "aria-label": `${label} over ${points.length} rounds` }, container);
  for (const t of yt) {
    svg("line", { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? "viz-zero" : "viz-grid" }, root);
    svg("text", { x: m.l - 8, y: Y(t) + 4, class: "viz-axis", "text-anchor": "end" }, root).textContent = fmtMoney(t);
  }
  const xt = ticks(1, points.length, W < 480 ? 3 : 5).filter((v) => v >= 1 && v <= points.length && Number.isInteger(v));
  for (const t of xt) svg("text", { x: X(t), y: H - 8, class: "viz-axis", "text-anchor": "middle" }, root).textContent = `#${t}`;

  const d = points.map((p, i) => `${i ? "L" : "M"}${X(p.i).toFixed(1)},${Y(p.net).toFixed(1)}`).join("");
  svg("path", { d, class: "viz-line" }, root);
  const last = points.at(-1);
  svg("circle", { cx: X(last.i), cy: Y(last.net), r: 4, class: "viz-dot" }, root);
  svg("text", { x: X(last.i) - 8, y: Y(last.net) + (last.net >= 0 ? -10 : 18), class: "viz-label", "text-anchor": "end" }, root).textContent = fmtMoney(last.net, { sign: true });

  const cross = svg("line", { y1: m.t, y2: H - m.b, class: "viz-cross", visibility: "hidden" }, root);
  const hoverDot = svg("circle", { r: 5, class: "viz-dot", visibility: "hidden" }, root);
  const overlay = svg("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: "transparent" }, root);
  overlay.addEventListener("pointermove", (e) => {
    const box = root.getBoundingClientRect();
    const sx = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((sx - m.l) / (W - m.l - m.r)) * (points.length - 1)) + 1;
    const p = points[Math.min(points.length, Math.max(1, i)) - 1];
    cross.setAttribute("x1", X(p.i));
    cross.setAttribute("x2", X(p.i));
    cross.setAttribute("visibility", "visible");
    hoverDot.setAttribute("cx", X(p.i));
    hoverDot.setAttribute("cy", Y(p.net));
    hoverDot.setAttribute("visibility", "visible");
    showTip(
      `<strong>Round ${p.i}</strong><span>${new Date(p.at).toLocaleString()}</span>` +
        `<span>This round: ${fmtMoney(p.roundNet, { sign: true })}</span><span>Total: ${fmtMoney(p.net, { sign: true })}</span>`,
      e.clientX,
      e.clientY,
    );
  });
  overlay.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    hoverDot.setAttribute("visibility", "hidden");
    hideTip();
  });
}

// Diverging bars around zero (positive = blue, negative = red).
function barChart(container, rows, opts) {
  sized(container, (w) => drawBars(container, rows, opts, w));
}
function drawBars(container, rows, { valueKey, label, tipFor, emptyText }, W) {
  container.replaceChildren();
  const vals = rows.map((r) => r[valueKey]).filter((v) => v != null);
  if (!vals.length) {
    container.innerHTML = `<p class="viz-empty">${emptyText}</p>`;
    return;
  }
  const H = 220, m = { t: 12, r: 12, b: 30, l: 56 };
  const yt = ticks(Math.min(0, ...vals), Math.max(0, ...vals));
  const y0 = yt[0], y1 = yt.at(-1);
  const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const band = (W - m.l - m.r) / rows.length;
  const bw = Math.min(44, band * 0.62);

  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "viz", role: "img", "aria-label": label }, container);
  for (const t of yt) {
    svg("line", { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? "viz-zero" : "viz-grid" }, root);
    svg("text", { x: m.l - 8, y: Y(t) + 4, class: "viz-axis", "text-anchor": "end" }, root).textContent = fmtMoney(t);
  }
  rows.forEach((r, i) => {
    const cx = m.l + band * i + band / 2;
    svg("text", { x: cx, y: H - 10, class: "viz-axis", "text-anchor": "middle" }, root).textContent = r.label;
    const v = r[valueKey];
    const g = svg("g", { class: "viz-hit" }, root);
    svg("rect", { x: cx - band / 2, y: m.t, width: band, height: H - m.t - m.b, fill: "transparent" }, g);
    if (v != null && v !== 0) {
      svg("path", { d: barPath(cx - bw / 2, bw, Y(0), Y(v)), class: v > 0 ? "viz-pos" : "viz-neg" }, g);
    } else if (v === 0) {
      svg("rect", { x: cx - bw / 2, y: Y(0) - 1, width: bw, height: 2, class: "viz-flat" }, g);
    }
    g.addEventListener("pointermove", (e) => showTip(tipFor(r), e.clientX, e.clientY));
    g.addEventListener("pointerleave", hideTip);
  });
}

// ---------- page ----------
export function initStats({ supabase, user, recorder, getStrategies }) {
  let rounds = [];
  let loaded = false;
  let loading = null;
  let stale = true;

  const filterStrategy = $("st-filter-strategy");
  const filterRange = $("st-filter-range");

  async function fetchAll() {
    const all = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("rounds")
        .select("*, round_hands(*), decisions(*)")
        .eq("user_id", user.id)
        .order("played_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      all.push(...data);
      if (data.length < PAGE) break;
    }
    return all;
  }

  function filtered() {
    const sid = filterStrategy.value;
    const days = Number(filterRange.value);
    const since = days ? Date.now() - days * 86400000 : 0;
    return rounds.filter(
      (r) =>
        (sid === "all" || (sid === "none" ? !r.strategy_id : r.strategy_id === sid)) &&
        (!since || new Date(r.played_at).getTime() >= since),
    );
  }

  function renderStrategyFilter() {
    const current = filterStrategy.value || "all";
    const opts = [`<option value="all">All strategies</option>`, `<option value="none">No strategy</option>`]
      .concat(getStrategies().map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`));
    filterStrategy.innerHTML = opts.join("");
    filterStrategy.value = [...filterStrategy.options].some((o) => o.value === current) ? current : "all";
  }

  function renderPending() {
    const n = recorder.pending();
    const el = $("st-pending");
    el.hidden = n === 0;
    el.textContent = `${n} round${n === 1 ? "" : "s"} waiting to upload. They'll sync automatically.`;
  }

  function kpi(label, value, sub = "", tone = "") {
    return `<div class="kpi ${tone}"><span class="kpi-label">${label}</span><span class="kpi-value">${value}</span>${sub ? `<span class="kpi-sub">${sub}</span>` : ""}</div>`;
  }

  function render() {
    renderStrategyFilter();
    renderPending();
    const data = filtered();
    const s = computeStats(data, getStrategies());
    const { summary: S, adherence: A } = s;
    $("st-empty").hidden = S.rounds > 0;
    $("st-content").hidden = S.rounds === 0;
    if (!S.rounds) return;

    $("st-range-note").textContent = `${fmtNum(S.rounds)} rounds · ${fmtNum(S.hands)} hands · ${fmtNum(S.decisions)} decisions · ${new Date(S.firstPlayed).toLocaleDateString()} – ${new Date(S.lastPlayed).toLocaleDateString()}`;

    const tone = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "");
    $("st-kpis").innerHTML = [
      kpi("Net result", fmtMoney(S.net, { sign: true }), `on ${fmtMoney(S.wagered)} wagered`, tone(S.net)),
      kpi("Return on wager", fmtPct(S.roi, 1), "net ÷ total wagered", tone(S.roi)),
      kpi("Hand win rate", fmtPct(S.winRate), `${fmtPct(S.lossRate)} lost · ${fmtPct(S.pushRate)} push`),
      kpi("Basic strategy", fmtPct(A.rate), `${fmtNum(A.matched)} of ${fmtNum(A.decisions)} decisions`),
      kpi("Rounds played", fmtNum(S.rounds), `avg bet ${fmtMoney(S.avgBet)}`),
      kpi("Blackjacks", fmtPct(S.blackjackRate, 1), "of rounds (≈4.8% expected)"),
      kpi("Bust rate", fmtPct(S.bustRate), `dealer busts ${fmtPct(S.dealerBustRate)}`),
      kpi("Doubles", fmtNum(S.doubles.count), S.doubles.count ? `${fmtPct(S.doubles.winRate)} won · ${fmtMoney(S.doubles.net, { sign: true })}` : "none yet"),
      kpi("Splits", fmtNum(S.splits.count), S.splits.count ? `${fmtMoney(S.splits.net, { sign: true })} net` : "none yet"),
      kpi("Streaks", `${S.longestWin}W / ${S.longestLoss}L`, `current: ${S.current > 0 ? `${S.current} wins` : S.current < 0 ? `${-S.current} losses` : "—"}`),
      kpi("Best / worst round", `${fmtMoney(S.biggestWin, { sign: true })} / ${fmtMoney(S.biggestLoss)}`),
      kpi("Decision speed", A.avgDecisionMs == null ? "—" : `${(A.avgDecisionMs / 1000).toFixed(1)}s`, "average time to act"),
    ].join("");

    $("st-insights").innerHTML = s.insights
      .map((i) => `<li class="insight ${i.kind}"><span class="insight-icon" aria-hidden="true">${{ good: "✓", warn: "!", info: "i" }[i.kind]}</span><span>${esc(i.text)}</span></li>`)
      .join("");

    lineChart($("st-chart-net"), s.curve, { label: "cumulative net" });

    barChart($("st-chart-upcard"), s.byUpcard.map((u) => ({ ...u, label: u.label })), {
      valueKey: "netPerHand",
      label: "Net per hand by dealer upcard",
      emptyText: "No hands yet.",
      tipFor: (u) => `<strong>Dealer shows ${u.label}</strong><span>${u.hands} hands · ${fmtPct(u.winRate)} won</span><span>Net ${fmtMoney(u.net, { sign: true })} (${fmtMoney(u.netPerHand, { sign: true })}/hand)</span><span>Dealer busted ${fmtPct(u.dealerBustRate)}</span>`,
    });
    $("st-table-upcard").innerHTML = table(
      ["Upcard", "Hands", "Win %", "Net", "Net / hand", "Dealer bust %"],
      s.byUpcard.map((u) => [u.label, u.hands, fmtPct(u.winRate), fmtMoney(u.net, { sign: true }), fmtMoney(u.netPerHand, { sign: true }), fmtPct(u.dealerBustRate)]),
    );

    barChart($("st-chart-count"), s.byTrueCount.map((b) => ({ ...b, label: b.bucket })), {
      valueKey: "netPerRound",
      label: "Net per round by true count",
      emptyText: "No rounds yet.",
      tipFor: (b) => `<strong>True count ${b.bucket}</strong><span>${b.rounds} rounds · avg bet ${fmtMoney(b.avgBet)}</span><span>Net ${fmtMoney(b.net, { sign: true })} (${fmtMoney(b.netPerRound, { sign: true })}/round)</span>`,
    });
    $("st-count-note").textContent =
      s.betCountCorrelation == null ? "" : `Bet size vs true count correlation: ${s.betCountCorrelation.toFixed(2)} (1.0 = bets rise perfectly with the count).`;
    $("st-table-count").innerHTML = table(
      ["True count", "Rounds", "Avg bet", "Rounds won", "Net", "Net / round"],
      s.byTrueCount.map((b) => [b.bucket, b.rounds, fmtMoney(b.avgBet), fmtPct(b.winRate), fmtMoney(b.net, { sign: true }), fmtMoney(b.netPerRound, { sign: true })]),
    );

    renderHeatmap(s.heatmap);

    $("st-deviations").innerHTML = s.deviations.length
      ? table(
          ["Situation", "Dealer", "You", "Basic says", "Times", "Net on those hands"],
          s.deviations.slice(0, 12).map((d) => [d.situation, upLabel(d.upcard), cap(d.action), cap(d.recommended), d.count, fmtMoney(d.net, { sign: true })]),
        )
      : `<p class="viz-empty">No deviations from basic strategy yet. Textbook play.</p>`;

    $("st-starting").innerHTML = table(
      ["Starting hand", "Hands", "Win %", "Net", "Net / hand"],
      s.byStartingHand.map((h) => [h.label, h.hands, fmtPct(h.winRate), fmtMoney(h.net, { sign: true }), fmtMoney(h.netPerHand, { sign: true })]),
    );

    $("st-strategies").innerHTML = table(
      ["Strategy", "Rounds", "Avg bet", "Hand win %", "Basic strategy", "Net", "Net / round", "Return"],
      s.byStrategy.map((x) => [x.name, x.rounds, fmtMoney(x.avgBet), fmtPct(x.winRate), fmtPct(x.adherence), fmtMoney(x.net, { sign: true }), fmtMoney(x.netPerRound, { sign: true }), fmtPct(x.roi, 1)]),
    );

    $("st-actions").innerHTML = table(
      ["Action", "Times", "Share", "Matched basic"],
      s.actions.map((a) => [cap(a.action), a.count, fmtPct(a.share), fmtPct(a.matched)]),
    );

    const recent = [...data].reverse().slice(0, 25);
    $("st-recent").innerHTML = table(
      ["When", "Bet", "Your hand(s)", "Dealer", "Actions", "Result"],
      recent.map((r) => [
        new Date(r.played_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
        fmtMoney(Number(r.initial_bet)),
        (r.round_hands ?? []).sort((a, b) => a.hand_index - b.hand_index).map((h) => `${pretty(h.cards)} (${h.final_total})`).join(" | "),
        `${pretty(r.dealer_cards)} (${r.dealer_total})`,
        (r.decisions ?? []).sort((a, b) => a.seq - b.seq).map((d) => `${cap(d.action)}${d.matches_basic ? "" : "*"}`).join(", ") || "—",
        `<span class="result-chip ${Number(r.net) > 0 ? "pos" : Number(r.net) < 0 ? "neg" : ""}">${fmtMoney(Number(r.net), { sign: true })}</span>`,
      ]),
      { raw: [5] },
    );
  }

  function renderHeatmap(hm) {
    const wrap = $("st-heatmap");
    if (!hm.rows.length) {
      wrap.innerHTML = `<p class="viz-empty">No decisions recorded yet.</p>`;
      return;
    }
    const head = `<tr><th scope="col">You \\ Dealer</th>${UPCARDS.map((u) => `<th scope="col">${upLabel(u)}</th>`).join("")}</tr>`;
    const body = hm.rows
      .map((row) => {
        const cells = UPCARDS.map((u) => {
          const c = hm.cell(row, u);
          if (!c) return `<td class="hm-empty"></td>`;
          const rate = c.matched / c.count;
          // Sequential blue on the dark felt: brighter = more consistent.
          const step = Math.round(rate * 4);
          return `<td class="hm hm-${step}" title="${esc(row)} vs ${upLabel(u)}: ${c.matched}/${c.count} matched basic strategy">${Math.round(rate * 100)}<small>${c.count}</small></td>`;
        }).join("");
        return `<tr><th scope="row">${esc(row)}</th>${cells}</tr>`;
      })
      .join("");
    const legend = `<div class="hm-legend" aria-hidden="true"><span>0%</span>${[0, 1, 2, 3, 4].map((i) => `<i class="hm-${i}"></i>`).join("")}<span>100% matched</span></div>`;
    wrap.innerHTML = `<table class="heatmap"><thead>${head}</thead><tbody>${body}</tbody></table>${legend}`;
  }

  async function load(force = false) {
    if (loading) return loading;
    if (loaded && !stale && !force) return render();
    $("st-status").textContent = "Loading your history…";
    loading = (async () => {
      try {
        await recorder.flush();
        rounds = await fetchAll();
        loaded = true;
        stale = false;
        $("st-status").textContent = "";
        render();
      } catch (err) {
        console.error(err);
        $("st-status").textContent = `Couldn't load your stats: ${err.message}`;
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  function download(name, text) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  filterStrategy.addEventListener("change", render);
  filterRange.addEventListener("change", render);
  $("st-refresh").addEventListener("click", () => load(true));
  $("st-export").addEventListener("change", (e) => {
    const which = e.target.value;
    e.target.value = "";
    if (!which) return;
    const tables = exportTables(filtered(), getStrategies());
    const stamp = new Date().toISOString().slice(0, 10);
    download(`blackjack-${which}-${stamp}.csv`, tables[which]);
  });

  recorder.onChange((ev) => {
    if (ev.type === "saved") stale = true;
    if (!$("stats-view").hidden) {
      if (ev.type === "saved") load(true);
      else renderPending();
    }
  });

  return { show: () => load(), refreshFilters: () => loaded && render() };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pretty = (codes = []) => codes.map((c) => c.replace(/^0/, "10")).join(" ");

function table(headers, rows, { raw = [] } = {}) {
  const th = headers.map((h, i) => `<th scope="col"${i ? ' class="num"' : ""}>${esc(h)}</th>`).join("");
  const tr = rows
    .map((r) => `<tr>${r.map((v, i) => `<td${i ? ' class="num"' : ""}>${raw.includes(i) ? v : esc(v ?? "—")}</td>`).join("")}</tr>`)
    .join("");
  return `<div class="table-scroll"><table class="data"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

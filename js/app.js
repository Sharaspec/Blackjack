import { Shoe, CARD_BACK } from "./api.js";
import {
  RULES,
  scoreHand,
  isBust,
  isNatural,
  dealerShouldHit,
  canSplit,
  canDouble,
  settleHand,
  cardName,
} from "./rules.js";

const STARTING_BANKROLL = 1000;
const MIN_CHIP = 5;
const STORAGE_KEY = "blackjack.bankroll";
const DEAL_DELAY = 280;

const $ = (id) => document.getElementById(id);
const el = {
  bankroll: $("bankroll"),
  bet: $("bet"),
  shoe: $("shoe"),
  message: $("message"),
  dealerCards: $("dealer-cards"),
  dealerScore: $("dealer-score"),
  playerHands: $("player-hands"),
  betting: $("betting"),
  playing: $("playing"),
  broke: $("broke"),
  deal: $("deal"),
  clear: $("clear"),
  rebet: $("rebet"),
  hit: $("hit"),
  stand: $("stand"),
  double: $("double"),
  split: $("split"),
  reset: $("reset"),
  chips: document.querySelectorAll("[data-chip]"),
};

const fmtWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const money = { format: (n) => (Number.isInteger(n) ? fmtWhole : fmtCents).format(n) };

const shoe = new Shoe(RULES.deckCount);

const state = {
  phase: "betting", // betting | player | dealer
  busy: false,
  bankroll: loadBankroll(),
  pendingBet: 0,
  lastBet: 0,
  hands: [], // { cards, bet, doubled, fromSplit, done, result }
  active: 0,
  dealer: [],
  holeHidden: true,
  retry: null,
};

// ---------- persistence ----------
function loadBankroll() {
  try {
    const saved = Number.parseFloat(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) && saved >= 0 ? saved : STARTING_BANKROLL;
  } catch {
    return STARTING_BANKROLL;
  }
}
function saveBankroll() {
  try {
    localStorage.setItem(STORAGE_KEY, String(state.bankroll));
  } catch {
    /* storage unavailable — play on without persistence */
  }
}

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let uid = 0;
const tag = (cards) => cards.map((c) => ({ ...c, uid: ++uid }));

function setMessage(text, isError = false) {
  el.message.textContent = text;
  el.message.classList.toggle("error", isError);
}

// Wrap every async action: lock the UI, surface API errors, allow a retry.
async function run(action) {
  if (state.busy) return;
  state.busy = true;
  state.retry = null;
  render();
  try {
    await action();
  } catch (err) {
    console.error(err);
    state.retry = action;
    setMessage(`${err.message} Press Retry to try again.`, true);
  } finally {
    state.busy = false;
    render();
  }
}

// ---------- card elements (cached so re-renders don't replay the deal animation) ----------
const cardEls = new Map();
function cardEl(card, faceDown) {
  let img = cardEls.get(card.uid);
  if (!img) {
    img = document.createElement("img");
    img.className = "card new";
    img.addEventListener("animationend", () => img.classList.remove("new"), { once: true });
    cardEls.set(card.uid, img);
  }
  const src = faceDown ? CARD_BACK : card.images?.svg || card.image;
  if (img.getAttribute("src") !== src) img.src = src;
  img.alt = faceDown ? "Face-down card" : cardName(card);
  return img;
}
function syncChildren(parent, children) {
  children.forEach((child, i) => {
    if (parent.children[i] !== child) parent.insertBefore(child, parent.children[i] || null);
  });
  while (parent.children.length > children.length) parent.lastChild.remove();
}
function scoreLabel(cards, fromSplit = false) {
  const { total, soft } = scoreHand(cards);
  if (isNatural(cards, fromSplit)) return "Blackjack";
  return soft && total < 21 ? `${total - 10} / ${total}` : String(total);
}

// ---------- rendering ----------
const handEls = [];
function handEl(i) {
  if (!handEls[i]) {
    const wrap = document.createElement("div");
    wrap.className = "hand";
    wrap.innerHTML = `
      <div class="area-head">
        <h2></h2><span class="score"></span><span class="bet-tag"></span><span class="result" hidden></span>
      </div>
      <div class="cards"></div>`;
    handEls[i] = wrap;
  }
  return handEls[i];
}

function render() {
  const { phase, busy, hands, dealer } = state;
  const hand = hands[state.active];

  el.bankroll.textContent = money.format(state.bankroll);
  const onTable = hands.reduce((sum, h) => sum + h.bet, 0);
  el.bet.textContent = money.format(phase === "betting" ? state.pendingBet : onTable);
  el.shoe.textContent = shoe.deckId ? `${shoe.remaining} cards` : "—";

  // dealer
  syncChildren(
    el.dealerCards,
    dealer.map((c, i) => cardEl(c, i === 1 && state.holeHidden)),
  );
  const visible = state.holeHidden ? dealer.slice(0, 1) : dealer;
  el.dealerScore.hidden = visible.length === 0;
  el.dealerScore.textContent = visible.length ? scoreLabel(visible) : "";

  // player hands
  syncChildren(
    el.playerHands,
    hands.map((h, i) => {
      const wrap = handEl(i);
      wrap.classList.toggle("active", phase === "player" && i === state.active && hands.length > 1);
      wrap.querySelector("h2").textContent = hands.length > 1 ? `Hand ${i + 1}` : "You";
      wrap.querySelector(".score").textContent = h.cards.length ? scoreLabel(h.cards, h.fromSplit) : "";
      wrap.querySelector(".bet-tag").textContent = `${money.format(h.bet)}${h.doubled ? " (doubled)" : ""}`;
      const result = wrap.querySelector(".result");
      result.hidden = !h.result;
      if (h.result) {
        result.className = `result ${h.result}`;
        result.textContent = h.result;
      }
      syncChildren(wrap.querySelector(".cards"), h.cards.map((c) => cardEl(c, false)));
      return wrap;
    }),
  );

  // panels
  const broke = phase === "betting" && state.bankroll < MIN_CHIP && state.pendingBet === 0;
  el.betting.hidden = phase !== "betting" || broke;
  el.playing.hidden = phase !== "player" && phase !== "dealer";
  el.broke.hidden = !broke;

  // betting controls
  el.chips.forEach((chip) => {
    chip.disabled = busy || state.pendingBet + Number(chip.dataset.chip) > state.bankroll;
  });
  el.deal.disabled = busy || state.pendingBet === 0;
  el.clear.disabled = busy || state.pendingBet === 0;
  el.rebet.hidden = !(state.pendingBet === 0 && state.lastBet > 0 && state.lastBet <= state.bankroll);
  el.rebet.disabled = busy;

  // play controls
  const canAct = phase === "player" && !busy && hand;
  el.hit.disabled = !canAct;
  el.stand.disabled = !canAct;
  el.double.disabled = !(canAct && canDouble(hand, state.bankroll));
  el.split.disabled = !(canAct && canSplit(hand, hands.length, state.bankroll));

  renderRetry();
}

let retryBtn;
function renderRetry() {
  if (state.retry && !state.busy) {
    if (!retryBtn) {
      retryBtn = document.createElement("button");
      retryBtn.className = "btn primary";
      retryBtn.textContent = "Retry";
      retryBtn.style.marginLeft = "12px";
      retryBtn.addEventListener("click", () => run(state.retry));
    }
    el.message.append(retryBtn);
  } else {
    retryBtn?.remove();
  }
}

// ---------- game flow ----------
async function deal() {
  const bet = state.pendingBet;
  setMessage("Dealing…");
  const [p1, d1, p2, d2] = tag(await shoe.draw(4));

  state.bankroll -= bet;
  saveBankroll();
  state.lastBet = bet;
  state.pendingBet = 0;
  state.hands = [{ cards: [], bet, doubled: false, fromSplit: false, done: false, result: null }];
  state.active = 0;
  state.dealer = [];
  state.holeHidden = true;
  state.phase = "player";

  // Deal in casino order: player, dealer, player, dealer (hole card).
  for (const [target, card] of [
    [state.hands[0].cards, p1],
    [state.dealer, d1],
    [state.hands[0].cards, p2],
    [state.dealer, d2],
  ]) {
    target.push(card);
    render();
    await sleep(DEAL_DELAY);
  }

  const playerBJ = isNatural(state.hands[0].cards);
  const dealerBJ = isNatural(state.dealer);
  if (playerBJ || dealerBJ) {
    state.hands[0].done = true;
    await finishRound();
    return;
  }
  setMessage("Your move.");
  await autoAdvance();
}

// Stand automatically on 21 (or on split aces); move to next hand or the dealer.
async function autoAdvance() {
  const hand = state.hands[state.active];
  if (hand && !hand.done && scoreHand(hand.cards).total >= 21) hand.done = true;
  if (hand && !hand.done) return;

  const next = state.hands.findIndex((h) => !h.done);
  if (next !== -1) {
    state.active = next;
    setMessage(`Playing hand ${next + 1}.`);
    render();
    return autoAdvance();
  }
  await finishRound();
}

async function hit() {
  const [card] = tag(await shoe.draw(1));
  const hand = state.hands[state.active];
  hand.cards.push(card);
  if (isBust(hand.cards)) {
    hand.done = true;
    setMessage(state.hands.length > 1 ? `Hand ${state.active + 1} busts.` : "Bust!");
    render();
    await sleep(DEAL_DELAY);
  }
  await autoAdvance();
}

async function stand() {
  state.hands[state.active].done = true;
  await autoAdvance();
}

async function doubleDown() {
  const hand = state.hands[state.active];
  if (!canDouble(hand, state.bankroll)) return;
  const [card] = tag(await shoe.draw(1));
  state.bankroll -= hand.bet;
  saveBankroll();
  hand.bet *= 2;
  hand.doubled = true;
  hand.cards.push(card);
  hand.done = true;
  render();
  await sleep(DEAL_DELAY);
  await autoAdvance();
}

async function split() {
  const hand = state.hands[state.active];
  if (!canSplit(hand, state.hands.length, state.bankroll)) return;
  const [c1, c2] = tag(await shoe.draw(2));
  state.bankroll -= hand.bet;
  saveBankroll();

  const moved = hand.cards.pop();
  const newHand = { cards: [moved], bet: hand.bet, doubled: false, fromSplit: true, done: false, result: null };
  hand.fromSplit = true;
  state.hands.splice(state.active + 1, 0, newHand);
  render();
  await sleep(DEAL_DELAY);

  hand.cards.push(c1);
  render();
  await sleep(DEAL_DELAY);
  newHand.cards.push(c2);

  // Split aces receive one card each and stand.
  if (moved.value === "ACE") {
    hand.done = true;
    newHand.done = true;
  }
  setMessage(`Playing hand ${state.active + 1}.`);
  await autoAdvance();
}

async function finishRound() {
  state.phase = "dealer";
  state.holeHidden = false;
  render();
  await sleep(DEAL_DELAY);

  const anyLive = state.hands.some((h) => !isBust(h.cards));
  const playerNatural = state.hands.length === 1 && isNatural(state.hands[0].cards);
  if (anyLive && !playerNatural && !isNatural(state.dealer)) {
    setMessage("Dealer's turn.");
    while (dealerShouldHit(state.dealer)) {
      const [card] = tag(await shoe.draw(1));
      state.dealer.push(card);
      render();
      await sleep(DEAL_DELAY * 1.5);
    }
  }

  let returned = 0;
  let staked = 0;
  for (const hand of state.hands) {
    const { outcome, payout } = settleHand(hand, state.dealer);
    hand.result = outcome;
    returned += payout;
    staked += hand.bet;
  }
  state.bankroll += returned;
  saveBankroll();
  state.phase = "betting";

  const net = returned - staked;
  const dealerTotal = scoreHand(state.dealer).total;
  let summary;
  if (state.hands.length === 1) {
    summary = {
      blackjack: `Blackjack! You win ${money.format(net)}.`,
      win: dealerTotal > 21 ? `Dealer busts — you win ${money.format(net)}!` : `You win ${money.format(net)}!`,
      lose: isNatural(state.dealer) ? "Dealer has Blackjack." : "Dealer wins.",
      bust: "Bust — dealer wins.",
      push: "Push. Your bet is returned.",
    }[state.hands[0].result];
  } else if (net > 0) summary = `You're up ${money.format(net)} this round.`;
  else if (net < 0) summary = `You're down ${money.format(-net)} this round.`;
  else summary = "You broke even this round.";

  if (shoe.remaining < shoe.size * RULES.reshuffleAt) {
    setMessage(`${summary} Shuffling the shoe…`);
    render();
    await shoe.reshuffle();
  }

  if (state.bankroll < MIN_CHIP) summary += " You're out of chips.";
  else summary += " Place your next bet.";
  setMessage(summary);
}

// ---------- wiring ----------
el.chips.forEach((chip) =>
  chip.addEventListener("click", () => {
    const value = Number(chip.dataset.chip);
    if (state.phase !== "betting" || state.pendingBet + value > state.bankroll) return;
    state.pendingBet += value;
    render();
  }),
);
el.clear.addEventListener("click", () => {
  state.pendingBet = 0;
  render();
});
el.rebet.addEventListener("click", () => {
  if (state.lastBet <= state.bankroll) state.pendingBet = state.lastBet;
  render();
});
el.reset.addEventListener("click", () => {
  state.bankroll = STARTING_BANKROLL;
  state.lastBet = 0;
  saveBankroll();
  setMessage("Fresh chips! Place your bet to begin.");
  render();
});
el.deal.addEventListener("click", () => state.pendingBet > 0 && run(deal));
el.hit.addEventListener("click", () => run(hit));
el.stand.addEventListener("click", () => run(stand));
el.double.addEventListener("click", () => run(doubleDown));
el.split.addEventListener("click", () => run(split));

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  if (e.key === "Enter" && e.target instanceof HTMLButtonElement) return; // native click handles it
  const map = { Enter: el.deal, h: el.hit, s: el.stand, d: el.double, p: el.split };
  const btn = map[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (btn && !btn.disabled && !btn.closest("[hidden]")) {
    e.preventDefault();
    btn.click();
  }
});

// Open the shoe up front so the first deal is quick.
render();
run(async () => {
  setMessage("Shuffling a 6-deck shoe…");
  await shoe.open();
  setMessage("Place your bet to begin.");
});

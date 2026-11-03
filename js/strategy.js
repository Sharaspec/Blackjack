// Basic strategy + Hi-Lo counting — pure functions, no DOM.
//
// Basic strategy here matches this table's rules: 6 decks, dealer stands on
// soft 17, double on any two cards, double after split allowed, no surrender.
import { cardPoints, scoreHand } from "./rules.js";

// Dealer upcard value: 2–10, ace = 11.
export const upcardValue = (card) => cardPoints(card);

// H = hit, S = stand, D = double (else hit), Ds = double (else stand), P = split.
// Columns: dealer 2 3 4 5 6 7 8 9 10 A
const HARD = {
  8: "H H H H H H H H H H",
  9: "H D D D D H H H H H",
  10: "D D D D D D D D H H",
  11: "D D D D D D D D D H",
  12: "H H S S S H H H H H",
  13: "S S S S S H H H H H",
  14: "S S S S S H H H H H",
  15: "S S S S S H H H H H",
  16: "S S S S S H H H H H",
};
const SOFT = {
  13: "H H H D D H H H H H", // A,2
  14: "H H H D D H H H H H", // A,3
  15: "H H D D D H H H H H", // A,4
  16: "H H D D D H H H H H", // A,5
  17: "H D D D D H H H H H", // A,6
  18: "S Ds Ds Ds Ds S S H H H", // A,7
};
const PAIRS = {
  2: "P P P P P P H H H H",
  3: "P P P P P P H H H H",
  4: "H H H P P H H H H H",
  6: "P P P P P H H H H H",
  7: "P P P P P P H H H H",
  8: "P P P P P P P P P P",
  9: "P P P P P S P P S S",
  11: "P P P P P P P P P P",
};
const col = (up) => (up === 11 ? 9 : up - 2);
const cell = (row, up) => row.split(" ")[col(up)];

// Returns "hit" | "stand" | "double" | "split" for the given situation.
export function basicStrategy(cards, upcard, { canDouble = cards.length === 2, canSplit = false } = {}) {
  const up = typeof upcard === "number" ? upcard : upcardValue(upcard);
  const { total, soft } = scoreHand(cards);

  if (canSplit && cards.length === 2) {
    const pv = cardPoints(cards[0]);
    if (pv === cardPoints(cards[1]) && PAIRS[pv] && cell(PAIRS[pv], up) === "P") return "split";
  }

  let code;
  if (soft && total < 21) code = total >= 19 ? "S" : total <= 12 ? "H" : cell(SOFT[total], up);
  else if (total >= 17) code = "S";
  else if (total <= 8) code = "H";
  else code = cell(HARD[total], up);

  if (code === "D") return canDouble ? "double" : "hit";
  if (code === "Ds") return canDouble ? "double" : "stand";
  return code === "S" ? "stand" : "hit";
}

// Hi-Lo tag: 2–6 = +1, 7–9 = 0, 10/face/ace = −1.
export function hiLo(card) {
  const v = cardPoints(card);
  if (v >= 2 && v <= 6) return 1;
  if (v >= 10) return -1;
  return 0;
}

export function trueCount(running, cardsRemaining) {
  const decks = Math.max(cardsRemaining / 52, 0.5);
  return Math.round((running / decks) * 100) / 100;
}

// Describes a hand's situation in the shape basic-strategy charts use.
export function situation(cards) {
  const { total, soft } = scoreHand(cards);
  const isPair = cards.length === 2 && cardPoints(cards[0]) === cardPoints(cards[1]);
  let label;
  if (isPair) {
    const v = cardPoints(cards[0]);
    label = `Pair ${v === 11 ? "A" : v}s`;
  } else if (soft && total < 21) label = `Soft ${total}`;
  else label = `Hard ${total}`;
  return { total, soft, isPair, label };
}

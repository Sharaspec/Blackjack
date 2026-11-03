import { test } from "node:test";
import assert from "node:assert/strict";
import { basicStrategy, hiLo, trueCount, situation } from "../js/strategy.js";

const SUITS = { S: "SPADES", H: "HEARTS", D: "DIAMONDS", C: "CLUBS" };
const VALUES = { A: "ACE", K: "KING", Q: "QUEEN", J: "JACK", 0: "10" };
const c = (code) => ({ code, value: VALUES[code[0]] ?? code[0], suit: SUITS[code[1]] });
const h = (s) => s.split(" ").map(c);
const bs = (cards, up, opts) => basicStrategy(h(cards), c(up), opts);

test("hard totals", () => {
  assert.equal(bs("0S 6D", "6H"), "stand");
  assert.equal(bs("0S 6D", "7H"), "hit");
  assert.equal(bs("0S 2D", "3H"), "hit");
  assert.equal(bs("0S 2D", "4H"), "stand");
  assert.equal(bs("6S 5D", "AH"), "hit"); // S17 6-deck: hit 11 vs A
  assert.equal(bs("6S 5D", "0H"), "double");
  assert.equal(bs("6S 5D 0C".split(" ").slice(0, 2).join(" "), "0H", { canDouble: false }), "hit");
  assert.equal(bs("5S 4D", "2H"), "hit");
  assert.equal(bs("5S 4D", "3H"), "double");
  assert.equal(bs("0S 7D", "AH"), "stand");
  assert.equal(bs("3S 2D", "6H"), "hit");
});

test("soft totals", () => {
  assert.equal(bs("AS 7D", "2H"), "stand");
  assert.equal(bs("AS 7D", "3H"), "double");
  assert.equal(bs("AS 7D", "3H", { canDouble: false }), "stand");
  assert.equal(bs("AS 7D", "9H"), "hit");
  assert.equal(bs("AS 8D", "6H"), "stand");
  assert.equal(bs("AS 2D", "5H"), "double");
  assert.equal(bs("AS 2D", "4H"), "hit");
  assert.equal(bs("AS AD", "6H", { canSplit: false }), "hit");
  assert.equal(bs("AS 2D 3C", "5H", { canDouble: false }), "hit");
});

test("pairs", () => {
  assert.equal(bs("8S 8D", "AH", { canSplit: true }), "split");
  assert.equal(bs("AS AD", "0H", { canSplit: true }), "split");
  assert.equal(bs("9S 9D", "7H", { canSplit: true }), "stand");
  assert.equal(bs("9S 9D", "8H", { canSplit: true }), "split");
  assert.equal(bs("5S 5D", "6H", { canSplit: true }), "double");
  assert.equal(bs("KS QD", "6H", { canSplit: true }), "stand");
  assert.equal(bs("4S 4D", "5H", { canSplit: true }), "split");
  assert.equal(bs("4S 4D", "4H", { canSplit: true }), "hit");
  assert.equal(bs("8S 8D", "0H", { canSplit: false }), "hit");
});

test("hi-lo counting", () => {
  assert.deepEqual(h("2S 6D 7H 9C 0S KD AH").map(hiLo), [1, 1, 0, 0, -1, -1, -1]);
  assert.equal(trueCount(6, 156), 2);
  assert.equal(trueCount(3, 10), 6); // floors at half a deck
});

test("situation labels", () => {
  assert.equal(situation(h("8S 8D")).label, "Pair 8s");
  assert.equal(situation(h("AS 6D")).label, "Soft 17");
  assert.equal(situation(h("0S 6D")).label, "Hard 16");
  assert.equal(situation(h("AS AD")).label, "Pair As");
});

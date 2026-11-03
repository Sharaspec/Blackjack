import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreHand, isNatural, dealerShouldHit, settleHand, canSplit, canDouble, cardName } from "../js/rules.js";

const SUITS = { S: "SPADES", H: "HEARTS", D: "DIAMONDS", C: "CLUBS" };
const VALUES = { A: "ACE", K: "KING", Q: "QUEEN", J: "JACK", 0: "10" };
const c = (code) => ({ code, value: VALUES[code[0]] ?? code[0], suit: SUITS[code[1]] });
const hand = (codes, extra = {}) => ({ cards: codes.split(" ").map(c), bet: 10, doubled: false, fromSplit: false, ...extra });

test("scores hard and soft hands", () => {
  assert.deepEqual(scoreHand(hand("KH 7S").cards), { total: 17, soft: false });
  assert.deepEqual(scoreHand(hand("AH 6S").cards), { total: 17, soft: true });
  assert.deepEqual(scoreHand(hand("AH 6S 9D").cards), { total: 16, soft: false });
  assert.deepEqual(scoreHand(hand("AH AS AD").cards), { total: 13, soft: true });
  assert.equal(scoreHand(hand("0H QS 2D").cards).total, 22);
});

test("natural blackjack only on two-card, non-split 21", () => {
  assert.ok(isNatural(hand("AS KD").cards));
  assert.ok(!isNatural(hand("AS KD").cards, true));
  assert.ok(!isNatural(hand("7S 7D 7H").cards));
});

test("dealer stands on soft 17 by default", () => {
  assert.ok(dealerShouldHit(hand("0S 6D").cards));
  assert.ok(!dealerShouldHit(hand("AS 6D").cards));
  assert.ok(dealerShouldHit(hand("AS 6D").cards, true));
  assert.ok(!dealerShouldHit(hand("0S 7D").cards));
});

test("settles hands with correct payouts", () => {
  assert.deepEqual(settleHand(hand("AS KD"), hand("0S 9D").cards), { outcome: "blackjack", payout: 25 });
  assert.deepEqual(settleHand(hand("AS KD"), hand("AH QD").cards), { outcome: "push", payout: 10 });
  assert.deepEqual(settleHand(hand("0S 0D"), hand("AH QD").cards), { outcome: "lose", payout: 0 });
  assert.deepEqual(settleHand(hand("0S 5D 9H"), hand("0H 2D").cards), { outcome: "bust", payout: 0 });
  assert.deepEqual(settleHand(hand("0S 8D"), hand("0H 6D 9C").cards), { outcome: "win", payout: 20 });
  assert.deepEqual(settleHand(hand("0S 8D"), hand("0H 7D").cards), { outcome: "win", payout: 20 });
  assert.deepEqual(settleHand(hand("0S 7D"), hand("0H 7D").cards), { outcome: "push", payout: 10 });
  assert.deepEqual(settleHand(hand("AS KD", { fromSplit: true }), hand("0H 7D").cards), { outcome: "win", payout: 20 });
});

test("split and double eligibility", () => {
  assert.ok(canSplit(hand("8S 8D"), 1, 100));
  assert.ok(canSplit(hand("KS 0D"), 1, 100));
  assert.ok(!canSplit(hand("8S 9D"), 1, 100));
  assert.ok(!canSplit(hand("8S 8D"), 4, 100));
  assert.ok(!canSplit(hand("8S 8D"), 1, 5));
  assert.ok(canDouble(hand("5S 6D"), 10));
  assert.ok(!canDouble(hand("5S 6D 2C"), 10));
});

test("card names", () => {
  assert.equal(cardName(c("QH")), "Queen of Hearts");
  assert.equal(cardName(c("0S")), "10 of Spades");
});

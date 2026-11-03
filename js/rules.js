// Pure Blackjack rules — no DOM, no network. Easy to unit test.
//
// Cards follow the Deck of Cards API shape:
//   { code: "KH", value: "KING", suit: "HEARTS", image: "..." }
// The API reports ten as value "10" (code "0H").

export const RULES = {
  deckCount: 6,            // standard 6-deck shoe
  dealerHitsSoft17: false, // dealer stands on all 17s
  blackjackPayout: 1.5,    // 3:2
  maxHands: 4,             // split up to 3 times
  reshuffleAt: 0.25,       // reshuffle when 25% of the shoe remains
};

export function cardPoints(card) {
  switch (card.value) {
    case "ACE":
      return 11;
    case "KING":
    case "QUEEN":
    case "JACK":
      return 10;
    default:
      return Number.parseInt(card.value, 10);
  }
}

// Returns { total, soft }. "soft" means an ace is still counted as 11.
export function scoreHand(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += cardPoints(card);
    if (card.value === "ACE") aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}

export function isBust(cards) {
  return scoreHand(cards).total > 21;
}

// A natural: exactly two cards totalling 21. Split hands never count as natural.
export function isNatural(cards, fromSplit = false) {
  return !fromSplit && cards.length === 2 && scoreHand(cards).total === 21;
}

export function dealerShouldHit(cards, hitSoft17 = RULES.dealerHitsSoft17) {
  const { total, soft } = scoreHand(cards);
  if (total < 17) return true;
  return total === 17 && soft && hitSoft17;
}

export function canSplit(hand, handCount, bankroll) {
  const [a, b] = hand.cards;
  return (
    hand.cards.length === 2 &&
    !hand.doubled &&
    handCount < RULES.maxHands &&
    bankroll >= hand.bet &&
    cardPoints(a) === cardPoints(b)
  );
}

export function canDouble(hand, bankroll) {
  return hand.cards.length === 2 && !hand.doubled && bankroll >= hand.bet;
}

// Settles one player hand against the dealer.
// Returns { outcome, payout } where payout is the total returned to the
// player (stake included). Losing returns 0.
export function settleHand(hand, dealerCards) {
  const player = scoreHand(hand.cards).total;
  const dealer = scoreHand(dealerCards).total;
  const playerNatural = isNatural(hand.cards, hand.fromSplit);
  const dealerNatural = isNatural(dealerCards);

  if (player > 21) return { outcome: "bust", payout: 0 };
  if (playerNatural && dealerNatural) return { outcome: "push", payout: hand.bet };
  if (playerNatural) {
    return { outcome: "blackjack", payout: hand.bet + hand.bet * RULES.blackjackPayout };
  }
  if (dealerNatural) return { outcome: "lose", payout: 0 };
  if (dealer > 21) return { outcome: "win", payout: hand.bet * 2 };
  if (player > dealer) return { outcome: "win", payout: hand.bet * 2 };
  if (player < dealer) return { outcome: "lose", payout: 0 };
  return { outcome: "push", payout: hand.bet };
}

export function cardName(card) {
  const value = card.value.charAt(0) + card.value.slice(1).toLowerCase();
  const suit = card.suit.charAt(0) + card.suit.slice(1).toLowerCase();
  return `${value} of ${suit}`;
}

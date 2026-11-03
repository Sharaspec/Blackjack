// Thin client for https://deckofcardsapi.com
//
// Endpoints used:
//   GET /api/deck/new/shuffle/?deck_count=N   -> new shuffled shoe
//   GET /api/deck/<id>/draw/?count=N          -> draw cards
//   GET /api/deck/<id>/shuffle/               -> return every card and reshuffle
//
// Piles are not used: the API does not support piles with multiple decks,
// so hands are tracked in the browser instead.

const BASE = "https://deckofcardsapi.com/api/deck";
export const CARD_BACK = "https://deckofcardsapi.com/static/img/back.png";

async function request(url) {
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error("Can't reach the Deck of Cards API. Check your connection.");
  }
  if (!res.ok) throw new Error(`Deck of Cards API error (${res.status}).`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Deck of Cards API request failed.");
  return data;
}

export class Shoe {
  constructor(deckCount) {
    this.deckCount = deckCount;
    this.size = deckCount * 52;
    this.deckId = null;
    this.remaining = 0;
  }

  async open() {
    const data = await request(`${BASE}/new/shuffle/?deck_count=${this.deckCount}`);
    this.deckId = data.deck_id;
    this.remaining = data.remaining;
  }

  async draw(count = 1) {
    if (!this.deckId) await this.open();
    let data;
    try {
      data = await request(`${BASE}/${this.deckId}/draw/?count=${count}`);
    } catch (err) {
      // Decks expire after two weeks of inactivity — open a fresh shoe and retry once.
      await this.open();
      data = await request(`${BASE}/${this.deckId}/draw/?count=${count}`);
    }
    if (data.cards.length < count) {
      // Ran dry mid-round: reshuffle and top up.
      await this.reshuffle();
      const extra = await request(`${BASE}/${this.deckId}/draw/?count=${count - data.cards.length}`);
      data.cards.push(...extra.cards);
      data.remaining = extra.remaining;
    }
    this.remaining = data.remaining;
    return data.cards;
  }

  async reshuffle() {
    const data = await request(`${BASE}/${this.deckId}/shuffle/`);
    this.remaining = data.remaining;
  }
}

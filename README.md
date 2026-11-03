# Blackjack

A browser Blackjack game powered by the free [Deck of Cards API](https://deckofcardsapi.com/).
Plain HTML, CSS, and JavaScript (ES modules), with no build step and no dependencies.

## How it uses the API

| Action | Endpoint |
| --- | --- |
| Open a 6-deck shoe | `GET /api/deck/new/shuffle/?deck_count=6` |
| Deal / hit / double / split | `GET /api/deck/<deck_id>/draw/?count=N` |
| Reshuffle when 25% of the shoe is left | `GET /api/deck/<deck_id>/shuffle/` |
| Card art | `card.images.svg` from each drawn card, `static/img/back.png` for the hole card |

The API's *piles* feature doesn't work with multi-deck shoes, so hands are tracked in the
browser. If a deck expires (the API discards decks after two weeks idle), the game opens a new one automatically.

## Rules

- 6 decks; dealer stands on all 17s
- Blackjack pays 3:2; dealer peeks for blackjack
- Double down on any first two cards
- Split matching values up to 4 hands; split aces get one card each; 21 after a split is not a blackjack
- Starting bankroll is $1,000, saved in `localStorage`

Keyboard: `Enter` deal · `H` hit · `S` stand · `D` double · `P` split

## Run locally

ES modules don't load from `file://`, so serve the folder:

```bash
npx serve .
```

## Tests

```bash
npm test
```

## Deploy to Netlify

`netlify.toml` sets the publish directory to the repo root with no build command.

- **Drag and drop:** zip or drag the project folder onto https://app.netlify.com/drop
- **Git-connected:** in Netlify, "Add new site → Import from Git", pick this repo and the `main` branch, and leave the build command empty

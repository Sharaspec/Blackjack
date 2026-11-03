# Blackjack

A browser Blackjack game powered by the free [Deck of Cards API](https://deckofcardsapi.com/).
Plain HTML, CSS, and JavaScript (ES modules), with no build step. Supabase's JS client loads from a CDN.

## Sign in with Google (Supabase)

Players sign in with Google through [Supabase Auth](https://supabase.com/docs/guides/auth/social-login/auth-google)
before they can play. Once signed in, the header greets them by first name with their Google profile photo
(or their initials if there's no photo), and each account keeps its own bankroll in that browser.

The project URL and publishable key live in `js/config.js`. The publishable key is meant to be public.

One-time setup, in the Supabase dashboard:

1. **Authentication → Sign In / Providers → Google:** enabled, with your Google OAuth client ID and secret.
2. In Google Cloud Console, the OAuth client's **Authorized redirect URI** is
   `https://tvczcrjyywnjdfugqpnp.supabase.co/auth/v1/callback`.
3. **Authentication → URL Configuration:**
   - **Site URL:** your Netlify URL, e.g. `https://your-site.netlify.app`
   - **Redirect URLs:** add `https://your-site.netlify.app/**` (and `http://localhost:3000/**` for local testing)

If the Netlify URL isn't in the redirect list, Supabase sends players back to the Site URL instead.

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

Then open http://localhost:3000. That address must be in Supabase's redirect URLs for sign-in to work locally.

## Tests

```bash
npm test
```

## Deploy to Netlify

`netlify.toml` sets the publish directory to the repo root with no build command.

- **Drag and drop:** zip or drag the project folder onto https://app.netlify.com/drop
- **Git-connected:** in Netlify, "Add new site → Import from Git", pick this repo and the `main` branch, and leave the build command empty

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

## Player profiles

Signed-in players get a **Profile** tab where they create and edit a profile: a unique `@username`,
a display name, a short bio, and optionally their Google photo. New players land on that tab after their
first sign-in (they can skip it). After that, the header greets them by display name.

Profiles are stored in the Supabase table `public.profiles`. The migration is in
`supabase/migrations/20261103000000_create_profiles.sql` and has already been applied to the project.

| Column | Notes |
| --- | --- |
| `id` | The player's `auth.users` id. Deleting the account deletes the profile. |
| `username` | Unique, 3–20 chars, `a-z 0-9 _` |
| `display_name` | 1–50 chars |
| `bio` | Optional, up to 280 chars |
| `avatar_url` | Optional `https://` image URL (their Google photo) |
| `created_at`, `updated_at` | Set automatically |

Row Level Security:
- Signed-in players can read profiles.
- Each player can only create and update their own profile.
- Signed-out visitors can't read the table at all.

## Game history & Stats tab

Every round is saved automatically to Supabase for analysis and modeling:

| Table | One row per | Key columns |
| --- | --- | --- |
| `strategies` | strategy you define on the table ("Basic", "Hi-Lo 1–8 spread"…) | `name`, `description` |
| `rounds` | round dealt | `strategy_id`, `initial_bet`, `total_wagered`, `net`, `bankroll_before/after`, shoe state (`cards_remaining`, Hi-Lo `running_count`, `true_count`), dealer `upcard`/`cards`/`total`/`bust`/`blackjack` |
| `round_hands` | player hand (splits make several) | `cards`, `initial_total/soft`, `is_pair`, `final_total`, `doubled`, `from_split`, `outcome`, `bet`, `payout`, `net` |
| `decisions` | action you took | situation (`player_cards`, `player_total`, `soft`, `is_pair`, dealer `upcard_value`), what was allowed (`can_double`, `can_split`), `action`, the basic-strategy `recommended` action, `matches_basic`, count at that moment, `decision_ms` (time you took) |

- Rounds are written atomically through the `record_round(payload)` database function.
- Every table is private to its owner (RLS). Migration: `supabase/migrations/20261103010000_create_game_history.sql`.
- If a save fails (e.g. offline), the round is queued in the browser and uploaded later.
- Card counting uses Hi-Lo on the cards visible to the player. The hole card is counted once it's revealed, and the count resets on every shuffle.
- Basic strategy is the chart for these rules: 6 decks, dealer stands on soft 17, double after split, no surrender.

**Stats tab** (filter by strategy and time range):
- **KPIs:** net, return on wager, win/loss/push rates, blackjack, bust and dealer-bust rates, doubles, splits, streaks, best and worst round, basic-strategy adherence, decision speed.
- **Insights:** plain-language patterns, such as costly deviations, decision speed when deviating, best and worst dealer upcards, and whether your bets track the count.
- **Charts:** cumulative net; net per hand by dealer upcard; net per round by true count.
- **Breakdowns:** a basic-strategy adherence heatmap (your hand vs dealer upcard), top deviations, a strategy comparison, results by starting hand, and recent rounds.
- **Export:** CSV of rounds, hands or decisions for modeling in Python, R or Excel.

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

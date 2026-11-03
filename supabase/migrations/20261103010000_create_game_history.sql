-- Game history for analytics and modeling.
--
--   strategies     player-defined labels ("Basic", "Hi-Lo spread", "Martingale"...)
--   rounds         one row per round dealt (shoe state, bets, dealer result, bankroll)
--   round_hands    one row per player hand in a round (a split creates more than one)
--   decisions      one row per player action, with the situation and the
--                  basic-strategy recommendation at the moment it was made
--
-- Rows are written atomically through public.record_round(payload jsonb).
-- Every table is private to its owner via RLS.

-- ---------- strategies ----------
create table public.strategies (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  description text check (description is null or char_length(description) <= 500),
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);
comment on table public.strategies is 'Player-defined strategy labels used to tag rounds.';

-- ---------- rounds ----------
create table public.rounds (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  strategy_id      uuid references public.strategies (id) on delete set null,
  played_at        timestamptz not null default now(),
  deck_id          text,
  deck_count       smallint not null check (deck_count between 1 and 20),
  cards_remaining  smallint not null check (cards_remaining >= 0),  -- in the shoe before the deal
  running_count    smallint not null,                               -- Hi-Lo, before the deal
  true_count       numeric(6, 2) not null,                          -- running / decks remaining
  bankroll_before  numeric(12, 2) not null,
  bankroll_after   numeric(12, 2) not null,
  initial_bet      numeric(12, 2) not null check (initial_bet > 0),
  total_wagered    numeric(12, 2) not null check (total_wagered >= initial_bet),
  net              numeric(12, 2) not null,
  hand_count       smallint not null check (hand_count between 1 and 4),
  dealer_upcard    text not null check (dealer_upcard ~ '^[A2-90JQK][SHDC]$'),
  dealer_cards     text[] not null,
  dealer_total     smallint not null,
  dealer_blackjack boolean not null,
  dealer_bust      boolean not null,
  player_blackjack boolean not null
);
comment on table public.rounds is 'One row per Blackjack round played.';
create index rounds_user_played_idx on public.rounds (user_id, played_at desc);
create index rounds_strategy_idx on public.rounds (strategy_id);

-- ---------- round_hands ----------
create table public.round_hands (
  id            uuid primary key default gen_random_uuid(),
  round_id      uuid not null references public.rounds (id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  hand_index    smallint not null check (hand_index between 0 and 3),
  cards         text[] not null,
  initial_total smallint not null,   -- first two cards
  initial_soft  boolean not null,
  is_pair       boolean not null,
  final_total   smallint not null,
  final_soft    boolean not null,
  doubled       boolean not null,
  from_split    boolean not null,
  outcome       text not null check (outcome in ('blackjack', 'win', 'push', 'lose', 'bust')),
  bet           numeric(12, 2) not null check (bet > 0),
  payout        numeric(12, 2) not null check (payout >= 0),
  net           numeric(12, 2) not null,
  unique (round_id, hand_index)
);
comment on table public.round_hands is 'Each player hand in a round, with its final result.';
create index round_hands_user_idx on public.round_hands (user_id);

-- ---------- decisions ----------
create table public.decisions (
  id             bigint generated always as identity primary key,
  round_id       uuid not null references public.rounds (id) on delete cascade,
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  hand_index     smallint not null check (hand_index between 0 and 3),
  seq            smallint not null check (seq >= 0),       -- order within the round
  action         text not null check (action in ('hit', 'stand', 'double', 'split')),
  player_cards   text[] not null,                          -- the hand when the decision was made
  player_total   smallint not null,
  soft           boolean not null,
  is_pair        boolean not null,
  dealer_upcard  text not null,
  upcard_value   smallint not null check (upcard_value between 2 and 11),
  can_double     boolean not null,
  can_split      boolean not null,
  recommended    text not null check (recommended in ('hit', 'stand', 'double', 'split')),
  matches_basic  boolean not null,
  running_count  smallint not null,
  true_count     numeric(6, 2) not null,
  decision_ms    integer check (decision_ms is null or decision_ms >= 0),
  unique (round_id, seq)
);
comment on table public.decisions is 'Every player action with context and the basic-strategy recommendation.';
create index decisions_user_idx on public.decisions (user_id);

-- ---------- RLS: owner-only ----------
alter table public.strategies  enable row level security;
alter table public.rounds      enable row level security;
alter table public.round_hands enable row level security;
alter table public.decisions   enable row level security;

revoke all on public.strategies, public.rounds, public.round_hands, public.decisions from anon;

create policy "Own strategies: read"   on public.strategies for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own strategies: create" on public.strategies for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Own strategies: edit"   on public.strategies for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Own strategies: delete" on public.strategies for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Own rounds: read"   on public.rounds for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own rounds: create" on public.rounds for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and (strategy_id is null or exists (
      select 1 from public.strategies s where s.id = strategy_id and s.user_id = (select auth.uid())))
  );
create policy "Own rounds: delete" on public.rounds for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Own hands: read"   on public.round_hands for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own hands: create" on public.round_hands for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.rounds r where r.id = round_id and r.user_id = (select auth.uid()))
  );

create policy "Own decisions: read"   on public.decisions for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own decisions: create" on public.decisions for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.rounds r where r.id = round_id and r.user_id = (select auth.uid()))
  );

-- ---------- atomic write ----------
-- Inserts a round with its hands and decisions in one transaction.
-- SECURITY INVOKER: runs as the caller, so the RLS policies above still apply.
create function public.record_round(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in';
  end if;

  insert into public.rounds (
    strategy_id, played_at, deck_id, deck_count, cards_remaining, running_count, true_count,
    bankroll_before, bankroll_after, initial_bet, total_wagered, net, hand_count,
    dealer_upcard, dealer_cards, dealer_total, dealer_blackjack, dealer_bust, player_blackjack
  )
  select
    nullif(r->>'strategy_id', '')::uuid,
    coalesce((r->>'played_at')::timestamptz, now()),
    r->>'deck_id',
    (r->>'deck_count')::smallint,
    (r->>'cards_remaining')::smallint,
    (r->>'running_count')::smallint,
    (r->>'true_count')::numeric,
    (r->>'bankroll_before')::numeric,
    (r->>'bankroll_after')::numeric,
    (r->>'initial_bet')::numeric,
    (r->>'total_wagered')::numeric,
    (r->>'net')::numeric,
    (r->>'hand_count')::smallint,
    r->>'dealer_upcard',
    array(select jsonb_array_elements_text(r->'dealer_cards')),
    (r->>'dealer_total')::smallint,
    (r->>'dealer_blackjack')::boolean,
    (r->>'dealer_bust')::boolean,
    (r->>'player_blackjack')::boolean
  from (select payload->'round' as r) src
  returning id into new_id;

  insert into public.round_hands (
    round_id, hand_index, cards, initial_total, initial_soft, is_pair, final_total, final_soft,
    doubled, from_split, outcome, bet, payout, net
  )
  select
    new_id,
    (h->>'hand_index')::smallint,
    array(select jsonb_array_elements_text(h->'cards')),
    (h->>'initial_total')::smallint,
    (h->>'initial_soft')::boolean,
    (h->>'is_pair')::boolean,
    (h->>'final_total')::smallint,
    (h->>'final_soft')::boolean,
    (h->>'doubled')::boolean,
    (h->>'from_split')::boolean,
    h->>'outcome',
    (h->>'bet')::numeric,
    (h->>'payout')::numeric,
    (h->>'net')::numeric
  from jsonb_array_elements(payload->'hands') h;

  insert into public.decisions (
    round_id, hand_index, seq, action, player_cards, player_total, soft, is_pair,
    dealer_upcard, upcard_value, can_double, can_split, recommended, matches_basic,
    running_count, true_count, decision_ms
  )
  select
    new_id,
    (d->>'hand_index')::smallint,
    (d->>'seq')::smallint,
    d->>'action',
    array(select jsonb_array_elements_text(d->'player_cards')),
    (d->>'player_total')::smallint,
    (d->>'soft')::boolean,
    (d->>'is_pair')::boolean,
    d->>'dealer_upcard',
    (d->>'upcard_value')::smallint,
    (d->>'can_double')::boolean,
    (d->>'can_split')::boolean,
    d->>'recommended',
    (d->>'matches_basic')::boolean,
    (d->>'running_count')::smallint,
    (d->>'true_count')::numeric,
    (d->>'decision_ms')::integer
  from jsonb_array_elements(coalesce(payload->'decisions', '[]'::jsonb)) d;

  return new_id;
end;
$$;

revoke execute on function public.record_round(jsonb) from public, anon;
grant execute on function public.record_round(jsonb) to authenticated;

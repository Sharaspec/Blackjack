// Entry point: Google sign-in through Supabase Auth, then the game.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";
import { initProfile, loadProfile } from "./profile.js";
import { createRecorder } from "./recorder.js";
import { initStrategies } from "./strategies.js";
import { initStats } from "./stats-view.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true },
});

const $ = (id) => document.getElementById(id);
const screens = { loading: $("loading"), login: $("login"), game: $("game") };
let gameStarted = false;

function show(name) {
  for (const [key, node] of Object.entries(screens)) node.hidden = key !== name;
}

function profileOf(user) {
  const meta = user.user_metadata ?? {};
  const fullName = meta.full_name || meta.name || user.email || "Player";
  return {
    fullName,
    firstName: fullName.split(/[\s@]/)[0],
    avatar: meta.avatar_url || meta.picture || "",
    email: user.email || "",
  };
}

function renderUser(user, profile) {
  const google = profileOf(user);
  const fullName = profile?.display_name || google.fullName;
  const firstName = profile?.display_name || google.firstName;
  const avatar = profile ? profile.avatar_url || "" : google.avatar;
  const email = profile ? `@${profile.username}` : google.email;
  $("greeting").textContent = `Welcome, ${firstName}!`;
  $("user-email").textContent = email;

  const img = $("avatar");
  const initials = $("avatar-initials");
  initials.textContent = fullName
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  img.alt = fullName;
  const useInitials = () => {
    img.hidden = true;
    initials.hidden = false;
  };
  if (avatar) {
    img.hidden = false;
    initials.hidden = true;
    img.onerror = useInitials;
    img.src = avatar;
  } else {
    useInitials();
  }
}

// ---------- tabs ----------
const tabs = { table: $("tab-table"), profile: $("tab-profile"), stats: $("tab-stats") };
const views = { table: $("table-view"), profile: $("profile-view"), stats: $("stats-view") };
const tabOrder = Object.keys(tabs);
let statsPage = null;
function selectTab(name) {
  for (const key of tabOrder) {
    const on = key === name;
    tabs[key].setAttribute("aria-selected", String(on));
    tabs[key].tabIndex = on ? 0 : -1;
    views[key].hidden = !on;
  }
  if (name === "stats") statsPage?.show();
}
for (const key of tabOrder) tabs[key].addEventListener("click", () => selectTab(key));
$("tabs").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const cur = tabOrder.findIndex((k) => tabs[k].getAttribute("aria-selected") === "true");
  const next = tabOrder[(cur + (e.key === "ArrowRight" ? 1 : tabOrder.length - 1)) % tabOrder.length];
  selectTab(next);
  tabs[next].focus();
});
$("pf-skip").addEventListener("click", () => selectTab("table"));

async function enterGame(user) {
  if (gameStarted) return;
  gameStarted = true;

  let profile = null;
  try {
    profile = await loadProfile(supabase, user.id);
  } catch (err) {
    console.error("Couldn't load profile", err);
  }
  renderUser(user, profile);
  initProfile({
    supabase,
    user,
    profile,
    googleAvatar: profileOf(user).avatar,
    onSaved: (saved) => {
      renderUser(user, saved);
      $("pf-skip").hidden = true;
    },
  });
  $("pf-skip").hidden = Boolean(profile);

  const recorder = createRecorder(supabase, user.id);
  const strategies = await initStrategies({ supabase, user, onChange: () => statsPage?.refreshFilters() });
  statsPage = initStats({ supabase, user, recorder, getStrategies: strategies.list });
  recorder.flush(); // upload anything left over from a previous session

  const { startGame } = await import("./app.js");
  // loads this player's bankroll before the table is shown; every round is recorded
  startGame(user, {
    getStrategyId: strategies.selectedId,
    onRoundComplete: (payload) => recorder.record(payload),
  });
  // New players land on the Profile tab so they can set one up right away.
  selectTab(profile ? "table" : "profile");
  show("game");
}

function setLoginError(text) {
  const node = $("login-error");
  node.textContent = text;
  node.hidden = !text;
}

$("google-signin").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  setLoginError("");
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) {
    btn.disabled = false;
    setLoginError(`Couldn't start Google sign-in: ${error.message}`);
  }
  // On success the browser is redirected to Google.
});

$("signout").addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.reload(); // simplest way to reset the table for the next player
});

supabase.auth.onAuthStateChange((event, session) => {
  if (session?.user) enterGame(session.user);
  else if (event === "SIGNED_OUT") show("login");
});

// Initial load (also completes the OAuth redirect when ?code=… is present).
const { data, error } = await supabase.auth.getSession();
const params = new URLSearchParams(window.location.search);
const oauthError = params.get("error_description") || params.get("error");
if (params.has("code") || oauthError) {
  history.replaceState(null, "", window.location.pathname); // tidy the URL
}
if (data?.session?.user) {
  enterGame(data.session.user);
} else {
  show("login");
  if (error || oauthError) setLoginError(`Sign-in failed: ${oauthError || error.message}`);
}

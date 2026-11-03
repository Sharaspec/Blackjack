// Entry point: Google sign-in through Supabase Auth, then the game.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

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

function renderUser(user) {
  const { fullName, firstName, avatar, email } = profileOf(user);
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

async function enterGame(user) {
  renderUser(user);
  if (!gameStarted) {
    gameStarted = true;
    const { startGame } = await import("./app.js");
    startGame(user); // loads this player's bankroll before the table is shown
  }
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

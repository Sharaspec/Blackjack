// Profile tab: create / edit the signed-in player's row in public.profiles.
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const BIO_MAX = 280;

const $ = (id) => document.getElementById(id);

export function suggestUsername(user) {
  const meta = user.user_metadata ?? {};
  const base = (meta.full_name || meta.name || user.email || "player")
    .split("@")[0]
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 16);
  return (base.length >= 3 ? base : `player_${base}`).slice(0, 20);
}

export function validateProfile({ username, display_name, bio }) {
  if (!USERNAME_RE.test(username)) {
    return "Username must be 3–20 characters: lowercase letters, numbers, or underscores.";
  }
  if (!display_name.trim() || display_name.trim().length > 50) return "Display name must be 1–50 characters.";
  if (bio.length > BIO_MAX) return `Bio must be ${BIO_MAX} characters or fewer.`;
  return null;
}

function friendlyError(error) {
  if (error?.code === "23505" && /username/.test(error.message)) return "That username is taken — try another.";
  if (error?.code === "23514") return "Some fields aren't valid. Check your username and bio.";
  return `Couldn't save your profile: ${error?.message || "unknown error"}`;
}

export async function loadProfile(supabase, userId) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// Wires up the Profile tab. `onSaved(profile)` lets the header refresh the greeting.
export function initProfile({ supabase, user, profile, googleAvatar, onSaved }) {
  const form = $("profile-form");
  const fields = {
    username: $("pf-username"),
    display_name: $("pf-display-name"),
    bio: $("pf-bio"),
    useGooglePhoto: $("pf-use-photo"),
  };
  const status = $("profile-status");
  const submit = $("pf-submit");
  const bioCount = $("pf-bio-count");
  let current = profile;

  function setStatus(text, kind = "") {
    status.textContent = text;
    status.className = `profile-status ${kind}`;
  }

  function avatarFor() {
    return fields.useGooglePhoto.checked && googleAvatar ? googleAvatar : null;
  }

  function renderCard(p) {
    const preview = p ?? {
      username: fields.username.value || "username",
      display_name: fields.display_name.value || "Your name",
      bio: fields.bio.value,
      avatar_url: avatarFor(),
    };
    $("pc-name").textContent = preview.display_name;
    $("pc-username").textContent = `@${preview.username}`;
    $("pc-bio").textContent = preview.bio || "No bio yet.";
    $("pc-bio").classList.toggle("muted", !preview.bio);
    $("pc-since").textContent = p?.created_at
      ? `Member since ${new Date(p.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}`
      : "Preview";
    const img = $("pc-avatar");
    const initials = $("pc-initials");
    initials.textContent = preview.display_name
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
    if (preview.avatar_url) {
      img.src = preview.avatar_url;
      img.hidden = false;
      initials.hidden = true;
      img.onerror = () => {
        img.hidden = true;
        initials.hidden = false;
      };
    } else {
      img.hidden = true;
      initials.hidden = false;
    }
  }

  function renderMode() {
    const exists = Boolean(current);
    $("profile-title").textContent = exists ? "Your profile" : "Create your profile";
    $("profile-intro").textContent = exists
      ? "Update how other players see you."
      : "Pick a username and tell the table a little about yourself.";
    submit.textContent = exists ? "Save changes" : "Create profile";
    $("profile-tab-dot").hidden = exists;
    fields.useGooglePhoto.closest("label").hidden = !googleAvatar;
  }

  function fill(p) {
    const meta = user.user_metadata ?? {};
    fields.username.value = p?.username ?? suggestUsername(user);
    fields.display_name.value = p?.display_name ?? (meta.full_name || meta.name || "");
    fields.bio.value = p?.bio ?? "";
    fields.useGooglePhoto.checked = p ? Boolean(p.avatar_url) : Boolean(googleAvatar);
    bioCount.textContent = `${fields.bio.value.length}/${BIO_MAX}`;
  }

  fields.username.addEventListener("input", () => {
    const cleaned = fields.username.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (cleaned !== fields.username.value) fields.username.value = cleaned;
    if (!current) renderCard(null);
  });
  for (const f of [fields.display_name, fields.bio, fields.useGooglePhoto]) {
    f.addEventListener("input", () => {
      bioCount.textContent = `${fields.bio.value.length}/${BIO_MAX}`;
      if (!current) renderCard(null);
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const row = {
      username: fields.username.value.trim(),
      display_name: fields.display_name.value.trim(),
      bio: fields.bio.value.trim(),
    };
    const problem = validateProfile(row);
    if (problem) return setStatus(problem, "error");

    const payload = { ...row, bio: row.bio || null, avatar_url: avatarFor() };
    submit.disabled = true;
    setStatus("Saving…");
    const query = current
      ? supabase.from("profiles").update(payload).eq("id", user.id)
      : supabase.from("profiles").insert({ id: user.id, ...payload });
    const { data, error } = await query.select().single();
    submit.disabled = false;
    if (error) return setStatus(friendlyError(error), "error");

    const created = !current;
    current = data;
    fill(current);
    renderMode();
    renderCard(current);
    setStatus(created ? "Profile created! You're all set." : "Profile saved.", "ok");
    onSaved?.(current);
  });

  fill(current);
  renderMode();
  renderCard(current);
}

// Strategy picker on the table + "new strategy" dialog. Rounds are tagged with
// the selected strategy so the Stats tab can compare them.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function initStrategies({ supabase, user, onChange }) {
  const select = $("strategy-select");
  const dialog = $("strategy-dialog");
  const form = $("strategy-form");
  const nameInput = $("sd-name");
  const descInput = $("sd-description");
  const error = $("sd-error");
  const storeKey = `blackjack.strategy.${user.id}`;
  let strategies = [];
  let selected = null;

  try {
    selected = localStorage.getItem(storeKey) || null;
  } catch {
    /* ignore */
  }

  async function load() {
    const { data, error: err } = await supabase.from("strategies").select("*").order("created_at");
    if (err) {
      console.error("Couldn't load strategies", err);
      return;
    }
    strategies = data;
    if (selected && !strategies.some((s) => s.id === selected)) selected = null;
    render();
  }

  function remember() {
    try {
      if (selected) localStorage.setItem(storeKey, selected);
      else localStorage.removeItem(storeKey);
    } catch {
      /* ignore */
    }
  }

  function render() {
    select.innerHTML = [
      `<option value="">No strategy</option>`,
      ...strategies.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`),
      `<option value="__new">+ New strategy…</option>`,
    ].join("");
    select.value = selected ?? "";
    select.title = strategies.find((s) => s.id === selected)?.description ?? "";
    onChange?.(strategies);
  }

  select.addEventListener("change", () => {
    if (select.value === "__new") {
      select.value = selected ?? "";
      error.hidden = true;
      form.reset();
      dialog.showModal();
      nameInput.focus();
      return;
    }
    selected = select.value || null;
    select.title = strategies.find((s) => s.id === selected)?.description ?? "";
    remember();
  });

  $("sd-cancel").addEventListener("click", () => dialog.close());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const description = descInput.value.trim() || null;
    if (!name) {
      error.textContent = "Give your strategy a name.";
      error.hidden = false;
      return;
    }
    const btn = $("sd-save");
    btn.disabled = true;
    const { data, error: err } = await supabase.from("strategies").insert({ name, description }).select().single();
    btn.disabled = false;
    if (err) {
      error.textContent = err.code === "23505" ? "You already have a strategy with that name." : `Couldn't save: ${err.message}`;
      error.hidden = false;
      return;
    }
    strategies.push(data);
    selected = data.id;
    remember();
    render();
    dialog.close();
  });

  await load();
  return {
    selectedId: () => selected,
    list: () => strategies,
  };
}

// Saves finished rounds to Supabase via the record_round() RPC.
// Rounds that can't be sent (offline, API hiccup) wait in a localStorage queue
// and are retried on the next round or when the Stats tab loads.

export function createRecorder(supabase, userId) {
  const key = `blackjack.pendingRounds.${userId}`;
  const listeners = new Set();
  let flushing = null;

  const readQueue = () => {
    try {
      return JSON.parse(localStorage.getItem(key) || "[]");
    } catch {
      return [];
    }
  };
  const writeQueue = (q) => {
    try {
      localStorage.setItem(key, JSON.stringify(q));
    } catch {
      /* storage full or blocked; the round stays in memory until reload */
    }
  };
  const notify = (event) => listeners.forEach((fn) => fn({ ...event, pending: readQueue().length }));

  async function send(payload) {
    const { error } = await supabase.rpc("record_round", { payload });
    if (error) throw new Error(error.message);
  }

  async function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      let q = readQueue();
      while (q.length) {
        try {
          await send(q[0]);
        } catch (err) {
          console.warn("Round upload failed; will retry", err);
          notify({ type: "error", error: err });
          return false;
        }
        q = readQueue().slice(1);
        writeQueue(q);
        notify({ type: "saved" });
      }
      return true;
    })().finally(() => {
      flushing = null;
    });
    return flushing;
  }

  return {
    record(payload) {
      writeQueue([...readQueue(), payload]);
      return flush();
    },
    flush,
    pending: () => readQueue().length,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

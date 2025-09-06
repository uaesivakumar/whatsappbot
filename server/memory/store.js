let mode = "memory";
let supabase = null;

const memory = {
  messages: new Map(),
  summaries: new Map(),
};

async function maybeInitSupabase() {
  const url = process.env.SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_KEY;
  const anon = process.env.SUPABASE_ANON_KEY;
  const key = svc || anon;
  if (!url || !key) {
    console.warn("⚠️ Supabase disabled (no URL or key). Falling back to in-memory.");
    return;
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    supabase = createClient(url, key);
    mode = "supabase";
    console.log(`✅ Memory store: Supabase mode (${svc ? "service_role" : "anon"})`);
  } catch (e) {
    console.warn("⚠️ Supabase client init failed. Using in-memory store.", e?.message);
  }
}

export async function init() {
  await maybeInitSupabase();
}

export async function appendMessage({ waId, role, text, ts = Date.now() }) {
  if (mode === "supabase" && supabase) {
    const { error } = await supabase.from('messages').insert([{ wa_id: waId, role, text, ts }]);
    if (error) console.warn("Supabase insert error:", error.message);
    return;
  }
  const arr = memory.messages.get(waId) || [];
  arr.push({ role, text, ts });
  memory.messages.set(waId, arr);
}

export async function fetchRecentMessages({ waId, limit = 500 }) {
  if (mode === "supabase" && supabase) {
    const { data, error } = await supabase
      .from('messages')
      .select('role,text,ts')
      .eq('wa_id', waId)
      .order('ts', { ascending: false })
      .limit(limit);
    if (error) {
      console.warn("Supabase select error:", error.message);
      return [];
    }
    return (data || []).reverse();
  }
  const arr = memory.messages.get(waId) || [];
  return arr.slice(Math.max(0, arr.length - limit));
}

export async function getLatestSummary(waId) {
  if (mode === "supabase" && supabase) {
    const { data, error } = await supabase
      .from('memory_summaries')
      .select('summary, updated_at')
      .eq('wa_id', waId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn("Supabase select summary error:", error.message);
      return null;
    }
    return data || null;
  }
  return memory.summaries.get(waId) || null;
}

export async function upsertSummary(waId, summary) {
  const payload = { wa_id: waId, summary, updated_at: new Date().toISOString() };
  if (mode === "supabase" && supabase) {
    const { error } = await supabase
      .from('memory_summaries')
      .upsert([payload], { onConflict: 'wa_id' });
    if (error) console.warn("Supabase upsert error:", error.message);
    return;
  }
  memory.summaries.set(waId, { summary, updated_at: payload.updated_at });
}

export async function clearAllMemory() {
  if (mode === "supabase" && supabase) {
    console.warn("clearAllMemory skipped in supabase mode.");
    return;
  }
  memory.messages.clear();
  memory.summaries.clear();
}

export default { init, appendMessage, fetchRecentMessages, getLatestSummary, upsertSummary, clearAllMemory };

import { createClient } from "@supabase/supabase-js";

let _sp = null;
function sp() {
  if (_sp) return _sp;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE env not set");
  _sp = createClient(url, key);
  return _sp;
}

function splitText(t) {
  const s = String(t || "").trim();
  if (!s) return [];
  const sentences = s.match(/[^.!?]+[.!?]+/g) || [s];
  const out = [];
  let cur = "";
  for (const part of sentences) {
    if ((cur + part).length > 800) { if (cur) out.push(cur.trim()); cur = part; }
    else { cur += part; }
  }
  if (cur) out.push(cur.trim());
  if (!out.length) out.push(s.slice(0, 800));
  return out;
}

export async function upsertOne(content, meta = {}) {
  const db = sp();
  const chunks = splitText(content);
  let firstId = null, n = 0;
  for (const c of chunks) {
    const { data, error } = await db.from("kb_chunks")
      .insert({ content: c, meta, updated_at: new Date().toISOString() })
      .select("id").single();
    if (!error && data) { if (!firstId) firstId = data.id; n++; }
    else if (error) console.error("kb insert error:", error.message);
  }
  return { id: firstId, chunks: n };
}

export async function reindex() {
  const db = sp();
  const { count, error } = await db.from("kb_chunks").select("id", { count: "exact", head: true });
  if (error) { console.error("kb reindex error:", error.message); return { chunks: 0 }; }
  return { chunks: count || 0 };
}

export async function count() {
  const db = sp();
  const { count, error } = await db.from("kb_chunks").select("id", { count: "exact", head: true });
  if (error) return 0;
  return count || 0;
}

export async function list({ limit = 20 } = {}) {
  const db = sp();
  const { data, error } = await db.from("kb_chunks")
    .select("id, meta, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return data || [];
}

export async function retrieve(q, { k = 5 } = {}) {
  const db = sp();
  const { data, error } = await db.from("kb_chunks")
    .select("content, meta, updated_at")
    .ilike("content", `%${q}%`)
    .order("updated_at", { ascending: false })
    .limit(k);
  if (error) return [];
  return (data || []).map((r, i) => ({ content: r.content, meta: r.meta || {}, similarity: 1 - i * 0.1 }));
}

export async function answer(q) {
  return `Ok. Searching for: ${String(q || "")}`;
}

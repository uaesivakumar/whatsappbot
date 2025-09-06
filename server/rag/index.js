import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || "";

let _db = null;
function db() {
  if (_db) return _db;
  _db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  return _db;
}

function splitText(t) {
  const s = String(t || "").split(/\n{2,}/).map(x => x.trim()).filter(Boolean);
  const out = [];
  for (const q of s) {
    if (q.length <= 800) { out.push(q); continue; }
    for (let i = 0; i < q.length; i += 800) out.push(q.slice(i, i + 800));
  }
  return out.length ? out : [String(t || "").slice(0, 800)];
}

export async function upsertOne(content, meta = {}) {
  const now = new Date().toISOString();
  const chunks = splitText(content);
  let firstId = null;
  for (const c of chunks) {
    const { data, error } = await db().from("kb_chunks")
      .insert({ content: c, meta, updated_at: now })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    if (!firstId) firstId = data?.id || null;
  }
  return { id: firstId };
}

export async function reindex() {
  const { count, error } = await db().from("kb_chunks").select("id", { count: "exact", head: true });
  return { chunks: error ? 0 : (count || 0) };
}

export async function count() {
  const { count, error } = await db().from("kb_chunks").select("id", { count: "exact", head: true });
  return error ? 0 : (count || 0);
}

export async function list({ limit = 20 } = {}) {
  const { data } = await db().from("kb_chunks")
    .select("id,meta,updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  return data || [];
}

export async function retrieve(q, { k = 5 } = {}) {
  const { data } = await db().from("kb_chunks")
    .select("content,meta,updated_at")
    .ilike("content", `%${q}%`)
    .order("updated_at", { ascending: false })
    .limit(k);
  const rows = data || [];
  return rows.map((r, i) => ({
    content: r.content,
    meta: r.meta || {},
    similarity: 1 - i * 0.1
  }));
}

export async function answer(q) {
  return "Ok. Searching for: " + String(q || "");
}

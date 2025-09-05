import fs from "fs";
import path from "path";
import { createHash } from "crypto";

let _fetch = globalThis.fetch;
if (typeof _fetch !== "function") {
  const nf = await import("node-fetch");
  _fetch = nf.default;
}

let supabase = null;
async function db() {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase not configured");
  const { createClient } = await import("@supabase/supabase-js");
  supabase = createClient(url, key);
  return supabase;
}

async function embed(texts) {
  const r = await _fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "embeddings error");
  return j.data.map(d => d.embedding);
}

function chunk(md) {
  const paras = md.split(/\n{2,}/g).map(s => s.trim()).filter(Boolean);
  const out = [];
  let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length <= 700) cur = cur ? cur + "\n\n" + p : p;
    else { if (cur) out.push(cur); cur = p; }
  }
  if (cur) out.push(cur);
  return out;
}

export async function reindexKnowledge() {
  const file = path.join(process.cwd(), "knowledge", "faq.md");
  const md = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (!md) return { chunks: 0 };
  const pieces = chunk(md);
  const ids = pieces.map(p => createHash("sha256").update(p).digest("hex"));
  const embs = await embed(pieces);
  const rows = pieces.map((content, i) => ({
    id: ids[i], content, embedding: embs[i], meta: { src: "faq.md", idx: i }, updated_at: new Date().toISOString()
  }));
  const client = await db();
  for (const r of rows) {
    const { error } = await client.from("kb_chunks").upsert(r, { onConflict: "id" });
    if (error) throw new Error(error.message);
  }
  return { chunks: rows.length };
}

export async function retrieve(query, k = 5) {
  const topk = Number(process.env.RAG_TOPK || k);
  const [qEmb] = await embed([query]);
  const client = await db();
  const { data, error } = await client.rpc("match_kb", { query_embedding: qEmb, match_count: topk });
  if (error) throw new Error(error.message);
  const min = Number(process.env.RAG_MIN_SIM || 0);
  return (data || []).filter(h => !min || (h.similarity ?? 0) >= min);
}

async function llm(prompt, messages) {
  const r = await _fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "system", content: prompt }, ...messages], temperature: 0.2 })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "chat error");
  return j.choices?.[0]?.message?.content?.trim() || "";
}

export async function answer(userText, { memory, userId }) {
  try {
    const hits = await retrieve(userText, 5);
    if (!hits.length) return null;
    const context = hits.map((h, i) => `#${i + 1}\n${h.content}`).join("\n\n");
    const prompt = "Answer briefly and helpfully using only the provided context. If unsure, say you’re unsure.";
    const msg = [{ role: "user", content: `Context:\n${context}\n\nQuestion: ${userText}` }];
    const out = await llm(prompt, msg);
    return out || null;
  } catch {
    return null;
  }
}

export async function upsertOne(content, meta = {}) {
  const [emb] = await embed([content]);
  const id = createHash("sha256").update(content).digest("hex");
  const client = await db();
  const row = { id, content, embedding: emb, meta, updated_at: new Date().toISOString() };
  const { error } = await client.from("kb_chunks").upsert(row, { onConflict: "id" });
  if (error) throw new Error(error.message);
  return { id };
}

export async function countKb() {
  const client = await db();
  const { data, count, error } = await client.from("kb_chunks").select("id", { head: true, count: "exact" });
  if (error) throw new Error(error.message);
  return count ?? (data ? data.length : 0);
}

export async function listKb(n = 10) {
  const client = await db();
  const { data, error } = await client
    .from("kb_chunks")
    .select("id, meta, updated_at, content")
    .order("updated_at", { ascending: false })
    .limit(Math.min(n, 50));
  if (error) throw new Error(error.message);
  return data || [];
}

export default { reindexKnowledge, retrieve, answer, upsertOne, countKb, listKb };
